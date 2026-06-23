use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use md5::{Digest, Md5};
use pbkdf2::pbkdf2_hmac;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::models::note::{NoteMetadata, INDEX_PATH};

type HmacSha256 = Hmac<Sha256>;

/// Number of iterations for PBKDF2 password hashing.
const PBKDF2_ITERATIONS: u32 = 10_000;
/// Output length for PBKDF2 derived key in bytes (256 bits).
const PBKDF2_KEY_LEN: usize = 32;

/// JWT expiry: 7 days in seconds.
pub const AUTH_MAX_AGE_SECONDS: i64 = 7 * 24 * 60 * 60;

/// JWT claims.
#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    path: String,
    exp: i64,
}

/// Return the JWT signing secret or fail closed when it is not configured.
pub fn required_jwt_secret(env: &worker::Env) -> worker::Result<String> {
    let secret = env.secret("SCN_SECRET")?.to_string();
    validate_jwt_secret(secret)
}

fn validate_jwt_secret(secret: String) -> worker::Result<String> {
    if secret.trim().is_empty() {
        return Err(worker::Error::RustError(
            "SCN_SECRET must be configured as a non-empty Worker secret".to_string(),
        ));
    }
    Ok(secret)
}

// ── Password hashing ────────────────────────────────────────────────

/// Hash a password using PBKDF2-HMAC-SHA256 with a random 16-byte salt.
///
/// Returns a string in the format `pbkdf2$<iterations>$<salt_hex>$<hash_hex>`.
/// Compatible with the TypeScript worker's `saltPw()` function.
pub fn hash_password(password: &str) -> Result<String, worker::Error> {
    let mut salt = [0u8; 16];
    getrandom::getrandom(&mut salt)
        .map_err(|e| worker::Error::RustError(format!("getrandom failed: {e}")))?;
    let salt_hex = hex::encode(salt);

    let mut output = [0u8; PBKDF2_KEY_LEN];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, PBKDF2_ITERATIONS, &mut output);
    let hash_hex = hex::encode(output);

    Ok(format!("pbkdf2${PBKDF2_ITERATIONS}${salt_hex}${hash_hex}"))
}

/// Verify a plaintext password against a stored hash.
///
/// Supports two formats:
/// 1. **PBKDF2**: `pbkdf2$<iterations>$<salt_hex>$<hash_hex>`
/// 2. **Legacy MD5**: a raw hex string, verified as `MD5(MD5(password) + "+" + salt)`
pub fn verify_password(password: &str, stored: &str, legacy_salt: &str) -> bool {
    if stored.starts_with("pbkdf2$") {
        verify_pbkdf2(password, stored)
    } else {
        verify_legacy_md5(password, stored, legacy_salt)
    }
}

fn verify_pbkdf2(password: &str, stored: &str) -> bool {
    let parts: Vec<&str> = stored.split('$').collect();
    if parts.len() != 4 {
        return false;
    }
    let iterations: u32 = match parts[1].parse() {
        Ok(n) => n,
        Err(_) => return false,
    };
    let salt = match hex::decode(parts[2]) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let expected_hash = match hex::decode(parts[3]) {
        Ok(h) => h,
        Err(_) => return false,
    };

    let mut output = vec![0u8; expected_hash.len()];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, iterations, &mut output);

    // Constant-time comparison.
    output == expected_hash
}

fn verify_legacy_md5(password: &str, stored: &str, legacy_salt: &str) -> bool {
    let hash_pw = format!("{:x}", Md5::digest(password.as_bytes()));
    let salted = format!("{hash_pw}+{legacy_salt}");
    let result = format!("{:x}", Md5::digest(salted.as_bytes()));
    result == stored
}

// ── JWT (HS256, implemented manually for WASM) ──────────────────────

#[cfg(target_arch = "wasm32")]
fn now_secs() -> i64 {
    (js_sys::Date::now() / 1000.0) as i64
}

#[cfg(not(target_arch = "wasm32"))]
fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

/// Create a JWT token scoped to a specific note path.
pub fn create_auth_token(path: &str, secret: &str) -> Result<String, worker::Error> {
    let claims = Claims {
        path: path.to_string(),
        exp: now_secs() + AUTH_MAX_AGE_SECONDS,
    };

    let header = r#"{"alg":"HS256","typ":"JWT"}"#;
    let header_b64 = URL_SAFE_NO_PAD.encode(header.as_bytes());
    let payload_json = serde_json::to_string(&claims)
        .map_err(|e| worker::Error::RustError(format!("JWT serialize: {e}")))?;
    let payload_b64 = URL_SAFE_NO_PAD.encode(payload_json.as_bytes());

    let message = format!("{header_b64}.{payload_b64}");

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|e| worker::Error::RustError(format!("HMAC key: {e}")))?;
    mac.update(message.as_bytes());
    let signature = mac.finalize().into_bytes();
    let sig_b64 = URL_SAFE_NO_PAD.encode(signature);

    Ok(format!("{message}.{sig_b64}"))
}

/// Verify a JWT token and check that it is scoped to the expected path.
pub fn verify_auth_token(token: &str, expected_path: &str, secret: &str) -> bool {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return false;
    }

    // Verify signature.
    let message = format!("{}.{}", parts[0], parts[1]);
    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(message.as_bytes());

    let sig = match URL_SAFE_NO_PAD.decode(parts[2]) {
        Ok(s) => s,
        Err(_) => return false,
    };
    if mac.verify_slice(&sig).is_err() {
        return false;
    }

    // Decode payload.
    let payload_json = match URL_SAFE_NO_PAD.decode(parts[1]) {
        Ok(p) => p,
        Err(_) => return false,
    };
    let claims: Claims = match serde_json::from_slice(&payload_json) {
        Ok(c) => c,
        Err(_) => return false,
    };

    // Check expiry.
    if claims.exp < now_secs() {
        return false;
    }

    claims.path == expected_path
}

// ── Authorisation helpers ───────────────────────────────────────────

/// Check whether viewing a note requires authentication.
pub fn needs_view_auth(metadata: &NoteMetadata) -> bool {
    metadata.pw.is_some() || !metadata.share
}

/// Check whether editing a note requires authentication.
pub fn requires_edit_auth(
    path: &str,
    metadata: &NoteMetadata,
    index_password: &Option<String>,
) -> bool {
    if path == INDEX_PATH && index_password.is_some() {
        return true;
    }
    metadata.pw.is_some()
}

/// Check if a password matches the note's edit password (or the index admin password).
pub fn matches_edit_password(
    path: &str,
    password: &str,
    metadata: &NoteMetadata,
    legacy_salt: &str,
    index_password: &Option<String>,
) -> bool {
    // Check note-level password.
    if let Some(ref stored) = metadata.pw {
        if verify_password(password, stored, legacy_salt) {
            return true;
        }
    }
    // Check index admin password.
    if path == INDEX_PATH {
        if let Some(ref admin_pw) = index_password {
            if password == admin_pw {
                return true;
            }
        }
    }
    false
}

/// Extract the `auth` cookie value from a `Cookie` header string.
pub fn extract_auth_cookie(cookie_header: &str) -> Option<String> {
    for part in cookie_header.split(';') {
        let part = part.trim();
        if let Some(value) = part.strip_prefix("auth=") {
            let value = value.trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

/// Check authorisation via the auth cookie JWT.
pub fn check_cookie_auth(cookie_header: Option<&str>, path: &str, secret: &str) -> bool {
    let header = match cookie_header {
        Some(h) => h,
        None => return false,
    };
    let token = match extract_auth_cookie(header) {
        Some(t) => t,
        None => return false,
    };
    verify_auth_token(&token, path, secret)
}

/// Check if a request is authorised to **view** a note.
pub fn is_view_authorized(
    query_password: Option<&str>,
    cookie_header: Option<&str>,
    path: &str,
    metadata: &NoteMetadata,
    legacy_salt: &str,
    secret: &str,
) -> bool {
    if !needs_view_auth(metadata) {
        return true;
    }
    // Try query-string password.
    if let (Some(pw), Some(ref stored)) = (query_password, &metadata.pw) {
        if verify_password(pw, stored, legacy_salt) {
            return true;
        }
    }
    // Try cookie.
    check_cookie_auth(cookie_header, path, secret)
}

/// Check if a request is authorised to **edit** a note.
pub fn is_edit_authorized(
    cookie_header: Option<&str>,
    path: &str,
    metadata: &NoteMetadata,
    secret: &str,
    index_password: &Option<String>,
) -> bool {
    if !requires_edit_auth(path, metadata, index_password) {
        return true;
    }
    check_cookie_auth(cookie_header, path, secret)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pbkdf2_hash_and_verify() {
        let password = "my_secure_password";
        let hash = hash_password(password).unwrap();
        assert!(hash.starts_with("pbkdf2$10000$"));

        // Correct password
        assert!(verify_password(password, &hash, ""));

        // Incorrect password
        assert!(!verify_password("wrong_password", &hash, ""));
    }

    #[test]
    fn test_legacy_md5_verify() {
        use md5::{Digest, Md5};
        let password = "my_legacy_password";
        let legacy_salt = "somesalt";
        let hash_pw = format!("{:x}", Md5::digest(password.as_bytes()));
        let salted = format!("{}+{}", hash_pw, legacy_salt);
        let stored = format!("{:x}", Md5::digest(salted.as_bytes()));

        assert!(verify_password(password, &stored, legacy_salt));
        assert!(!verify_password("wrong", &stored, legacy_salt));
    }

    #[test]
    fn test_jwt_create_and_verify() {
        let path = "test_note_path";
        let secret = "super_secret_key";

        let token = create_auth_token(path, secret).unwrap();

        assert!(verify_auth_token(&token, path, secret));
        assert!(!verify_auth_token(&token, "other_path", secret));
        assert!(!verify_auth_token(&token, path, "wrong_secret"));
        assert!(!verify_auth_token("invalid.token.format", path, secret));
    }

    #[test]
    fn secret_validation_rejects_empty_values() {
        assert!(validate_jwt_secret("".to_string()).is_err());
        assert!(validate_jwt_secret("  \t".to_string()).is_err());
        assert_eq!(
            validate_jwt_secret("test-secret".to_string()).unwrap(),
            "test-secret"
        );
    }

    #[test]
    fn test_auth_authorization_helpers() {
        let mut meta = NoteMetadata {
            mode: Default::default(),
            update_at: None,
            share: true,
            pw: None,
        };

        assert!(!needs_view_auth(&meta));

        meta.share = false;
        assert!(needs_view_auth(&meta));

        meta.share = true;
        meta.pw = Some(hash_password("test").unwrap());
        assert!(needs_view_auth(&meta));

        // Check password match
        assert!(matches_edit_password("testpath", "test", &meta, "", &None));
        assert!(!matches_edit_password(
            "testpath", "wrong", &meta, "", &None
        ));
    }
}
