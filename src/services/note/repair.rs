//! Repair inconsistent metadata ↔ body relationships.
//!
//! Default policy: **markdown body is the baseline** (`prefer=h1`).
//! - Display title ← first `# H1` (falls back to path)
//! - Book page structure ← links in the book body TOC
//! - metadata is updated to match the body; body is not rewritten
//!
//! Optional `prefer=title` keeps metadata.title as SSOT and rewrites H1
//! (legacy behaviour). Prefer body-first for repair UI / scripts.

use std::collections::{HashMap, HashSet};

use worker::{Bucket, Result};

use crate::models::note::{
    first_markdown_h1, is_system_key, path_display_name, DocType, NoteMetadata, NoteMode,
    NoteRecord,
};

use super::book::parse_book_toc;
use super::cache::invalidate_for_paths;
use super::list::{list_book_page_keys, list_metadata};
use super::store::{get_snapshot, now_unix, put_note_object};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TitlePrefer {
    /// metadata.title wins; body H1 is rewritten to match.
    Title,
    /// body H1 wins; metadata.title is set from H1 (default).
    H1,
}

impl TitlePrefer {
    pub fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "title" | "meta" | "metadata" => Self::Title,
            // Body-first is the repair default.
            _ => Self::H1,
        }
    }

    pub fn default_body_first() -> Self {
        Self::H1
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
                    changes.push(change("h1", format!("body H1 -> {:?}", resolved)));
                }
            } else if (!record.content.trim().is_empty() || meta_title.is_some())
                && first_markdown_h1(&record.content).as_deref() != Some(resolved.as_str())
            {
                record.content = replace_or_prepend_h1(&record.content, &resolved);
                changes.push(change("h1", format!("prepend H1 {:?}", resolved)));
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

fn new_toc_page(path: &str, book_path: &str, title: &str) -> NoteRecord {
    NoteRecord {
        path: path.to_string(),
        content: format!("# {title}\n\n"),
        metadata: NoteMetadata {
            doc_type: DocType::Page,
            book_ref: Some(book_path.to_string()),
            title: Some(title.to_string()),
            mode: NoteMode::Md,
            update_at: Some(now_unix()),
            ..Default::default()
        },
    }
}

fn apply_toc_page_metadata(
    page: &mut NoteRecord,
    book_path: &str,
    toc_title: &str,
    changes: &mut Vec<RepairChange>,
) -> bool {
    let path = &page.path;
    let mut dirty = false;
    if page.metadata.title.as_deref() != Some(toc_title) {
        page.metadata.title = Some(toc_title.to_string());
        changes.push(change(
            "title",
            format!("{path}: title <- TOC {:?}", toc_title),
        ));
        dirty = true;
    }
    if page.metadata.doc_type != DocType::Page {
        page.metadata.doc_type = DocType::Page;
        changes.push(change("docType", format!("{path}: -> page (from TOC)")));
        dirty = true;
    }
    if page.metadata.book_ref.as_deref() != Some(book_path) {
        page.metadata.book_ref = Some(book_path.to_string());
        changes.push(change("bookRef", format!("{path}: bookRef <- {book_path}")));
        dirty = true;
    }
    // Align page body H1 with TOC title (body remains human-editable copy).
    if first_markdown_h1(&page.content).as_deref() != Some(toc_title) {
        page.content = replace_or_prepend_h1(&page.content, toc_title);
        changes.push(change("h1", format!("{path}: H1 <- TOC")));
        dirty = true;
    }
    if page.metadata.mode == NoteMode::Plain && page.content.trim_start().starts_with('#') {
        page.metadata.mode = NoteMode::Md;
        dirty = true;
    }
    dirty
}

/// Sync page metadata **from the book body TOC** (body is baseline).
/// Does not rewrite the book markdown. Optional create for dead TOC links.
async fn sync_book_meta_from_body_toc(
    bucket: &Bucket,
    book_path: &str,
    book: &NoteRecord,
    create_missing: bool,
    changes: &mut Vec<RepairChange>,
) -> Result<(u32, u32)> {
    let mut pages_checked = 0u32;
    let mut pages_created = 0u32;

    // Empty map: TOC parse only needs titles/paths from markdown.
    let empty: HashMap<String, NoteMetadata> = HashMap::new();
    let toc_items = parse_book_toc(book_path, &book.content, &empty);
    let mut toc_paths = HashSet::new();

    for item in toc_items.iter().filter(|t| !t.heading) {
        let Some(path) = item.path.clone() else {
            continue;
        };
        if path.starts_with("http://") || path.starts_with("https://") {
            continue;
        }
        toc_paths.insert(path.clone());
        pages_checked += 1;
        let toc_title = item.title.clone();

        match get_snapshot(bucket, &path).await? {
            Some(snapshot) => {
                let mut page = snapshot.record;
                if apply_toc_page_metadata(&mut page, book_path, &toc_title, changes) {
                    page.metadata.update_at = Some(now_unix());
                    put_note_object(bucket, &page, snapshot.uploaded_at).await?;
                }
            }
            None => {
                if !create_missing {
                    changes.push(change(
                        "deadLink",
                        format!("TOC link without object: {path}"),
                    ));
                    continue;
                }
                let page = new_toc_page(&path, book_path, &toc_title);
                put_note_object(bucket, &page, None).await?;
                pages_created += 1;
                changes.push(change("createPage", format!("created {path} from TOC")));
            }
        }
    }

    // Orphans: R2 pages under prefix that body TOC does not list.
    let keys = list_book_page_keys(bucket, book_path).await?;
    for key in keys {
        if toc_paths.contains(&key) {
            continue;
        }
        changes.push(change(
            "orphanPage",
            format!("{key}: in R2 but not in book TOC (body baseline keeps TOC)"),
        ));
    }

    Ok((pages_checked, pages_created))
}

fn normalize_indexed_page(page: &mut NoteRecord, book_path: &str, changes: &mut Vec<RepairChange>) {
    heal_title_fields(page, TitlePrefer::Title, changes);
    heal_doc_type(page, changes);
    if page.metadata.doc_type == DocType::Article {
        page.metadata.doc_type = DocType::Page;
        changes.push(change("docType", format!("{}: article → page", page.path)));
    }
    if page.metadata.book_ref.as_deref() != Some(book_path) {
        page.metadata.book_ref = Some(book_path.to_string());
        changes.push(change(
            "bookRef",
            format!("{}: bookRef → {book_path}", page.path),
        ));
    }
    if page.metadata.mode == NoteMode::Plain && page.content.trim_start().starts_with('#') {
        page.metadata.mode = NoteMode::Md;
    }
}

fn render_rebuilt_toc(book: &NoteRecord, page_titles: &[(String, String)]) -> String {
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
        for (path, title) in page_titles {
            content.push_str(&format!("- [{title}]({path})\n"));
        }
    }

    content
}

/// Legacy: rebuild body TOC from R2 page objects (metadata → body).
/// Only used when `prefer=title`.
async fn rebuild_book_toc_from_objects(
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
        match get_snapshot(bucket, &key).await? {
            Some(snapshot) => {
                let mut page = snapshot.record;
                normalize_indexed_page(&mut page, book_path, changes);
                page.metadata.update_at = page.metadata.update_at.or(Some(now_unix()));
                put_note_object(bucket, &page, snapshot.uploaded_at).await?;
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
    let toc_items = parse_book_toc(book_path, &book.content, &HashMap::new());
    let mut indexed_paths: HashSet<_> = page_titles.iter().map(|(path, _)| path.clone()).collect();
    for item in toc_items {
        let Some(path) = item.path.filter(|_| !item.heading) else {
            continue;
        };
        if path.starts_with("http") || indexed_paths.contains(&path) {
            continue;
        }
        if !create_missing {
            changes.push(change(
                "deadLink",
                format!("TOC link without object: {path}"),
            ));
            continue;
        }
        let title = item.title;
        let page = new_toc_page(&path, book_path, &title);
        put_note_object(bucket, &page, None).await?;
        pages_created += 1;
        pages_checked += 1;
        indexed_paths.insert(path.clone());
        page_titles.push((path.clone(), title));
        changes.push(change("createPage", format!("created {path}")));
    }

    page_titles.sort_by(|a, b| a.0.cmp(&b.0));
    let content = render_rebuilt_toc(book, &page_titles);
    let rebuilt = content != book.content;
    if rebuilt {
        book.content = content;
        changes.push(change(
            "toc",
            format!("rebuilt TOC ({} pages)", page_titles.len()),
        ));
    }

    Ok((pages_checked, pages_created, rebuilt))
}

fn infer_page_book_ref(record: &mut NoteRecord, changes: &mut Vec<RepairChange>) {
    if record.metadata.doc_type == DocType::Page && record.metadata.book_ref.is_none() {
        if let Some((root, _)) = record.path.split_once('/') {
            record.metadata.book_ref = Some(root.to_string());
            changes.push(change("bookRef", format!("bookRef ← {root}")));
        }
    }
}

/// Repair a single document path.
pub async fn repair_doc(
    bucket: &Bucket,
    origin: &str,
    path: &str,
    prefer: TitlePrefer,
    rebuild_toc: bool,
    create_missing: bool,
) -> Result<RepairResult> {
    let mut invalidations = HashSet::new();
    let result = repair_doc_inner(
        bucket,
        path,
        prefer,
        rebuild_toc,
        create_missing,
        &mut invalidations,
    )
    .await;
    invalidate_repaired(bucket, origin, &invalidations).await;
    result
}

async fn invalidate_repaired(bucket: &Bucket, origin: &str, paths: &HashSet<String>) {
    let paths: Vec<_> = paths.iter().map(String::as_str).collect();
    invalidate_for_paths(bucket, origin, &paths).await;
}

async fn repair_doc_inner(
    bucket: &Bucket,
    path: &str,
    prefer: TitlePrefer,
    rebuild_toc: bool,
    create_missing: bool,
    invalidations: &mut HashSet<String>,
) -> Result<RepairResult> {
    let path = path.trim().trim_matches('/').to_string();
    if path.is_empty() || is_system_key(&path) {
        return Err(worker::Error::RustError("invalid path".into()));
    }

    let snapshot = get_snapshot(bucket, &path)
        .await?
        .ok_or_else(|| worker::Error::RustError("not found".into()))?;
    let mut record = snapshot.record;
    invalidations.insert(path.clone());
    if let Some(book_ref) = &record.metadata.book_ref {
        invalidations.insert(book_ref.clone());
    }
    let mut changes = Vec::new();
    heal_doc_type(&mut record, &mut changes);
    heal_mode(&mut record, &mut changes);

    let is_book = record.metadata.doc_type == DocType::Book
        || (rebuild_toc && record.content.contains("## TOC"));
    if is_book && record.metadata.doc_type != DocType::Book {
        record.metadata.doc_type = DocType::Book;
        changes.push(change("docType", "-> book (TOC detected)"));
    }
    heal_title_fields(&mut record, prefer, &mut changes);

    let (pages_checked, pages_created, toc_rebuilt) = if is_book {
        match prefer {
            TitlePrefer::H1 => {
                let (checked, created) = sync_book_meta_from_body_toc(
                    bucket,
                    &path,
                    &record,
                    create_missing,
                    &mut changes,
                )
                .await?;
                (checked, created, false)
            }
            TitlePrefer::Title => {
                rebuild_book_toc_from_objects(
                    bucket,
                    &path,
                    &mut record,
                    create_missing,
                    &mut changes,
                )
                .await?
            }
        }
    } else {
        infer_page_book_ref(&mut record, &mut changes);
        (0, 0, false)
    };

    if !changes.is_empty() {
        record.metadata.update_at = Some(now_unix());
        put_note_object(bucket, &record, snapshot.uploaded_at).await?;
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
    origin: &str,
    prefer: TitlePrefer,
    create_missing: bool,
    limit: usize,
) -> Result<Vec<RepairResult>> {
    let mut invalidations = HashSet::new();
    let result = repair_all_inner(bucket, prefer, create_missing, limit, &mut invalidations).await;
    invalidate_repaired(bucket, origin, &invalidations).await;
    result
}

async fn repair_all_inner(
    bucket: &Bucket,
    prefer: TitlePrefer,
    create_missing: bool,
    limit: usize,
    invalidations: &mut HashSet<String>,
) -> Result<Vec<RepairResult>> {
    let metadata = list_metadata(bucket, None).await?;
    let mut keys: Vec<_> = metadata.keys().cloned().collect();
    keys.sort_unstable();
    let roots_with_children: HashSet<_> = keys
        .iter()
        .filter_map(|key| key.split_once('/').map(|(root, _)| root))
        .collect();
    let mut results = Vec::new();

    // First pass: top-level keys that look like books (have children) or docType book.
    let mut book_candidates: Vec<String> = Vec::new();
    for key in &keys {
        if key.contains('/') {
            continue;
        }
        if roots_with_children.contains(key.as_str()) || metadata[key].doc_type == DocType::Book {
            book_candidates.push(key.clone());
        }
    }

    for path in book_candidates.into_iter().take(limit.max(1)) {
        match repair_doc_inner(bucket, &path, prefer, true, create_missing, invalidations).await {
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
        let Some(snapshot) = get_snapshot(bucket, key).await? else {
            continue;
        };
        let mut rec = snapshot.record;
        if rec.metadata.doc_type == DocType::Page {
            continue;
        }
        let mut changes = Vec::new();
        heal_doc_type(&mut rec, &mut changes);
        heal_mode(&mut rec, &mut changes);
        heal_title_fields(&mut rec, prefer, &mut changes);
        if !changes.is_empty() {
            rec.metadata.update_at = Some(now_unix());
            put_note_object(bucket, &rec, snapshot.uploaded_at).await?;
            invalidations.insert(key.clone());
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
    fn toc_page_repair_is_idempotent_and_keeps_body_text() {
        let mut page = NoteRecord {
            path: "book/chapter".into(),
            content: "# Old\n\nChapter body".into(),
            metadata: NoteMetadata::default(),
        };
        let mut changes = Vec::new();
        assert!(apply_toc_page_metadata(
            &mut page,
            "book",
            "New",
            &mut changes
        ));
        assert_eq!(page.content, "# New\n\nChapter body");
        assert_eq!(page.metadata.doc_type, DocType::Page);
        assert_eq!(page.metadata.book_ref.as_deref(), Some("book"));
        assert_eq!(page.metadata.title.as_deref(), Some("New"));
        changes.clear();
        assert!(!apply_toc_page_metadata(
            &mut page,
            "book",
            "New",
            &mut changes
        ));
        assert!(changes.is_empty());
    }

    #[test]
    fn prefer_parse() {
        // Body-first is default for unspecified values.
        assert_eq!(TitlePrefer::parse("h1"), TitlePrefer::H1);
        assert_eq!(TitlePrefer::parse("body"), TitlePrefer::H1);
        assert_eq!(TitlePrefer::parse(""), TitlePrefer::H1);
        assert_eq!(TitlePrefer::parse("title"), TitlePrefer::Title);
        assert_eq!(TitlePrefer::parse("meta"), TitlePrefer::Title);
        assert_eq!(TitlePrefer::default_body_first(), TitlePrefer::H1);
    }
}
