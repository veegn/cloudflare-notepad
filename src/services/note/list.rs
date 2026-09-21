//! List/filter notes from R2.
//!
//! Performance notes (production):
//! - R2 `get(key)` transfers the whole object; calling it for every key
//!   makes TOC/home-tree unusable on large buckets (Worker 1101/500).
//! - Prefer a single `list()`; use list custom_metadata when present.
//! - Fall back to path heuristics + **few** GETs (only keys that look like books).

use std::collections::{HashMap, HashSet};

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

    let mut out: Vec<FastDoc> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut classify_gets = 0usize;
    const MAX_CLASSIFY_GETS: usize = 24;
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

    // Classify top-level objects first (so nested keys can follow book vs article).
    for key in &keys {
        if key.contains('/') || seen.contains(key) {
            continue;
        }
        seen.insert(key.clone());

        let has_children = prefixes.contains(key.as_str());
        let mut metadata = NoteMetadata {
            title: Some(path_display_name(key)),
            ..Default::default()
        };

        if has_children && classify_gets < MAX_CLASSIFY_GETS {
            classify_gets += 1;
            let m = meta_get(bucket, key).await;
            // Respect real docType. Only `book` becomes a book — having
            // child keys (e.g. `sub/xxx`) is NOT enough.
            metadata.doc_type = m.doc_type;
            if m.title
                .as_deref()
                .map(|t| !t.trim().is_empty())
                .unwrap_or(false)
            {
                metadata.title = m.title.clone();
            }
            metadata.update_at = m.update_at;
            metadata.pw = m.pw.clone();
            metadata.share = m.share;
            metadata.mode = m.mode;
        } else {
            metadata.doc_type = DocType::Article;
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
            // Nested article (or child of a non-book prefix) — not a book page.
            let book_ref = if key_set.contains(root.as_str()) {
                Some(root.clone())
            } else {
                None
            };
            out.push(FastDoc {
                path: key.clone(),
                metadata: NoteMetadata {
                    doc_type: DocType::Article,
                    book_ref,
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
        if is_system_key(&key) {
            continue;
        }
        // Never call list-object custom_metadata here: on some Workers/R2
        // combinations it throws (1101/500). Use path heuristics instead.
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

/// Count pages per book using prefix keys only (no body download).
/// Only counts nested keys whose top-level parent is a known book object.
pub async fn book_page_counts(bucket: &Bucket) -> Result<HashMap<String, u32>> {
    let mut counts: HashMap<String, u32> = HashMap::new();
    let keys = list_keys(bucket, None).await?;
    let mut tops: HashMap<String, DocType> = HashMap::new();
    for key in &keys {
        if key.contains('/') {
            continue;
        }
        let mut meta = NoteMetadata::default();
        // cheap: only GET top-level keys (few compared to full tree)
        if let Ok(Some(object)) = bucket.get(key).execute().await {
            let custom = object.custom_metadata().unwrap_or_default();
            meta = super::meta::from_custom(&custom);
        }
        tops.insert(key.clone(), meta.doc_type);
    }
    for key in &keys {
        if !key.contains('/') {
            continue;
        }
        let root = key.split('/').next().unwrap_or("").to_string();
        if root.is_empty() || is_system_key(&root) {
            continue;
        }
        if tops.get(&root) != Some(&DocType::Book) {
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
        .filter(|d| !d.is_page && !is_system_key(&d.path))
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
