//! `xlsx-api` — Ergonomic Rust API facade for the XLSX parser.
//!
//! Provides typed access to XLSX parse, export, streaming inflate, and ZIP
//! utilities. Replaces the parser's FFI-constrained surface (string errors,
//! JSON export, bridge type mirrors) with idiomatic Rust types.
//!
//! # Quick Start
//!
//! ```ignore
//! use xlsx_api::{parse, ParseOptions, XlsxApiError};
//!
//! // Simple parse (default options: Lenient mode, parse everything)
//! let result = parse(&xlsx_bytes)?;
//! println!("Parsed {} sheets", result.output.sheets.len());
//! ```

pub mod bridge;
mod error;
mod export;
mod options;
mod parse;
pub mod streaming;
mod types;
pub mod zip;

pub use error::XlsxApiError;
pub use export::{
    ExportReport, export_from_parse_output, export_from_parse_output_to,
    export_from_parse_output_with_report, export_owned_parse_output,
};
pub use options::{ParseMode, ParseOptions};
pub use parse::{ParsedWorkbook, parse, parse_with_options};
pub use types::*;

#[cfg(not(target_arch = "wasm32"))]
pub use export::{export_from_parse_output_to_path, export_owned_parse_output_to_path};
