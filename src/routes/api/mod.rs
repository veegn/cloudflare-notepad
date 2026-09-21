//! HTTP JSON API.
//!
//! | Module | Routes |
//! |--------|--------|
//! | `docs`  | `POST /api/docs`, `GET /api/books`, `GET /api/home-tree` |
//! | `books` | `GET/POST /api/books/:book/pages`, `POST .../adopt`, `GET /api/toc` |
//! | `notes` | `GET /api/notes`, CRUD `/api/notes/*path` |
//! | `repair`| `POST /api/repair` |
//! | `auth`  | `POST /api/auth` |
//! | `util`  | shared request helpers |

mod assets;
mod auth;
mod books;
mod docs;
mod notes;
mod repair;
mod util;

pub use assets::{get_asset, upload_image};
pub use auth::auth_note;
pub use books::{adopt_book, create_book_page, get_toc, list_book_pages};
pub use docs::{create_doc, home_tree, list_books};
pub use notes::{delete_note, get_note, list_notes, patch_note, put_note};
pub use repair::repair;
