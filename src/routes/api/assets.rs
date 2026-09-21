//! Image upload + serving.
//!
//! Storage layout (export-friendly):
//! - Note `path/to/doc` → assets at `path/to/doc.assets/{id}-{name}`
//! - Note `path/to/doc.md` → `path/to/doc.assets/{id}-{name}`
//! - Unbound uploads → legacy `_assets/{id}-{name}`
//!
//! Markdown uses relative links `./doc.assets/{file}` so a folder export
//! (doc + sibling `.assets`) keeps working outside the site.
//! Web preview rewrites these to `/assets/{full-r2-key}`.

use worker::*;

use crate::error::*;
use crate::services::{auth, note};

use super::util::{clean_path, cookie_header, get_index_password, is_edit_authorized};

pub const ASSET_PREFIX: &str = "_assets/";
const MAX_UPLOAD_BYTES: usize = 8 * 1024 * 1024;

fn is_allowed_image(content_type: &str) -> bool {
    matches!(
        content_type,
        "image/png" | "image/jpeg" | "image/jpg" | "image/webp" | "image/gif"
    )
}

fn ext_for_content_type(content_type: &str) -> &'static str {
    match content_type {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "bin",
    }
}

fn random_id() -> String {
    let mut bytes = [0u8; 8];
    getrandom::getrandom(&mut bytes).unwrap_or_default();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `handbook/install` → `handbook/install.assets/`
/// `foo/bar.md` → `foo/bar.assets/`
/// empty / `_index` → `_assets/`
pub fn asset_dir_prefix(note_path: Option<&str>) -> String {
    let Some(np) = note_path
        .map(|s| s.trim().trim_matches('/'))
        .filter(|s| !s.is_empty())
    else {
        return ASSET_PREFIX.to_string();
    };
    if np == "_index" || np == INDEX_PLACEHOLDER {
        return ASSET_PREFIX.to_string();
    }
    let stem = np.strip_suffix(".md").unwrap_or(np);
    format!("{stem}.assets/")
}

const INDEX_PLACEHOLDER: &str = "_index";

/// R2 object key for an uploaded image under a note (or global).
pub fn asset_object_key(note_path: Option<&str>, safe_name: &str) -> String {
    format!("{}{}", asset_dir_prefix(note_path), safe_name)
}

/// Relative markdown src for export: `./install.assets/xxx.png`
pub fn relative_md_src(object_key: &str) -> String {
    let parts: Vec<&str> = object_key.split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() >= 2 {
        format!("./{}/{}", parts[parts.len() - 2], parts[parts.len() - 1])
    } else if parts.len() == 1 {
        format!("./{}", parts[0])
    } else {
        String::new()
    }
}

/// Web URL path: `/assets/{full-r2-key}`
pub fn public_asset_url(object_key: &str) -> String {
    format!("/assets/{}", object_key.trim_start_matches('/'))
}

/// POST /api/upload?note=<optional note path>
pub async fn upload_image(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let bucket = ctx.env.bucket("NOTES")?;
    let url = req.url()?;
    let note_path = url
        .query_pairs()
        .find(|(k, _)| k == "note")
        .map(|(_, v)| clean_path(&v))
        .filter(|s| !s.is_empty());

    if let Some(ref np) = note_path {
        if !np.is_empty() && np != "_index" {
            let secret = auth::required_jwt_secret(&ctx.env)?;
            let index_pw = get_index_password(&ctx.env);
            let cookie = cookie_header(&req);
            let record = note::query_note(&bucket, np).await?;
            if !is_edit_authorized(cookie.as_deref(), np, &record, &secret, &index_pw) {
                return err_json(ERR_AUTH_FAILED, "Password auth failed", 401);
            }
        }
    }

    let content_type = req
        .headers()
        .get("content-type")
        .ok()
        .flatten()
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    if !is_allowed_image(&content_type) {
        return err_json(40100, "Unsupported image type. Use png/jpeg/webp/gif.", 400);
    }

    let body = req.bytes().await?;
    if body.is_empty() {
        return err_json(40101, "Empty upload body", 400);
    }
    if body.len() > MAX_UPLOAD_BYTES {
        return err_json(40102, "Image too large (max 8MB)", 413);
    }

    // Filename: query `name` supports UTF-8; `X-Filename` is ISO-8859-1 only.
    let filename = url
        .query_pairs()
        .find(|(k, _)| k == "name")
        .map(|(_, v)| v.to_string())
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            req.headers()
                .get("x-filename")
                .ok()
                .flatten()
                .map(|h| {
                    urlencoding::decode(&h)
                        .map(|s| s.to_string())
                        .unwrap_or_else(|_| h.clone())
                })
                .filter(|s| !s.trim().is_empty())
        })
        .unwrap_or_default();
    let ext = ext_for_content_type(&content_type);
    let id = random_id();
    let safe = format!("{}-{}", id, sanitize_filename(&filename, ext));
    let object_key = asset_object_key(note_path.as_deref(), &safe);

    let mut custom = std::collections::HashMap::new();
    custom.insert("contentType".to_string(), content_type.clone());
    if let Some(np) = &note_path {
        custom.insert("note".to_string(), np.clone());
    }

    bucket
        .put(&object_key, body.to_vec())
        .custom_metadata(custom)
        .execute()
        .await?;

    let public_url = public_asset_url(&object_key);
    let relative = relative_md_src(&object_key);
    let alt = alt_from_filename(&filename);

    ok_json(serde_json::json!({
        "url": public_url,
        "path": object_key,
        "relative": relative,
        "contentType": content_type,
        "note": note_path,
        "markdown": format!("![{alt}]({relative})"),
    }))
}

/// GET /assets/*path
/// Accepts full R2-like keys (`foo/bar.assets/x.png`) or legacy `_assets` names.
pub async fn get_asset(_req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let path = clean_path(ctx.param("path").unwrap_or(&String::new()));
    if path.is_empty() || path.contains("..") {
        return err_json(40400, "not found", 404);
    }

    let bucket = ctx.env.bucket("NOTES")?;
    let candidates = asset_key_candidates(&path);
    let mut object_opt = None;
    for key in &candidates {
        if let Ok(Some(o)) = bucket.get(key).execute().await {
            object_opt = Some(o);
            break;
        }
    }
    let Some(object) = object_opt else {
        return err_json(40400, "asset not found", 404);
    };

    let custom = object.custom_metadata().unwrap_or_default();
    let content_type = custom
        .get("contentType")
        .cloned()
        .unwrap_or_else(|| guess_content_type(&path).to_string());

    if !content_type.starts_with("image/") {
        return err_json(40300, "not an image asset", 403);
    }

    let bytes = match object.body() {
        Some(body) => body.bytes().await?,
        None => return err_json(40400, "asset not found", 404),
    };

    Ok(Response::from_bytes(bytes)?.with_headers({
        let mut h = Headers::new();
        h.set("Content-Type", &content_type)?;
        h.set("Cache-Control", "public, max-age=31536000, immutable")?;
        h.set("X-Content-Type-Options", "nosniff")?;
        h
    }))
}

fn asset_key_candidates(path: &str) -> Vec<String> {
    let p = path.trim_start_matches('/');
    let mut out = Vec::new();
    // Full key already (note-relative .assets or legacy prefix)
    if p.contains(".assets/") || p.starts_with(ASSET_PREFIX) || p.contains("/_assets/") {
        out.push(p.to_string());
    }
    // Legacy short name → _assets/{name}
    if !p.starts_with(ASSET_PREFIX) && !p.contains('/') {
        out.push(format!("{ASSET_PREFIX}{p}"));
    }
    if !p.contains(".assets/") {
        out.push(format!("{ASSET_PREFIX}{p}"));
    }
    out.dedup();
    out
}

fn sanitize_filename(raw: &str, default_ext: &str) -> String {
    let raw = raw.trim();
    if raw.is_empty() {
        return format!("image.{default_ext}");
    }
    let mut name = String::new();
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
            name.push(ch.to_ascii_lowercase());
        } else {
            name.push('-');
        }
    }
    let name = name.trim_matches('-').trim_matches('.').to_string();
    if name.is_empty() {
        return format!("image.{default_ext}");
    }
    if name.contains('.') {
        name
    } else {
        format!("{name}.{default_ext}")
    }
}

fn alt_from_filename(raw: &str) -> String {
    let raw = raw.trim();
    if raw.is_empty() {
        return "image".into();
    }
    let base = raw.rsplit(['/', '\\']).next().unwrap_or(raw);
    let stem = base.rsplit_once('.').map(|(s, _)| s).unwrap_or(base);
    let cleaned: String = stem
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let cleaned = cleaned.trim_matches('-').to_string();
    if cleaned.is_empty() {
        "image".into()
    } else {
        cleaned.chars().take(60).collect()
    }
}

fn guess_content_type(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else {
        "application/octet-stream"
    }
}
