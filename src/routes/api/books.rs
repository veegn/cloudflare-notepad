//! Book TOC and page management APIs.

use worker::*;

use crate::error::*;
use crate::models::api::CreatePageRequest;
use crate::models::note::{path_display_name, DocType, NoteRecord};
use crate::services::{auth, note};

use super::util::{clean_path, cookie_header, get_index_password, is_edit_authorized};

const ERR_BAD_BOOK: u32 = 40004;

/// Build path→metadata map for book pages using prefix list (no full-bucket scan).
async fn book_page_existence(
    bucket: &worker::Bucket,
    book_path: &str,
) -> Result<std::collections::HashMap<String, crate::models::note::NoteMetadata>> {
    let keys = note::list_book_page_keys(bucket, book_path).await?;
    let mut map = std::collections::HashMap::new();
    for key in keys {
        map.insert(
            key,
            crate::models::note::NoteMetadata {
                doc_type: DocType::Page,
                book_ref: Some(book_path.to_string()),
                ..Default::default()
            },
        );
    }
    Ok(map)
}

// ── GET /api/toc?book= ───────────────────────────────────────────────

pub async fn get_toc(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let url = req.url()?;
    let Some(book_path) = url
        .query_pairs()
        .find(|(k, _)| k == "book")
        .map(|(_, v)| clean_path(&v))
        .filter(|s| !s.is_empty())
    else {
        return err_json(40003, "book query param is required", 400);
    };

    let bucket = ctx.env.bucket("NOTES")?;
    let cache_key = note::toc_cache_key(&book_path);
    if let Some(cached) = note::read_json_cache(&bucket, &cache_key).await {
        return ok_json(cached);
    }

    let book = note::query_note(&bucket, &book_path).await?;
    if book.metadata.doc_type != DocType::Book {
        return err_json(ERR_BAD_BOOK, "not a book", 400);
    }

    let existing = book_page_existence(&bucket, &book_path).await?;
    let items = note::parse_book_toc(&book_path, &book.content, &existing);

    let payload = serde_json::json!({
        "book": {
            "path": book_path,
            "title": book.display_title(),
            "docType": book.metadata.doc_type,
        },
        "items": items,
    });
    note::write_json_cache(&bucket, &cache_key, &payload).await;
    ok_json(payload)
}

// ── GET /api/books/{book}/pages ──────────────────────────────────────

pub async fn list_book_pages(_req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let book_path = clean_path(ctx.param("book").unwrap_or(&String::new()));
    let bucket = ctx.env.bucket("NOTES")?;
    let book = note::query_note(&bucket, &book_path).await?;
    if book.metadata.doc_type != DocType::Book {
        return err_json(ERR_BAD_BOOK, "not a book", 400);
    }

    let existing = book_page_existence(&bucket, &book_path).await?;
    let toc = note::parse_book_toc(&book_path, &book.content, &existing);

    let items: Vec<_> = toc
        .iter()
        .filter(|t| !t.heading && t.path.is_some())
        .map(|t| {
            serde_json::json!({
                "path": t.path,
                "title": t.title,
                "depth": t.depth,
                "exists": t.exists,
                "protected": t.protected,
                "updateAt": Option::<i64>::None,
                "mode": Option::<String>::None,
            })
        })
        .collect();

    ok_json(serde_json::json!({
        "book": { "path": book_path, "title": book.display_title() },
        "items": items,
        "total": items.len(),
    }))
}

// ── POST /api/books/{book}/pages ─────────────────────────────────────

pub async fn create_book_page(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let book_path = clean_path(ctx.param("book").unwrap_or(&String::new()));
    let bucket = ctx.env.bucket("NOTES")?;
    let book = note::query_note(&bucket, &book_path).await?;

    let secret = auth::required_jwt_secret(&ctx.env)?;
    let index_pw = get_index_password(&ctx.env);
    let cookie = cookie_header(&req);
    if !is_edit_authorized(cookie.as_deref(), &book_path, &book, &secret, &index_pw) {
        return err_json(ERR_AUTH_FAILED, "Password auth failed", 401);
    }

    if book.metadata.doc_type != DocType::Book {
        return err_json(ERR_BAD_BOOK, "not a book", 400);
    }

    let body: CreatePageRequest = match req.json().await {
        Ok(b) => b,
        Err(_) => return err_json(40005, "Invalid JSON", 400),
    };

    let title = body.title.trim().to_string();
    if title.is_empty() {
        return err_json(40006, "title is required", 400);
    }

    let page_path = match body.path {
        Some(p) if !p.trim().is_empty() => clean_path(&p),
        _ => format!("{}/{}", book_path, crate::models::api::slugify(&title)),
    };

    if let Err(e) = validate_page_path(&page_path, &book_path) {
        return err_json(40007, &e, 400);
    }

    match note::create_book_page(&bucket, &book_path, &page_path, &title).await {
        Ok(page) => ok_json(serde_json::json!({
            "path": page.path,
            "title": page.metadata.title.unwrap_or_else(|| path_display_name(&page.path)),
            "docType": page.metadata.doc_type,
            "bookRef": page.metadata.book_ref,
            "editUrl": format!("/edit/{}", urlencoding::encode(&page.path)),
            "viewUrl": format!("/note/{}", urlencoding::encode(&page.path)),
            "tocUpdated": true,
        })),
        Err(worker::Error::RustError(msg)) if msg.contains("already exists") => {
            err_json(40900, "path already exists", 409)
        }
        Err(worker::Error::RustError(msg)) => err_json(40009, &msg, 400),
        Err(e) => Err(e),
    }
}

// ── POST /api/books/{book}/adopt ─────────────────────────────────────
/// Adopt a historical path prefix as a book; stamp child keys as pages.
pub async fn adopt_book(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let book_path = clean_path(ctx.param("book").unwrap_or(&String::new()));
    if book_path.is_empty() {
        return err_json(40012, "book path is required", 400);
    }

    let bucket = ctx.env.bucket("NOTES")?;
    let existing = note::query_note(&bucket, &book_path).await?;

    let secret = auth::required_jwt_secret(&ctx.env)?;
    let index_pw = get_index_password(&ctx.env);
    let cookie = cookie_header(&req);
    if !is_edit_authorized(cookie.as_deref(), &book_path, &existing, &secret, &index_pw) {
        return err_json(ERR_AUTH_FAILED, "Password auth failed", 401);
    }

    // Optional title from query ?title=
    let title = req
        .url()
        .ok()
        .and_then(|u| {
            u.query_pairs()
                .find(|(k, _)| k == "title")
                .map(|(_, v)| v.to_string())
        })
        .filter(|t| !t.trim().is_empty());

    match note::adopt_book(&bucket, &book_path, title.as_deref()).await {
        Ok(result) => ok_json(serde_json::json!({
            "bookPath": result.book_path,
            "title": result.title,
            "pagesAdopted": result.pages_adopted,
            "pagesTotal": result.pages_total,
        })),
        Err(worker::Error::RustError(msg)) => err_json(40020, &msg, 400),
        Err(e) => Err(e),
    }
}

#[allow(dead_code)]
async fn list_pages_for_book(bucket: &worker::Bucket, book_path: &str) -> Result<Vec<NoteRecord>> {
    note::list_all_docs(
        bucket,
        &note::ListOptions {
            doc_type: Some(DocType::Page),
            exclude_pages: false,
            book_ref: Some(book_path.to_string()),
            limit: 2000,
            prefix: Some(format!("{}/", book_path.trim_matches('/'))),
            include_body: false,
        },
    )
    .await
}

fn validate_page_path(page_path: &str, book_path: &str) -> std::result::Result<(), String> {
    if page_path == book_path {
        return Err("page path conflicts with book path".into());
    }
    if page_path.contains("..") {
        return Err("path must not contain ..".into());
    }
    Ok(())
}
