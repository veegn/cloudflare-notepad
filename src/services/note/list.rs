//! List/filter notes from R2.
//!
//! Performance notes (production):
//! - R2 `get(key)` transfers the whole object; calling it for every key
//!   makes TOC/home-tree unusable on large buckets (Worker 1101/500).
//! - Prefer a single `list()`; use list custom_metadata when present.
//! - Fall back to path heuristics + **few** GETs (only keys that look like books).

use std::collections::{HashMap, HashSet};

use worker::{Bucket, ListOptionsBuilder, Result};

use crate::models::note::{is_index_path, path_display_name, DocType, NoteMetadata, NoteRecord};

use super::meta;

/// Filters for listing.
pub struct ListOptions {
    pub doc_type: Option<DocType>,
    pub exclude_pages: bool,
    pub book_ref: Option<String>,
    pub limit: usize,
    pub prefix: Option<String>,
    /// Download note bodies (slow). Avoid on list/tree endpoints.
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

fn build_list_request<'a>(bucket: &'a Bucket, prefix: Option<&str>) -> ListOptionsBuilder<'a> {
    let mut list = bucket.list().limit(1000);
    if let Some(p) = prefix {
        if !p.is_empty() {
            list = list.prefix(p);
        }
    }
    list
}

/// Collect keys from one R2 list (no per-key GET).
pub async fn list_keys(bucket: &Bucket, prefix: Option<&str>) -> Result<Vec<String>> {
    let mut keys = Vec::new();
    let objects = build_list_request(bucket, prefix)
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

pub async fn list_keys_with_prefix(bucket: &Bucket, prefix: &str) -> Result<Vec<String>> {
    list_keys(bucket, Some(prefix)).await
}

pub async fn list_book_page_keys(bucket: &Bucket, book_path: &str) -> Result<Vec<String>> {
    let prefix = format!("{}/", book_path.trim_matches('/'));
    list_keys_with_prefix(bucket, &prefix).await
}

/// Metadata-only GET (still downloads object from R2 — use sparingly).
async fn meta_get(bucket: &Bucket, key: &str) -> NoteMetadata {
    match bucket.get(key).execute().await {
        Ok(Some(object)) => {
            let custom = object.custom_metadata().ok().unwrap_or_default();
            meta::from_custom(&custom)
        }
        _ => NoteMetadata::default(),
    }
}

/// Fast structural snapshot of the bucket for homepage tree.
/// One `list()`, then only GET keys that look like books (have children).
pub struct FastDoc {
    pub path: String,
    pub metadata: NoteMetadata,
    pub is_book: bool,
    pub is_page: bool,
    pub is_dir: bool,
}

pub async fn list_docs_fast(bucket: &Bucket) -> Result<Vec<FastDoc>> {
    let keys = list_keys(bucket, None).await?;
    let key_set: HashSet<&str> = keys.iter().map(|s| s.as_str()).collect();

    // All directory prefixes implied by nested keys.
    let mut prefixes: HashSet<String> = HashSet::new();
    for key in &keys {
        if let Some(pos) = key.find('/') {
            let mut acc = String::new();
            for seg in key[..pos].split('/').chain(key[pos + 1..].split('/')) {
                if acc.is_empty() {
                    acc = seg.to_string();
                } else {
                    acc.push('/');
                    acc.push_str(seg);
                }
                // stop before full key; prefixes are ancestors only
                if acc != *key {
                    prefixes.insert(acc.clone());
                } else {
                    break;
                }
            }
        }
    }

    let mut out: Vec<FastDoc> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut classify_gets = 0usize;
    const MAX_CLASSIFY_GETS: usize = 24;

    // Virtual directories that are not themselves objects.
    for prefix in &prefixes {
        if key_set.contains(prefix.as_str()) || seen.contains(prefix) {
            continue;
        }
        seen.insert(prefix.clone());
        out.push(FastDoc {
            path: prefix.clone(),
            metadata: NoteMetadata::default(),
            is_book: false,
            is_page: false,
            is_dir: true,
        });
    }

    for key in &keys {
        if seen.contains(key) {
            continue;
        }
        seen.insert(key.clone());

        let nested = key.contains('/');
        let has_children = prefixes.contains(key.as_str());

        if nested {
            // Nested objects: treat as pages/articles without GET.
            // Hide under-book pages from the homepage tree (caller filters pages).
            let root = key.split('/').next().unwrap_or(key).to_string();
            let under_object = key_set.contains(root.as_str());
            let root_is_book = if under_object {
                // Only GET the root when we must classify; reuse later via meta_get cache
                false
            } else {
                false
            };
            let _ = root_is_book;
            out.push(FastDoc {
                path: key.clone(),
                metadata: NoteMetadata {
                    doc_type: if under_object {
                        // likely page under a book/dir object
                        DocType::Page
                    } else {
                        DocType::Article
                    },
                    book_ref: if under_object { Some(root) } else { None },
                    title: Some(path_display_name(key)),
                    ..Default::default()
                },
                is_book: false,
                is_page: under_object,
                is_dir: false,
            });
            continue;
        }

        // Top-level object.
        if has_children {
            // Candidate book — classify with GET, but cap GETs so noisy
            // buckets cannot blow the Worker CPU budget.
            classify_gets += 1;
            let metadata = if classify_gets <= MAX_CLASSIFY_GETS {
                let m = meta_get(bucket, key).await;
                NoteMetadata {
                    doc_type: DocType::Book,
                    title: m.title.clone().or_else(|| Some(path_display_name(key))),
                    update_at: m.update_at,
                    pw: m.pw.clone(),
                    share: m.share,
                    mode: m.mode,
                    ..Default::default()
                }
            } else {
                NoteMetadata {
                    doc_type: DocType::Book,
                    title: Some(path_display_name(key)),
                    ..Default::default()
                }
            };
            out.push(FastDoc {
                path: key.clone(),
                metadata,
                is_book: true,
                is_page: false,
                is_dir: false,
            });
        } else {
            out.push(FastDoc {
                path: key.clone(),
                metadata: NoteMetadata {
                    doc_type: DocType::Article,
                    title: Some(path_display_name(key)),
                    ..Default::default()
                },
                is_book: false,
                is_page: false,
                is_dir: false,
            });
        }
    }

    Ok(out)
}

/// Metadata list used by APIs that can afford list+optional light GETs.
/// Does **not** download bodies. Uses list custom_metadata when available.
pub async fn list_doc_metas(
    bucket: &Bucket,
    opts: &ListOptions,
) -> Result<Vec<(String, NoteMetadata)>> {
    let mut out = Vec::new();
    let objects = build_list_request(bucket, opts.prefix.as_deref())
        .execute()
        .await?
        .objects();

    for obj in objects {
        let key = obj.key();
        if is_index_path(&key) {
            continue;
        }
        // Prefer list metadata; do not GET by default (body transfer is expensive).
        let mut metadata = match obj.custom_metadata() {
            Ok(custom) if !custom.is_empty() => meta::from_custom(&custom),
            _ => NoteMetadata::default(),
        };

        // Heuristic when metadata missing: nested paths look like pages.
        if metadata.doc_type == DocType::Article && key.contains('/') {
            metadata.doc_type = DocType::Page;
            let root = key.split('/').next().unwrap_or("").to_string();
            if !root.is_empty() {
                metadata.book_ref = Some(root);
            }
        }
        if metadata.title.is_none() {
            metadata.title = Some(path_display_name(&key));
        }

        if !matches_filters(&metadata, opts) {
            continue;
        }
        out.push((key, metadata));
    }

    out.sort_by(|a, b| {
        b.1.update_at
            .unwrap_or(0)
            .cmp(&a.1.update_at.unwrap_or(0))
            .then_with(|| a.0.cmp(&b.0))
    });
    out.truncate(opts.limit.max(1));
    Ok(out)
}

/// Full records with bodies — only for APIs that truly need content (search/adopt).
pub async fn list_all_docs(bucket: &Bucket, opts: &ListOptions) -> Result<Vec<NoteRecord>> {
    let metas = list_doc_metas(bucket, opts).await?;
    let mut out = Vec::with_capacity(metas.len());
    for (path, metadata) in metas {
        let content = if opts.include_body {
            match bucket.get(&path).execute().await? {
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
            path,
            content,
            metadata,
        });
    }
    Ok(out)
}

/// Convert fast docs into homepage records (no bodies).
pub fn fast_docs_to_records(docs: Vec<FastDoc>) -> Vec<NoteRecord> {
    docs.into_iter()
        .map(|d| NoteRecord {
            path: d.path,
            content: String::new(),
            metadata: d.metadata,
        })
        .collect()
}

/// Count pages per book using prefix keys only (no body download).
pub async fn book_page_counts(bucket: &Bucket) -> Result<HashMap<String, u32>> {
    let mut counts: HashMap<String, u32> = HashMap::new();
    // One full list; count nested keys as pages of their top-level book prefix.
    let keys = list_keys(bucket, None).await?;
    for key in keys {
        if !key.contains('/') {
            continue;
        }
        let root = key.split('/').next().unwrap_or("").to_string();
        if root.is_empty() || is_index_path(&root) {
            continue;
        }
        *counts.entry(root).or_insert(0) += 1;
    }
    Ok(counts)
}

/// Records visible on homepage tree (articles + books + virtual dirs, pages excluded).
pub async fn list_visible_docs_fast(bucket: &Bucket) -> Result<Vec<NoteRecord>> {
    let fast = list_docs_fast(bucket).await?;
    let docs = fast
        .into_iter()
        .filter(|d| !d.is_page && !is_index_path(&d.path))
        .map(|d| {
            let mut metadata = d.metadata;
            if d.is_dir {
                metadata.doc_type = DocType::Article; // tree builder uses path shape for dirs
            }
            if d.is_book {
                metadata.doc_type = DocType::Book;
            }
            NoteRecord {
                path: d.path,
                content: String::new(),
                metadata,
            }
        })
        .collect();
    Ok(docs)
}
