//! Note item handlers: GET/PUT/PATCH/DELETE `/api/notes/*` and GET `/api/notes`.

use worker::*;

use crate::error::*;
use crate::models::api::*;
use crate::models::note::{is_system_key, DocListItem, DocType};
use crate::services::{auth, note};

use super::util::{
    clean_path, cookie_header, get_index_password, get_salt, is_edit_authorized, query_password,
    wants_raw,
};

// ── GET /api/notes/*path ─────────────────────────────────────────────

pub async fn get_note(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let path = clean_path(ctx.param("path").unwrap_or(&String::new()));
    let bucket = ctx.env.bucket("NOTES")?;
    let record = note::query_note(&bucket, &path).await?;

    let secret = auth::required_jwt_secret(&ctx.env)?;
    let salt = get_salt(&ctx.env);
    let cookie = cookie_header(&req);
    let url = req.url()?;

    if auth::needs_view_auth(&record.metadata) {
        let authorized = auth::is_view_authorized(
            query_password(&url).as_deref(),
            cookie.as_deref(),
            &path,
            &record.metadata,
            &salt,
            &secret,
        );
        if !authorized {
            return err_json(ERR_UNAUTHORIZED, "Authorization required", 403);
        }
    }

    if wants_raw(&url) {
        return Ok(Response::ok(record.content)?.with_headers({
            let mut h = Headers::new();
            h.set("Content-Type", "text/plain; charset=utf-8")?;
            h
        }));
    }

    ok_json(NoteResponse {
        content: record.content,
        metadata: (&record.metadata).into(),
    })
}

// ── GET /api/notes (list) ────────────────────────────────────────────

struct ListQuery {
    doc_type: Option<DocType>,
    exclude_pages: bool,
    book_ref: Option<String>,
    q: Option<String>,
    limit: usize,
    prefix: Option<String>,
}

fn parse_list_query(url: &worker::Url) -> ListQuery {
    let mut query = ListQuery {
        doc_type: None,
        exclude_pages: true,
        book_ref: None,
        q: None,
        limit: 100,
        prefix: None,
    };

    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "docType" => match v.as_ref() {
                "article" => {
                    query.doc_type = Some(DocType::Article);
                    query.exclude_pages = true;
                }
                "book" => {
                    query.doc_type = Some(DocType::Book);
                    query.exclude_pages = false;
                }
                "page" => {
                    query.doc_type = Some(DocType::Page);
                    query.exclude_pages = false;
                }
                "all" => {
                    query.doc_type = None;
                    query.exclude_pages = false;
                }
                _ => {}
            },
            "excludePages" => query.exclude_pages = v != "0" && v != "false",
            "bookRef" | "book" => {
                if !v.is_empty() {
                    query.book_ref = Some(v.to_string());
                }
            }
            "q" => {
                if !v.is_empty() {
                    query.q = Some(v.to_lowercase());
                }
            }
            "limit" => {
                if let Ok(n) = v.parse::<usize>() {
                    query.limit = n.clamp(1, 200);
                }
            }
            "prefix" if !v.is_empty() => {
                query.prefix = Some(v.to_string());
            }
            _ => {}
        }
    }
    query
}

fn item_matches_query(item: &DocListItem, needle: &str) -> bool {
    let hay = format!(
        "{} {} {}",
        item.path.to_lowercase(),
        item.title.to_lowercase(),
        item.excerpt.clone().unwrap_or_default().to_lowercase()
    );
    hay.contains(needle)
}

pub async fn list_notes(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let bucket = ctx.env.bucket("NOTES")?;
    let url = req.url()?;
    let query = parse_list_query(&url);

    let records = note::list_all_docs(
        &bucket,
        &note::ListOptions {
            doc_type: query.doc_type,
            exclude_pages: query.exclude_pages,
            book_ref: query.book_ref,
            limit: 500,
            prefix: query.prefix,
            include_body: query.q.is_some(),
        },
    )
    .await?;

    let mut items: Vec<DocListItem> = Vec::new();
    for rec in &records {
        if is_system_key(&rec.path) {
            continue;
        }
        let item = DocListItem::from_record(rec, true);
        if let Some(ref needle) = query.q {
            if !item_matches_query(&item, needle) {
                continue;
            }
        }
        items.push(item);
        if items.len() >= query.limit {
            break;
        }
    }

    let total = items.len();
    ok_json(serde_json::json!({
        "total": total,
        "items": items,
        "hasMore": false,
    }))
}

// ── PUT /api/notes/*path ─────────────────────────────────────────────

pub async fn put_note(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let path = clean_path(ctx.param("path").unwrap_or(&String::new()));
    let bucket = ctx.env.bucket("NOTES")?;
    let record = note::query_note(&bucket, &path).await?;

    let secret = auth::required_jwt_secret(&ctx.env)?;
    let index_pw = get_index_password(&ctx.env);
    let cookie = cookie_header(&req);
    if !is_edit_authorized(cookie.as_deref(), &path, &record, &secret, &index_pw) {
        return err_json(ERR_AUTH_FAILED, "Password auth failed", 401);
    }

    let body: SaveNoteRequest = req.json().await?;
    note::save_note(&bucket, &path, &body.content).await?;
    ok_empty()
}

// ── DELETE /api/notes/*path ──────────────────────────────────────────

pub async fn delete_note(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let path = clean_path(ctx.param("path").unwrap_or(&String::new()));
    let bucket = ctx.env.bucket("NOTES")?;
    let record = note::query_note(&bucket, &path).await?;

    let secret = auth::required_jwt_secret(&ctx.env)?;
    let index_pw = get_index_password(&ctx.env);
    let cookie = cookie_header(&req);
    if !is_edit_authorized(cookie.as_deref(), &path, &record, &secret, &index_pw) {
        return err_json(ERR_AUTH_FAILED, "Password auth failed", 401);
    }

    let url = req.url()?;
    let sync_book = url
        .query_pairs()
        .any(|(k, v)| (k == "syncBook" || k == "sync") && v != "0" && v != "false");

    if record.metadata.doc_type == DocType::Page {
        note::delete_book_page(&bucket, &path, true).await?;
        let _ = sync_book; // pages always sync TOC
    } else {
        note::delete_note(&bucket, &path).await?;
    }

    ok_empty()
}

// ── PATCH /api/notes/*path ───────────────────────────────────────────

pub async fn patch_note(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let path = clean_path(ctx.param("path").unwrap_or(&String::new()));
    let bucket = ctx.env.bucket("NOTES")?;
    let record = note::query_note(&bucket, &path).await?;

    let secret = auth::required_jwt_secret(&ctx.env)?;
    let index_pw = get_index_password(&ctx.env);
    let cookie = cookie_header(&req);
    if !is_edit_authorized(cookie.as_deref(), &path, &record, &secret, &index_pw) {
        return err_json(ERR_AUTH_FAILED, "Password auth failed", 401);
    }

    let body_text = req.text().await.unwrap_or_default();
    let body: PatchNoteRequest = match serde_json::from_str(&body_text) {
        Ok(b) => b,
        Err(_) => return err_json(40000, "Invalid JSON", 400),
    };

    if let Some(password) = body.password {
        return apply_password(&ctx.env, &bucket, &path, password).await;
    }

    if let Some(mode) = body.mode {
        note::set_mode(&bucket, &path, mode).await?;
    }

    if let Some(title) = body.title {
        apply_title(&bucket, &path, &record, title.trim()).await?;
    }

    ok_empty()
}

async fn apply_password(
    env: &Env,
    bucket: &worker::Bucket,
    path: &str,
    password: String,
) -> Result<Response> {
    let pw_hash = if password.is_empty() {
        None
    } else {
        Some(auth::hash_password(&password)?)
    };
    note::set_password(bucket, path, pw_hash).await?;

    let mut resp = ok_empty()?;
    if password.is_empty() {
        resp.headers_mut().set(
            "Set-Cookie",
            "auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict",
        )?;
        return Ok(resp);
    }

    let secret = auth::required_jwt_secret(env)?;
    if let Ok(token) = auth::create_auth_token(path, &secret) {
        let cookie = format!("auth={token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict");
        resp.headers_mut().set("Set-Cookie", &cookie)?;
    }
    Ok(resp)
}

async fn apply_title(
    bucket: &worker::Bucket,
    path: &str,
    record: &crate::models::note::NoteRecord,
    title: &str,
) -> Result<()> {
    let new_title = if title.is_empty() {
        None
    } else {
        Some(title.to_string())
    };
    note::set_title(bucket, path, new_title).await?;

    if record.metadata.doc_type != DocType::Page || title.is_empty() {
        return Ok(());
    }

    let Some(book_path) = record.metadata.book_ref.clone() else {
        return Ok(());
    };
    let book = note::query_note(bucket, &book_path).await?;
    let mut lines: Vec<String> = Vec::new();
    for line in book.content.lines() {
        if line.trim_start().starts_with("- [") && line.contains(&format!("]({path})")) {
            let indent = &line[..line.len() - line.trim_start().len()];
            lines.push(format!("{indent}- [{title}]({path})"));
        } else {
            lines.push(line.to_string());
        }
    }
    let mut content = lines.join("\n");
    if book.content.ends_with('\n') {
        content.push('\n');
    }
    if content != book.content {
        note::save_note(bucket, &book_path, &content).await?;
    }
    Ok(())
}
