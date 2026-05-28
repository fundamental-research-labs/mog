//! Rich error types for xlsx-api.
//!
//! `XlsxApiError` provides matchable error variants for all XLSX operations.
//! The parser's string-wrapped `XlsxBridgeError` is replaced with structured errors
//! that consumers can pattern-match on.

use domain_types::ImportDiagnostic;

/// Error type for all xlsx-api operations.
#[derive(Debug, thiserror::Error)]
pub enum XlsxApiError {
    /// The input is not a valid ZIP archive.
    #[error("invalid archive: {0}")]
    InvalidArchive(String),

    /// The archive is corrupted (CRC mismatch, truncated, etc.).
    #[error("corrupted archive: {0}")]
    CorruptedArchive(String),

    /// A required part is missing from the OOXML package.
    #[error("missing part: {0}")]
    MissingPart(String),

    /// XML content is malformed.
    #[error("malformed XML in {part}: {message}")]
    MalformedXml { part: String, message: String },

    /// A cell could not be parsed.
    #[error("invalid cell at row {row}, col {col}: {message}")]
    InvalidCell { row: u32, col: u32, message: String },

    /// Sheet not found by name.
    #[error("sheet not found: {0}")]
    SheetNotFound(String),

    /// Sheet index out of bounds.
    #[error("sheet index out of bounds: {index} (count: {count})")]
    SheetIndexOutOfBounds { index: usize, count: usize },

    /// Cell limit exceeded during parsing.
    #[error("cell limit exceeded: {count} cells (limit: {limit})")]
    CellLimitExceeded { count: usize, limit: usize },

    /// A feature is not supported by this parser version.
    #[error("unsupported feature: {0}")]
    UnsupportedFeature(String),

    /// A parse option was set that the parser doesn't yet enforce.
    #[error("unsupported option '{option}': {reason}")]
    UnsupportedOption { option: String, reason: String },

    /// Export failed.
    #[error("export error: {0}")]
    Export(String),

    /// ZIP-level error.
    #[error("ZIP error: {0}")]
    Zip(String),

    /// Parse failed with fatal errors.
    #[error("parse failed with {} fatal error(s)", .0.len())]
    ParseFailed(Vec<ImportDiagnostic>),
}

impl From<xlsx_parser::pipeline::lazy::ParseError> for XlsxApiError {
    fn from(e: xlsx_parser::pipeline::lazy::ParseError) -> Self {
        match e {
            xlsx_parser::pipeline::lazy::ParseError::InvalidArchive(msg) => {
                XlsxApiError::InvalidArchive(msg)
            }
            xlsx_parser::pipeline::lazy::ParseError::SheetNotFound(idx) => {
                XlsxApiError::SheetNotFound(format!("sheet index {}", idx))
            }
            xlsx_parser::pipeline::lazy::ParseError::ParseFailed(msg) => {
                XlsxApiError::InvalidArchive(msg)
            }
        }
    }
}

impl From<xlsx_parser::write::write_error::WriteError> for XlsxApiError {
    fn from(e: xlsx_parser::write::write_error::WriteError) -> Self {
        XlsxApiError::Export(e.to_string())
    }
}

impl From<xlsx_parser::zip::ZipError> for XlsxApiError {
    fn from(e: xlsx_parser::zip::ZipError) -> Self {
        XlsxApiError::Zip(e.to_string())
    }
}

/// Convert a parser string error (from `parse_xlsx_full_native`) into an `XlsxApiError`.
/// The parser returns `Result<_, String>`, so we map common patterns to structured variants.
pub(crate) fn from_parse_string_error(msg: String) -> XlsxApiError {
    if msg.contains("Encrypted XLSX files are not supported") {
        XlsxApiError::UnsupportedFeature(msg)
    } else if msg.contains("not a valid ZIP") || msg.contains("Empty XLSX") {
        XlsxApiError::InvalidArchive(msg)
    } else if msg.contains("Failed to open XLSX archive") {
        XlsxApiError::CorruptedArchive(msg)
    } else {
        XlsxApiError::InvalidArchive(msg)
    }
}
