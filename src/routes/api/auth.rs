//! Password authentication: POST `/api/auth`.

use worker::*;

use crate::error::*;
use crate::models::api::{AuthRequest, AuthResponse};
use crate::services::{auth, note};

use super::util::{clean_path, get_index_password, get_salt};

pub async fn auth_note(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let body: AuthRequest = req.json().await?;
    let path = clean_path(&body.path);

    let bucket = ctx.env.bucket("NOTES")?;
    let record = note::query_note(&bucket, &path).await?;

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

    let mut resp = ok_json(AuthResponse {
        token: token.clone(),
    })?;
    resp.headers_mut().set("Set-Cookie", &cookie_value)?;
    Ok(resp)
}
