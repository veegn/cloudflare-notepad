use worker::*;

use crate::error::*;
use crate::models::api::*;
use crate::services::{auth, note};

/// Helper: extract the `Cookie` header value.
fn cookie_header(req: &Request) -> Option<String> {
    req.headers().get("Cookie").ok().flatten()
}

/// Helper: strip leading `/` from a wildcard path capture.
fn clean_path(raw: &str) -> String {
    raw.trim_start_matches('/').to_string()
}

fn get_salt(env: &Env) -> String {
    env.var("SCN_SALT")
        .map(|s| s.to_string())
        .unwrap_or_default()
}

fn get_index_password(env: &Env) -> Option<String> {
    env.var("SCN_INDEX_PASSWD")
        .ok()
        .map(|v| v.to_string())
        .filter(|s| !s.is_empty())
}

// ── GET /api/notes/*path ─────────────────────────────────────────────

pub async fn get_note(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let raw_path = ctx.param("path").unwrap_or(&String::new()).to_string();
    let path = clean_path(&raw_path);
    let kv = ctx.env.kv("NOTES")?;
    let record = note::query_note(&kv, &path).await?;

    let secret = auth::required_jwt_secret(&ctx.env)?;
    let salt = get_salt(&ctx.env);
    let cookie = cookie_header(&req);

    // Parse query params for password and raw flag.
    let url = req.url()?;
    let query_pw = url
        .query_pairs()
        .find(|(k, _)| k == "password" || k == "passwd" || k == "pw")
        .map(|(_, v)| v.to_string());
    let is_raw = url.query_pairs().any(|(k, _)| k == "raw");

    // Auth check for protected notes.
    if auth::needs_view_auth(&record.metadata) {
        let authorized = auth::is_view_authorized(
            query_pw.as_deref(),
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

    // Raw mode: return plain text.
    if is_raw {
        return Ok(Response::ok(record.content)?.with_headers({
            let mut h = Headers::new();
            h.set("Content-Type", "text/plain; charset=utf-8")?;
            h
        }));
    }

    // JSON mode: return structured response.
    let resp = NoteResponse {
        content: record.content,
        metadata: (&record.metadata).into(),
    };
    ok_json(resp)
}

// ── PUT /api/notes/*path ─────────────────────────────────────────────

pub async fn put_note(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let raw_path = ctx.param("path").unwrap_or(&String::new()).to_string();
    let path = clean_path(&raw_path);
    let kv = ctx.env.kv("NOTES")?;
    let record = note::query_note(&kv, &path).await?;

    let secret = auth::required_jwt_secret(&ctx.env)?;
    let index_pw = get_index_password(&ctx.env);
    let cookie = cookie_header(&req);

    if !auth::is_edit_authorized(
        cookie.as_deref(),
        &path,
        &record.metadata,
        &secret,
        &index_pw,
    ) {
        return err_json(ERR_AUTH_FAILED, "Password auth failed", 401);
    }

    let body: SaveNoteRequest = req.json().await?;
    note::save_note(&kv, &path, &body.content).await?;

    ok_empty()
}

// ── DELETE /api/notes/*path ──────────────────────────────────────────

pub async fn delete_note(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let raw_path = ctx.param("path").unwrap_or(&String::new()).to_string();
    let path = clean_path(&raw_path);
    let kv = ctx.env.kv("NOTES")?;
    let record = note::query_note(&kv, &path).await?;

    let secret = auth::required_jwt_secret(&ctx.env)?;
    let index_pw = get_index_password(&ctx.env);
    let cookie = cookie_header(&req);

    if !auth::is_edit_authorized(
        cookie.as_deref(),
        &path,
        &record.metadata,
        &secret,
        &index_pw,
    ) {
        return err_json(ERR_AUTH_FAILED, "Password auth failed", 401);
    }

    note::delete_note(&kv, &path).await?;
    ok_empty()
}

// ── PATCH /api/notes/*path ───────────────────────────────────────────

pub async fn patch_note(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let mut req = req; // need mut to extract json
    let raw_path = ctx.param("path").unwrap_or(&String::new()).to_string();
    let path = clean_path(&raw_path);
    let kv = ctx.env.kv("NOTES")?;
    let record = note::query_note(&kv, &path).await?;

    let secret = auth::required_jwt_secret(&ctx.env)?;
    let index_pw = get_index_password(&ctx.env);
    let cookie = cookie_header(&req);

    if !auth::is_edit_authorized(
        cookie.as_deref(),
        &path,
        &record.metadata,
        &secret,
        &index_pw,
    ) {
        return err_json(ERR_AUTH_FAILED, "Password auth failed", 401);
    }

    let body_text = req.text().await.unwrap_or_default();
    let body = match serde_json::from_str::<PatchNoteRequest>(&body_text) {
        Ok(b) => b,
        Err(e) => {
            worker::console_error!("JSON parse error on '{}': {}", body_text, e);
            return err_json(40000, "Invalid JSON", 400);
        }
    };

    if let Some(ref password) = body.password {
        let pw_hash = if password.is_empty() {
            None
        } else {
            match auth::hash_password(password) {
                Ok(h) => Some(h),
                Err(e) => {
                    worker::console_error!("Hash error: {}", e);
                    return Err(e);
                }
            }
        };
        if let Err(e) = note::set_password(&kv, &path, pw_hash).await {
            worker::console_error!("KV set_password error: {}", e);
            return Err(e);
        }

        let mut resp = ok_empty()?;
        if password.is_empty() {
            resp.headers_mut().set(
                "Set-Cookie",
                "auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict",
            )?;
        } else {
            let secret = auth::required_jwt_secret(&ctx.env)?;
            if let Ok(token) = auth::create_auth_token(&path, &secret) {
                let cookie = format!(
                    "auth={}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict",
                    token
                );
                resp.headers_mut().set("Set-Cookie", &cookie)?;
            }
        }
        return Ok(resp);
    }

    if let Some(mode) = body.mode {
        if let Err(e) = note::set_mode(&kv, &path, mode).await {
            worker::console_error!("KV set_mode error: {}", e);
            return Err(e);
        }
    }

    ok_empty()
}

// ── POST /api/auth ───────────────────────────────────────────────────

pub async fn auth_note(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let body: AuthRequest = req.json().await?;
    let path = clean_path(&body.path);

    let kv = ctx.env.kv("NOTES")?;
    let record = note::query_note(&kv, &path).await?;

    let secret = auth::required_jwt_secret(&ctx.env)?;
    let salt = get_salt(&ctx.env);
    let index_pw = get_index_password(&ctx.env);

    if !auth::matches_edit_password(&path, &body.password, &record.metadata, &salt, &index_pw) {
        return err_json(ERR_AUTH_FAILED, "Password auth failed", 401);
    }

    let token = auth::create_auth_token(&path, &secret)?;

    let cookie_value = format!(
        "auth={token}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Strict",
        max_age = auth::AUTH_MAX_AGE_SECONDS,
    );

    let resp_data = AuthResponse {
        token: token.clone(),
    };
    let mut resp = ok_json(resp_data)?;
    resp.headers_mut().set("Set-Cookie", &cookie_value)?;

    Ok(resp)
}
