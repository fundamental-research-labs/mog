//! `xlsx-api` — Ergonomic Rust API facade for the XLSX parser.
//!
//! Provides clean, typed access to XLSX parse, export, lazy loading, streaming,
//! and ZIP utilities. Replaces the parser's FFI-constrained surface (string errors,
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
pub mod lazy;
mod options;
mod parse;
pub mod streaming;
mod types;
pub mod zip;

// Native-only modules (memory-mapped I/O)
#[cfg(all(not(target_arch = "wasm32"), feature = "native"))]
pub mod mmap;

// Parallel parsing (implies native)
#[cfg(all(not(target_arch = "wasm32"), feature = "parallel"))]
pub mod parallel;

pub use error::XlsxApiError;
pub use export::{ExportReport, export_from_parse_output, export_from_parse_output_with_report};
pub use options::{ParseMode, ParseOptions};
pub use parse::{ParsedWorkbook, parse, parse_max_sheets, parse_with_options};
pub use types::*;
