//! Note storage domain (R2).
//!
//! | Module | Role |
//! |--------|------|
//! | `store` | read/write single objects + metadata |
//! | `meta`  | custom_metadata encode/decode |
//! | `list`  | prefix listing, fast tree inputs (avoid body GETs) |
//! | `create`| create article/book |
//! | `book`  | book pages + TOC markdown |
//! | `tree`  | homepage tree |
//! | `cache` | `_meta/*` derived JSON caches |
//! | `repair`| reconcile body ↔ metadata (body-first default) |

mod book;
mod cache;
mod create;
mod list;
mod meta;
mod repair;
mod store;
mod tree;

pub use book::{adopt_book, create_book_page, delete_book_page, parse_book_toc};
pub use cache::{
    read_json_cache, reserve_cache_fill, schedule_cache_fill, toc_cache_key, HOME_TREE_CACHE_KEY,
};
pub use create::{create_doc, gen_random_path};
pub(crate) use list::list_metadata;
pub use list::{index_bucket, list_all_docs, visible_docs_from_index, ListOptions};
pub use repair::{repair_all, repair_doc, TitlePrefer};
pub use store::{
    commit_note_update, delete_note, head_note, is_write_conflict, query_note,
    read_note_for_update, save_note, WRITE_CONFLICT,
};
pub use tree::build_home_tree_with_page_counts;

#[cfg(test)]
mod tests {
    use super::*;
    use super::{book::strip_toc_link, tree::build_home_tree};
    use crate::models::note::{DocType, NoteMetadata, NoteMode, NoteRecord, TreeNode};

    fn book_meta() -> NoteMetadata {
        NoteMetadata {
            mode: NoteMode::Md,
            doc_type: DocType::Book,
            title: Some("book-title".into()),
            ..Default::default()
        }
    }

    #[test]
    fn flatten_writes_non_default_doc_fields() {
        let record = NoteRecord {
            path: "hb".into(),
            content: "x".into(),
            metadata: book_meta(),
        };
        let custom = meta::flatten_for_test(&record.metadata);
        assert_eq!(custom.get("docType").map(String::as_str), Some("book"));
        assert_eq!(custom.get("title").map(String::as_str), Some("book-title"));

        let article = NoteRecord {
            path: "a".into(),
            content: "x".into(),
            metadata: NoteMetadata::default(),
        };
        let flat = meta::flatten_for_test(&article.metadata);
        assert!(!flat.contains_key("docType"));
    }

    #[test]
    fn metadata_roundtrip_page_fields() {
        let mut custom = std::collections::HashMap::new();
        custom.insert("docType".to_string(), "page".into());
        custom.insert("bookRef".to_string(), "hb".into());
        custom.insert("title".to_string(), "install".into());
        let meta = meta::from_custom_for_test(&custom);
        assert_eq!(meta.doc_type, DocType::Page);
        assert_eq!(meta.book_ref.as_deref(), Some("hb"));
        assert_eq!(meta.title.as_deref(), Some("install"));
    }

    #[test]
    fn strip_toc_link_removes_list_item() {
        let c = "# Book\n\n## TOC\n\n- [intro](hb/intro)\n- [install](hb/install)\n";
        let out = strip_toc_link(c, "hb/install");
        assert!(out.contains("hb/intro"));
        assert!(!out.contains("hb/install"));
    }

    #[test]
    fn parse_toc_marks_exists_and_depth() {
        let content = "# Book\n\n## TOC\n\n- [intro](hb/intro)\n  - [install](install)\n";
        let mut existing = std::collections::HashMap::new();
        existing.insert(
            "hb/intro".to_string(),
            NoteMetadata {
                doc_type: DocType::Page,
                book_ref: Some("hb".into()),
                ..Default::default()
            },
        );
        let toc = parse_book_toc("hb", content, &existing);
        assert!(toc.iter().any(|t| t.heading && t.title.contains("TOC")));
        let intro = toc
            .iter()
            .find(|t| t.path.as_deref() == Some("hb/intro"))
            .unwrap();
        assert!(intro.exists);
        let install = toc
            .iter()
            .find(|t| t.path.as_deref() == Some("hb/install"))
            .unwrap();
        assert!(!install.exists);
        assert_eq!(install.depth, 1);
    }

    #[test]
    fn home_tree_excludes_pages() {
        let records = vec![
            NoteRecord {
                path: "notes/a".into(),
                content: "# A".into(),
                metadata: NoteMetadata::default(),
            },
            NoteRecord {
                path: "hb".into(),
                content: "# handbook".into(),
                metadata: NoteMetadata {
                    doc_type: DocType::Book,
                    title: Some("handbook".into()),
                    ..Default::default()
                },
            },
            NoteRecord {
                path: "hb/p1".into(),
                content: "# P".into(),
                metadata: NoteMetadata {
                    doc_type: DocType::Page,
                    book_ref: Some("hb".into()),
                    ..Default::default()
                },
            },
        ];
        let tree = build_home_tree(&records);
        let flat_paths = |nodes: &Vec<TreeNode>| -> Vec<String> {
            let mut v = vec![];
            fn walk(ns: &Vec<TreeNode>, v: &mut Vec<String>) {
                for n in ns {
                    v.push(format!("{}:{}", n.node_type, n.path));
                    walk(&n.children, v);
                }
            }
            walk(nodes, &mut v);
            v
        };
        let paths = flat_paths(&tree);
        assert!(paths.iter().any(|p| p == "book:hb"));
        assert!(paths.iter().any(|p| p.starts_with("dir:notes")));
        assert!(!paths.iter().any(|p| p.contains("hb/p1")));
    }
}
