//! List/filter notes from R2.

use worker::{Bucket, Result};

use crate::models::note::{is_index_path, DocType, NoteRecord};

use super::meta;

/// Filters for `list_all_docs`.
pub struct ListOptions {
    pub doc_type: Option<DocType>,
    /// When true, skip `docType=page` objects (homepage default).
    pub exclude_pages: bool,
    pub book_ref: Option<String>,
    pub limit: usize,
}

/// List notes sorted by `updateAt` desc, then path.
///
/// Uses `GET` per key so custom_metadata is reliable (local R2 `list()` may omit it).
pub async fn list_all_docs(bucket: &Bucket, opts: &ListOptions) -> Result<Vec<NoteRecord>> {
    let mut out: Vec<NoteRecord> = Vec::new();
    let limit = opts.limit.max(1);
    let objects = bucket.list().limit(1000).execute().await?.objects();

    for obj in objects {
        let key = obj.key();
        if is_index_path(&key) {
            continue;
        }

        let Some(object) = bucket.get(&key).execute().await? else {
            continue;
        };
        let custom = object.custom_metadata().unwrap_or_default();
        let metadata = meta::from_custom(&custom);

        if !matches_filters(&metadata, opts) {
            continue;
        }

        let content = match object.body() {
            Some(b) => b.text().await.unwrap_or_default(),
            None => String::new(),
        };

        out.push(NoteRecord {
            path: key,
            content,
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

fn matches_filters(metadata: &crate::models::note::NoteMetadata, opts: &ListOptions) -> bool {
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
