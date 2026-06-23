use serde::{Deserialize, Serialize};

/// The supported content modes for a note.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteMode {
    #[default]
    Plain,
    Md,
    Json,
    Yaml,
}

impl NoteMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Plain => "plain",
            Self::Md => "md",
            Self::Json => "json",
            Self::Yaml => "yaml",
        }
    }

    #[allow(dead_code)]
    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s {
            "plain" => Some(Self::Plain),
            "md" => Some(Self::Md),
            "json" => Some(Self::Json),
            "yaml" => Some(Self::Yaml),
            _ => None,
        }
    }
}

impl std::fmt::Display for NoteMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Metadata attached to a note in Cloudflare KV.
///
/// Field names use camelCase to match the existing KV data written by
/// the TypeScript worker (`updateAt`, not `updated_at`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMetadata {
    /// Hashed password (PBKDF2 or legacy MD5). `None` means unprotected.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pw: Option<String>,

    /// Whether the note is publicly shareable.
    /// Absent in KV → defaults to `true`.
    #[serde(default = "default_share", skip_serializing_if = "is_true")]
    pub share: bool,

    /// Unix timestamp (seconds) of the last edit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_at: Option<i64>,

    /// Content rendering mode.
    #[serde(default)]
    pub mode: NoteMode,
}

fn default_share() -> bool {
    true
}

fn is_true(v: &bool) -> bool {
    *v
}

impl Default for NoteMetadata {
    fn default() -> Self {
        Self {
            pw: None,
            share: true,
            update_at: None,
            mode: NoteMode::Plain,
        }
    }
}

/// A full note record as read from KV (value + metadata).
#[derive(Debug, Clone)]
pub struct NoteRecord {
    #[allow(dead_code)]
    pub path: String,
    pub content: String,
    pub metadata: NoteMetadata,
}

/// The reserved path used for the home page note.
pub const INDEX_PATH: &str = "_index";

/// The legacy index path from the TypeScript version.
/// Used for data compatibility — if someone has existing data with `.index`.
pub const LEGACY_INDEX_PATH: &str = ".index";

/// Check whether a path refers to the home index note (new or legacy).
pub fn is_index_path(path: &str) -> bool {
    path == INDEX_PATH || path == LEGACY_INDEX_PATH
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_note_mode_parsing() {
        assert_eq!(NoteMode::from_str_opt("plain"), Some(NoteMode::Plain));
        assert_eq!(NoteMode::from_str_opt("md"), Some(NoteMode::Md));
        assert_eq!(NoteMode::from_str_opt("json"), Some(NoteMode::Json));
        assert_eq!(NoteMode::from_str_opt("yaml"), Some(NoteMode::Yaml));
        assert_eq!(NoteMode::from_str_opt("unknown"), None);
        assert_eq!(NoteMode::Plain.as_str(), "plain");
    }

    #[test]
    fn test_note_metadata_serialization() {
        let meta = NoteMetadata {
            mode: NoteMode::Md,
            update_at: Some(123456789),
            share: false,
            pw: Some("hash".to_string()),
        };
        let serialized = serde_json::to_string(&meta).unwrap();
        assert!(serialized.contains(r#""mode":"md""#));
        assert!(serialized.contains(r#""updateAt":123456789"#));
        assert!(serialized.contains(r#""share":false"#));
        assert!(serialized.contains(r#""pw":"hash""#));

        let default_meta = NoteMetadata::default();
        let default_ser = serde_json::to_string(&default_meta).unwrap();
        assert_eq!(default_ser, r#"{"mode":"plain"}"#);
    }

    #[test]
    fn test_note_metadata_deserialization() {
        let json_str = r#"{"updateAt": 987654321}"#;
        let meta: NoteMetadata = serde_json::from_str(json_str).unwrap();

        assert_eq!(meta.mode, NoteMode::Plain);
        assert!(meta.share);
        assert_eq!(meta.pw, None);
        assert_eq!(meta.update_at, Some(987654321));
    }

    #[test]
    fn test_is_index_path() {
        assert!(is_index_path("_index"));
        assert!(is_index_path(".index"));
        assert!(!is_index_path("index"));
        assert!(!is_index_path("other"));
    }
}
