//! R2 `custom_metadata` encode/decode for `NoteMetadata`.

use std::collections::HashMap;

use crate::models::note::{DocType, NoteMetadata, NoteMode};

pub(super) const KEY_PW: &str = "pw";
pub(super) const KEY_MODE: &str = "mode";
pub(super) const KEY_UPDATE_AT: &str = "updateAt";
pub(super) const KEY_SHARE: &str = "share";
pub(super) const KEY_DOC_TYPE: &str = "docType";
pub(super) const KEY_BOOK_REF: &str = "bookRef";
pub(super) const KEY_TITLE: &str = "title";
const LEGACY_META_KEY: &str = "meta";

/// Build metadata from flattened R2 custom_metadata keys.
/// Flattened keys win over a transitional nested `meta` JSON blob.
pub(super) fn from_custom(custom: &HashMap<String, String>) -> NoteMetadata {
    let mut metadata = NoteMetadata::default();

    if let Some(raw) = custom.get(LEGACY_META_KEY) {
        if let Ok(m) = serde_json::from_str::<NoteMetadata>(raw) {
            metadata = m;
        }
    }

    if let Some(pw) = custom.get(KEY_PW) {
        metadata.pw = if pw.is_empty() {
            None
        } else {
            Some(pw.clone())
        };
    }
    if let Some(mode) = custom.get(KEY_MODE) {
        if let Some(m) = NoteMode::from_str_opt(mode) {
            metadata.mode = m;
        }
    }
    if let Some(update_at) = custom.get(KEY_UPDATE_AT) {
        metadata.update_at = update_at.parse().ok();
    }
    if let Some(share) = custom.get(KEY_SHARE) {
        metadata.share = share != "false" && share != "0";
    }
    if let Some(dt) = custom.get(KEY_DOC_TYPE) {
        if let Some(d) = DocType::from_str_opt(dt) {
            metadata.doc_type = d;
        }
    }
    if let Some(br) = custom.get(KEY_BOOK_REF) {
        if !br.is_empty() {
            metadata.book_ref = Some(br.clone());
        }
    }
    if let Some(title) = custom.get(KEY_TITLE) {
        if !title.is_empty() {
            metadata.title = Some(title.clone());
        }
    }

    metadata
}

/// Flatten note metadata into R2 custom_metadata key/value pairs.
/// Default values are omitted to keep objects small.
pub(super) fn flatten(meta: &NoteMetadata) -> HashMap<String, String> {
    let mut custom = HashMap::new();
    if let Some(pw) = &meta.pw {
        if !pw.is_empty() {
            custom.insert(KEY_PW.to_string(), pw.clone());
        }
    }
    if meta.mode != NoteMode::Plain {
        custom.insert(KEY_MODE.to_string(), meta.mode.as_str().to_string());
    }
    if let Some(update_at) = meta.update_at {
        custom.insert(KEY_UPDATE_AT.to_string(), update_at.to_string());
    }
    if !meta.share {
        custom.insert(KEY_SHARE.to_string(), "false".to_string());
    }
    if meta.doc_type != DocType::Article {
        custom.insert(KEY_DOC_TYPE.to_string(), meta.doc_type.as_str().to_string());
    }
    if let Some(br) = &meta.book_ref {
        if !br.is_empty() {
            custom.insert(KEY_BOOK_REF.to_string(), br.clone());
        }
    }
    if let Some(title) = &meta.title {
        if !title.is_empty() {
            custom.insert(KEY_TITLE.to_string(), title.clone());
        }
    }
    custom
}

/// Split a record into (pure body, custom_metadata) for R2 put.
pub(super) fn encode(
    record: &crate::models::note::NoteRecord,
) -> (String, HashMap<String, String>) {
    (record.content.clone(), flatten(&record.metadata))
}

#[cfg(test)]
pub(super) fn flatten_for_test(meta: &NoteMetadata) -> HashMap<String, String> {
    flatten(meta)
}

#[cfg(test)]
pub(super) fn from_custom_for_test(custom: &HashMap<String, String>) -> NoteMetadata {
    from_custom(custom)
}
