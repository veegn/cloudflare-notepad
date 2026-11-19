//! Note item handlers: GET/PUT/PATCH/DELETE `/api/notes/*` and GET `/api/notes`.

use worker::*;

use crate::error::*;
use crate::models::api::*;
use crate::models::note::{is_index_path, is_system_key, DocListItem, DocType};
use crate::routes::{query_password, wants_raw};
use crate::services::{auth, note};

use super::util::{clean_path, cookie_header, get_index_password, get_salt, is_edit_authorized};

// ── GET /api/notes/*path ─────────────────────────────────────────────

pub async fn get_note(req: Request, ctx: RouteContext<crate::RequestState>) -> Result<Response> {
    let path = clean_path(ctx.param("path").unwrap_or(&String::new()));
    let bucket = ctx.env.bucket("NOTES")?;
    let record = note::query_note(&bucket, &path).await?;

    let secret = auth::required_jwt_secret(&ctx.env)?;
    let salt = get_salt(&ctx.env);
    let cookie = cookie_header(&req);
    let url = req.url()?;
    let raw = wants_raw(&url);

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
            if raw {
                return Ok(Response::ok("Authorization required")?.with_status(403));
            }
            return err_json(ERR_UNAUTHORIZED, "Authorization required", 403);
        }
    }

    if raw {
        return Response::ok(record.content);
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

pub async fn list_notes(req: Request, ctx: RouteContext<crate::RequestState>) -> Result<Response> {
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

pub async fn put_note(
    mut req: Request,
    ctx: RouteContext<crate::RequestState>,
) -> Result<Response> {
    let path = clean_path(ctx.param("path").unwrap_or(&String::new()));
    if is_system_key(&path) && !is_index_path(&path) {
        return err_json(40007, "Reserved storage path", 400);
    }
    let bucket = ctx.env.bucket("NOTES")?;
    let secret = auth::required_jwt_secret(&ctx.env)?;
    let index_pw = get_index_password(&ctx.env);
    let cookie = cookie_header(&req);
    let mut snapshot = note::head_note(&bucket, &path).await?;
    if !is_edit_authorized(
        cookie.as_deref(),
        &path,
        &snapshot.record,
        &secret,
        &index_pw,
    ) {
        return err_json(ERR_AUTH_FAILED, "Password auth failed", 401);
    }
    let body: SaveNoteRequest = req.json().await?;
    for _ in 0..4 {
        if !is_edit_authorized(
            cookie.as_deref(),
            &path,
            &snapshot.record,
            &secret,
            &index_pw,
        ) {
            return err_json(ERR_AUTH_FAILED, "Password auth failed", 401);
        }
        match note::save_note(&bucket, &ctx.data.origin, snapshot, body.content.clone()).await {
            Ok(()) => return ok_empty(),
            Err(error) if note::is_write_conflict(&error) => {
                snapshot = note::head_note(&bucket, &path).await?
            }
            Err(error) => return Err(error),
        }
    }
    err_json(40901, note::WRITE_CONFLICT, 409)
}

// ── DELETE /api/notes/*path ──────────────────────────────────────────

pub async fn delete_note(req: Request, ctx: RouteContext<crate::RequestState>) -> Result<Response> {
    let path = clean_path(ctx.param("path").unwrap_or(&String::new()));
    if is_system_key(&path) && !is_index_path(&path) {
        return err_json(40007, "Reserved storage path", 400);
    }
    let bucket = ctx.env.bucket("NOTES")?;
    let record = note::head_note(&bucket, &path).await?.record;

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
        note::delete_book_page(&bucket, &ctx.data.origin, &path, true).await?;
        let _ = sync_book; // pages always sync TOC
    } else {
        note::delete_note(&bucket, &ctx.data.origin, &path).await?;
    }

    ok_empty()
}

// ── PATCH /api/notes/*path ───────────────────────────────────────────

pub async fn patch_note(
    mut req: Request,
    ctx: RouteContext<crate::RequestState>,
) -> Result<Response> {
    let path = clean_path(ctx.param("path").unwrap_or(&String::new()));
    if is_system_key(&path) && !is_index_path(&path) {
        return err_json(40007, "Reserved storage path", 400);
    }
    let bucket = ctx.env.bucket("NOTES")?;
    let secret = auth::required_jwt_secret(&ctx.env)?;
    let index_pw = get_index_password(&ctx.env);
    let cookie = cookie_header(&req);
    let mut snapshot = note::read_note_for_update(&bucket, &path).await?;
    if !is_edit_authorized(
        cookie.as_deref(),
        &path,
        &snapshot.record,
        &secret,
        &index_pw,
    ) {
        return err_json(ERR_AUTH_FAILED, "Password auth failed", 401);
    }

    let body: PatchNoteRequest = match req.json().await {
        Ok(body) => body,
        Err(_) => return err_json(40000, "Invalid JSON", 400),
    };
    let new_password = match body.password.as_deref() {
        Some("") => Some(None),
        Some(password) => Some(Some(auth::hash_password(password)?)),
        None => None,
    };
    let title = body.title.as_deref().map(str::trim);
    if new_password.is_none() && body.mode.is_none() && title.is_none() && body.share.is_none() {
        return ok_empty();
    }

    for attempt in 0..4 {
        if attempt > 0 {
            snapshot = note::read_note_for_update(&bucket, &path).await?;
            if !is_edit_authorized(
                cookie.as_deref(),
                &path,
                &snapshot.record,
                &secret,
                &index_pw,
            ) {
                return err_json(ERR_AUTH_FAILED, "Password auth failed", 401);
            }
        }
        apply_metadata_patch(&mut snapshot.record, &body, title, new_password.as_ref());
        let toc_title = title.filter(|_| new_password.is_none());
        match note::commit_note_update(&bucket, &ctx.data.origin, &snapshot, toc_title).await {
            Ok(()) => {
                if let Some(password) = body.password {
                    return password_response(&path, &secret, password.is_empty());
                }
                return ok_empty();
            }
            Err(error) if note::is_write_conflict(&error) => continue,
            Err(error) => return Err(error),
        }
    }
    err_json(40901, note::WRITE_CONFLICT, 409)
}

fn apply_metadata_patch(
    record: &mut crate::models::note::NoteRecord,
    patch: &PatchNoteRequest,
    title: Option<&str>,
    new_password: Option<&Option<String>>,
) {
    if let Some(password) = new_password {
        record.metadata.pw = password.clone();
    } else {
        if let Some(mode) = patch.mode {
            record.metadata.mode = mode;
        }
        if let Some(title) = title {
            record.metadata.title = (!title.is_empty()).then(|| title.to_string());
        }
        if let Some(share) = patch.share {
            record.metadata.share = share;
        }
        record.metadata.update_at = Some((Date::now().as_millis() / 1000) as i64);
    }
    if record.content.is_empty()
        && (new_password.is_some() || title.is_some() || patch.share.is_some())
    {
        record.content.push(' ');
    }
}

fn password_response(path: &str, secret: &str, removed: bool) -> Result<Response> {
    let mut resp = ok_empty()?;
    if removed {
        resp.headers_mut().set(
            "Set-Cookie",
            "auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict",
        )?;
    } else if let Ok(token) = auth::create_auth_token(path, secret) {
        let cookie = format!("auth={token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict");
        resp.headers_mut().set("Set-Cookie", &cookie)?;
    }
    Ok(resp)
}
