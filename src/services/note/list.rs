//! List/filter notes from R2.
//!
//! Performance notes (production):
//! - R2 `get(key)` transfers the whole object; calling it for every key
//!   makes TOC/home-tree unusable on large buckets (Worker 1101/500).
//! - **Never** call `custom_metadata()` on list() objects — some Workers/R2
//!   combos throw a JS exception (HTTP 1101) instead of returning Err.
//! - Full GET custom_metadata is safe; use it only where titles are required.

use std::collections::{HashMap, HashSet};

use futures::future::join_all;
use worker::{Bucket, ListOptionsBuilder, Result};

use crate::models::note::{is_system_key, path_display_name, DocType, NoteMetadata, NoteRecord};

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
        if is_system_key(&key) {
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
/// Full-object `custom_metadata()` is safe; list-object access is not.
async fn meta_get(bucket: &Bucket, key: &str) -> NoteMetadata {
    match bucket.get(key).execute().await {
        Ok(Some(object)) => {
            let custom = object.custom_metadata().ok().unwrap_or_default();
            meta::from_custom(&custom)
        }
        _ => NoteMetadata::default(),
    }
}

fn merge_meta(base: &mut NoteMetadata, m: &NoteMetadata) {
    if m.title
        .as_deref()
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false)
    {
        base.title = m.title.clone();
    }
    if m.doc_type != DocType::Article {
        base.doc_type = m.doc_type;
    }
    if m.update_at.is_some() {
        base.update_at = m.update_at;
    }
    if m.pw.is_some() {
        base.pw = m.pw.clone();
    }
    if !m.share {
        base.share = m.share;
    }
    if m.mode != crate::models::note::NoteMode::Plain {
        base.mode = m.mode;
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

/// One-pass bucket index: docs + per-book page counts from a single list().
pub struct BucketIndex {
    pub docs: Vec<FastDoc>,
    pub page_counts: HashMap<String, u32>,
}

fn page_counts_from_docs(docs: &[FastDoc]) -> HashMap<String, u32> {
    let mut counts: HashMap<String, u32> = HashMap::new();
    for d in docs {
        if d.is_page {
            if let Some(root) = d.path.split('/').next() {
                if !root.is_empty() {
                    *counts.entry(root.to_string()).or_insert(0) += 1;
                }
            }
        }
    }
    counts
}

/// Build the homepage index with at most one R2 GET per document, run concurrently.
/// Never reads list-object custom_metadata (throws 1101 on production R2).
pub async fn index_bucket(bucket: &Bucket) -> Result<BucketIndex> {
    let list = build_list_request(bucket, None).execute().await?;
    let mut keys: Vec<String> = Vec::new();
    for obj in list.objects() {
        let key = obj.key();
        if is_system_key(&key) {
            continue;
        }
        keys.push(key);
    }

    let key_set: HashSet<String> = keys.iter().cloned().collect();

    // All directory prefixes implied by nested keys.
    let mut prefixes: HashSet<String> = HashSet::new();
    for key in &keys {
        if let Some(pos) = key.find('/') {
            let mut acc = String::new();
            let head = &key[..pos];
            acc.push_str(head);
            prefixes.insert(acc.clone());
            let rest = &key[pos + 1..];
            for seg in rest.split('/') {
                acc.push('/');
                acc.push_str(seg);
                if acc != *key {
                    prefixes.insert(acc.clone());
                }
            }
        }
    }

    // Resolve real title/docType via full GET (safe). Parents/books first.
    let mut need_get: Vec<String> = keys
        .iter()
        .filter(|k| !k.contains('/'))
        .cloned()
        .collect();
    need_get.sort_by_key(|k| !prefixes.contains(k.as_str()));

    let fetched = join_all(need_get.iter().map(|k| meta_get(bucket, k))).await;
    let mut resolved: HashMap<String, NoteMetadata> = HashMap::new();
    for (key, meta) in need_get.iter().zip(fetched) {
        resolved.insert(key.clone(), meta);
    }

    let mut out: Vec<FastDoc> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut top_doc_type: HashMap<String, DocType> = HashMap::new();

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

    // Top-level objects.
    let mut top_level: Vec<&String> = keys
        .iter()
        .filter(|k| !k.contains('/') && !seen.contains(k.as_str()))
        .collect();
    top_level.sort_by_key(|k| !prefixes.contains(k.as_str()));

    for key in top_level {
        seen.insert(key.clone());
        let mut metadata = NoteMetadata {
            title: Some(path_display_name(key)),
            ..Default::default()
        };
        if let Some(m) = resolved.get(key) {
            metadata.doc_type = m.doc_type;
            merge_meta(&mut metadata, m);
        }

        let is_book = metadata.doc_type == DocType::Book;
        top_doc_type.insert(key.clone(), metadata.doc_type);
        out.push(FastDoc {
            path: key.clone(),
            metadata,
            is_book,
            is_page: false,
            is_dir: false,
        });
    }

    // Nested non-page articles that still need titles.
    let nested_need_get: Vec<String> = keys
        .iter()
        .filter(|k| k.contains('/') && !seen.contains(k.as_str()))
        .filter(|k| {
            let root = k.split('/').next().unwrap_or(k);
            top_doc_type.get(root) != Some(&DocType::Book)
        })
        .cloned()
        .collect();
    let nested_fetched = join_all(nested_need_get.iter().map(|k| meta_get(bucket, k))).await;
    for (key, meta) in nested_need_get.iter().zip(nested_fetched) {
        resolved.insert(key.clone(), meta);
    }

    // Nested keys: pages only when parent is a book; otherwise nested articles.
    for key in &keys {
        if !key.contains('/') || seen.contains(key) {
            continue;
        }
        seen.insert(key.clone());
        let root = key.split('/').next().unwrap_or(key).to_string();
        let parent_is_book = top_doc_type.get(&root) == Some(&DocType::Book);
        if parent_is_book {
            out.push(FastDoc {
                path: key.clone(),
                metadata: NoteMetadata {
                    doc_type: DocType::Page,
                    book_ref: Some(root),
                    title: Some(path_display_name(key)),
                    ..Default::default()
                },
                is_book: false,
                is_page: true,
                is_dir: false,
            });
        } else if key_set.contains(root.as_str()) || prefixes.contains(&root) {
            let book_ref = if key_set.contains(root.as_str()) {
                Some(root.clone())
            } else {
                None
            };
            let mut metadata = NoteMetadata {
                doc_type: DocType::Article,
                book_ref,
                title: Some(path_display_name(key)),
                ..Default::default()
            };
            if let Some(m) = resolved.get(key) {
                merge_meta(&mut metadata, m);
            }
            out.push(FastDoc {
                path: key.clone(),
                metadata,
                is_book: false,
                is_page: false,
                is_dir: false,
            });
        }
    }

    let page_counts = page_counts_from_docs(&out);
    Ok(BucketIndex {
        docs: out,
        page_counts,
    })
}

/// Metadata list used by APIs that can afford list+optional light GETs.
/// Path heuristics only for the list pass — list custom_metadata is unsafe.
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
        if is_system_key(&key) {
            continue;
        }
        // Never call list-object custom_metadata (throws 1101 on production R2).
        let mut metadata = NoteMetadata::default();
        if key.contains('/') {
            metadata.doc_type = DocType::Page;
            let root = key.split('/').next().unwrap_or("").to_string();
            if !root.is_empty() {
                metadata.book_ref = Some(root);
            }
        } else {
            metadata.doc_type = DocType::Article;
        }
        metadata.title = Some(path_display_name(&key));

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
    for (path, mut metadata) in metas {
        let content = if opts.include_body {
            match bucket.get(&path).execute().await? {
                Some(object) => {
                    let custom = object.custom_metadata().ok().unwrap_or_default();
                    if !custom.is_empty() {
                        let real = meta::from_custom(&custom);
                        if real
                            .title
                            .as_deref()
                            .map(|t| !t.trim().is_empty())
                            .unwrap_or(false)
                        {
                            metadata.title = real.title.clone();
                        }
                        metadata.doc_type = real.doc_type;
                        metadata.update_at = real.update_at;
                        metadata.pw = real.pw.clone();
                        metadata.share = real.share;
                        metadata.mode = real.mode;
                        metadata.book_ref = real.book_ref.clone();
                    }
                    match object.body() {
                        Some(b) => b.text().await.unwrap_or_default(),
                        None => String::new(),
                    }
                }
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

/// Count pages per book. Prefers the one-pass index; falls back to keys only.
pub async fn book_page_counts(bucket: &Bucket) -> Result<HashMap<String, u32>> {
    Ok(index_bucket(bucket).await?.page_counts)
}

/// Records visible on homepage tree (articles + books; pages and virtual dirs excluded).
/// Virtual directories are implied by nested paths in `build_home_tree` — do not
/// insert them as leaf nodes or they render as articles with children.
pub fn visible_docs_from_index(index: BucketIndex) -> Vec<NoteRecord> {
    index
        .docs
        .into_iter()
        .filter(|d| !d.is_page && !d.is_dir && !is_system_key(&d.path))
        .map(|d| {
            let metadata = if d.is_book {
                NoteMetadata {
                    doc_type: DocType::Book,
                    ..d.metadata
                }
            } else {
                d.metadata
            };
            NoteRecord {
                path: d.path,
                content: String::new(),
                metadata,
            }
        })
        .collect()
}
