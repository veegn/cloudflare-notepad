use sha2::{Digest, Sha256};
use std::{fs, io::ErrorKind};

fn main() {
    let mut version = Sha256::new();
    for asset in [
        "static/css/app.css",
        "static/js/app.js",
        "static/js/mermaid.min.js",
    ] {
        println!("cargo:rerun-if-changed={asset}");
        match fs::read(asset) {
            Ok(bytes) => version.update(Sha256::digest(bytes)),
            // Native checks can run before npm has built the frontend.
            Err(error) if error.kind() == ErrorKind::NotFound => version.update([0; 32]),
            Err(error) => panic!("Could not read {asset}: {error}"),
        }
    }
    println!(
        "cargo:rustc-env=SCN_ASSET_VERSION={}",
        hex::encode(version.finalize())
    );
}
