//! Bridge API — `#[bridge::api]` impl for `XlsxParser`.
//!
//! This is the single facade for all XLSX bridge operations. Each method
//! delegates to xlsx-api's public functions, keeping the bridge layer thin.
//!
//! The bridge was moved here from xlsx-parser so that xlsx-api is the sole
//! entry point for both Rust consumers and FFI callers.

use crate::{BridgeLazyParseResult, BridgeLazyParseResultWithErrors, XlsxBridgeError};
use bridge_core as bridge;
use xlsx_parser::infra::error::ParseMode;

const ENCRYPTED_XLSX_UNSUPPORTED: &str = "Encrypted XLSX files are not supported";

/// Zero-sized bridge type for XLSX parser stateless functions.
pub struct XlsxParser;

#[bridge::api(fn_prefix = "xlsx")]
impl XlsxParser {
    // parse_full and parse_full_profiled were removed — FullParseResult is now crate-private
    // in xlsx-parser. Use parse_xlsx_to_output() for domain-typed results.

    #[bridge::pure]
    pub fn parse_lazy(xlsx_data: &[u8]) -> Result<BridgeLazyParseResult, XlsxBridgeError> {
        // Validate input
        if xlsx_data.is_empty() {
            return Ok(BridgeLazyParseResult {
                ok: false,
                sheet_count: 0,
                sheet_names: Vec::new(),
                error_message: "Empty XLSX data".to_string(),
            });
        }

        if xlsx_parser::zip::is_encrypted_office_package(xlsx_data) {
            return Ok(BridgeLazyParseResult {
                ok: false,
                sheet_count: 0,
                sheet_names: Vec::new(),
                error_message: ENCRYPTED_XLSX_UNSUPPORTED.to_string(),
            });
        }

        // Verify ZIP signature
        if xlsx_data.len() < 4 || &xlsx_data[0..4] != b"PK\x03\x04" {
            return Ok(BridgeLazyParseResult {
                ok: false,
                sheet_count: 0,
                sheet_names: Vec::new(),
                error_message: "Invalid XLSX file: not a valid ZIP archive".to_string(),
            });
        }

        match crate::lazy::LazyWorkbook::new(xlsx_data) {
            Ok(workbook) => {
                let sheet_count = workbook.sheet_count() as u32;
                let sheet_names: Vec<String> = workbook
                    .sheet_names()
                    .into_iter()
                    .map(|s| s.to_string())
                    .collect();

                Ok(BridgeLazyParseResult {
                    ok: true,
                    sheet_count,
                    sheet_names,
                    error_message: String::new(),
                })
            }
            Err(e) => Ok(BridgeLazyParseResult {
                ok: false,
                sheet_count: 0,
                sheet_names: Vec::new(),
                error_message: e.to_string(),
            }),
        }
    }

    #[bridge::pure]
    pub fn parse_lazy_with_mode(
        xlsx_data: &[u8],
        mode: u32,
    ) -> Result<BridgeLazyParseResultWithErrors, XlsxBridgeError> {
        let parse_mode = match mode {
            0 => ParseMode::Strict,
            1 => ParseMode::Lenient,
            _ => ParseMode::Permissive,
        };

        // Validate input
        if xlsx_data.is_empty() {
            return Ok(BridgeLazyParseResultWithErrors {
                ok: false,
                sheet_count: 0,
                sheet_names: Vec::new(),
                warning_count: 0,
                error_count: 0,
                mode,
                error_message: "Empty XLSX data".to_string(),
                errors_json: "[]".to_string(),
            });
        }

        if xlsx_parser::zip::is_encrypted_office_package(xlsx_data) {
            return Ok(BridgeLazyParseResultWithErrors {
                ok: false,
                sheet_count: 0,
                sheet_names: Vec::new(),
                warning_count: 0,
                error_count: 0,
                mode,
                error_message: ENCRYPTED_XLSX_UNSUPPORTED.to_string(),
                errors_json: "[]".to_string(),
            });
        }

        // Verify ZIP signature
        if xlsx_data.len() < 4 || &xlsx_data[0..4] != b"PK\x03\x04" {
            return Ok(BridgeLazyParseResultWithErrors {
                ok: false,
                sheet_count: 0,
                sheet_names: Vec::new(),
                warning_count: 0,
                error_count: 0,
                mode,
                error_message: "Invalid XLSX file: not a valid ZIP archive".to_string(),
                errors_json: "[]".to_string(),
            });
        }

        match crate::lazy::LazyWorkbook::with_mode(xlsx_data, parse_mode) {
            Ok(workbook) => {
                let sheet_count = workbook.sheet_count() as u32;
                let sheet_names: Vec<String> = workbook
                    .sheet_names()
                    .into_iter()
                    .map(|s| s.to_string())
                    .collect();

                let warning_count = workbook.warning_count() as u32;
                let error_count = workbook.error_count() as u32;
                let errors_json = xlsx_parser::errors_to_json(workbook.errors());

                Ok(BridgeLazyParseResultWithErrors {
                    ok: true,
                    sheet_count,
                    sheet_names,
                    warning_count,
                    error_count,
                    mode,
                    error_message: String::new(),
                    errors_json,
                })
            }
            Err(e) => Ok(BridgeLazyParseResultWithErrors {
                ok: false,
                sheet_count: 0,
                sheet_names: Vec::new(),
                warning_count: 0,
                error_count: 0,
                mode,
                error_message: e.to_string(),
                errors_json: "[]".to_string(),
            }),
        }
    }

    #[bridge::pure]
    pub fn version() -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }
}
