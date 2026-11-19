//! List and filter notes without reading document bodies unless requested.

use std::collections::{HashMap, HashSet};

use futures::{stream, StreamExt, TryStreamExt};
use worker::{Bucket, Include, Object, Result};

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

const LIST_PAGE_SIZE: u32 = 1000;
const R2_CONCURRENCY: usize = 6;

/// Do not assume a full page: R2 may truncate before the requested limit.
async fn list_all_objects(
    bucket: &Bucket,
    prefix: Option<&str>,
    include_metadata: bool,
) -> Result<Vec<Object>> {
    let mut all = Vec::new();
    let mut cursor = None;
    let mut seen = HashSet::new();
    loop {
        let mut request = bucket.list().limit(LIST_PAGE_SIZE);
        if include_metadata {
            request = request.include(vec![Include::CustomMetadata]);
        }
        if let Some(prefix) = prefix.filter(|p| !p.is_empty()) {
            request = request.prefix(prefix);
        }
        if let Some(cursor) = cursor.take() {
            request = request.cursor(cursor);
        }
        let page = request.execute().await?;
        all.extend(page.objects());
        if !page.truncated() {
            return Ok(all);
        }
        cursor = Some(
            page.cursor()
                .filter(|next| !next.is_empty() && seen.insert(next.clone()))
                .ok_or_else(|| {
                    worker::Error::RustError(
                        "R2 listing returned an invalid continuation cursor".into(),
                    )
                })?,
        );
    }
}

pub async fn list_keys(bucket: &Bucket, prefix: Option<&str>) -> Result<Vec<String>> {
    Ok(list_all_objects(bucket, prefix, false)
        .await?
        .iter()
        .map(Object::key)
        .filter(|key| !is_system_key(key))
        .collect())
}

pub async fn list_keys_with_prefix(bucket: &Bucket, prefix: &str) -> Result<Vec<String>> {
    list_keys(bucket, Some(prefix)).await
}

pub async fn list_book_page_keys(bucket: &Bucket, book_path: &str) -> Result<Vec<String>> {
    let prefix = format!("{}/", book_path.trim_matches('/'));
    list_keys_with_prefix(bucket, &prefix).await
}

/// Metadata-only HEAD. LIST objects are not used for custom metadata.
async fn meta_get(bucket: &Bucket, key: &str) -> Result<Option<NoteMetadata>> {
    bucket
        .head(key)
        .await?
        .map(|object| {
            object
                .custom_metadata()
                .map(|custom| meta::from_custom(&custom))
        })
        .transpose()
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

/// One-pass bucket index: docs + per-book page counts from a paginated listing.
pub struct BucketIndex {
    pub docs: Vec<FastDoc>,
    pub page_counts: HashMap<String, u32>,
}

fn page_counts_from_docs(docs: &[FastDoc]) -> HashMap<String, u32> {
    let mut counts: HashMap<String, u32> = HashMap::new();
    for d in docs {
        if d.is_page {
            if let Some(book) = d
                .metadata
                .book_ref
                .as_deref()
                .filter(|path| !path.is_empty())
            {
                *counts.entry(book.to_string()).or_insert(0) += 1;
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
) -> Result<HashMap<String, NoteMetadata>> {
    stream::iter(
        keys.into_iter().map(|key| async move {
            Ok(meta_get(bucket, key).await?.map(|meta| (key.clone(), meta)))
        }),
    )
    .buffer_unordered(R2_CONCURRENCY)
    .try_filter_map(|entry| async { Ok(entry) })
    .try_collect()
    .await
}

/// On the supported compatibility date, explicitly requesting metadata
/// keeps large indexes within the per-invocation R2 subrequest budget.
pub(crate) async fn list_metadata(
    bucket: &Bucket,
    prefix: Option<&str>,
) -> Result<HashMap<String, NoteMetadata>> {
    let objects = list_all_objects(bucket, prefix, true).await?;
    let mut metadata = HashMap::new();
    let mut fallback = Vec::new();
    for object in objects {
        let key = object.key();
        if is_system_key(&key) {
            continue;
        }
        match object.custom_metadata() {
            Ok(custom) => {
                metadata.insert(key, meta::from_custom(&custom));
            }
            Err(_) => fallback.push(key),
        }
    }
    metadata.extend(fetch_index_metadata(bucket, &fallback).await?);
    Ok(metadata)
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
        is_page: metadata.doc_type == DocType::Page,
        metadata,
        is_dir: false,
    }
}

fn nested_doc(
    key: &str,
    root: &str,
    parent: Option<&NoteMetadata>,
    stored: Option<&NoteMetadata>,
) -> FastDoc {
    let doc_type = stored.map_or(DocType::Article, |metadata| metadata.doc_type);
    let parent_is_book = parent.is_some_and(|metadata| metadata.doc_type == DocType::Book);
    let is_page = doc_type == DocType::Page || (doc_type == DocType::Article && parent_is_book);
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
    if let Some(stored) = stored {
        if let Some(book_ref) = &stored.book_ref {
            metadata.book_ref = Some(book_ref.clone());
        }
        if !is_page {
            merge_meta(&mut metadata, stored);
        }
    }
    FastDoc {
        path: key.to_string(),
        is_book: metadata.doc_type == DocType::Book,
        metadata,
        is_page,
        is_dir: false,
    }
}

/// Build the homepage index from a metadata-inclusive paginated listing.
pub async fn index_bucket(bucket: &Bucket) -> Result<BucketIndex> {
    let resolved = list_metadata(bucket, None).await?;
    let mut keys: Vec<_> = resolved.keys().cloned().collect();
    keys.sort_unstable();
    let key_set: HashSet<_> = keys.iter().map(String::as_str).collect();
    let prefixes = directory_prefixes(&keys);
    let mut top_level: Vec<_> = keys.iter().filter(|key| !key.contains('/')).collect();
    top_level.sort_by_key(|key| !prefixes.contains(key.as_str()));

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
            .map(|key| top_level_doc(key, resolved.get(key))),
    );
    docs.extend(keys.iter().filter_map(|key| {
        let (root, _) = key.split_once('/')?;
        Some(nested_doc(key, root, resolved.get(root), resolved.get(key)))
    }));

    let page_counts = page_counts_from_docs(&docs);
    Ok(BucketIndex { docs, page_counts })
}

/// Resolve metadata before filtering, including legacy objects with default metadata.
pub async fn list_doc_metas(
    bucket: &Bucket,
    opts: &ListOptions,
) -> Result<Vec<(String, NoteMetadata)>> {
    let resolved = list_metadata(bucket, opts.prefix.as_deref()).await?;
    let mut out: Vec<_> = resolved
        .into_iter()
        .filter(|(_, metadata)| matches_filters(metadata, opts))
        .collect();
    out.sort_by(|a, b| {
        b.1.update_at
            .unwrap_or(0)
            .cmp(&a.1.update_at.unwrap_or(0))
            .then_with(|| a.0.cmp(&b.0))
    });
    out.truncate(opts.limit.max(1));
    Ok(out)
}

/// Full records with bodies, keeping the metadata sort order.
pub async fn list_all_docs(bucket: &Bucket, opts: &ListOptions) -> Result<Vec<NoteRecord>> {
    let metas = list_doc_metas(bucket, opts).await?;
    if !opts.include_body {
        return Ok(metas
            .into_iter()
            .map(|(path, metadata)| NoteRecord {
                path,
                metadata,
                content: String::new(),
            })
            .collect());
    }
    let mut records: Vec<_> = stream::iter(metas.into_iter().enumerate().map(
        |(index, (path, _))| async move {
            let record = super::store::get_note(bucket, &path).await?;
            Ok::<_, worker::Error>(
                record
                    .filter(|r| matches_filters(&r.metadata, opts))
                    .map(|record| (index, record)),
            )
        },
    ))
    .buffer_unordered(R2_CONCURRENCY)
    .try_filter_map(|entry| async { Ok(entry) })
    .try_collect()
    .await?;
    records.sort_unstable_by_key(|(index, _)| *index);
    Ok(records.into_iter().map(|(_, record)| record).collect())
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
