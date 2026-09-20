//! Create articles/books and random paths.

use worker::{Bucket, Result};

use crate::models::note::{path_display_name, DocType, NoteMetadata, NoteMode, NoteRecord};

use super::store::{get_note, now_unix, put_note_object};

/// Create an article or book. Pages must be created via the book editor API.
pub async fn create_doc(
    bucket: &Bucket,
    path: &str,
    doc_type: DocType,
    title: Option<String>,
    summary: Option<String>,
) -> Result<NoteRecord> {
    if doc_type == DocType::Page {
        return Err(worker::Error::RustError(
            "pages can only be created from the book editor".into(),
        ));
    }

    if get_note(bucket, path).await?.is_some() {
        return Err(worker::Error::RustError("path already exists".into()));
    }

    let content = initial_content(doc_type, path, title.as_deref(), summary.as_deref());
    let mode = initial_mode(doc_type, &content);

    let record = NoteRecord {
        path: path.to_string(),
        content,
        metadata: NoteMetadata {
            doc_type,
            title: title.filter(|t| !t.trim().is_empty()),
            mode,
            update_at: Some(now_unix()),
            ..Default::default()
        },
    };
    put_note_object(bucket, path, &record).await?;
    Ok(record)
}

/// Random 5-character path (legacy charset from the TypeScript worker).
pub fn gen_random_path() -> String {
    const CHARSET: &[u8] = b"2345679abcdefghjkmnpqrstwxyz";
    let mut bytes = [0u8; 5];
    getrandom::getrandom(&mut bytes).expect("getrandom failed");
    bytes
        .iter()
        .map(|&b| CHARSET[b as usize % CHARSET.len()] as char)
        .collect()
}

fn initial_content(
    doc_type: DocType,
    path: &str,
    title: Option<&str>,
    summary: Option<&str>,
) -> String {
    match doc_type {
        DocType::Book => {
            let name = title
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .map(|t| t.to_string())
                .unwrap_or_else(|| path_display_name(path));
            let mut md = format!("# {name}\n\n");
            match summary.map(str::trim).filter(|s| !s.is_empty()) {
                Some(s) => md.push_str(&format!("> {s}\n\n")),
                None => md.push_str("> Add a one-line summary here.\n\n"),
            }
            md.push_str("## TOC\n\n<!-- New book pages are appended here automatically -->\n");
            md
        }
        DocType::Article => match title.map(str::trim).filter(|t| !t.is_empty()) {
            Some(t) => format!("# {t}\n\n"),
            None => String::new(),
        },
        DocType::Page => String::new(),
    }
}

fn initial_mode(doc_type: DocType, content: &str) -> NoteMode {
    match doc_type {
        DocType::Book | DocType::Page => NoteMode::Md,
        DocType::Article => {
            if content.trim_start().starts_with('#') {
                NoteMode::Md
            } else {
                NoteMode::Plain
            }
        }
    }
}
