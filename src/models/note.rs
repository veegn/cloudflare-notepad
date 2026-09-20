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

/// Explicit document type written at creation time.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocType {
    #[default]
    Article,
    Book,
    Page,
}

impl DocType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Article => "article",
            Self::Book => "book",
            Self::Page => "page",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s {
            "article" => Some(Self::Article),
            "book" => Some(Self::Book),
            "page" => Some(Self::Page),
            _ => None,
        }
    }
}

impl std::fmt::Display for DocType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Metadata attached to a note in Cloudflare R2.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMetadata {
    /// Hashed password (PBKDF2 or legacy MD5). `None` means unprotected.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pw: Option<String>,

    /// Whether the note is publicly shareable.
    #[serde(default = "default_share", skip_serializing_if = "is_true")]
    pub share: bool,

    /// Unix timestamp (seconds) of the last edit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_at: Option<i64>,

    /// Content rendering mode.
    #[serde(default)]
    pub mode: NoteMode,

    /// Document type. Missing → article (legacy notes).
    #[serde(default, rename = "docType", skip_serializing_if = "is_article")]
    pub doc_type: DocType,

    /// Parent book path for `page` docs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book_ref: Option<String>,

    /// Display title (optional).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

fn default_share() -> bool {
    true
}

fn is_true(v: &bool) -> bool {
    *v
}

fn is_article(v: &DocType) -> bool {
    *v == DocType::Article
}

impl Default for NoteMetadata {
    fn default() -> Self {
        Self {
            pw: None,
            share: true,
            update_at: None,
            mode: NoteMode::Plain,
            doc_type: DocType::Article,
            book_ref: None,
            title: None,
        }
    }
}

/// A full note record as read from R2 (body + metadata).
#[derive(Debug, Clone)]
pub struct NoteRecord {
    pub path: String,
    pub content: String,
    pub metadata: NoteMetadata,
}

impl NoteRecord {
    /// Display title: metadata title → first markdown H1 → path tail.
    pub fn display_title(&self) -> String {
        if let Some(t) = self.metadata.title.as_ref() {
            let t = t.trim();
            if !t.is_empty() {
                return t.to_string();
            }
        }
        if let Some(h1) = first_markdown_h1(&self.content) {
            return h1;
        }
        path_display_name(&self.path)
    }
}

/// Last path segment for display.
pub fn path_display_name(path: &str) -> String {
    let cleaned = path.trim_matches('/');
    match cleaned.rsplit('/').next() {
        Some(seg) if !seg.is_empty() => seg.to_string(),
        _ => cleaned.to_string(),
    }
}

/// Extract the first markdown H1 line (without `#`).
pub fn first_markdown_h1(content: &str) -> Option<String> {
    for line in content.lines() {
        let t = line.trim_start();
        if let Some(rest) = t.strip_prefix("# ") {
            let title = rest.trim();
            if !title.is_empty() {
                return Some(title.to_string());
            }
        }
    }
    None
}

/// Strip markdown-ish syntax for short excerpts.
pub fn excerpt_plain(content: &str, max_chars: usize) -> String {
    let mut out = String::new();
    let mut body_started = false;
    for line in content.lines() {
        let mut s = line.trim();
        if s.is_empty() {
            if body_started {
                break;
            }
            continue;
        }
        if let Some(rest) = s.strip_prefix('#') {
            s = rest.trim_start_matches('#').trim();
            // headings alone don't count as body for blank-line stop
        } else {
            body_started = true;
        }
        if s.starts_with("```") || s.starts_with("<!--") {
            continue;
        }
        let mut plain = String::new();
        let chars: Vec<char> = s.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            if chars[i] == '[' {
                if let Some(end) = chars[i..].iter().position(|c| *c == ']') {
                    let text: String = chars[i + 1..i + end].iter().collect();
                    plain.push_str(&text);
                    i += end + 1;
                    if i < chars.len() && chars[i] == '(' {
                        if let Some(paren) = chars[i..].iter().position(|c| *c == ')') {
                            i += paren + 1;
                        }
                    }
                    continue;
                }
            }
            plain.push(chars[i]);
            i += 1;
        }
        if !plain.trim().is_empty() {
            if !out.is_empty() {
                out.push(' ');
            }
            out.push_str(plain.trim());
        }
        if out.chars().count() >= max_chars {
            break;
        }
    }
    let count = out.chars().count();
    if count > max_chars {
        out.chars().take(max_chars).collect::<String>() + "…"
    } else {
        out
    }
}

/// The reserved path used for the home page note.
pub const INDEX_PATH: &str = "_index";

/// The legacy index path from the TypeScript version.
pub const LEGACY_INDEX_PATH: &str = ".index";

/// Check whether a path refers to the home index note (new or legacy).
pub fn is_index_path(path: &str) -> bool {
    path == INDEX_PATH || path == LEGACY_INDEX_PATH
}

/// A flat list item for homepage / book APIs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocListItem {
    pub path: String,
    pub doc_type: DocType,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excerpt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_at: Option<i64>,
    pub mode: NoteMode,
    pub protected: bool,
    pub shared: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub book_ref: Option<String>,
    pub has_excerpt: bool,
}

impl DocListItem {
    pub fn from_record(record: &NoteRecord, include_excerpt: bool) -> Self {
        let meta = &record.metadata;
        let protected = meta.pw.is_some();
        let shared = meta.share;
        let can_excerpt = include_excerpt && !protected && shared;
        let excerpt = if can_excerpt {
            let e = excerpt_plain(&record.content, 120);
            if e.is_empty() {
                None
            } else {
                Some(e)
            }
        } else {
            None
        };
        let has_excerpt = excerpt.is_some();
        Self {
            path: record.path.clone(),
            doc_type: meta.doc_type,
            title: record.display_title(),
            excerpt,
            update_at: meta.update_at,
            mode: meta.mode,
            protected,
            shared,
            book_ref: meta.book_ref.clone(),
            has_excerpt,
        }
    }
}

/// Tree node for homepage.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    /// "dir" | "book" | "article"
    pub node_type: String,
    pub path: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excerpt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<NoteMode>,
    pub protected: bool,
    pub shared: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub book_ref: Option<String>,
    #[serde(default)]
    pub children: Vec<TreeNode>,
}

/// TOC entry parsed from book markdown.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TocItem {
    pub title: String,
    pub path: Option<String>,
    pub depth: u32,
    pub exists: bool,
    pub doc_type: Option<DocType>,
    pub protected: bool,
    pub heading: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta() -> NoteMetadata {
        NoteMetadata {
            mode: NoteMode::Md,
            update_at: Some(123456789),
            doc_type: DocType::Book,
            title: Some("手册".into()),
            ..Default::default()
        }
    }

    #[test]
    fn test_note_mode_parsing() {
        assert_eq!(NoteMode::from_str_opt("md"), Some(NoteMode::Md));
        assert_eq!(DocType::from_str_opt("book"), Some(DocType::Book));
        assert_eq!(DocType::from_str_opt("page"), Some(DocType::Page));
        assert_eq!(DocType::from_str_opt("nope"), None);
    }

    #[test]
    fn test_note_metadata_serialization() {
        let serialized = serde_json::to_string(&meta()).unwrap();
        assert!(serialized.contains(r#""docType":"book""#));
        assert!(serialized.contains(r#""title":"手册""#));
        assert!(serialized.contains(r#""mode":"md""#));

        let default_meta = NoteMetadata::default();
        let default_json = serde_json::to_string(&default_meta).unwrap();
        assert!(!default_json.contains("docType"));
        assert!(!default_json.contains("bookRef"));
    }

    #[test]
    fn test_note_metadata_deserialization() {
        let json_str = r#"{"updateAt": 987654321, "docType": "page", "bookRef": "hb"}"#;
        let meta: NoteMetadata = serde_json::from_str(json_str).unwrap();
        assert_eq!(meta.doc_type, DocType::Page);
        assert_eq!(meta.book_ref.as_deref(), Some("hb"));
        assert_eq!(meta.mode, NoteMode::Plain);

        let legacy: NoteMetadata = serde_json::from_str(r#"{"mode":"md"}"#).unwrap();
        assert_eq!(legacy.doc_type, DocType::Article);
        assert!(legacy.share);
    }

    #[test]
    fn test_is_index_path() {
        assert!(is_index_path("_index"));
        assert!(is_index_path(".index"));
        assert!(!is_index_path("handbook"));
    }

    #[test]
    fn test_display_title_and_h1() {
        let rec = NoteRecord {
            path: "hb/install".into(),
            content: "# 安装步骤\n\n正文".into(),
            metadata: NoteMetadata::default(),
        };
        assert_eq!(rec.display_title(), "安装步骤");

        let with_title = NoteRecord {
            path: "hb".into(),
            content: "no h1".into(),
            metadata: NoteMetadata {
                title: Some("书名".into()),
                ..Default::default()
            },
        };
        assert_eq!(with_title.display_title(), "书名");

        let path_only = NoteRecord {
            path: "a/b/leaf".into(),
            content: String::new(),
            metadata: NoteMetadata::default(),
        };
        assert_eq!(path_only.display_title(), "leaf");
    }

    #[test]
    fn test_excerpt_plain() {
        let c = "# Title\n\nSee [link](http://x) in the body for more text here.";
        let e = excerpt_plain(c, 20);
        assert!(e.to_lowercase().contains("link"));
        assert!(e.chars().count() <= 21);
    }
}
