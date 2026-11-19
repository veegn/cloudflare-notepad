//! Shared R2 snapshots with a short-lived, per-data-center edge cache.

use std::collections::BTreeSet;

use futures::{stream, StreamExt};
use serde_json::Value;
use sha2::{Digest, Sha256};
use worker::{Bucket, Cache, Conditional, Context, Date, Response, Result};

pub const HOME_TREE_CACHE_KEY: &str = "_meta/home-tree.json";
const TOC_CACHE_PREFIX: &str = "_meta/toc/v2/";
const SNAPSHOT_TTL_SECS: u64 = 120;
const EDGE_TTL_SECS: u64 = 10;

#[derive(serde::Serialize, serde::Deserialize)]
struct CacheEnvelope {
    updated_at: u64,
    payload: Value,
    #[serde(default)]
    revision: String,
}

pub fn toc_cache_key(book_path: &str) -> String {
    format!(
        "{TOC_CACHE_PREFIX}{}.json",
        hex::encode(Sha256::digest(book_path.as_bytes()))
    )
}

fn edge_key(origin: &str, key: &str) -> String {
    format!("{origin}/__scn_cache/v2/{key}")
}

fn now_secs() -> u64 {
    Date::now().as_millis() / 1000
}

fn revision() -> Option<String> {
    let mut bytes = [0; 16];
    getrandom::fill(&mut bytes).ok()?;
    Some(hex::encode(bytes))
}

pub struct CacheRead {
    pub payload: Option<Value>,
    etag: Option<String>,
}

pub async fn read_json_cache(
    context: &Context,
    bucket: &Bucket,
    origin: &str,
    key: &str,
    refresh: bool,
) -> CacheRead {
    let edge_key = edge_key(origin, key);
    let mut result = CacheRead {
        payload: None,
        etag: None,
    };
    if !refresh {
        if let Ok(Some(mut edge)) = Cache::default().get(&edge_key, false).await {
            if let Ok(payload) = edge.json().await {
                result.payload = Some(payload);
                return result;
            }
        }
    }

    if refresh {
        result.etag = bucket
            .head(key)
            .await
            .ok()
            .flatten()
            .map(|object| object.etag());
        return result;
    }
    if let Ok(Some(object)) = bucket.get(key).execute().await {
        result.etag = Some(object.etag());
        if let Some(body) = object.body() {
            if let Ok(envelope) = parse_envelope(body).await {
                let remaining = envelope
                    .updated_at
                    .saturating_add(SNAPSHOT_TTL_SECS)
                    .saturating_sub(now_secs());
                if remaining > 0 && !envelope.payload.is_null() {
                    if let Ok(response) = edge_response(&envelope.payload, remaining) {
                        context.wait_until(async move {
                            let _ = Cache::default().put(&edge_key, response).await;
                        });
                    }
                    result.payload = Some(envelope.payload);
                }
            }
        }
    }
    result
}

async fn parse_envelope(body: worker::ObjectBody<'_>) -> Result<CacheEnvelope> {
    Ok(serde_json::from_str(&body.text().await?)?)
}

/// Reserve a unique revision before building a missing snapshot. Invalidation
/// deletes it, so a builder that started before a mutation cannot refill R2.
pub async fn reserve_cache_fill(bucket: &Bucket, key: &str, read: CacheRead) -> Option<String> {
    if read.etag.is_some() {
        return read.etag;
    }
    let marker = serde_json::to_string(&CacheEnvelope {
        updated_at: 0,
        payload: Value::Null,
        revision: revision()?,
    })
    .ok()?;
    bucket
        .put(key, marker)
        .only_if(Conditional {
            etag_does_not_match: Some("*".into()),
            ..Default::default()
        })
        .execute()
        .await
        .ok()
        .flatten()
        .map(|object| object.etag())
}

pub fn schedule_cache_fill(
    context: &Context,
    bucket: &Bucket,
    origin: &str,
    key: &str,
    etag: Option<String>,
    payload: &Value,
) {
    let (Some(etag), Some(revision)) = (etag, revision()) else {
        return;
    };
    let envelope = CacheEnvelope {
        updated_at: now_secs(),
        payload: payload.clone(),
        revision,
    };
    let bucket = bucket.clone();
    let edge_key = edge_key(origin, key);
    let key = key.to_string();
    context.wait_until(async move {
        let Ok(text) = serde_json::to_string(&envelope) else {
            return;
        };
        let saved = bucket
            .put(key, text)
            .only_if(Conditional {
                etag_matches: Some(etag),
                ..Default::default()
            })
            .execute()
            .await;
        if matches!(saved, Ok(Some(_))) {
            if let Ok(response) = edge_response(&envelope.payload, SNAPSHOT_TTL_SECS) {
                let _ = Cache::default().put(&edge_key, response).await;
            }
        }
    });
}

fn edge_response(payload: &Value, remaining: u64) -> Result<Response> {
    let response = Response::from_json(payload)?;
    response.headers().set(
        "Cache-Control",
        &format!("public, max-age={}", remaining.min(EDGE_TTL_SECS)),
    )?;
    Ok(response)
}

pub async fn invalidate_for_paths(bucket: &Bucket, origin: &str, paths: &[&str]) {
    let mut keys = BTreeSet::new();
    for path in paths {
        let path = path.trim_matches('/');
        if path.is_empty() || crate::models::note::is_system_key(path) {
            continue;
        }
        keys.insert(HOME_TREE_CACHE_KEY.to_string());
        keys.insert(toc_cache_key(path));
        if let Some((root, _)) = path.split_once('/') {
            keys.insert(toc_cache_key(root));
        }
    }
    let keys: Vec<_> = keys.into_iter().collect();
    for chunk in keys.chunks(1000) {
        let edge = Cache::default();
        let evict = stream::iter(chunk.iter().map(|key| {
            let edge = &edge;
            async move {
                let _ = edge.delete(edge_key(origin, key), false).await;
            }
        }))
        .buffer_unordered(5)
        .collect::<Vec<_>>();
        let (deleted, _) = futures::join!(bucket.delete_multiple(chunk.to_vec()), evict);
        if let Err(error) = deleted {
            worker::console_error!("Unable to invalidate R2 cache: {}", error);
        }
    }
}
