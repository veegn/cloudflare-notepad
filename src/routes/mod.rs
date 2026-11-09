pub mod api;
pub mod pages;

fn query_password(url: &worker::Url) -> Option<String> {
    url.query_pairs()
        .find(|(k, _)| k == "password" || k == "passwd" || k == "pw")
        .map(|(_, v)| v.to_string())
}

fn wants_raw(url: &worker::Url) -> bool {
    url.query_pairs().any(|(k, _)| k == "raw")
}
