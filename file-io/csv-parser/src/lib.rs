//! CSV → `ParseOutput` parser.
//!
//! ## What this crate does
//!
//! Decode raw CSV bytes (UTF-8 by default, BOM-detected Unicode encodings, or
//! a caller-specified encoding; any line terminator, RFC 4180 quoting), infer
//! per-cell types per the locked policy table, and emit a single-sheet
//! `domain_types::ParseOutput` that the engine can hydrate through the same
//! `hydrate_from_parse_output` /
//! `parse_output_to_workbook_snapshot` path that XLSX uses.
//!
//! ## Public surface
//!
//! Callers use one entry point:
//!
//! ```ignore
//! let result = csv_parser::parse_csv_to_parse_output(bytes, CsvImportOptions::default())?;
//! // result.output is a `domain_types::ParseOutput` ready for hydration.
//! ```
//!
//! `CsvImportOptions` rides the bridge in R-2 (`compute_core::storage::engine`
//! re-exports it) so TS callers pass the same struct.
//!
//! ## What this crate doesn't do
//!
//! - Hydration / Yrs writes (consumer's job, in `compute-core`).
//! - Currency / percentage detection (out of scope this round).
//! - Streaming for multi-GB inputs (the largest fixture is 2 MB).
//! - CSV *export* (separate round, separate crate).

mod dialect;
mod encoding;
mod infer;
mod options;
mod parse_output_assembly;
mod types;

pub use options::{CsvImportOptions, DEFAULT_MAX_COLS, DEFAULT_MAX_ROWS};
pub use parse_output_assembly::parse_csv_to_parse_output;
pub use types::{CsvParseError, CsvParseResult, CsvWarning};
