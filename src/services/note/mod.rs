//! Note storage service: R2 IO, metadata, list/tree, book pages.

mod book;
mod create;
mod list;
mod meta;
mod store;
mod tree;

pub use book::{adopt_book, create_book_page, delete_book_page, parse_book_toc};
pub use create::{create_doc, gen_random_path};
pub use list::{
    book_page_counts, list_all_docs, list_book_page_keys, list_doc_metas, list_visible_docs_fast,
    ListOptions,
};
pub use store::{delete_note, query_note, save_note, set_mode, set_password, set_title};
pub use tree::build_home_tree_with_counts;

// Re-exports used by unit tests in this module.
#[allow(unused_imports)]
pub use book::strip_toc_link;
#[allow(unused_imports)]
pub use tree::build_home_tree;

#[cfg(test)]
mod tests {
    use super::*;
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
