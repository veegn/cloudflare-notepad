//! Image upload + static asset serving (R2 prefix `_assets/`).

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

/// POST /api/upload?note=<optional note path>
/// Headers: Content-Type=image/*, optional X-Filename
/// Body: raw image bytes
pub async fn upload_image(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let bucket = ctx.env.bucket("NOTES")?;
    let url = req.url()?;
    let note_path = url
        .query_pairs()
        .find(|(k, _)| k == "note")
        .map(|(_, v)| clean_path(&v))
        .filter(|s| !s.is_empty());

    // When bound to a note, require the same edit permission as saving that note.
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

    let filename = req
        .headers()
        .get("x-filename")
        .ok()
        .flatten()
        .unwrap_or_default();
    let ext = ext_for_content_type(&content_type);
    let id = random_id();
    let name = sanitize_filename(&filename, ext);
    let object_key = format!("{ASSET_PREFIX}{id}-{name}");

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

    // Public URL: /assets/<id>-<name> (served from `_assets/`)
    let public_path = object_key
        .strip_prefix(ASSET_PREFIX)
        .unwrap_or(&object_key)
        .to_string();
    let public_url = format!("/assets/{public_path}");

    ok_json(serde_json::json!({
        "url": public_url,
        "path": object_key,
        "contentType": content_type,
        "note": note_path,
        "markdown": format!("![{}]({})", alt_from_filename(&filename), public_url),
    }))
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
    raw.rsplit(['/', '\\'])
        .next()
        .unwrap_or(raw)
        .trim_end_matches(|c: char| c == '.' || c.is_ascii_alphanumeric())
        .trim()
        .trim_matches('.')
        .to_string()
        .chars()
        .take(60)
        .collect::<String>()
}

/// GET /assets/*path → serve `_assets/*path` from R2.
pub async fn get_asset(_req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let path = clean_path(ctx.param("path").unwrap_or(&String::new()));
    if path.is_empty() || path.contains("..") {
        return err_json(40400, "not found", 404);
    }

    let bucket = ctx.env.bucket("NOTES")?;
    let object_key = format!("{ASSET_PREFIX}{path}");
    let Some(object) = bucket.get(&object_key).execute().await? else {
        return err_json(40400, "asset not found", 404);
    };

    let custom = object.custom_metadata().unwrap_or_default();
    let content_type = custom
        .get("contentType")
        .cloned()
        .unwrap_or_else(|| guess_content_type(&path).to_string());

    if !is_allowed_image(&content_type) && !content_type.starts_with("image/") {
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
