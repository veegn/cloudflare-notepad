use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Supported language codes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum LangCode {
    #[serde(rename = "en")]
    #[default]
    En,
    #[serde(rename = "zh")]
    Zh,
}

impl LangCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::En => "en",
            Self::Zh => "zh",
        }
    }
}

impl std::fmt::Display for LangCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Type alias for a single language dictionary.
pub type LangDict = HashMap<String, String>;

/// All i18n dictionaries keyed by language code string.
pub type I18nMap = HashMap<String, LangDict>;

/// Parse the `Accept-Language` header and return the best matching [`LangCode`].
pub fn detect_language(accept_language: Option<&str>) -> LangCode {
    let header = match accept_language {
        Some(h) => h,
        None => return LangCode::En,
    };

    for part in header.split(',') {
        let lang = part.split(';').next().unwrap_or("").trim().to_lowercase();
        if lang.starts_with("zh") {
            return LangCode::Zh;
        }
        if lang.starts_with("en") {
            return LangCode::En;
        }
    }

    LangCode::En
}

/// Build the full i18n map (all languages).
pub fn build_i18n_map() -> I18nMap {
    let en =
        serde_json::from_str::<LangDict>(include_str!("en.json")).expect("Failed to parse en.json");
    let zh =
        serde_json::from_str::<LangDict>(include_str!("zh.json")).expect("Failed to parse zh.json");

    let mut map = HashMap::new();
    map.insert("en".to_string(), en);
    map.insert("zh".to_string(), zh);
    map
}

/// Lookup a single i18n key for the given language, falling back to English.
pub fn get_i18n(map: &I18nMap, lang: LangCode, key: &str) -> String {
    map.get(lang.as_str())
        .and_then(|d| d.get(key))
        .or_else(|| map.get("en").and_then(|d| d.get(key)))
        .cloned()
        .unwrap_or_else(|| key.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_zh() {
        assert_eq!(
            detect_language(Some("zh-CN,zh;q=0.9,en;q=0.8")),
            LangCode::Zh
        );
    }

    #[test]
    fn detect_en_default() {
        assert_eq!(detect_language(None), LangCode::En);
        assert_eq!(detect_language(Some("fr-FR,de;q=0.5")), LangCode::En);
    }

    #[test]
    fn i18n_map_loads() {
        let map = build_i18n_map();
        assert!(map.get("en").unwrap().contains_key("setPW"));
        assert!(map.get("zh").unwrap().contains_key("setPW"));
    }
}
