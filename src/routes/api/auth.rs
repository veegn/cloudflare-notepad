//! Password authentication for the JSON API and the note and edit forms.

use worker::*;

use crate::error::*;
use crate::models::api::{AuthRequest, AuthResponse};
use crate::services::{auth, note};

use super::util::{clean_path, get_index_password, get_salt};

pub async fn auth_note(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let body: AuthRequest = req.json().await?;
    let path = clean_path(&body.path);

    let Some(token) = authenticate_note(&ctx.env, &path, &body.password).await? else {
        return err_json(ERR_AUTH_FAILED, "Password auth failed", 401);
    };

    let cookie = auth_cookie(&token);
    let mut response = ok_json(AuthResponse { token })?;
    response.headers_mut().set("Set-Cookie", &cookie)?;
    Ok(response)
}

pub async fn auth_note_page(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let path = clean_path(ctx.param("path").unwrap_or(&String::new()));
    let url = req.url()?;
    let token = match req.form_data().await?.get("password") {
        Some(FormEntry::Field(password)) => authenticate_note(&ctx.env, &path, &password).await?,
        _ => None,
    };

    let mut response = Response::empty()?.with_status(303);
    if let Some(token) = token {
        response
            .headers_mut()
            .set("Set-Cookie", &auth_cookie(&token))?;
        response.headers_mut().set("Location", url.path())?;
    } else {
        response
            .headers_mut()
            .set("Location", &format!("{}?auth=failed", url.path()))?;
    }
    Ok(response)
}

async fn authenticate_note(env: &Env, path: &str, password: &str) -> Result<Option<String>> {
    let bucket = env.bucket("NOTES")?;
    let record = note::query_note(&bucket, path).await?;
    let secret = auth::required_jwt_secret(env)?;
    let salt = get_salt(env);
    let index_pw = get_index_password(env);

    if auth::matches_edit_password(path, password, &record.metadata, &salt, &index_pw) {
        return auth::create_auth_token(path, &secret).map(Some);
    }
    Ok(None)
}

fn auth_cookie(token: &str) -> String {
    format!(
        "auth={token}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Strict",
        max_age = auth::AUTH_MAX_AGE_SECONDS,
    )
}
