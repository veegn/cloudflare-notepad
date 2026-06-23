use serde::{Deserialize, Serialize};

use super::note::{NoteMetadata, NoteMode};

// ── Request DTOs ─────────────────────────────────────────────────────

/// `PUT /api/notes/*path` — save note content.
#[derive(Debug, Deserialize)]
pub struct SaveNoteRequest {
    pub content: String,
}

/// `PATCH /api/notes/*path` — update note metadata.
/// All fields are optional; only provided fields are applied.
#[derive(Debug, Deserialize)]
pub struct PatchNoteRequest {
    pub password: Option<String>,
    pub mode: Option<NoteMode>,
}

/// `POST /api/auth` — authenticate with a note password.
#[derive(Debug, Deserialize)]
pub struct AuthRequest {
    pub path: String,
    pub password: String,
}

// ── Response DTOs ────────────────────────────────────────────────────

/// Payload returned by `GET /api/notes/*path`.
#[derive(Debug, Serialize)]
pub struct NoteResponse {
    pub content: String,
    pub metadata: NoteMetadataResponse,
}

/// Public-facing metadata (never exposes the raw password hash).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMetadataResponse {
    pub has_password: bool,
    pub share: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_at: Option<i64>,
    pub mode: NoteMode,
}

impl From<&NoteMetadata> for NoteMetadataResponse {
    fn from(m: &NoteMetadata) -> Self {
        Self {
            has_password: m.pw.is_some(),
            share: m.share,
            update_at: m.update_at,
            mode: m.mode,
        }
    }
}

/// Payload returned by `POST /api/auth`.
#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
}
