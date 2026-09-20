//! Core note read/write against R2.

use worker::{Bucket, Result};

use crate::models::note::{NoteMetadata, NoteMode, NoteRecord, INDEX_PATH, LEGACY_INDEX_PATH};

use super::meta;

/// Query a note from R2. Missing keys yield an empty record (legacy `.index` fallback for home).
pub async fn query_note(bucket: &Bucket, path: &str) -> Result<NoteRecord> {
    if let Some(record) = get_note(bucket, path).await? {
        return Ok(record);
    }

    if path == INDEX_PATH {
        if let Some(record) = get_note(bucket, LEGACY_INDEX_PATH).await? {
            return Ok(NoteRecord {
                path: INDEX_PATH.to_string(),
                ..record
            });
        }
    }

    Ok(NoteRecord {
        path: path.to_string(),
        content: String::new(),
        metadata: NoteMetadata::default(),
    })
}

/// Read a single object; `None` when the key does not exist.
pub(super) async fn get_note(bucket: &Bucket, path: &str) -> Result<Option<NoteRecord>> {
    let Some(object) = bucket.get(path).execute().await? else {
        return Ok(None);
    };

    let custom = object.custom_metadata().unwrap_or_default();
    let metadata = meta::from_custom(&custom);
    let content = match object.body() {
        Some(body) => body.text().await?,
        None => String::new(),
    };

    Ok(Some(NoteRecord {
        path: path.to_string(),
        content,
        metadata,
    }))
}

/// Write body + flattened custom_metadata.
pub(super) async fn put_note_object(
    bucket: &Bucket,
    path: &str,
    record: &NoteRecord,
) -> Result<()> {
    let (body, custom) = meta::encode(record);
    bucket
        .put(path, body)
        .custom_metadata(custom)
        .execute()
        .await?;
    Ok(())
}

/// Rewrite a record (content + metadata) without empty-body delete semantics.
#[allow(dead_code)]
pub async fn overwrite_note(bucket: &Bucket, path: &str, record: &NoteRecord) -> Result<()> {
    put_note_object(bucket, path, record).await
}

/// Save content. Empty/whitespace content deletes the object.
pub async fn save_note(bucket: &Bucket, path: &str, content: &str) -> Result<()> {
    if content.trim().is_empty() {
        bucket.delete(path).await?;
        super::cache::invalidate_for_path(bucket, path).await;
        return Ok(());
    }

    let existing = query_note(bucket, path).await?;
    let record = NoteRecord {
        path: path.to_string(),
        content: content.to_string(),
        metadata: NoteMetadata {
            update_at: Some(now_unix()),
            ..existing.metadata
        },
    };
    put_note_object(bucket, path, &record).await?;
    super::cache::invalidate_for_path(bucket, path).await;
    Ok(())
}

pub async fn set_password(bucket: &Bucket, path: &str, pw_hash: Option<String>) -> Result<()> {
    let existing = query_note(bucket, path).await?;
    let record = NoteRecord {
        path: path.to_string(),
        content: non_empty_body(existing.content),
        metadata: NoteMetadata {
            pw: pw_hash,
            ..existing.metadata
        },
    };
    put_note_object(bucket, path, &record).await?;
    super::cache::invalidate_for_path(bucket, path).await;
    Ok(())
}

pub async fn set_mode(bucket: &Bucket, path: &str, mode: NoteMode) -> Result<()> {
    let existing = query_note(bucket, path).await?;
    let record = NoteRecord {
        path: path.to_string(),
        content: existing.content,
        metadata: NoteMetadata {
            mode,
            update_at: Some(now_unix()),
            ..existing.metadata
        },
    };
    put_note_object(bucket, path, &record).await?;
    super::cache::invalidate_for_path(bucket, path).await;
    Ok(())
}

pub async fn set_title(bucket: &Bucket, path: &str, title: Option<String>) -> Result<()> {
    let existing = query_note(bucket, path).await?;
    let record = NoteRecord {
        path: path.to_string(),
        content: non_empty_body(existing.content),
        metadata: NoteMetadata {
            title,
            update_at: Some(now_unix()),
            ..existing.metadata
        },
    };
    put_note_object(bucket, path, &record).await?;
    super::cache::invalidate_for_path(bucket, path).await;
    Ok(())
}

pub async fn delete_note(bucket: &Bucket, path: &str) -> Result<()> {
    bucket.delete(path).await?;
    super::cache::invalidate_for_path(bucket, path).await;
    Ok(())
}

fn non_empty_body(content: String) -> String {
    if content.is_empty() {
        " ".to_string()
    } else {
        content
    }
}

pub(super) fn now_unix() -> i64 {
    (js_sys::Date::now() / 1000.0) as i64
}
