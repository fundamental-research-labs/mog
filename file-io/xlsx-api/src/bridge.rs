//! Bridge API — `#[bridge::api]` impl for `XlsxParser`.
//!
//! This is the single facade for all XLSX bridge operations. Each method
//! delegates to xlsx-api's public functions, keeping the bridge layer thin.
//!
//! The bridge was moved here from xlsx-parser so that xlsx-api is the sole
//! entry point for both Rust consumers and FFI callers.

use bridge_core as bridge;

/// Zero-sized bridge type for XLSX parser stateless functions.
pub struct XlsxParser;

#[bridge::api(fn_prefix = "xlsx")]
impl XlsxParser {
    #[bridge::pure]
    pub fn version() -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }
}
