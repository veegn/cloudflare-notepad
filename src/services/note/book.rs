//! Book pages CRUD helpers and TOC markdown parsing.

use std::collections::HashMap;

use worker::{Bucket, Result};

use crate::models::note::{
    path_display_name, DocType, NoteMetadata, NoteMode, NoteRecord, TocItem,
};

use super::store::{get_note, now_unix, put_note_object};

const TOC_HEADING_ZH: &str = "## \u{76ee}\u{5f55}"; // ## 目录
const TOC_HEADING_EN: &str = "## TOC";
const TOC_HEADING_EN_ALT: &str = "## Contents";

/// Create a page under `book_path` and append a TOC link in the book body.
pub async fn create_book_page(
    bucket: &Bucket,
    book_path: &str,
    page_path: &str,
    title: &str,
) -> Result<NoteRecord> {
    let Some(book) = get_note(bucket, book_path).await? else {
        return Err(worker::Error::RustError("book not found".into()));
    };
    if book.metadata.doc_type != DocType::Book {
        return Err(worker::Error::RustError("target is not a book".into()));
    }
    if get_note(bucket, page_path).await?.is_some() {
        return Err(worker::Error::RustError("path already exists".into()));
    }

    let title = title.trim();
    if title.is_empty() {
        return Err(worker::Error::RustError("title is required".into()));
    }

    let page = NoteRecord {
        path: page_path.to_string(),
        content: format!("# {title}\n\n"),
        metadata: NoteMetadata {
            doc_type: DocType::Page,
            book_ref: Some(book_path.to_string()),
            title: Some(title.to_string()),
            mode: NoteMode::Md,
            update_at: Some(now_unix()),
            ..Default::default()
        },
    };
    put_note_object(bucket, page_path, &page).await?;
    append_toc_link(bucket, &book, page_path, title).await?;
    Ok(page)
}

/// Delete a page; when `sync_book` is true, remove its TOC link from the parent book.
pub async fn delete_book_page(bucket: &Bucket, page_path: &str, sync_book: bool) -> Result<()> {
    let Some(page) = get_note(bucket, page_path).await? else {
        bucket.delete(page_path).await?;
        return Ok(());
    };

    if sync_book {
        if let Some(book_path) = page.metadata.book_ref.clone() {
            if let Some(book) = get_note(bucket, &book_path).await? {
                let new_content = strip_toc_link(&book.content, page_path);
                if new_content != book.content {
                    let book_record = NoteRecord {
                        path: book_path,
                        content: new_content,
                        metadata: NoteMetadata {
                            update_at: Some(now_unix()),
                            ..book.metadata
                        },
                    };
                    put_note_object(bucket, &book_record.path, &book_record).await?;
                }
            }
        }
    }

    bucket.delete(page_path).await?;
    Ok(())
}

/// Remove markdown list links that point at `page_path`.
pub fn strip_toc_link(content: &str, page_path: &str) -> String {
    let needle = format!("]({page_path})");
    let mut lines: Vec<&str> = Vec::new();
    for line in content.lines() {
        if line.trim_start().starts_with("- [") && line.contains(&needle) {
            continue;
        }
        lines.push(line);
    }
    let mut s = lines.join("\n");
    if content.ends_with('\n') && !s.ends_with('\n') {
        s.push('\n');
    }
    s
}

/// Parse TOC from book markdown. `existing` maps page path → metadata
/// (or empty metadata when only existence is known).
pub fn parse_book_toc(
    book_path: &str,
    book_content: &str,
    existing: &HashMap<String, NoteMetadata>,
) -> Vec<TocItem> {
    let mut items = Vec::new();
    for line in book_content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix("## ") {
            items.push(TocItem {
                title: rest.trim().to_string(),
                path: None,
                depth: 0,
                exists: false,
                doc_type: None,
                protected: false,
                heading: true,
            });
            continue;
        }
        if trimmed.starts_with('#') && !trimmed.starts_with("- [") {
            continue;
        }

        if let Some(item) = parse_list_link(book_path, line, trimmed, existing) {
            items.push(item);
        }
    }
    items
}

fn parse_list_link(
    book_path: &str,
    line: &str,
    trimmed: &str,
    existing: &HashMap<String, NoteMetadata>,
) -> Option<TocItem> {
    let idx = trimmed.find("- [")?;
    let indent = line.len() - line.trim_start().len();
    let depth = (indent / 2) as u32;
    let after = &trimmed[idx + 3..];
    let close = after.find("](")?;
    let title = after[..close].trim().to_string();
    let rest = &after[close + 2..];
    let end = rest.find(')')?;
    let raw_path = rest[..end].trim();
    let path = normalize_toc_path(book_path, raw_path);
    let meta = existing.get(&path);

    Some(TocItem {
        title: if title.is_empty() {
            path_display_name(&path)
        } else {
            title
        },
        path: Some(path),
        depth,
        exists: meta.is_some(),
        doc_type: meta.map(|m| m.doc_type),
        protected: meta.map(|m| m.pw.is_some()).unwrap_or(false),
        heading: false,
    })
}

fn normalize_toc_path(book_path: &str, raw: &str) -> String {
    let raw = raw.trim();
    if raw.starts_with("http://") || raw.starts_with("https://") {
        return raw.to_string();
    }
    let raw = raw.trim_start_matches("./");
    if let Some(stripped) = raw.strip_prefix('/') {
        return stripped.to_string();
    }
    if raw.contains('/') {
        return raw.to_string();
    }
    format!("{book_path}/{raw}")
}

async fn append_toc_link(
    bucket: &Bucket,
    book: &NoteRecord,
    page_path: &str,
    title: &str,
) -> Result<()> {
    let link_line = format!("- [{title}]({page_path})");
    if book.content.contains(&format!("]({page_path})")) {
        return Ok(());
    }

    let mut content = book.content.clone();
    if let Some(pos) = find_toc_section_end(&content) {
        content.insert_str(pos, &format!("{link_line}\n"));
    } else {
        if !content.trim_end().is_empty() {
            content.push('\n');
        }
        content.push_str("\n## TOC\n\n");
        content.push_str(&format!("{link_line}\n"));
    }

    let book_record = NoteRecord {
        path: book.path.clone(),
        content,
        metadata: NoteMetadata {
            update_at: Some(now_unix()),
            ..book.metadata.clone()
        },
    };
    put_note_object(bucket, &book_record.path, &book_record).await
}

/// Byte offset where a new TOC link should be inserted.
fn find_toc_section_end(content: &str) -> Option<usize> {
    let mut offset = 0usize;
    let mut in_toc = false;
    let mut last_link_end = None;
    let mut toc_header_end = None;

    for line in content.lines() {
        let line_len = line.len() + 1;
        let trimmed = line.trim();
        if is_toc_heading(trimmed) {
            in_toc = true;
            toc_header_end = Some(offset + line_len);
            last_link_end = None;
            offset += line_len;
            continue;
        }
        if in_toc && trimmed.starts_with("# ") {
            break;
        }
        if in_toc && trimmed.starts_with("- [") {
            last_link_end = Some(offset + line_len);
        }
        offset += line_len;
    }

    last_link_end.or(toc_header_end)
}

/// Result of adopting a historical path prefix as a book.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptBookResult {
    pub book_path: String,
    pub title: String,
    pub pages_adopted: u32,
    pub pages_total: u32,
}

/// Stamp `book_path` as `docType=book` and all `book_path/*` keys as pages.
/// Rebuilds the book TOC markdown from adopted pages (sorted by path).
pub async fn adopt_book(
    bucket: &Bucket,
    book_path: &str,
    title: Option<&str>,
) -> Result<AdoptBookResult> {
    let book_path = book_path.trim().trim_matches('/').to_string();
    if book_path.is_empty() {
        return Err(worker::Error::RustError("book path is required".into()));
    }

    let prefix = format!("{book_path}/");
    // Only scan keys under this book prefix (not the whole bucket).
    let children_keys = super::list::list_keys_with_prefix(bucket, &prefix).await?;
    let mut children: Vec<NoteRecord> = Vec::new();
    for key in children_keys {
        if let Some(rec) = get_note(bucket, &key).await? {
            children.push(rec);
        }
    }
    children.sort_by(|a, b| a.path.cmp(&b.path));

    let book = get_note(bucket, &book_path)
        .await?
        .unwrap_or_else(|| NoteRecord {
            path: book_path.clone(),
            content: String::new(),
            metadata: NoteMetadata::default(),
        });

    let title = title
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
        .unwrap_or_else(|| {
            if !book.metadata.title.as_deref().unwrap_or("").is_empty() {
                book.metadata.title.clone().unwrap()
            } else {
                crate::models::note::first_markdown_h1(&book.content)
                    .unwrap_or_else(|| path_display_name(&book_path))
            }
        });

    // Stamp each child as a page of this book.
    let mut adopted = 0u32;
    for child in &children {
        let page_title = child.display_title();
        let mode = if child.content.trim_start().starts_with('#') {
            NoteMode::Md
        } else {
            child.metadata.mode
        };
        let record = NoteRecord {
            path: child.path.clone(),
            content: child.content.clone(),
            metadata: NoteMetadata {
                doc_type: DocType::Page,
                book_ref: Some(book_path.clone()),
                title: Some(page_title),
                mode,
                update_at: child.metadata.update_at.or(Some(now_unix())),
                ..child.metadata.clone()
            },
        };
        put_note_object(bucket, &record.path, &record).await?;
        adopted += 1;
    }

    // Rebuild book body: keep non-TOC preamble if any, then a clean TOC.
    let preamble = extract_preamble(&book.content, &title);
    let mut content = format!("# {title}\n\n");
    if !preamble.trim().is_empty() {
        content.push_str(preamble.trim());
        content.push_str("\n\n");
    } else if book.content.trim().is_empty() {
        content.push_str("> Historical notes adopted as a book.\n\n");
    }
    content.push_str("## TOC\n\n");
    if children.is_empty() {
        content.push_str("<!-- No pages under this prefix yet. -->\n");
    } else {
        for child in &children {
            let page_title = child.display_title();
            content.push_str(&format!("- [{}]({})\n", page_title, child.path));
        }
    }

    let book_record = NoteRecord {
        path: book_path.clone(),
        content,
        metadata: NoteMetadata {
            doc_type: DocType::Book,
            title: Some(title.clone()),
            mode: NoteMode::Md,
            update_at: Some(now_unix()),
            ..book.metadata
        },
    };
    put_note_object(bucket, &book_path, &book_record).await?;

    Ok(AdoptBookResult {
        book_path,
        title,
        pages_adopted: adopted,
        pages_total: children.len() as u32,
    })
}

/// Non-TOC portion of historical book content (skip H1 we regenerate).
fn extract_preamble(content: &str, title: &str) -> String {
    let mut lines: Vec<&str> = Vec::new();
    let mut in_toc = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == format!("# {title}") {
            continue;
        }
        if lines.is_empty() && trimmed.starts_with("# ") {
            continue;
        }
        if is_toc_heading(trimmed) || trimmed.starts_with("## TOC") {
            in_toc = true;
            continue;
        }
        if in_toc && trimmed.starts_with("# ") {
            in_toc = false;
        }
        if in_toc {
            continue;
        }
        lines.push(line);
    }
    lines.join("\n")
}

fn is_toc_heading(trimmed: &str) -> bool {
    trimmed == TOC_HEADING_ZH
        || trimmed == TOC_HEADING_EN
        || trimmed == TOC_HEADING_EN_ALT
        || trimmed.starts_with(TOC_HEADING_ZH)
        || trimmed.starts_with(TOC_HEADING_EN)
        || trimmed.starts_with(TOC_HEADING_EN_ALT)
}
