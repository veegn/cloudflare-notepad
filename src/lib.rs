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
        // Collection / doc-type APIs (must register before /*path wildcards where needed)
        .get_async("/api/notes", routes::api::list_notes)
        .get_async("/api/books", routes::api::list_books)
        .get_async("/api/home-tree", routes::api::home_tree)
        .get_async("/api/toc", routes::api::get_toc)
        .post_async("/api/docs", routes::api::create_doc)
        .get_async("/api/books/:book/pages", routes::api::list_book_pages)
        .post_async("/api/books/:book/pages", routes::api::create_book_page)
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
