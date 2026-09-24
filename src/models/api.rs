use serde::{Deserialize, Serialize};

use super::note::{DocType, NoteMetadata, NoteMode};

// ── Request DTOs ─────────────────────────────────────────────────────

/// `PUT /api/notes/*path` — save note content.
#[derive(Debug, Deserialize)]
pub struct SaveNoteRequest {
    pub content: String,
}

/// `PATCH /api/notes/*path` — update note metadata.
#[derive(Debug, Deserialize)]
pub struct PatchNoteRequest {
    pub password: Option<String>,
    pub mode: Option<NoteMode>,
    pub title: Option<String>,
    pub share: Option<bool>,
}

/// `POST /api/auth`
#[derive(Debug, Deserialize)]
pub struct AuthRequest {
    pub path: String,
    pub password: String,
}

/// `POST /api/docs` — create article or book only.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDocRequest {
    /// "article" | "book" — page is rejected.
    pub doc_type: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
}

/// `POST /api/books/{book}/pages`
#[derive(Debug, Deserialize)]
pub struct CreatePageRequest {
    pub title: String,
    #[serde(default)]
    pub path: Option<String>,
}

// ── Response DTOs ────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct NoteResponse {
    pub content: String,
    pub metadata: NoteMetadataResponse,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMetadataResponse {
    pub has_password: bool,
    pub share: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_at: Option<i64>,
    pub mode: NoteMode,
    pub doc_type: DocType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub book_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

impl From<&NoteMetadata> for NoteMetadataResponse {
    fn from(m: &NoteMetadata) -> Self {
        Self {
            has_password: m.pw.is_some(),
            share: m.share,
            update_at: m.update_at,
            mode: m.mode,
            doc_type: m.doc_type,
            book_ref: m.book_ref.clone(),
            title: m.title.clone(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDocResponse {
    pub path: String,
    pub doc_type: DocType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub edit_url: String,
    pub view_url: String,
}

/// Slugify a title for default page paths under a book.
pub fn slugify(input: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if (ch as u32) > 127 {
            out.push(ch);
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        String::from("doc")
    } else {
        trimmed
    }
}
