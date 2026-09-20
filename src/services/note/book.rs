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

/// Parse book markdown into TOC items; mark existence via known pages.
pub fn parse_book_toc(book_path: &str, book_content: &str, pages: &[NoteRecord]) -> Vec<TocItem> {
    let mut page_map: HashMap<&str, &NoteRecord> = HashMap::new();
    for p in pages {
        page_map.insert(p.path.as_str(), p);
    }

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

        if let Some(item) = parse_list_link(book_path, line, trimmed, &page_map) {
            items.push(item);
        }
    }
    items
}

fn parse_list_link(
    book_path: &str,
    line: &str,
    trimmed: &str,
    page_map: &HashMap<&str, &NoteRecord>,
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
    let page = page_map.get(path.as_str());

    Some(TocItem {
        title: if title.is_empty() {
            path_display_name(&path)
        } else {
            title
        },
        path: Some(path),
        depth,
        exists: page.is_some(),
        doc_type: page.map(|p| p.metadata.doc_type),
        protected: page.map(|p| p.metadata.pw.is_some()).unwrap_or(false),
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

fn is_toc_heading(trimmed: &str) -> bool {
    trimmed == TOC_HEADING_ZH
        || trimmed == TOC_HEADING_EN
        || trimmed == TOC_HEADING_EN_ALT
        || trimmed.starts_with(TOC_HEADING_ZH)
        || trimmed.starts_with(TOC_HEADING_EN)
        || trimmed.starts_with(TOC_HEADING_EN_ALT)
}
