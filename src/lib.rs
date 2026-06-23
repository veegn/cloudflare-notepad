use worker::*;

mod error;
mod i18n;
mod models;
mod routes;
mod services;

#[event(fetch)]
async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    console_error_panic_hook::set_once();

    let router = Router::new();

    router
        // ── Page routes (return HTML) ────────────────────────────
        .get_async("/", routes::pages::home)
        .get_async("/new", routes::pages::create_note)
        .get_async("/note/*path", routes::pages::view_note)
        .get_async("/edit/*path", routes::pages::edit_note)
        // ── API routes (return JSON) ─────────────────────────────
        .get_async("/api/notes/*path", routes::api::get_note)
        .put_async("/api/notes/*path", routes::api::put_note)
        .delete_async("/api/notes/*path", routes::api::delete_note)
        .patch_async("/api/notes/*path", routes::api::patch_note)
        .post_async("/api/auth", routes::api::auth_note)
        // ── Fallback ─────────────────────────────────────────────
        .get_async("/*catchall", routes::pages::not_found)
        .run(req, env)
        .await
}
