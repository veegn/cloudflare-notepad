//! R2-backed JSON caches for expensive list/tree/TOC endpoints.
//!
//! Keys (not user documents):
//! - `_meta/home-tree.json`
//! - `_meta/toc/<book-path-with-slashes-replaced>.json`
//!
//! Invalidation: delete cache objects on note/book mutations. TTL is a
//! safety net if a write path misses invalidation.

use worker::{Bucket, Result};

pub const HOME_TREE_CACHE_KEY: &str = "_meta/home-tree.json";
pub const TOC_CACHE_PREFIX: &str = "_meta/toc/";
/// Freshness window when cache was not explicitly invalidated.
pub const CACHE_TTL_SECS: i64 = 120;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CacheEnvelope {
    pub updated_at: i64,
    pub payload: serde_json::Value,
}

pub fn toc_cache_key(book_path: &str) -> String {
    let safe = book_path.trim_matches('/').replace('/', "__");
    format!("{TOC_CACHE_PREFIX}{safe}.json")
}

fn now_unix() -> i64 {
    (js_sys::Date::now() / 1000.0) as i64
}

/// Read a cache object if present and within TTL.
pub async fn read_json_cache(bucket: &Bucket, key: &str) -> Option<serde_json::Value> {
    let object = bucket.get(key).execute().await.ok()??;
    let text = object.body()?.text().await.ok()?;
    let envelope: CacheEnvelope = serde_json::from_str(&text).ok()?;
    if now_unix() - envelope.updated_at > CACHE_TTL_SECS {
        return None;
    }
    Some(envelope.payload)
}

/// Write a cache object (best-effort; failures must not break the request).
pub async fn write_json_cache(bucket: &Bucket, key: &str, payload: &serde_json::Value) {
    let envelope = CacheEnvelope {
        updated_at: now_unix(),
        payload: payload.clone(),
    };
    if let Ok(text) = serde_json::to_string(&envelope) {
        let _ = bucket.put(key, text).execute().await;
    }
}

/// Drop caches affected by a path mutation.
pub async fn invalidate_for_path(bucket: &Bucket, path: &str) {
    let _ = bucket.delete(HOME_TREE_CACHE_KEY).await;
    let path = path.trim_matches('/');
    if path.is_empty() {
        return;
    }
    // Drop TOC cache for the book itself and for the top-level prefix.
    let _ = bucket.delete(&toc_cache_key(path)).await;
    if let Some(root) = path.split('/').next() {
        if !root.is_empty() && root != path {
            let _ = bucket.delete(&toc_cache_key(root)).await;
        }
    }
}

/// Drop all known structured caches (used by cleanup tooling).
pub async fn invalidate_all(bucket: &Bucket) {
    let _ = bucket.delete(HOME_TREE_CACHE_KEY).await;
    if let Ok(list) = bucket
        .list()
        .prefix(TOC_CACHE_PREFIX)
        .limit(1000)
        .execute()
        .await
    {
        for obj in list.objects() {
            let _ = bucket.delete(&obj.key()).await;
        }
    }
}
