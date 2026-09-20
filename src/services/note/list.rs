//! List/filter notes from R2.
//!
//! Performance: prefer `list()` metadata and never download object bodies
//! unless explicitly requested. Full-body listing is O(N) network and is
//! what made book TOC / home-tree slow on large buckets.

use std::collections::{HashMap, HashSet};

use worker::{Bucket, ListOptionsBuilder, Result};

use crate::models::note::{is_index_path, DocType, NoteMetadata, NoteRecord};

use super::meta;

/// Filters for listing.
pub struct ListOptions {
    pub doc_type: Option<DocType>,
    /// When true, skip `docType=page` objects (homepage default).
    pub exclude_pages: bool,
    pub book_ref: Option<String>,
    pub limit: usize,
    /// Optional R2 key prefix (e.g. `network_concepts/`).
    pub prefix: Option<String>,
    /// Download note bodies (slow). Default for listings is false.
    pub include_body: bool,
}

impl Default for ListOptions {
    fn default() -> Self {
        Self {
            doc_type: None,
            exclude_pages: false,
            book_ref: None,
            limit: 200,
            prefix: None,
            include_body: false,
        }
    }
}

/// Lightweight row: path + metadata, no body.
#[derive(Debug, Clone)]
pub struct DocMeta {
    pub path: String,
    pub metadata: NoteMetadata,
}

fn matches_filters(metadata: &NoteMetadata, opts: &ListOptions) -> bool {
    if opts.exclude_pages && metadata.doc_type == DocType::Page {
        return false;
    }
    if let Some(dt) = opts.doc_type {
        if metadata.doc_type != dt {
            return false;
        }
    }
    if let Some(br) = &opts.book_ref {
        if metadata.book_ref.as_deref() != Some(br.as_str()) {
            return false;
        }
    }
    true
}

fn build_list_request<'a>(
    bucket: &'a Bucket,
    prefix: Option<&str>,
) -> ListOptionsBuilder<'a> {
    let mut list = bucket.list().limit(1000);
    if let Some(p) = prefix {
        if !p.is_empty() {
            list = list.prefix(p);
        }
    }
    list
}

/// Read custom_metadata from list object; fall back to GET **without body**.
async fn read_meta(bucket: &Bucket, key: &str, list_custom: HashMap<String, String>) -> NoteMetadata {
    if !list_custom.is_empty() {
        return meta::from_custom(&list_custom);
    }
    // Fallback when local/miniflare list omits custom_metadata.
    match bucket.get(key).execute().await {
        Ok(Some(object)) => {
            let custom = object.custom_metadata().unwrap_or_default();
            meta::from_custom(&custom)
        }
        _ => NoteMetadata::default(),
    }
}

/// Fast metadata list (no bodies). Sorted updateAt desc, then path.
pub async fn list_doc_metas(bucket: &Bucket, opts: &ListOptions) -> Result<Vec<DocMeta>> {
    let mut out: Vec<DocMeta> = Vec::new();
    let limit = opts.limit.max(1);
    let objects = build_list_request(bucket, opts.prefix.as_deref())
        .execute()
        .await?
        .objects();

    for obj in objects {
        let key = obj.key();
        if is_index_path(&key) {
            continue;
        }
        let list_custom = obj.custom_metadata().unwrap_or_default();
        let metadata = read_meta(bucket, &key, list_custom).await;
        if !matches_filters(&metadata, opts) {
            continue;
        }
        out.push(DocMeta {
            path: key,
            metadata,
        });
    }

    out.sort_by(|a, b| {
        b.metadata
            .update_at
            .unwrap_or(0)
            .cmp(&a.metadata.update_at.unwrap_or(0))
            .then_with(|| a.path.cmp(&b.path))
    });
    out.truncate(limit);
    Ok(out)
}

/// List keys under a prefix (single R2 list, no per-key GET).
pub async fn list_keys_with_prefix(bucket: &Bucket, prefix: &str) -> Result<Vec<String>> {
    let mut keys = Vec::new();
    let objects = build_list_request(bucket, Some(prefix))
        .execute()
        .await?
        .objects();
    for obj in objects {
        let key = obj.key();
        if is_index_path(&key) {
            continue;
        }
        keys.push(key);
    }
    Ok(keys)
}

/// Existing page paths for a book: prefix scan (fast).
pub async fn list_book_page_keys(bucket: &Bucket, book_path: &str) -> Result<Vec<String>> {
    let prefix = format!("{}/", book_path.trim_matches('/'));
    list_keys_with_prefix(bucket, &prefix).await
}

/// Metadata map for known keys (no bodies).
#[allow(dead_code)]
pub async fn doc_metas_for_keys(
    bucket: &Bucket,
    keys: &[String],
) -> Result<HashMap<String, NoteMetadata>> {
    let mut map = HashMap::new();
    for key in keys {
        let custom = match bucket.get(key).execute().await {
            Ok(Some(object)) => object.custom_metadata().unwrap_or_default(),
            _ => HashMap::new(),
        };
        map.insert(key.clone(), meta::from_custom(&custom));
    }
    Ok(map)
}

/// Full records including bodies (slow path — notes list with excerpt, adopt, etc.).
pub async fn list_all_docs(bucket: &Bucket, opts: &ListOptions) -> Result<Vec<NoteRecord>> {
    let metas = list_doc_metas(bucket, opts).await?;
    let mut out = Vec::with_capacity(metas.len());
    for m in metas {
        let content = if opts.include_body {
            match bucket.get(&m.path).execute().await? {
                Some(object) => match object.body() {
                    Some(b) => b.text().await.unwrap_or_default(),
                    None => String::new(),
                },
                None => String::new(),
            }
        } else {
            String::new()
        };
        out.push(NoteRecord {
            path: m.path,
            content,
            metadata: m.metadata,
        });
    }
    Ok(out)
}

/// Build homepage tree inputs without downloading note bodies.
pub async fn list_visible_docs_fast(bucket: &Bucket) -> Result<Vec<NoteRecord>> {
    let metas = list_doc_metas(
        bucket,
        &ListOptions {
            exclude_pages: true,
            limit: 2000,
            include_body: false,
            ..Default::default()
        },
    )
    .await?;

    Ok(metas
        .into_iter()
        .map(|m| NoteRecord {
            path: m.path,
            content: String::new(),
            metadata: m.metadata,
        })
        .collect())
}

/// Count pages per bookRef via prefix keys + metadata only when needed.
pub async fn book_page_counts(bucket: &Bucket) -> Result<HashMap<String, u32>> {
    let pages = list_doc_metas(
        bucket,
        &ListOptions {
            doc_type: Some(DocType::Page),
            exclude_pages: false,
            limit: 5000,
            include_body: false,
            ..Default::default()
        },
    )
    .await?;
    let mut counts: HashMap<String, u32> = HashMap::new();
    for p in pages {
        if let Some(br) = p.metadata.book_ref {
            *counts.entry(br).or_insert(0) += 1;
        }
    }
    Ok(counts)
}

/// Path set under prefix — for TOC exists checks without bodies.
#[allow(dead_code)]
pub async fn path_set_with_prefix(bucket: &Bucket, prefix: &str) -> Result<HashSet<String>> {
    Ok(list_keys_with_prefix(bucket, prefix)
        .await?
        .into_iter()
        .collect())
}
