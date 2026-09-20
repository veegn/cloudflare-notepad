//! HTTP API handlers.
//!
//! Layout:
//! - `notes` — single note CRUD + list
//! - `docs` — create article/book, books list, home tree
//! - `books` — book TOC and page management
//! - `auth` — password auth cookie
//! - `util` — request helpers shared by handlers

mod auth;
mod books;
mod docs;
mod notes;
mod repair;
mod util;

pub use auth::auth_note;
pub use books::{adopt_book, create_book_page, get_toc, list_book_pages};
pub use docs::{create_doc, home_tree, list_books};
pub use notes::{delete_note, get_note, list_notes, patch_note, put_note};
pub use repair::repair;
