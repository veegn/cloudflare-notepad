//! Data repair: reconcile custom_metadata with markdown body / book TOC.

use worker::*;

use crate::error::*;
use crate::services::note::{repair_all, repair_doc, TitlePrefer};

use super::util::{clean_path, cookie_header, get_index_password, is_edit_authorized};

fn parse_prefer(req: &Request) -> Result<TitlePrefer> {
    let url = req.url()?;
    let prefer = url
        .query_pairs()
        .find(|(k, _)| k == "prefer")
        .map(|(_, v)| TitlePrefer::parse(&v))
        // Repair defaults to body-first: markdown H1 / book TOC drive metadata.
        .unwrap_or_else(TitlePrefer::default_body_first);
    Ok(prefer)
}

fn flag(req: &Request, name: &str) -> Result<bool> {
    let url = req.url()?;
    Ok(url
        .query_pairs()
        .any(|(k, v)| k == name && v != "0" && v != "false"))
}

fn query_path(req: &Request) -> Result<Option<String>> {
    let url = req.url()?;
    Ok(url
        .query_pairs()
        .find(|(k, _)| k == "path")
        .map(|(_, v)| clean_path(&v))
        .filter(|s| !s.is_empty()))
}

fn query_limit(req: &Request) -> Result<usize> {
    let url = req.url()?;
    Ok(url
        .query_pairs()
        .find(|(k, _)| k == "limit")
        .and_then(|(_, v)| v.parse::<usize>().ok())
        .unwrap_or(50)
        .clamp(1, 200))
}

/// POST /api/repair?path=network_concepts&rebuildToc=1&createMissing=0
/// Default prefer=h1 (markdown body drives metadata).
/// POST /api/repair?all=1&createMissing=1&limit=50
/// POST /api/repair?path=...&prefer=title  # metadata.title drives H1 (legacy)
pub async fn repair(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let bucket = ctx.env.bucket("NOTES")?;
    let secret = crate::services::auth::required_jwt_secret(&ctx.env)?;
    let index_pw = get_index_password(&ctx.env);
    let cookie = cookie_header(&req);
    let prefer = parse_prefer(&req)?;
    let rebuild_toc = flag(&req, "rebuildToc")? || flag(&req, "all")?;
    let create_missing = flag(&req, "createMissing")?;
    let repair_all_flag = flag(&req, "all")?;

    if repair_all_flag {
        // Require index admin password when configured (global mutation).
        if index_pw.is_some() {
            let authorized = cookie
                .as_deref()
                .map(|c| {
                    // reuse edit auth on _index when admin pw is set
                    let rec = crate::models::note::NoteRecord {
                        path: crate::models::note::INDEX_PATH.to_string(),
                        content: String::new(),
                        metadata: Default::default(),
                    };
                    is_edit_authorized(
                        Some(c),
                        crate::models::note::INDEX_PATH,
                        &rec,
                        &secret,
                        &index_pw,
                    )
                })
                .unwrap_or(false);
            if !authorized {
                return err_json(ERR_AUTH_FAILED, "Password auth failed", 401);
            }
        }
        let limit = query_limit(&req)?;
        let results = repair_all(&bucket, prefer, create_missing, limit).await?;
        return ok_json(serde_json::json!({
            "mode": "all",
            "count": results.len(),
            "results": results,
        }));
    }

    let Some(path) = query_path(&req)? else {
        return err_json(40003, "path query param is required (or use all=1)", 400);
    };

    let record = crate::services::note::query_note(&bucket, &path).await?;
    if !is_edit_authorized(cookie.as_deref(), &path, &record, &secret, &index_pw) {
        return err_json(ERR_AUTH_FAILED, "Password auth failed", 401);
    }

    match repair_doc(&bucket, &path, prefer, rebuild_toc, create_missing).await {
        Ok(result) => ok_json(result),
        Err(worker::Error::RustError(msg)) if msg.contains("not found") => {
            err_json(40400, "not found", 404)
        }
        Err(worker::Error::RustError(msg)) => err_json(40020, &msg, 400),
        Err(e) => Err(e),
    }
}
