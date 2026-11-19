//! Library-level APIs: create docs, bookshelf, homepage tree.

use worker::*;

use crate::error::*;
use crate::models::api::{CreateDocRequest, CreateDocResponse};
use crate::models::note::{is_system_key, DocType};
use crate::services::note;

use super::util::clean_path;

// ── POST /api/docs ───────────────────────────────────────────────────

pub async fn create_doc(
    mut req: Request,
    ctx: RouteContext<crate::RequestState>,
) -> Result<Response> {
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
    match note::create_doc(
        &bucket,
        &ctx.data.origin,
        &path,
        doc_type,
        body.title,
        body.summary,
    )
    .await
    {
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

pub async fn list_books(_req: Request, ctx: RouteContext<crate::RequestState>) -> Result<Response> {
    let bucket = ctx.env.bucket("NOTES")?;
    let index = note::index_bucket(&bucket).await?;
    let counts = index.page_counts.clone();
    let mut books: Vec<_> = note::visible_docs_from_index(index)
        .into_iter()
        .filter(|record| record.metadata.doc_type == DocType::Book)
        .collect();
    books.sort_by(|a, b| {
        b.metadata
            .update_at
            .cmp(&a.metadata.update_at)
            .then_with(|| a.path.cmp(&b.path))
    });
    let items: Vec<_> = books
        .into_iter()
        .take(200)
        .map(|record| {
            let item = crate::models::note::DocListItem::from_record(&record, false);
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
                "pageCount": counts.get(&record.path).copied().unwrap_or(0),
            })
        })
        .collect();

    ok_json(serde_json::json!({
        "total": items.len(),
        "items": items,
    }))
}

// ── GET /api/home-tree ───────────────────────────────────────────────

pub async fn home_tree(req: Request, ctx: RouteContext<crate::RequestState>) -> Result<Response> {
    let bucket = ctx.env.bucket("NOTES")?;
    let url = req.url()?;
    let skip_cache = url
        .query_pairs()
        .any(|(k, v)| (k == "refresh" || k == "nocache") && v != "0" && v != "false");

    ok_json(load_home_tree_payload(&bucket, &ctx.data, skip_cache).await?)
}

pub(crate) async fn load_home_tree_payload(
    bucket: &Bucket,
    state: &crate::RequestState,
    skip_cache: bool,
) -> Result<serde_json::Value> {
    let key = note::HOME_TREE_CACHE_KEY;
    let mut read =
        note::read_json_cache(&state.context, bucket, &state.origin, key, skip_cache).await;
    if let Some(payload) = read.payload.take() {
        return Ok(payload);
    }
    let etag = note::reserve_cache_fill(bucket, key, read).await;
    let payload = build_home_tree_payload(bucket).await?;
    note::schedule_cache_fill(&state.context, bucket, &state.origin, key, etag, &payload);
    Ok(payload)
}

pub(crate) async fn build_home_tree_payload(bucket: &worker::Bucket) -> Result<serde_json::Value> {
    let index = note::index_bucket(bucket).await?;
    let counts = index.page_counts.clone();
    let records = note::visible_docs_from_index(index);
    let tree = note::build_home_tree_with_page_counts(&records, &counts);

    let mut article_count = 0u32;
    let mut book_count = 0u32;
    for r in &records {
        if is_system_key(&r.path) {
            continue;
        }
        match r.metadata.doc_type {
            DocType::Book => book_count += 1,
            _ => article_count += 1,
        }
    }

    Ok(serde_json::json!({
        "counts": { "article": article_count, "book": book_count },
        "tree": tree,
    }))
}
