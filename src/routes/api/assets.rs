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

use futures::StreamExt;
use worker::*;

use crate::error::*;
use crate::services::{auth, note};

use super::util::{clean_path, cookie_header, get_index_password, is_edit_authorized};

pub const ASSET_PREFIX: &str = "_assets/";
const MAX_UPLOAD_BYTES: usize = 8 * 1024 * 1024;
const ASSET_CACHE_CONTROL: &str = "public, max-age=31536000, immutable";

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
    getrandom::fill(&mut bytes).unwrap_or_default();
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

fn upload_content_type(headers: &Headers) -> String {
    headers
        .get("content-type")
        .ok()
        .flatten()
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
}

/// The query parameter supports UTF-8. The header is the fallback.
fn upload_filename(query_name: Option<String>, headers: &Headers) -> String {
    query_name
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            headers
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
        .unwrap_or_default()
}

/// POST /api/upload?note=<optional note path>
pub async fn upload_image(
    mut req: Request,
    ctx: RouteContext<crate::RequestState>,
) -> Result<Response> {
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
            let record = note::head_note(&bucket, np).await?.record;
            if !is_edit_authorized(cookie.as_deref(), np, &record, &secret, &index_pw) {
                return err_json(ERR_AUTH_FAILED, "Password auth failed", 401);
            }
        }
    }

    let content_type = upload_content_type(req.headers());
    if !is_allowed_image(&content_type) {
        return err_json(40100, "Unsupported image type. Use png/jpeg/webp/gif.", 400);
    }

    let Some(body) = read_upload(&mut req).await? else {
        return err_json(40102, "Image too large (max 8MB)", 413);
    };
    if body.is_empty() {
        return err_json(40101, "Empty upload body", 400);
    }

    let query_name = url
        .query_pairs()
        .find(|(k, _)| k == "name")
        .map(|(_, v)| v.to_string());
    let filename = upload_filename(query_name, req.headers());
    let ext = ext_for_content_type(&content_type);
    let id = random_id();
    let safe = format!("{}-{}", id, sanitize_filename(&filename, ext));
    let object_key = asset_object_key(note_path.as_deref(), &safe);

    let mut custom = std::collections::HashMap::new();
    if let Some(np) = &note_path {
        custom.insert("note".to_string(), np.clone());
    }

    bucket
        .put(&object_key, body)
        .http_metadata(HttpMetadata {
            content_type: Some(content_type.clone()),
            cache_control: Some(ASSET_CACHE_CONTROL.into()),
            ..Default::default()
        })
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

async fn read_upload(req: &mut Request) -> Result<Option<Vec<u8>>> {
    let length = req
        .headers()
        .get("Content-Length")?
        .and_then(|value| value.parse::<usize>().ok());
    if length.is_some_and(|size| size > MAX_UPLOAD_BYTES) {
        return Ok(None);
    }
    // A request with no stream is an empty upload.
    let mut stream = match req.stream() {
        Ok(stream) => stream,
        Err(Error::RustError(message)) if message == "no body for request" => {
            return Ok(Some(Vec::new()))
        }
        Err(error) => return Err(error),
    };
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if chunk.len() > MAX_UPLOAD_BYTES - bytes.len() {
            return Ok(None);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(Some(bytes))
}

/// GET /assets/*path
/// Accepts full R2-like keys or legacy short names.
pub async fn get_asset(req: Request, ctx: RouteContext<crate::RequestState>) -> Result<Response> {
    let path = clean_path(ctx.param("path").map(String::as_str).unwrap_or(""));
    if path.is_empty() || path.contains("..") {
        return err_json(40400, "not found", 404);
    }

    let validator = req.headers().get("If-None-Match")?;
    let state = &ctx.data;
    let key = format!(
        "{}/__scn_cache/v2/asset/{}",
        state.origin,
        urlencoding::encode(&path)
    );
    let cache = Cache::default();
    if let Ok(Some(response)) = cache.get(&key, false).await {
        if let Some(etag) = response.headers().get("ETag")? {
            if etag_matches(validator.as_deref(), &etag) {
                return asset_not_modified(&etag);
            }
        }
        return Ok(response);
    }

    let bucket = ctx.env.bucket("NOTES")?;
    for object_key in asset_key_candidates(&path) {
        if validator.is_some() {
            let Some(metadata) = bucket.head(&object_key).await? else {
                continue;
            };
            let etag = metadata.http_etag();
            if etag_matches(validator.as_deref(), &etag) {
                if !asset_type(&metadata, &object_key).starts_with("image/") {
                    return err_json(40300, "not an image asset", 403);
                }
                return asset_not_modified(&etag);
            }
        }

        let Some(object) = bucket.get(&object_key).execute().await? else {
            continue;
        };
        let content_type = asset_type(&object, &object_key);
        if !content_type.starts_with("image/") {
            return err_json(40300, "not an image asset", 403);
        }
        let etag = object.http_etag();
        let Some(body) = object.body() else {
            return err_json(40400, "asset not found", 404);
        };
        let headers = asset_headers(&etag)?;
        headers.set("Content-Type", &content_type)?;
        let mut response = Response::from_body(body.response_body()?)?.with_headers(headers);
        if let Ok(copy) = response.cloned() {
            state.context.wait_until(async move {
                let _ = cache.put(key, copy).await;
            });
        }
        return Ok(response);
    }
    err_json(40400, "asset not found", 404)
}

fn asset_type(object: &Object, key: &str) -> String {
    let native = object.http_metadata().content_type;
    if let Some(mime) = native.as_ref().filter(|mime| mime.starts_with("image/")) {
        return mime.clone();
    }
    object
        .custom_metadata()
        .unwrap_or_default()
        .remove("contentType")
        .or(native)
        .unwrap_or_else(|| guess_content_type(key).to_string())
}

fn asset_headers(etag: &str) -> Result<Headers> {
    let headers = Headers::new();
    headers.set("ETag", etag)?;
    headers.set("Cache-Control", ASSET_CACHE_CONTROL)?;
    headers.set("X-Content-Type-Options", "nosniff")?;
    Ok(headers)
}

fn asset_not_modified(etag: &str) -> Result<Response> {
    Ok(Response::empty()?
        .with_status(304)
        .with_headers(asset_headers(etag)?))
}

fn etag_matches(header: Option<&str>, etag: &str) -> bool {
    header.is_some_and(|value| {
        value
            .split(',')
            .map(str::trim)
            .any(|tag| tag == "*" || tag.strip_prefix("W/").unwrap_or(tag) == etag)
    })
}

fn asset_key_candidates(path: &str) -> Vec<String> {
    if path.contains(".assets/") {
        return vec![path.to_string()];
    }
    let legacy = format!("{ASSET_PREFIX}{path}");
    if path.starts_with(ASSET_PREFIX) || path.contains("/_assets/") {
        vec![path.to_string(), legacy]
    } else {
        vec![legacy]
    }
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
