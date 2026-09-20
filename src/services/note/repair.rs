//! Repair inconsistent metadata ↔ body relationships.
//!
//! Sync model:
//! - `metadata.title` is the display SSOT; body `# H1` is a human-readable copy.
//! - Book TOC lives in the book markdown body; page objects carry `bookRef`.
//!
//! Repair can:
//! - fill empty `title` from H1 / path
//! - rewrite H1 from `title` (or the reverse via `prefer=h1`)
//! - stamp missing `docType` / `bookRef` from path shape
//! - rebuild book TOC from existing page objects
//! - create missing page objects from TOC links (`create_missing`)
//! - invalidate structured caches

use std::collections::HashMap;

use worker::{Bucket, Result};

use crate::models::note::{
    first_markdown_h1, is_index_path, path_display_name, DocType, NoteMetadata, NoteMode,
    NoteRecord,
};

use super::book::parse_book_toc;
use super::cache::invalidate_for_path;
use super::list::{list_book_page_keys, list_keys};
use super::store::{get_note, now_unix, put_note_object, query_note};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TitlePrefer {
    /// metadata.title wins; body H1 is rewritten to match.
    Title,
    /// body H1 wins; metadata.title is set from H1.
    H1,
}

impl TitlePrefer {
    pub fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "h1" | "body" | "content" => Self::H1,
            _ => Self::Title,
        }
    }
}

#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairChange {
    pub kind: String,
    pub detail: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairResult {
    pub path: String,
    pub doc_type: String,
    pub changes: Vec<RepairChange>,
    pub pages_checked: u32,
    pub pages_created: u32,
    pub toc_rebuilt: bool,
}

fn change(kind: &str, detail: impl AsRef<str>) -> RepairChange {
    RepairChange {
        kind: kind.to_string(),
        detail: detail.as_ref().to_string(),
    }
}

/// Replace or prepend the first markdown H1.
pub fn replace_or_prepend_h1(content: &str, title: &str) -> String {
    let title = title.trim();
    if title.is_empty() {
        return content.to_string();
    }
    let mut lines: Vec<String> = Vec::new();
    let mut replaced = false;
    for line in content.lines() {
        let trimmed = line.trim_start();
        if !replaced && trimmed.starts_with("# ") {
            lines.push(format!("# {title}"));
            replaced = true;
            continue;
        }
        lines.push(line.to_string());
    }
    if !replaced {
        let mut out = format!("# {title}\n");
        if !content.trim().is_empty() {
            out.push('\n');
            out.push_str(content.trim_start_matches('\n'));
        }
        return out;
    }
    let mut s = lines.join("\n");
    if content.ends_with('\n') && !s.ends_with('\n') {
        s.push('\n');
    }
    s
}

fn heal_title_fields(
    record: &mut NoteRecord,
    prefer: TitlePrefer,
    changes: &mut Vec<RepairChange>,
) {
    let h1 = first_markdown_h1(&record.content);
    let meta_title = record
        .metadata
        .title
        .clone()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());

    match prefer {
        TitlePrefer::Title => {
            let resolved = meta_title
                .clone()
                .or_else(|| h1.clone())
                .unwrap_or_else(|| path_display_name(&record.path));
            if record.metadata.title.as_deref() != Some(resolved.as_str()) {
                changes.push(change("title", format!("metadata.title → {:?}", resolved)));
                record.metadata.title = Some(resolved.clone());
            }
            if let Some(h) = &h1 {
                if h != &resolved {
                    record.content = replace_or_prepend_h1(&record.content, &resolved);
                    changes.push(change("h1", format!("body H1 → {:?}", resolved)));
                }
            } else if !record.content.trim().is_empty() || meta_title.is_some() {
                if first_markdown_h1(&record.content).as_deref() != Some(resolved.as_str()) {
                    record.content = replace_or_prepend_h1(&record.content, &resolved);
                    changes.push(change("h1", format!("prepend H1 {:?}", resolved)));
                }
            }
        }
        TitlePrefer::H1 => {
            if let Some(h) = h1 {
                if meta_title.as_deref() != Some(h.as_str()) {
                    changes.push(change("title", format!("metadata.title ← H1 {:?}", h)));
                    record.metadata.title = Some(h);
                }
            } else if meta_title.is_none() {
                let fallback = path_display_name(&record.path);
                changes.push(change(
                    "title",
                    format!("metadata.title ← path {:?}", fallback),
                ));
                record.metadata.title = Some(fallback);
            }
        }
    }
}

fn heal_doc_type(record: &mut NoteRecord, changes: &mut Vec<RepairChange>) {
    if record.metadata.doc_type != DocType::Article {
        return;
    }
    let path = record.path.clone();
    if path.contains('/') {
        let root = path.split('/').next().unwrap_or("").to_string();
        if !root.is_empty() && root != path {
            // Nested path without explicit type → page under root prefix.
            record.metadata.doc_type = DocType::Page;
            if record.metadata.book_ref.is_none() {
                record.metadata.book_ref = Some(root.clone());
                changes.push(change("bookRef", format!("bookRef ← {:?}", root)));
            }
            changes.push(change("docType", "article -> page (nested path)"));
        }
    }
}

fn heal_mode(record: &mut NoteRecord, changes: &mut Vec<RepairChange>) {
    if record.metadata.mode == NoteMode::Plain && record.content.trim_start().starts_with('#') {
        record.metadata.mode = NoteMode::Md;
        changes.push(change("mode", "plain -> md (markdown body)"));
    }
}

/// Rebuild book TOC from page objects that reference this book (or live under `book/`).
async fn rebuild_book_toc(
    bucket: &Bucket,
    book_path: &str,
    book: &mut NoteRecord,
    create_missing: bool,
    changes: &mut Vec<RepairChange>,
) -> Result<(u32, u32, bool)> {
    let mut pages_checked = 0u32;
    let mut pages_created = 0u32;

    let keys = list_book_page_keys(bucket, book_path).await?;
    let mut page_titles: Vec<(String, String)> = Vec::new();

    for key in keys {
        pages_checked += 1;
        match get_note(bucket, &key).await? {
            Some(mut page) => {
                heal_title_fields(&mut page, TitlePrefer::Title, changes);
                heal_doc_type(&mut page, changes);
                if page.metadata.doc_type == DocType::Article {
                    page.metadata.doc_type = DocType::Page;
                    changes.push(change("docType", format!("{key}: article → page")));
                }
                if page.metadata.book_ref.as_deref() != Some(book_path) {
                    page.metadata.book_ref = Some(book_path.to_string());
                    changes.push(change("bookRef", format!("{key}: bookRef → {book_path}")));
                }
                if page.metadata.mode == NoteMode::Plain
                    && page.content.trim_start().starts_with('#')
                {
                    page.metadata.mode = NoteMode::Md;
                }
                page.metadata.update_at = page.metadata.update_at.or(Some(now_unix()));
                put_note_object(bucket, &key, &page).await?;
                let title = page.display_title();
                page_titles.push((key, title));
            }
            None => {
                if !create_missing {
                    changes.push(change("missingPage", format!("TOC/object missing: {key}")));
                    continue;
                }
                // key listed under prefix but get failed — skip
                changes.push(change("missingPage", format!("unavailable: {key}")));
            }
        }
    }

    // Also create pages that exist only as TOC links in the book body.
    let existing: HashMap<String, NoteMetadata> = page_titles
        .iter()
        .map(|(p, _)| (p.clone(), NoteMetadata::default()))
        .collect();
    let toc_items = parse_book_toc(book_path, &book.content, &existing);
    for item in toc_items.iter().filter(|t| !t.heading) {
        let Some(path) = item.path.clone() else {
            continue;
        };
        if path.starts_with("http") {
            continue;
        }
        if page_titles.iter().any(|(p, _)| p == &path) {
            continue;
        }
        if !create_missing {
            changes.push(change(
                "deadLink",
                format!("TOC link without object: {path}"),
            ));
            continue;
        }
        let title = item.title.clone();
        let page = NoteRecord {
            path: path.clone(),
            content: format!("# {title}\n\n"),
            metadata: NoteMetadata {
                doc_type: DocType::Page,
                book_ref: Some(book_path.to_string()),
                title: Some(title.clone()),
                mode: NoteMode::Md,
                update_at: Some(now_unix()),
                ..Default::default()
            },
        };
        put_note_object(bucket, &path, &page).await?;
        pages_created += 1;
        pages_checked += 1;
        page_titles.push((path.clone(), title));
        changes.push(change("createPage", format!("created {path}")));
    }

    page_titles.sort_by(|a, b| a.0.cmp(&b.0));
    let mut content = format!("# {}\n\n", book.display_title());
    if book.content.contains("> ") && first_markdown_h1(&book.content).is_some() {
        // keep a short summary line if present
        for line in book.content.lines() {
            let t = line.trim();
            if t.starts_with("> ") {
                content.push_str(t);
                content.push_str("\n\n");
                break;
            }
        }
    }
    content.push_str("## TOC\n\n");
    if page_titles.is_empty() {
        content.push_str("<!-- No pages. -->\n");
    } else {
        for (path, title) in &page_titles {
            content.push_str(&format!("- [{title}]({path})\n"));
        }
    }

    let rebuilt = content != book.content;
    if rebuilt {
        book.content = content;
        changes.push(change(
            "toc",
            format!("rebuilt TOC ({} pages)", page_titles.len()),
        ));
    }

    // strip leftover links that do not point at known pages (already rebuilt)
    let _ = strip_toc_link;
    Ok((pages_checked, pages_created, rebuilt))
}

/// Repair a single document path.
pub async fn repair_doc(
    bucket: &Bucket,
    path: &str,
    prefer: TitlePrefer,
    rebuild_toc: bool,
    create_missing: bool,
) -> Result<RepairResult> {
    let path = path.trim().trim_matches('/').to_string();
    if path.is_empty() || is_index_path(&path) {
        return Err(worker::Error::RustError("invalid path".into()));
    }

    let mut record = query_note(bucket, &path).await?;
    if record.content.trim().is_empty()
        && record.metadata.title.is_none()
        && record.metadata.doc_type == DocType::Article
    {
        // truly missing object
        if get_note(bucket, &path).await?.is_none() {
            return Err(worker::Error::RustError("not found".into()));
        }
    }

    let mut changes: Vec<RepairChange> = Vec::new();
    let mut pages_checked = 0u32;
    let mut pages_created = 0u32;
    let mut toc_rebuilt = false;

    heal_doc_type(&mut record, &mut changes);
    heal_mode(&mut record, &mut changes);

    let is_book = record.metadata.doc_type == DocType::Book
        || (rebuild_toc && record.content.contains("## TOC"));

    if is_book {
        if record.metadata.doc_type != DocType::Book {
            record.metadata.doc_type = DocType::Book;
            changes.push(change("docType", "-> book (TOC detected)"));
        }
        heal_title_fields(&mut record, prefer, &mut changes);
        let (checked, created, rebuilt) =
            rebuild_book_toc(bucket, &path, &mut record, create_missing, &mut changes).await?;
        pages_checked = checked;
        pages_created = created;
        toc_rebuilt = rebuilt;
    } else {
        heal_title_fields(&mut record, prefer, &mut changes);
        if record.metadata.doc_type == DocType::Page && record.metadata.book_ref.is_none() {
            if let Some(root) = path.split('/').next() {
                if root != path {
                    record.metadata.book_ref = Some(root.to_string());
                    changes.push(change("bookRef", format!("bookRef ← {root}")));
                }
            }
        }
    }

    if !changes.is_empty() {
        record.metadata.update_at = Some(now_unix());
        put_note_object(bucket, &path, &record).await?;
    }
    invalidate_for_path(bucket, &path).await;
    if let Some(br) = record.metadata.book_ref.clone() {
        invalidate_for_path(bucket, &br).await;
    }

    Ok(RepairResult {
        path,
        doc_type: record.metadata.doc_type.as_str().to_string(),
        changes,
        pages_checked,
        pages_created,
        toc_rebuilt,
    })
}

/// Repair all book-like docs and optionally all nested page paths.
pub async fn repair_all(
    bucket: &Bucket,
    prefer: TitlePrefer,
    create_missing: bool,
    limit: usize,
) -> Result<Vec<RepairResult>> {
    let keys = list_keys(bucket, None).await?;
    let mut results = Vec::new();

    // First pass: top-level keys that look like books (have children) or docType book.
    let mut book_candidates: Vec<String> = Vec::new();
    for key in &keys {
        if key.contains('/') {
            continue;
        }
        let has_children = keys.iter().any(|k| k.starts_with(&format!("{key}/")));
        let rec = query_note(bucket, key).await?;
        if rec.metadata.doc_type == DocType::Book || has_children {
            book_candidates.push(key.clone());
        }
    }

    for path in book_candidates.into_iter().take(limit.max(1)) {
        match repair_doc(bucket, &path, prefer, true, create_missing).await {
            Ok(r) => results.push(r),
            Err(worker::Error::RustError(msg)) => {
                results.push(RepairResult {
                    path,
                    doc_type: "error".into(),
                    changes: vec![change("error", msg)],
                    pages_checked: 0,
                    pages_created: 0,
                    toc_rebuilt: false,
                });
            }
            Err(e) => return Err(e),
        }
    }

    // Lightweight heal for remaining standalone top-level articles (title only).
    let mut healed = 0usize;
    for key in &keys {
        if key.contains('/') {
            continue;
        }
        if results.iter().any(|r| &r.path == key) {
            continue;
        }
        let mut rec = query_note(bucket, key).await?;
        if rec.metadata.doc_type == DocType::Page {
            continue;
        }
        let mut changes = Vec::new();
        heal_doc_type(&mut rec, &mut changes);
        heal_mode(&mut rec, &mut changes);
        heal_title_fields(&mut rec, prefer, &mut changes);
        if !changes.is_empty() {
            rec.metadata.update_at = Some(now_unix());
            put_note_object(bucket, key, &rec).await?;
            invalidate_for_path(bucket, key).await;
            results.push(RepairResult {
                path: key.clone(),
                doc_type: rec.metadata.doc_type.as_str().to_string(),
                changes,
                pages_checked: 0,
                pages_created: 0,
                toc_rebuilt: false,
            });
        }
        healed += 1;
        if healed >= limit.max(1) * 5 {
            break;
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_h1_updates_existing() {
        let c = "# Old\n\nbody";
        assert_eq!(replace_or_prepend_h1(c, "New"), "# New\n\nbody");
    }

    #[test]
    fn replace_h1_prepends_when_missing() {
        let c = "just text";
        assert_eq!(replace_or_prepend_h1(c, "Title"), "# Title\n\njust text");
    }

    #[test]
    fn prefer_parse() {
        assert_eq!(TitlePrefer::parse("h1"), TitlePrefer::H1);
        assert_eq!(TitlePrefer::parse("title"), TitlePrefer::Title);
    }
}
