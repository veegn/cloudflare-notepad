use serde_json::json;
use worker::Response;

/// Build a JSON success response with optional data payload.
pub fn ok_json<T: serde::Serialize>(data: T) -> worker::Result<Response> {
    Response::from_json(&json!({ "code": 0, "data": data }))
}

/// Build a JSON success response with no data payload.
pub fn ok_empty() -> worker::Result<Response> {
    Response::from_json(&json!({ "code": 0 }))
}

/// Build a JSON error response.
pub fn err_json(code: u32, message: &str, status: u16) -> worker::Result<Response> {
    let body = json!({ "code": code, "message": message });
    let resp = Response::from_json(&body)?;
    // worker::Response doesn't have a direct status setter in the builder,
    // so we construct via Response::ok and override.
    Ok(resp.with_status(status))
}

/// Error codes.
pub const ERR_AUTH_FAILED: u32 = 40001;
pub const ERR_UNAUTHORIZED: u32 = 40002;
#[allow(dead_code)]
pub const ERR_INVALID_MODE: u32 = 40102;
#[allow(dead_code)]
pub const ERR_STORAGE: u32 = 50001;
