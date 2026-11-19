//! Core note read/write against R2.

use std::time::Duration;

use worker::{Bucket, Conditional, Date, DateInit, Delay, Object, Result};

use crate::models::note::{DocType, NoteMetadata, NoteRecord, INDEX_PATH, LEGACY_INDEX_PATH};

use super::{cache::invalidate_for_paths, meta};

pub const WRITE_CONFLICT: &str = "Document changed during the write. Reload and retry.";

pub struct NoteSnapshot {
    pub record: NoteRecord,
    pub(super) uploaded_at: Option<u64>,
}

impl NoteSnapshot {
    fn empty(path: &str) -> Self {
        Self {
            record: NoteRecord {
                path: path.to_string(),
                content: String::new(),
                metadata: NoteMetadata::default(),
            },
            uploaded_at: None,
        }
    }
}

/// Query a note from R2. Missing keys yield an empty record (legacy `.index` fallback for home).
pub async fn query_note(bucket: &Bucket, path: &str) -> Result<NoteRecord> {
    Ok(read_note_for_update(bucket, path).await?.record)
}

pub(super) async fn get_note(bucket: &Bucket, path: &str) -> Result<Option<NoteRecord>> {
    Ok(get_snapshot(bucket, path)
        .await?
        .map(|snapshot| snapshot.record))
}

pub(super) async fn get_snapshot(bucket: &Bucket, path: &str) -> Result<Option<NoteSnapshot>> {
    let Some(object) = bucket.get(path).execute().await? else {
        return Ok(None);
    };
    let mut snapshot = snapshot_metadata(path, &object)?;
    if let Some(body) = object.body() {
        snapshot.record.content = body.text().await?;
    }
    Ok(Some(snapshot))
}

fn snapshot_metadata(path: &str, object: &Object) -> Result<NoteSnapshot> {
    let mut snapshot = NoteSnapshot::empty(path);
    snapshot.record.metadata = meta::from_custom(&object.custom_metadata()?);
    snapshot.uploaded_at = Some(object.uploaded().as_millis());
    Ok(snapshot)
}

pub async fn read_note_for_update(bucket: &Bucket, path: &str) -> Result<NoteSnapshot> {
    if let Some(snapshot) = get_snapshot(bucket, path).await? {
        return Ok(snapshot);
    }
    if path == INDEX_PATH {
        if let Some(mut legacy) = get_snapshot(bucket, LEGACY_INDEX_PATH).await? {
            legacy.record.path = path.to_string();
            legacy.uploaded_at = None;
            return Ok(legacy);
        }
    }
    Ok(NoteSnapshot::empty(path))
}

/// Read authorization and note metadata without fetching the body.
pub async fn head_note(bucket: &Bucket, path: &str) -> Result<NoteSnapshot> {
    if let Some(object) = bucket.head(path).await? {
        return snapshot_metadata(path, &object);
    }
    if path == INDEX_PATH {
        if let Some(object) = bucket.head(LEGACY_INDEX_PATH).await? {
            let mut legacy = snapshot_metadata(path, &object)?;
            legacy.uploaded_at = None;
            return Ok(legacy);
        }
    }
    Ok(NoteSnapshot::empty(path))
}

pub fn is_write_conflict(error: &worker::Error) -> bool {
    matches!(error, worker::Error::RustError(message) if message == WRITE_CONFLICT)
}

/// Write against the observed R2 revision, or create only if still missing.
/// A content ETag can stay unchanged on metadata-only edits. Use the upload
/// time window without If-Match, which would take precedence over uploadedBefore.
pub(super) async fn put_note_object(
    bucket: &Bucket,
    record: &NoteRecord,
    uploaded_at: Option<u64>,
) -> Result<()> {
    let condition = match uploaded_at {
        Some(uploaded_at) => {
            if Date::now().as_millis() <= uploaded_at {
                Delay::from(Duration::from_millis(1)).await;
                if Date::now().as_millis() <= uploaded_at {
                    return Err(worker::Error::RustError(WRITE_CONFLICT.into()));
                }
            }
            Conditional {
                uploaded_after: Some(DateInit::Millis(uploaded_at.saturating_sub(1)).into()),
                uploaded_before: Some(DateInit::Millis(uploaded_at + 1).into()),
                ..Default::default()
            }
        }
        None => Conditional {
            etag_does_not_match: Some("*".into()),
            ..Default::default()
        },
    };
    let (body, custom) = meta::encode(record);
    let written = bucket
        .put(&record.path, body)
        .custom_metadata(custom)
        .only_if(condition)
        .execute()
        .await?;
    written.ok_or_else(|| worker::Error::RustError(WRITE_CONFLICT.into()))?;
    Ok(())
}

pub async fn save_note(
    bucket: &Bucket,
    origin: &str,
    mut snapshot: NoteSnapshot,
    content: String,
) -> Result<()> {
    let path = snapshot.record.path.as_str();
    let book_ref = snapshot.record.metadata.book_ref.clone();
    if content.trim().is_empty() {
        bucket.delete(path).await?;
        invalidate_note(bucket, origin, path, book_ref.as_deref()).await;
        return Ok(());
    }

    // The homepage indexes article titles and flags from metadata, without
    // excerpts. A content-only save can leave its cached update time to the TTL.
    let invalidate =
        snapshot.uploaded_at.is_none() || snapshot.record.metadata.doc_type == DocType::Book;
    snapshot.record.content = content;
    snapshot.record.metadata.update_at = Some(now_unix());
    put_note_object(bucket, &snapshot.record, snapshot.uploaded_at).await?;
    if invalidate {
        invalidate_note(bucket, origin, &snapshot.record.path, book_ref.as_deref()).await;
    }
    Ok(())
}

pub async fn commit_note_update(
    bucket: &Bucket,
    origin: &str,
    snapshot: &NoteSnapshot,
    toc_title: Option<&str>,
) -> Result<()> {
    let record = &snapshot.record;
    put_note_object(bucket, record, snapshot.uploaded_at).await?;
    let book_ref = record.metadata.book_ref.as_deref();
    let toc = match (
        record.metadata.doc_type,
        book_ref,
        toc_title.filter(|title| !title.is_empty()),
    ) {
        (DocType::Page, Some(book), Some(title)) => {
            super::book::rename_toc_link(bucket, book, &record.path, title).await
        }
        _ => Ok(()),
    };
    invalidate_note(bucket, origin, &record.path, book_ref).await;
    toc
}

pub async fn delete_note(bucket: &Bucket, origin: &str, path: &str) -> Result<()> {
    bucket.delete(path).await?;
    invalidate_for_paths(bucket, origin, &[path]).await;
    Ok(())
}

async fn invalidate_note(bucket: &Bucket, origin: &str, path: &str, book_ref: Option<&str>) {
    invalidate_for_paths(bucket, origin, &[path, book_ref.unwrap_or("")]).await;
}

pub(super) fn now_unix() -> i64 {
    (js_sys::Date::now() / 1000.0) as i64
}
