//! Homepage document tree (dirs + books + articles; never pages).

use std::collections::HashMap;

use worker::{Bucket, Result};

use crate::models::note::{
    is_system_key, path_display_name, DocListItem, DocType, NoteRecord, TreeNode,
};

use super::list::book_page_counts;

/// Build homepage tree from records that already exclude pages (typically).
pub fn build_home_tree(records: &[NoteRecord]) -> Vec<TreeNode> {
    #[derive(Default)]
    struct DirNode {
        path: String,
        title: String,
        children: Vec<DirNode>,
        leaf: Option<TreeNode>,
    }

    fn dir_node(path: &str) -> DirNode {
        DirNode {
            path: path.to_string(),
            title: path_display_name(path),
            children: Vec::new(),
            leaf: None,
        }
    }

    fn insert_leaf(roots: &mut Vec<DirNode>, full_path: &str, leaf: TreeNode) {
        let segs: Vec<&str> = full_path.split('/').filter(|s| !s.is_empty()).collect();
        if segs.is_empty() {
            return;
        }
        walk_insert(roots, &segs, "", leaf);
    }

    fn walk_insert(list: &mut Vec<DirNode>, segs: &[&str], prefix: &str, leaf: TreeNode) {
        let seg = segs[0];
        let path = if prefix.is_empty() {
            seg.to_string()
        } else {
            format!("{prefix}/{seg}")
        };
        let idx = match list.iter().position(|n| n.path == path) {
            Some(i) => i,
            None => {
                list.push(dir_node(&path));
                list.len() - 1
            }
        };
        if segs.len() == 1 {
            list[idx].leaf = Some(leaf);
        } else {
            walk_insert(&mut list[idx].children, &segs[1..], &path, leaf);
        }
    }

    fn convert(nodes: Vec<DirNode>) -> Vec<TreeNode> {
        let mut items = Vec::new();
        for n in nodes {
            let children = convert(n.children);
            if let Some(mut leaf) = n.leaf {
                // Article may act as folder when nested paths exist under the same key.
                if leaf.node_type == "article" && !children.is_empty() {
                    leaf.children = children;
                } else {
                    // Books never list pages; plain articles have no children.
                    leaf.children = Vec::new();
                }
                items.push(leaf);
            } else if !children.is_empty() {
                items.push(TreeNode {
                    node_type: "dir".into(),
                    path: n.path.clone(),
                    title: n.title,
                    excerpt: None,
                    update_at: None,
                    mode: None,
                    protected: false,
                    shared: true,
                    page_count: None,
                    book_ref: None,
                    children,
                });
            }
        }
        sort_tree_nodes(&mut items);
        items
    }

    fn sort_tree_nodes(items: &mut [TreeNode]) {
        items.sort_by(|a, b| {
            let rank = |t: &str| match t {
                "dir" => 0u8,
                "book" => 1,
                _ => 2,
            };
            rank(&a.node_type)
                .cmp(&rank(&b.node_type))
                .then_with(|| b.update_at.unwrap_or(0).cmp(&a.update_at.unwrap_or(0)))
                .then_with(|| a.title.cmp(&b.title))
        });
    }

    let mut roots: Vec<DirNode> = Vec::new();
    for rec in records {
        if is_system_key(&rec.path) || rec.metadata.doc_type == DocType::Page {
            continue;
        }
        let item = DocListItem::from_record(rec, true);
        let node_type = match rec.metadata.doc_type {
            DocType::Book => "book",
            _ => "article",
        }
        .to_string();
        let leaf = TreeNode {
            node_type,
            path: rec.path.clone(),
            title: rec.display_title(),
            excerpt: item.excerpt,
            update_at: rec.metadata.update_at,
            mode: Some(rec.metadata.mode),
            protected: rec.metadata.pw.is_some(),
            shared: rec.metadata.share,
            page_count: None,
            book_ref: rec.metadata.book_ref.clone(),
            children: Vec::new(),
        };
        insert_leaf(&mut roots, &rec.path, leaf);
    }

    convert(roots)
}

/// Same as `build_home_tree`, then annotate book nodes with page counts.
pub async fn build_home_tree_with_counts(
    bucket: &Bucket,
    records: &[NoteRecord],
) -> Result<Vec<TreeNode>> {
    let counts = book_page_counts(bucket).await?;
    let mut tree = build_home_tree(records);
    patch_page_counts(&mut tree, &counts);
    Ok(tree)
}

fn patch_page_counts(nodes: &mut [TreeNode], counts: &HashMap<String, u32>) {
    for n in nodes.iter_mut() {
        if n.node_type == "book" {
            n.page_count = counts.get(&n.path).copied();
        }
        patch_page_counts(&mut n.children, counts);
    }
}
