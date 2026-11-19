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
/// Page metadata can be inferred from its parent book without a per-page GET.
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

fn directory_prefixes(keys: &[String]) -> HashSet<&str> {
    keys.iter()
        .flat_map(|key| key.match_indices('/').map(|(offset, _)| &key[..offset]))
        .collect()
}

async fn fetch_index_metadata<'a>(
    bucket: &Bucket,
    keys: impl IntoIterator<Item = &'a String>,
) -> HashMap<String, NoteMetadata> {
    let keys: Vec<_> = keys.into_iter().collect();
    let metadata = join_all(keys.iter().map(|key| meta_get(bucket, key))).await;
    keys.into_iter().cloned().zip(metadata).collect()
}

fn top_level_doc(key: &str, stored: Option<&NoteMetadata>) -> FastDoc {
    let mut metadata = NoteMetadata {
        title: Some(path_display_name(key)),
        ..Default::default()
    };
    if let Some(stored) = stored {
        merge_meta(&mut metadata, stored);
    }
    FastDoc {
        path: key.to_string(),
        is_book: metadata.doc_type == DocType::Book,
        metadata,
        is_page: false,
        is_dir: false,
    }
}

fn nested_doc(
    key: &str,
    root: &str,
    parent: Option<&NoteMetadata>,
    stored: Option<&NoteMetadata>,
) -> FastDoc {
    let is_page = parent.is_some_and(|metadata| metadata.doc_type == DocType::Book);
    let mut metadata = NoteMetadata {
        doc_type: if is_page {
            DocType::Page
        } else {
            DocType::Article
        },
        book_ref: parent.map(|_| root.to_string()),
        title: Some(path_display_name(key)),
        ..Default::default()
    };
    if !is_page {
        if let Some(stored) = stored {
            merge_meta(&mut metadata, stored);
        }
    }
    FastDoc {
        path: key.to_string(),
        metadata,
        is_book: false,
        is_page,
        is_dir: false,
    }
}

/// Build the homepage index with at most one R2 GET per document, run concurrently.
/// Never reads list-object custom_metadata (throws 1101 on production R2).
pub async fn index_bucket(bucket: &Bucket) -> Result<BucketIndex> {
    let keys = list_keys(bucket, None).await?;
    let key_set: HashSet<_> = keys.iter().map(String::as_str).collect();
    let prefixes = directory_prefixes(&keys);
    let mut top_level: Vec<_> = keys.iter().filter(|key| !key.contains('/')).collect();
    top_level.sort_by_key(|key| !prefixes.contains(key.as_str()));
    let parents = fetch_index_metadata(bucket, top_level.iter().copied()).await;

    let nested: Vec<_> = keys
        .iter()
        .filter_map(|key| key.split_once('/').map(|(root, _)| (key, root)))
        .collect();
    let articles = fetch_index_metadata(
        bucket,
        nested.iter().filter_map(|&(key, root)| {
            let parent_is_book = parents
                .get(root)
                .is_some_and(|m| m.doc_type == DocType::Book);
            (!parent_is_book).then_some(key)
        }),
    )
    .await;

    let mut docs: Vec<_> = prefixes
        .difference(&key_set)
        .map(|prefix| FastDoc {
            path: (*prefix).to_string(),
            metadata: NoteMetadata::default(),
            is_book: false,
            is_page: false,
            is_dir: true,
        })
        .collect();
    docs.extend(
        top_level
            .into_iter()
            .map(|key| top_level_doc(key, parents.get(key))),
    );
    docs.extend(
        nested
            .into_iter()
            .map(|(key, root)| nested_doc(key, root, parents.get(root), articles.get(key))),
    );

    let page_counts = page_counts_from_docs(&docs);
    Ok(BucketIndex { docs, page_counts })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nested_docs_inherit_page_status_only_from_book_roots() {
        let book = NoteMetadata {
            doc_type: DocType::Book,
            ..Default::default()
        };
        let stored = NoteMetadata {
            title: Some("Stored title".into()),
            ..Default::default()
        };
        let page = nested_doc("book/chapter", "book", Some(&book), None);
        let article = nested_doc("folder/chapter", "folder", None, Some(&stored));
        assert!(page.is_page);
        assert_eq!(page.metadata.book_ref.as_deref(), Some("book"));
        assert!(!article.is_page);
        assert_eq!(article.metadata.book_ref, None);
        assert_eq!(article.metadata.title.as_deref(), Some("Stored title"));
        assert_eq!(
            page_counts_from_docs(&[page, article]),
            HashMap::from([("book".into(), 1)])
        );
    }
}
