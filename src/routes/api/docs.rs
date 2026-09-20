//! Library-level APIs: create docs, bookshelf, homepage tree.

use worker::*;

use crate::error::*;
use crate::models::api::{CreateDocRequest, CreateDocResponse};
use crate::models::note::{is_index_path, DocListItem, DocType};
use crate::services::note;

use super::util::clean_path;

// ── POST /api/docs ───────────────────────────────────────────────────

pub async fn create_doc(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let body: CreateDocRequest = match req.json().await {
        Ok(b) => b,
        Err(_) => return err_json(40005, "Invalid JSON", 400),
    };

    let doc_type = match body.doc_type.as_str() {
        "article" => DocType::Article,
        "book" => DocType::Book,
        "page" => {
            return err_json(
                40010,
                "Pages can only be created from the book editor.",
                400,
            )
        }
        _ => return err_json(40011, "docType must be article or book", 400),
    };

    let path = match body
        .path
        .as_ref()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
    {
        Some(p) => clean_path(p),
        None => {
            if doc_type == DocType::Book {
                return err_json(40012, "book path is required", 400);
            }
            note::gen_random_path()
        }
    };

    if let Err(e) = validate_doc_path(&path) {
        return err_json(40007, &e, 400);
    }

    if doc_type == DocType::Book {
        let has_title = body
            .title
            .as_ref()
            .map(|t| !t.trim().is_empty())
            .unwrap_or(false);
        if !has_title {
            return err_json(40013, "book title is required", 400);
        }
    }

    let bucket = ctx.env.bucket("NOTES")?;
    match note::create_doc(&bucket, &path, doc_type, body.title, body.summary).await {
        Ok(record) => {
            let edit_url = format!("/edit/{}", urlencoding::encode(&record.path));
            let view_url = format!("/note/{}", urlencoding::encode(&record.path));
            ok_json(CreateDocResponse {
                path: record.path.clone(),
                doc_type: record.metadata.doc_type,
                title: record.metadata.title.clone(),
                edit_url,
                view_url,
            })
        }
        Err(worker::Error::RustError(msg)) if msg.contains("already exists") => {
            err_json(40900, "path already exists", 409)
        }
        Err(worker::Error::RustError(msg)) => err_json(40014, &msg, 400),
        Err(e) => Err(e),
    }
}

fn validate_doc_path(path: &str) -> std::result::Result<(), String> {
    let p = path.trim().trim_matches('/');
    if p.is_empty() {
        return Err("path is required".into());
    }
    if p.contains("..") {
        return Err("path must not contain ..".into());
    }
    if p.starts_with('_') || p.starts_with('.') {
        return Err("path must not start with _ or .".into());
    }
    for seg in p.split('/') {
        if seg.is_empty() {
            return Err("path must not contain empty segments".into());
        }
        if seg.contains('\\') {
            return Err("path contains invalid characters".into());
        }
    }
    Ok(())
}

// ── GET /api/books ───────────────────────────────────────────────────

pub async fn list_books(_req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let bucket = ctx.env.bucket("NOTES")?;
    let books = note::list_all_docs(
        &bucket,
        &note::ListOptions {
            doc_type: Some(DocType::Book),
            exclude_pages: false,
            book_ref: None,
            limit: 200,
        },
    )
    .await?;

    let pages = note::list_all_docs(
        &bucket,
        &note::ListOptions {
            doc_type: Some(DocType::Page),
            exclude_pages: false,
            book_ref: None,
            limit: 2000,
        },
    )
    .await?;

    let mut counts: std::collections::HashMap<String, u32> = Default::default();
    for p in &pages {
        if let Some(br) = &p.metadata.book_ref {
            *counts.entry(br.clone()).or_insert(0) += 1;
        }
    }

    let items: Vec<_> = books
        .iter()
        .map(|b| {
            let item = DocListItem::from_record(b, true);
            serde_json::json!({
                "path": item.path,
                "docType": item.doc_type,
                "title": item.title,
                "excerpt": item.excerpt,
                "updateAt": item.update_at,
                "mode": item.mode,
                "protected": item.protected,
                "shared": item.shared,
                "hasExcerpt": item.has_excerpt,
                "pageCount": counts.get(&b.path).copied().unwrap_or(0),
            })
        })
        .collect();

    ok_json(serde_json::json!({
        "total": items.len(),
        "items": items,
    }))
}

// ── GET /api/home-tree ───────────────────────────────────────────────

pub async fn home_tree(_req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let bucket = ctx.env.bucket("NOTES")?;
    let records = note::list_all_docs(
        &bucket,
        &note::ListOptions {
            doc_type: None,
            exclude_pages: true,
            book_ref: None,
            limit: 1000,
        },
    )
    .await?;

    let tree = note::build_home_tree_with_counts(&bucket, &records).await?;

    let mut article_count = 0u32;
    let mut book_count = 0u32;
    for r in &records {
        if is_index_path(&r.path) {
            continue;
        }
        match r.metadata.doc_type {
            DocType::Book => book_count += 1,
            _ => article_count += 1,
        }
    }

    ok_json(serde_json::json!({
        "counts": { "article": article_count, "book": book_count },
        "tree": tree,
    }))
}
