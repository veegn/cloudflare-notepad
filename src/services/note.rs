use std::collections::HashMap;

use worker::{Bucket, Result};

use crate::models::note::{NoteMetadata, NoteMode, NoteRecord, INDEX_PATH, LEGACY_INDEX_PATH};

/// Flattened custom_metadata keys (values are always strings in R2).
const KEY_PW: &str = "pw";
const KEY_MODE: &str = "mode";
const KEY_UPDATE_AT: &str = "updateAt";
const KEY_SHARE: &str = "share";
/// Transitional nested JSON key — accepted on read only.
const LEGACY_META_KEY: &str = "meta";

/// Query a note from R2, returning a default empty record if not found.
///
/// For the index path, also tries the legacy `.index` key for backward compatibility.
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

/// Read a single note object from R2.
///
/// Scheme: body is pure content; metadata is flattened in custom_metadata
/// (`pw` / `mode` / `updateAt` / `share`).
async fn get_note(bucket: &Bucket, path: &str) -> Result<Option<NoteRecord>> {
    let Some(object) = bucket.get(path).execute().await? else {
        return Ok(None);
    };

    let custom_meta = object.custom_metadata().unwrap_or_default();
    let metadata = metadata_from_custom(&custom_meta);

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

/// Build NoteMetadata from flattened R2 custom_metadata keys.
/// Flattened keys win over a transitional nested `meta` JSON blob.
fn metadata_from_custom(custom: &HashMap<String, String>) -> NoteMetadata {
    let mut metadata = NoteMetadata::default();

    if let Some(raw) = custom.get(LEGACY_META_KEY) {
        if let Ok(m) = serde_json::from_str::<NoteMetadata>(raw) {
            metadata = m;
        }
    }

    if let Some(pw) = custom.get(KEY_PW) {
        metadata.pw = if pw.is_empty() {
            None
        } else {
            Some(pw.clone())
        };
    }
    if let Some(mode) = custom.get(KEY_MODE) {
        if let Some(m) = NoteMode::from_str_opt(mode) {
            metadata.mode = m;
        }
    }
    if let Some(update_at) = custom.get(KEY_UPDATE_AT) {
        metadata.update_at = update_at.parse().ok();
    }
    if let Some(share) = custom.get(KEY_SHARE) {
        metadata.share = share != "false" && share != "0";
    }

    metadata
}

/// Flatten note metadata into R2 custom_metadata key/value pairs.
fn flatten_custom_metadata(meta: &NoteMetadata) -> HashMap<String, String> {
    let mut custom = HashMap::new();
    if let Some(pw) = &meta.pw {
        if !pw.is_empty() {
            custom.insert(KEY_PW.to_string(), pw.clone());
        }
    }
    if meta.mode != NoteMode::Plain {
        custom.insert(KEY_MODE.to_string(), meta.mode.as_str().to_string());
    }
    if let Some(update_at) = meta.update_at {
        custom.insert(KEY_UPDATE_AT.to_string(), update_at.to_string());
    }
    if !meta.share {
        custom.insert(KEY_SHARE.to_string(), "false".to_string());
    }
    custom
}

/// Encode a note for R2: pure-content body + flattened custom_metadata.
fn encode_note(record: &NoteRecord) -> (String, HashMap<String, String>) {
    (
        record.content.clone(),
        flatten_custom_metadata(&record.metadata),
    )
}

/// Write a note object into R2 (body = pure content, flattened custom_metadata).
async fn put_note_object(bucket: &Bucket, path: &str, record: &NoteRecord) -> Result<()> {
    let (body, custom) = encode_note(record);
    bucket
        .put(path, body)
        .custom_metadata(custom)
        .execute()
        .await?;
    Ok(())
}

/// Save note content to R2, updating the `updateAt` timestamp.
/// If content is empty/whitespace, deletes the note instead.
pub async fn save_note(bucket: &Bucket, path: &str, content: &str) -> Result<()> {
    if content.trim().is_empty() {
        bucket.delete(path).await?;
    } else {
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
    }
    Ok(())
}

/// Update the note's password hash. Pass `None` to remove the password.
pub async fn set_password(bucket: &Bucket, path: &str, pw_hash: Option<String>) -> Result<()> {
    let existing = query_note(bucket, path).await?;
    let content = if existing.content.is_empty() {
        " ".to_string()
    } else {
        existing.content
    };
    let record = NoteRecord {
        path: path.to_string(),
        content,
        metadata: NoteMetadata {
            pw: pw_hash,
            ..existing.metadata
        },
    };
    put_note_object(bucket, path, &record).await?;
    Ok(())
}

/// Update the note's rendering mode.
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
    Ok(())
}

/// Delete a note object from R2.
pub async fn delete_note(bucket: &Bucket, path: &str) -> Result<()> {
    bucket.delete(path).await?;
    Ok(())
}

/// Generate a random 5-character path for new notes.
///
/// Uses the same character set as the original TypeScript implementation.
pub fn gen_random_path() -> String {
    const CHARSET: &[u8] = b"2345679abcdefghjkmnpqrstwxyz";
    let mut bytes = [0u8; 5];
    getrandom::getrandom(&mut bytes).expect("getrandom failed");
    bytes
        .iter()
        .map(|&b| CHARSET[b as usize % CHARSET.len()] as char)
        .collect()
}

fn now_unix() -> i64 {
    (js_sys::Date::now() / 1000.0) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_note_flattened_custom_meta() {
        let record = NoteRecord {
            path: "abcde".into(),
            content: "pure body text".into(),
            metadata: NoteMetadata {
                mode: NoteMode::Yaml,
                update_at: Some(99),
                pw: Some("hash".into()),
                share: false,
            },
        };
        let (body, custom) = encode_note(&record);
        assert_eq!(body, "pure body text");
        assert_eq!(custom.get(KEY_PW).map(String::as_str), Some("hash"));
        assert_eq!(custom.get(KEY_MODE).map(String::as_str), Some("yaml"));
        assert_eq!(custom.get(KEY_UPDATE_AT).map(String::as_str), Some("99"));
        assert_eq!(custom.get(KEY_SHARE).map(String::as_str), Some("false"));
        assert!(!custom.contains_key(LEGACY_META_KEY));
    }

    #[test]
    fn test_encode_note_omits_default_fields() {
        let record = NoteRecord {
            path: "x".into(),
            content: "hi".into(),
            metadata: NoteMetadata::default(),
        };
        let (_, custom) = encode_note(&record);
        assert!(custom.is_empty());
    }

    #[test]
    fn test_metadata_from_flattened_custom() {
        let mut custom = HashMap::new();
        custom.insert(KEY_PW.to_string(), "hash".to_string());
        custom.insert(KEY_MODE.to_string(), "md".to_string());
        custom.insert(KEY_UPDATE_AT.to_string(), "42".to_string());
        custom.insert(KEY_SHARE.to_string(), "false".to_string());

        let meta = metadata_from_custom(&custom);
        assert_eq!(meta.pw.as_deref(), Some("hash"));
        assert_eq!(meta.mode, NoteMode::Md);
        assert_eq!(meta.update_at, Some(42));
        assert!(!meta.share);
    }

    #[test]
    fn test_metadata_from_legacy_nested_meta_with_flat_override() {
        let mut custom = HashMap::new();
        custom.insert(
            LEGACY_META_KEY.to_string(),
            r#"{"mode":"json","updateAt":7,"pw":"old"}"#.to_string(),
        );
        custom.insert(KEY_MODE.to_string(), "yaml".to_string());

        let meta = metadata_from_custom(&custom);
        assert_eq!(meta.mode, NoteMode::Yaml); // flat wins
        assert_eq!(meta.update_at, Some(7)); // from legacy blob
        assert_eq!(meta.pw.as_deref(), Some("old"));
    }
}
