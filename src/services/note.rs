use worker::kv::KvStore;

use crate::models::note::{NoteMetadata, NoteMode, NoteRecord, INDEX_PATH, LEGACY_INDEX_PATH};

/// Query a note from KV, returning a default empty record if not found.
///
/// For the index path, also tries the legacy `.index` key for backward compatibility.
pub async fn query_note(kv: &KvStore, path: &str) -> worker::Result<NoteRecord> {
    // Try the requested path first.
    if let Some(record) = get_note(kv, path).await? {
        return Ok(record);
    }

    // For index path, also try the legacy key.
    if path == INDEX_PATH {
        if let Some(record) = get_note(kv, LEGACY_INDEX_PATH).await? {
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

/// Read a single note from KV (value + metadata).
async fn get_note(kv: &KvStore, path: &str) -> worker::Result<Option<NoteRecord>> {
    let builder = kv.get(path);
    let result = builder.text_with_metadata::<NoteMetadata>().await?;

    match result.0 {
        Some(mut content) => {
            let mut metadata = result.1.unwrap_or_default();
            // Fallback for worker-rs KV metadata bugs: read embedded metadata
            if content.starts_with("\0META:") {
                if let Some(end) = content.find("\0\n") {
                    let meta_str = &content[6..end];
                    if let Ok(m) = serde_json::from_str::<NoteMetadata>(meta_str) {
                        metadata = m;
                    }
                    content = content[end + 2..].to_string();
                }
            }

            Ok(Some(NoteRecord {
                path: path.to_string(),
                content,
                metadata,
            }))
        }
        None => Ok(None),
    }
}

/// Save note content to KV, updating the `updateAt` timestamp.
/// If content is empty/whitespace, deletes the note instead.
pub async fn save_note(kv: &KvStore, path: &str, content: &str) -> worker::Result<()> {
    if content.trim().is_empty() {
        kv.delete(path).await?;
    } else {
        let existing = query_note(kv, path).await?;
        let metadata = NoteMetadata {
            update_at: Some(now_unix()),
            ..existing.metadata
        };
        let meta_str = serde_json::to_string(&metadata).unwrap();
        let combined_content = format!("\0META:{}\0\n{}", meta_str, content);
        kv.put(path, combined_content.as_str())?
            .metadata(metadata.clone())?
            .execute()
            .await?;
    }
    Ok(())
}

/// Update the note's password hash. Pass `None` to remove the password.
pub async fn set_password(kv: &KvStore, path: &str, pw_hash: Option<String>) -> worker::Result<()> {
    let existing = query_note(kv, path).await?;
    let metadata = NoteMetadata {
        pw: pw_hash,
        ..existing.metadata
    };
    let content = if existing.content.is_empty() {
        " "
    } else {
        existing.content.as_str()
    };
    let meta_str = serde_json::to_string(&metadata).unwrap();
    let combined_content = format!("\0META:{}\0\n{}", meta_str, content);
    kv.put(path, combined_content.as_str())?
        .metadata(metadata.clone())?
        .execute()
        .await?;

    Ok(())
}

/// Update the note's rendering mode.
pub async fn set_mode(kv: &KvStore, path: &str, mode: NoteMode) -> worker::Result<()> {
    let existing = query_note(kv, path).await?;
    let metadata = NoteMetadata {
        mode,
        update_at: Some(now_unix()),
        ..existing.metadata
    };
    let meta_str = serde_json::to_string(&metadata).unwrap();
    let combined_content = format!("\0META:{}\0\n{}", meta_str, existing.content);
    kv.put(path, combined_content.as_str())?
        .metadata(metadata.clone())?
        .execute()
        .await?;
    Ok(())
}

/// Delete a note from KV.
pub async fn delete_note(kv: &KvStore, path: &str) -> worker::Result<()> {
    kv.delete(path).await?;
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
