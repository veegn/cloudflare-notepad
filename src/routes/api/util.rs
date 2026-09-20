//! Shared request helpers for API handlers.

use worker::{Env, Request};

use crate::models::note::NoteRecord;
use crate::services::auth;

pub(super) fn cookie_header(req: &Request) -> Option<String> {
    req.headers().get("Cookie").ok().flatten()
}

pub(super) fn clean_path(raw: &str) -> String {
    raw.trim_start_matches('/').to_string()
}

pub(super) fn get_salt(env: &Env) -> String {
    env.var("SCN_SALT")
        .map(|s| s.to_string())
        .unwrap_or_default()
}

pub(super) fn get_index_password(env: &Env) -> Option<String> {
    env.var("SCN_INDEX_PASSWD")
        .ok()
        .map(|v| v.to_string())
        .filter(|s| !s.is_empty())
}

/// Whether the cookie authorizes editing `record` at `path`.
pub(super) fn is_edit_authorized(
    cookie: Option<&str>,
    path: &str,
    record: &NoteRecord,
    secret: &str,
    index_pw: &Option<String>,
) -> bool {
    auth::is_edit_authorized(cookie, path, &record.metadata, secret, index_pw)
}

/// Extract optional query password (`password` / `passwd` / `pw`).
pub(super) fn query_password(url: &worker::Url) -> Option<String> {
    url.query_pairs()
        .find(|(k, _)| k == "password" || k == "passwd" || k == "pw")
        .map(|(_, v)| v.to_string())
}

pub(super) fn wants_raw(url: &worker::Url) -> bool {
    url.query_pairs().any(|(k, _)| k == "raw")
}
