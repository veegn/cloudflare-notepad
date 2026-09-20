//! Library-level APIs: create docs, bookshelf, homepage tree.

use worker::*;

use crate::error::*;
use crate::models::api::{CreateDocRequest, CreateDocResponse};
use crate::models::note::{is_index_path, DocType};
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
    let books = note::list_doc_metas(
        &bucket,
        &note::ListOptions {
            doc_type: Some(DocType::Book),
            exclude_pages: false,
            limit: 200,
            include_body: false,
            ..Default::default()
        },
    )
    .await?;

    let counts = note::book_page_counts(&bucket).await.unwrap_or_default();

    let items: Vec<_> = books
        .iter()
        .map(|(path, metadata)| {
            let title = metadata
                .title
                .clone()
                .unwrap_or_else(|| crate::models::note::path_display_name(path));
            serde_json::json!({
                "path": path,
                "docType": metadata.doc_type,
                "title": title,
                "excerpt": Option::<String>::None,
                "updateAt": metadata.update_at,
                "mode": metadata.mode,
                "protected": metadata.pw.is_some(),
                "shared": metadata.share,
                "hasExcerpt": false,
                "pageCount": counts.get(path).copied().unwrap_or(0),
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

    if let Some(cached) = note::read_json_cache(&bucket, note::HOME_TREE_CACHE_KEY).await {
        return ok_json(cached);
    }

    let records = note::list_visible_docs_fast(&bucket).await?;
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

    let payload = serde_json::json!({
        "counts": { "article": article_count, "book": book_count },
        "tree": tree,
    });
    note::write_json_cache(&bucket, note::HOME_TREE_CACHE_KEY, &payload).await;
    ok_json(payload)
}
