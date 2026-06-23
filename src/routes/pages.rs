use tera::Tera;
use worker::*;

use crate::i18n::{build_i18n_map, detect_language, get_i18n, I18nMap, LangCode};
use crate::models::note::{is_index_path, NoteMetadata, INDEX_PATH};
use crate::services::{auth, note};

/// Build a Tera instance with all templates embedded via `include_str!`.
pub fn build_tera() -> Tera {
    let mut tera = Tera::default();
    tera.add_raw_templates(vec![
        ("base.html", include_str!("../../templates/base.html")),
        ("home.html", include_str!("../../templates/home.html")),
        ("edit.html", include_str!("../../templates/edit.html")),
        ("share.html", include_str!("../../templates/share.html")),
        (
            "need_passwd.html",
            include_str!("../../templates/need_passwd.html"),
        ),
        ("404.html", include_str!("../../templates/404.html")),
    ])
    .expect("Failed to load templates");
    tera
}

// ── Helpers ──────────────────────────────────────────────────────────

fn detect_lang(req: &Request) -> LangCode {
    let accept = req.headers().get("Accept-Language").ok().flatten();
    detect_language(accept.as_deref())
}

fn cookie_header(req: &Request) -> Option<String> {
    req.headers().get("Cookie").ok().flatten()
}

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

/// Build the `window.CONFIG` JSON object that the frontend JavaScript reads.
fn build_config_json(
    lang: LangCode,
    note_path: &str,
    is_edit: bool,
    is_home: bool,
    metadata: &NoteMetadata,
    content: Option<&str>,
    i18n_map: &I18nMap,
) -> String {
    let config = serde_json::json!({
        "lang": lang.as_str(),
        "notePath": note_path,
        "isEdit": is_edit,
        "isHome": is_home,
        "updateAt": metadata.update_at,
        "pw": metadata.pw.is_some(),
        "mode": metadata.mode.as_str(),
        "content": content.unwrap_or(""),
        "i18n": i18n_map,
    });
    // Escape `<` to `\u003c` to prevent XSS in <script> blocks.
    config.to_string().replace('<', "\\u003c")
}

fn base_context(lang: LangCode, title: &str, i18n_map: &I18nMap) -> tera::Context {
    let mut ctx = tera::Context::new();
    ctx.insert("lang", lang.as_str());
    ctx.insert("title", title);
    ctx.insert("i18n", i18n_map);
    ctx
}

fn render_html(tera: &Tera, template: &str, ctx: &tera::Context) -> Result<Response> {
    let html = tera
        .render(template, ctx)
        .map_err(|e| worker::Error::RustError(format!("Template error: {e}")))?;
    Response::from_html(html)
}

// ── GET / ────────────────────────────────────────────────────────────

pub async fn home(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let lang = detect_lang(&req);
    let kv = ctx.env.kv("NOTES")?;
    let record = note::query_note(&kv, INDEX_PATH).await?;
    let i18n_map = build_i18n_map();
    let tera = build_tera();

    let config_json = build_config_json(
        lang,
        INDEX_PATH,
        false,
        true,
        &record.metadata,
        Some(&record.content),
        &i18n_map,
    );

    let mut context = base_context(lang, "Cloud Notepad", &i18n_map);
    context.insert("is_home", &true);
    context.insert("is_edit", &false);
    context.insert("content", &record.content);
    context.insert("metadata", &record.metadata);
    context.insert("config_json", &config_json);
    context.insert("show_pw_prompt", &false);
    context.insert("note_path", INDEX_PATH);
    context.insert("tips", &"");

    render_html(&tera, "home.html", &context)
}

// ── GET /new ─────────────────────────────────────────────────────────

pub async fn create_note(_req: Request, _ctx: RouteContext<()>) -> Result<Response> {
    let path = note::gen_random_path();
    let mut resp = Response::empty()?.with_status(302);
    resp.headers_mut()
        .set("Location", &format!("/edit/{path}"))?;
    Ok(resp)
}

// ── GET /note/*path ──────────────────────────────────────────────────

pub async fn view_note(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let raw_path = ctx.param("path").unwrap_or(&String::new()).to_string();
    let path = clean_path(&raw_path);
    let lang = detect_lang(&req);

    // Redirect /note/_index to home.
    if is_index_path(&path) {
        let mut resp = Response::empty()?.with_status(302);
        resp.headers_mut().set("Location", "/")?;
        return Ok(resp);
    }

    let kv = ctx.env.kv("NOTES")?;
    let record = note::query_note(&kv, &path).await?;
    let title = urlencoding::decode(&path)
        .unwrap_or_else(|_| path.clone().into())
        .to_string();

    let secret = auth::required_jwt_secret(&ctx.env)?;
    let salt = get_salt(&ctx.env);
    let cookie = cookie_header(&req);
    let i18n_map = build_i18n_map();
    let tera = build_tera();

    // Parse query password.
    let url = req.url()?;
    let query_pw = url
        .query_pairs()
        .find(|(k, _)| k == "password" || k == "passwd" || k == "pw")
        .map(|(_, v)| v.to_string());

    // Check auth for private / password-protected notes.
    if !record.metadata.share {
        let authorized = auth::is_view_authorized(
            query_pw.as_deref(),
            cookie.as_deref(),
            &path,
            &record.metadata,
            &salt,
            &secret,
        );
        if !authorized {
            let tip = get_i18n(&i18n_map, lang, "tipPrivate");
            return render_need_passwd(
                &tera,
                lang,
                &title,
                &path,
                &tip,
                record.metadata.pw.is_some(),
                &i18n_map,
            );
        }
    } else if record.metadata.pw.is_some() {
        let authorized = auth::is_view_authorized(
            query_pw.as_deref(),
            cookie.as_deref(),
            &path,
            &record.metadata,
            &salt,
            &secret,
        );
        if !authorized {
            let tip = get_i18n(&i18n_map, lang, "tipEncrypt");
            return render_need_passwd(&tera, lang, &title, &path, &tip, true, &i18n_map);
        }
    }

    let config_json = build_config_json(
        lang,
        &path,
        false,
        false,
        &record.metadata,
        Some(&record.content),
        &i18n_map,
    );

    let mut context = base_context(lang, &title, &i18n_map);
    context.insert("is_home", &false);
    context.insert("is_edit", &false);
    context.insert("content", &record.content);
    context.insert("metadata", &record.metadata);
    context.insert("config_json", &config_json);
    context.insert("show_pw_prompt", &false);
    context.insert("note_path", &path);
    context.insert("tips", &"");

    render_html(&tera, "share.html", &context)
}

// ── GET /edit/*path ──────────────────────────────────────────────────

pub async fn edit_note(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let raw_path = ctx.param("path").unwrap_or(&String::new()).to_string();
    let path = clean_path(&raw_path);
    let lang = detect_lang(&req);

    let kv = ctx.env.kv("NOTES")?;
    let record = note::query_note(&kv, &path).await?;
    let title = urlencoding::decode(&path)
        .unwrap_or_else(|_| path.clone().into())
        .to_string();

    let secret = auth::required_jwt_secret(&ctx.env)?;
    let index_pw = get_index_password(&ctx.env);
    let cookie = cookie_header(&req);
    let i18n_map = build_i18n_map();
    let tera = build_tera();

    if auth::requires_edit_auth(&path, &record.metadata, &index_pw) {
        let authorized = auth::is_edit_authorized(
            cookie.as_deref(),
            &path,
            &record.metadata,
            &secret,
            &index_pw,
        );
        if !authorized {
            let tip = get_i18n(&i18n_map, lang, "tipEncrypt");
            return render_need_passwd(&tera, lang, &title, &path, &tip, true, &i18n_map);
        }
    }

    let config_json = build_config_json(
        lang,
        &path,
        true,
        false,
        &record.metadata,
        Some(&record.content),
        &i18n_map,
    );

    let mut context = base_context(lang, &title, &i18n_map);
    context.insert("is_home", &false);
    context.insert("is_edit", &true);
    context.insert("content", &record.content);
    context.insert("metadata", &record.metadata);
    context.insert("config_json", &config_json);
    context.insert("show_pw_prompt", &false);
    context.insert("note_path", &path);
    context.insert("tips", &"");

    render_html(&tera, "edit.html", &context)
}

// ── 404 fallback ─────────────────────────────────────────────────────

pub async fn not_found(req: Request, _ctx: RouteContext<()>) -> Result<Response> {
    let lang = detect_lang(&req);
    let i18n_map = build_i18n_map();
    let tera = build_tera();
    let tip = get_i18n(&i18n_map, lang, "tip404");

    let mut context = base_context(lang, "404", &i18n_map);
    context.insert("is_home", &false);
    context.insert("is_edit", &false);
    context.insert("content", &"");
    context.insert("metadata", &NoteMetadata::default());
    context.insert("config_json", &"{}");
    context.insert("show_pw_prompt", &false);
    context.insert("note_path", &"");
    context.insert("tips", &tip);

    render_html(&tera, "404.html", &context)
}

// ── Helper: password prompt page ─────────────────────────────────────

fn render_need_passwd(
    tera: &Tera,
    lang: LangCode,
    title: &str,
    note_path: &str,
    tip: &str,
    show_pw_prompt: bool,
    i18n_map: &I18nMap,
) -> Result<Response> {
    let config_json = build_config_json(
        lang,
        note_path,
        false,
        false,
        &NoteMetadata::default(),
        None,
        i18n_map,
    );

    let mut context = base_context(lang, title, i18n_map);
    context.insert("is_home", &false);
    context.insert("is_edit", &false);
    context.insert("content", &"");
    context.insert("metadata", &NoteMetadata::default());
    context.insert("config_json", &config_json);
    context.insert("show_pw_prompt", &show_pw_prompt);
    context.insert("note_path", note_path);
    context.insert("tips", tip);

    render_html(tera, "need_passwd.html", &context)
}
