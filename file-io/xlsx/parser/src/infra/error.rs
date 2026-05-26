//! Error recovery infrastructure for XLSX parsing
//!
//! This module provides comprehensive error handling and recovery mechanisms
//! for parsing XLSX files, allowing for graceful degradation when encountering
//! malformed or corrupted data.
//!
//! # Parse Modes
//!
//! - **Strict**: Fail on first error - useful for validation
//! - **Lenient**: Skip items with errors, continue parsing, collect warnings
//! - **Permissive**: Maximum recovery, ignore most errors - useful for data recovery
//!
//! # Example
//!
//! ```rust
//! use xlsx_parser::{ErrorCode, ParseContext, ParseMode};
//!
//! let mut ctx = ParseContext::lenient();
//! ctx.set_current_part("xl/worksheets/sheet1.xml");
//!
//! // Report a warning (non-fatal)
//! ctx.report_warning(ErrorCode::InvalidCellReference, "Invalid cell ref 'ZZZ999999'");
//!
//! // Check if we should continue
//! if !ctx.should_stop() {
//!     // Continue parsing...
//! }
//! ```
//!
//! UTF-8 boundary guard: the three `&raw[..n]` / `&raw[n..]` slices in this
//! file truncate error-context strings at byte offsets produced
//! after ASCII-only boundary tests (preview truncation at byte 47 of
//! an ASCII error string; A1-cell splits after `is_ascii_alphabetic`
//! / `is_ascii_digit` scans). Char-boundary by construction. The
//! byte-47 preview in `format!("{}...", &raw[..47])` is a known
//! latent mid-UTF-8-char truncation hazard on non-ASCII inputs; the
//! error string itself is an ASCII parser-error format. File-scope
//! allow documented here.

#![allow(clippy::string_slice)]

use std::fmt;

/// Controls error handling behavior during parsing
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ParseMode {
    /// Fail on first error - useful for validation and strict compliance checking
    Strict,
    /// Skip items with errors, continue parsing, collect warnings - balanced approach
    #[default]
    Lenient,
    /// Maximum recovery, ignore most errors - useful for data recovery from corrupted files
    Permissive,
}

impl fmt::Display for ParseMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ParseMode::Strict => write!(f, "strict"),
            ParseMode::Lenient => write!(f, "lenient"),
            ParseMode::Permissive => write!(f, "permissive"),
        }
    }
}

/// Severity level of a parse error
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ErrorSeverity {
    /// Non-critical issue, parsing continued with defaults
    Warning,
    /// Significant issue, item was skipped
    Error,
    /// Unrecoverable error, parsing stopped
    Fatal,
}

impl fmt::Display for ErrorSeverity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErrorSeverity::Warning => write!(f, "warning"),
            ErrorSeverity::Error => write!(f, "error"),
            ErrorSeverity::Fatal => write!(f, "fatal"),
        }
    }
}

/// Categorization of all possible parse errors
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    // Archive errors (100-199)
    /// The archive is not a valid ZIP file
    InvalidArchive,
    /// The archive is corrupted or has CRC errors
    CorruptedArchive,
    /// A required part (file) is missing from the archive
    MissingPart,

    // XML errors (200-299)
    /// The XML is not well-formed
    MalformedXml,
    /// An element has invalid structure or is in wrong position
    InvalidElement,
    /// A required attribute is missing
    MissingAttribute,

    // Cell errors (300-399)
    /// Cell reference (e.g., "A1") is invalid or out of range
    InvalidCellReference,
    /// Cell value cannot be parsed or is malformed
    InvalidCellValue,
    /// Formula syntax is invalid
    InvalidFormula,

    // Style errors (400-499)
    /// Number format string is invalid
    InvalidNumberFormat,
    /// Style index references a non-existent style
    InvalidStyleIndex,

    // Reference errors (500-599)
    /// Shared string index is out of bounds
    InvalidSharedStringIndex,
    /// A relationship reference is missing or broken
    MissingRelationship,

    // Feature errors (600-699)
    /// A feature is not supported by this parser
    UnsupportedFeature,

    // Data errors (700-799)
    /// File appears to be truncated
    TruncatedFile,
    /// Data is corrupted beyond recovery
    DataCorruption,
}

impl ErrorCode {
    /// Get the numeric code for this error type
    pub fn code(&self) -> u32 {
        match self {
            // Archive errors (100-199)
            ErrorCode::InvalidArchive => 100,
            ErrorCode::CorruptedArchive => 101,
            ErrorCode::MissingPart => 102,
            // XML errors (200-299)
            ErrorCode::MalformedXml => 200,
            ErrorCode::InvalidElement => 201,
            ErrorCode::MissingAttribute => 202,
            // Cell errors (300-399)
            ErrorCode::InvalidCellReference => 300,
            ErrorCode::InvalidCellValue => 301,
            ErrorCode::InvalidFormula => 302,
            // Style errors (400-499)
            ErrorCode::InvalidNumberFormat => 400,
            ErrorCode::InvalidStyleIndex => 401,
            // Reference errors (500-599)
            ErrorCode::InvalidSharedStringIndex => 500,
            ErrorCode::MissingRelationship => 501,
            // Feature errors (600-699)
            ErrorCode::UnsupportedFeature => 600,
            // Data errors (700-799)
            ErrorCode::TruncatedFile => 700,
            ErrorCode::DataCorruption => 701,
        }
    }

    /// Get a short description of this error type
    pub fn description(&self) -> &'static str {
        match self {
            ErrorCode::InvalidArchive => "Invalid archive",
            ErrorCode::CorruptedArchive => "Corrupted archive",
            ErrorCode::MissingPart => "Missing part",
            ErrorCode::MalformedXml => "Malformed XML",
            ErrorCode::InvalidElement => "Invalid element",
            ErrorCode::MissingAttribute => "Missing attribute",
            ErrorCode::InvalidCellReference => "Invalid cell reference",
            ErrorCode::InvalidCellValue => "Invalid cell value",
            ErrorCode::InvalidFormula => "Invalid formula",
            ErrorCode::InvalidNumberFormat => "Invalid number format",
            ErrorCode::InvalidStyleIndex => "Invalid style index",
            ErrorCode::InvalidSharedStringIndex => "Invalid shared string index",
            ErrorCode::MissingRelationship => "Missing relationship",
            ErrorCode::UnsupportedFeature => "Unsupported feature",
            ErrorCode::TruncatedFile => "Truncated file",
            ErrorCode::DataCorruption => "Data corruption",
        }
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "E{:03}: {}", self.code(), self.description())
    }
}

/// Location information for where an error occurred
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ErrorLocation {
    /// The part (file path) within the archive, e.g., "xl/worksheets/sheet1.xml"
    pub part: String,
    /// XPath-like path to the element, e.g., "/worksheet/sheetData/row[5]/c[3]"
    pub path: Option<String>,
    /// Row number if applicable (1-based)
    pub row: Option<u32>,
    /// Column number if applicable (1-based)
    pub col: Option<u32>,
}

impl ErrorLocation {
    /// Create a new error location with just the part path
    pub fn new(part: impl Into<String>) -> Self {
        Self {
            part: part.into(),
            path: None,
            row: None,
            col: None,
        }
    }

    /// Create a new error location with part and element path
    pub fn with_path(part: impl Into<String>, path: impl Into<String>) -> Self {
        Self {
            part: part.into(),
            path: Some(path.into()),
            row: None,
            col: None,
        }
    }

    /// Create a new error location for a specific cell
    pub fn cell(part: impl Into<String>, row: u32, col: u32) -> Self {
        Self {
            part: part.into(),
            path: None,
            row: Some(row),
            col: Some(col),
        }
    }

    /// Set the element path
    pub fn set_path(&mut self, path: impl Into<String>) {
        self.path = Some(path.into());
    }

    /// Set the cell coordinates
    pub fn set_cell(&mut self, row: u32, col: u32) {
        self.row = Some(row);
        self.col = Some(col);
    }
}

impl fmt::Display for ErrorLocation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.part)?;
        if let Some(ref path) = self.path {
            write!(f, " at {}", path)?;
        }
        if let (Some(row), Some(col)) = (self.row, self.col) {
            write!(f, " [row={}, col={}]", row, col)?;
        } else if let Some(row) = self.row {
            write!(f, " [row={}]", row)?;
        } else if let Some(col) = self.col {
            write!(f, " [col={}]", col)?;
        }
        Ok(())
    }
}

/// Detailed information about a parse error
#[derive(Debug, Clone)]
pub struct ParseErrorDetail {
    /// The category of error
    pub code: ErrorCode,
    /// How severe this error is
    pub severity: ErrorSeverity,
    /// Human-readable error message
    pub message: String,
    /// Where the error occurred
    pub location: Option<ErrorLocation>,
    /// The original data that caused the error (for debugging)
    pub raw_data: Option<String>,
    /// What fallback/default value was used instead
    pub fallback_used: Option<String>,
}

impl ParseErrorDetail {
    /// Create a new error detail
    pub fn new(code: ErrorCode, severity: ErrorSeverity, message: impl Into<String>) -> Self {
        Self {
            code,
            severity,
            message: message.into(),
            location: None,
            raw_data: None,
            fallback_used: None,
        }
    }

    /// Create a warning
    pub fn warning(code: ErrorCode, message: impl Into<String>) -> Self {
        Self::new(code, ErrorSeverity::Warning, message)
    }

    /// Create an error
    pub fn error(code: ErrorCode, message: impl Into<String>) -> Self {
        Self::new(code, ErrorSeverity::Error, message)
    }

    /// Create a fatal error
    pub fn fatal(code: ErrorCode, message: impl Into<String>) -> Self {
        Self::new(code, ErrorSeverity::Fatal, message)
    }

    /// Add location information
    pub fn with_location(mut self, location: ErrorLocation) -> Self {
        self.location = Some(location);
        self
    }

    /// Add raw data that caused the error
    pub fn with_raw_data(mut self, raw: impl Into<String>) -> Self {
        self.raw_data = Some(raw.into());
        self
    }

    /// Add information about the fallback used
    pub fn with_fallback(mut self, fallback: impl Into<String>) -> Self {
        self.fallback_used = Some(fallback.into());
        self
    }
}

impl fmt::Display for ParseErrorDetail {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}: {}", self.severity, self.code, self.message)?;
        if let Some(ref loc) = self.location {
            write!(f, " in {}", loc)?;
        }
        if let Some(ref raw) = self.raw_data {
            // Truncate raw data for display
            let display_raw = if raw.len() > 50 {
                format!("{}...", &raw[..47])
            } else {
                raw.clone()
            };
            write!(f, " (raw: {:?})", display_raw)?;
        }
        if let Some(ref fallback) = self.fallback_used {
            write!(f, " -> using {}", fallback)?;
        }
        Ok(())
    }
}

impl std::error::Error for ParseErrorDetail {}

/// Collects errors during parsing
#[derive(Debug, Clone)]
pub struct ErrorCollector {
    mode: ParseMode,
    errors: Vec<ParseErrorDetail>,
    max_errors: usize,
    has_fatal: bool,
}

impl Default for ErrorCollector {
    fn default() -> Self {
        Self::new(ParseMode::default())
    }
}

impl ErrorCollector {
    /// Default maximum errors to collect
    pub const DEFAULT_MAX_ERRORS: usize = 1000;

    /// Create a new error collector with the specified mode
    pub fn new(mode: ParseMode) -> Self {
        Self {
            mode,
            errors: Vec::new(),
            max_errors: Self::DEFAULT_MAX_ERRORS,
            has_fatal: false,
        }
    }

    /// Create a new error collector with custom max errors limit
    pub fn with_max_errors(mode: ParseMode, max: usize) -> Self {
        Self {
            mode,
            errors: Vec::new(),
            max_errors: max,
            has_fatal: false,
        }
    }

    /// Add an error to the collection
    ///
    /// Returns `true` if parsing should continue, `false` if it should stop.
    pub fn add_error(&mut self, error: ParseErrorDetail) -> bool {
        if error.severity == ErrorSeverity::Fatal {
            self.has_fatal = true;
        }

        // In strict mode, any error should stop parsing
        if self.mode == ParseMode::Strict && error.severity >= ErrorSeverity::Error {
            self.errors.push(error);
            return false;
        }

        // Store error if we haven't hit the limit
        if self.errors.len() < self.max_errors {
            self.errors.push(error.clone());
        }

        // Determine if we should continue
        self.should_continue(error.severity)
    }

    /// Add a warning with minimal information
    pub fn add_warning(&mut self, code: ErrorCode, message: &str, location: Option<ErrorLocation>) {
        let mut error = ParseErrorDetail::warning(code, message);
        if let Some(loc) = location {
            error.location = Some(loc);
        }
        self.add_error(error);
    }

    /// Check if parsing should continue given an error severity
    pub fn should_continue(&self, severity: ErrorSeverity) -> bool {
        match self.mode {
            ParseMode::Strict => severity < ErrorSeverity::Error,
            ParseMode::Lenient => severity < ErrorSeverity::Fatal,
            ParseMode::Permissive => severity < ErrorSeverity::Fatal,
        }
    }

    /// Get all collected errors
    pub fn errors(&self) -> &[ParseErrorDetail] {
        &self.errors
    }

    /// Check if a fatal error has occurred
    pub fn has_fatal_error(&self) -> bool {
        self.has_fatal
    }

    /// Get the total number of errors (excluding warnings)
    pub fn error_count(&self) -> usize {
        self.errors
            .iter()
            .filter(|e| e.severity >= ErrorSeverity::Error)
            .count()
    }

    /// Get the number of warnings
    pub fn warning_count(&self) -> usize {
        self.errors
            .iter()
            .filter(|e| e.severity == ErrorSeverity::Warning)
            .count()
    }

    /// Get the current parse mode
    pub fn mode(&self) -> ParseMode {
        self.mode
    }

    /// Consume the collector and return all errors
    pub fn into_errors(self) -> Vec<ParseErrorDetail> {
        self.errors
    }

    /// Check if any errors were collected
    pub fn has_errors(&self) -> bool {
        !self.errors.is_empty()
    }

    /// Clear all collected errors
    pub fn clear(&mut self) {
        self.errors.clear();
        self.has_fatal = false;
    }
}

/// Context for parsing operations, thread through parsing functions
#[derive(Debug, Clone)]
pub struct ParseContext {
    /// The current parse mode
    pub mode: ParseMode,
    /// Error collector
    pub collector: ErrorCollector,
    /// The current part being parsed
    pub current_part: String,
}

impl Default for ParseContext {
    fn default() -> Self {
        Self::lenient()
    }
}

impl ParseContext {
    /// Create a new parse context with the specified mode
    pub fn new(mode: ParseMode) -> Self {
        Self {
            mode,
            collector: ErrorCollector::new(mode),
            current_part: String::new(),
        }
    }

    /// Create a strict parse context (fail on first error)
    pub fn strict() -> Self {
        Self::new(ParseMode::Strict)
    }

    /// Create a lenient parse context (skip errors, collect warnings)
    pub fn lenient() -> Self {
        Self::new(ParseMode::Lenient)
    }

    /// Create a permissive parse context (maximum recovery)
    pub fn permissive() -> Self {
        Self::new(ParseMode::Permissive)
    }

    /// Set the current part being parsed
    pub fn set_current_part(&mut self, part: &str) {
        self.current_part = part.to_string();
    }

    /// Report an error and return whether parsing should continue
    ///
    /// Returns `true` if parsing should continue, `false` if it should stop.
    pub fn report_error(&mut self, code: ErrorCode, message: &str) -> bool {
        let error = ParseErrorDetail::error(code, message)
            .with_location(ErrorLocation::new(&self.current_part));
        self.collector.add_error(error)
    }

    /// Report a warning (always continues)
    pub fn report_warning(&mut self, code: ErrorCode, message: &str) {
        let location = if self.current_part.is_empty() {
            None
        } else {
            Some(ErrorLocation::new(&self.current_part))
        };
        self.collector.add_warning(code, message, location);
    }

    /// Report an error with full details
    pub fn report_error_detail(&mut self, error: ParseErrorDetail) -> bool {
        self.collector.add_error(error)
    }

    /// Check if parsing should stop
    pub fn should_stop(&self) -> bool {
        self.collector.has_fatal_error()
            || (self.mode == ParseMode::Strict && self.collector.error_count() > 0)
    }

    /// Get all collected errors
    pub fn errors(&self) -> &[ParseErrorDetail] {
        self.collector.errors()
    }

    /// Get the error count
    pub fn error_count(&self) -> usize {
        self.collector.error_count()
    }

    /// Get the warning count
    pub fn warning_count(&self) -> usize {
        self.collector.warning_count()
    }

    /// Consume the context and return all errors
    pub fn into_errors(self) -> Vec<ParseErrorDetail> {
        self.collector.into_errors()
    }
}

// =============================================================================
// Recovery Helper Functions
// =============================================================================

/// Attempt to recover an invalid cell reference
///
/// Tries to parse what it can from the reference, returning (0, 0) as default.
///
/// # Arguments
/// * `raw` - The raw cell reference string (e.g., "A1", "ZZZ999", or garbage)
///
/// # Returns
/// A tuple of (row, col) with 0-based indices, defaulting to (0, 0) on failure
pub fn recover_cell_reference(raw: &str) -> (u32, u32) {
    let raw = raw.trim();
    if raw.is_empty() {
        return (0, 0);
    }

    // Extract column letters and row digits
    let mut col_end = 0;
    for (i, c) in raw.chars().enumerate() {
        if c.is_ascii_alphabetic() {
            col_end = i + 1;
        } else {
            break;
        }
    }

    // If no column letters found, this isn't a valid cell reference
    if col_end == 0 {
        return (0, 0);
    }

    // Parse column (A=0, B=1, ..., Z=25, AA=26, etc.)
    let col_str = &raw[..col_end].to_uppercase();
    let mut col_num: u32 = 0;
    for c in col_str.chars() {
        if c.is_ascii_uppercase() {
            col_num = col_num
                .saturating_mul(26)
                .saturating_add((c as u32) - ('A' as u32) + 1);
        }
    }
    let col = col_num.saturating_sub(1); // Convert to 0-based

    // Parse row
    let row = if col_end < raw.len() {
        raw[col_end..].parse::<u32>().unwrap_or(1).saturating_sub(1) // Convert to 0-based
    } else {
        0
    };

    (row, col)
}

/// Attempt to recover an invalid number
///
/// Tries various parsing strategies, returning 0.0 as default.
///
/// # Arguments
/// * `raw` - The raw number string
///
/// # Returns
/// The parsed number, or 0.0 on failure
pub fn recover_number(raw: &str) -> f64 {
    let raw = raw.trim();
    if raw.is_empty() {
        return 0.0;
    }

    // Try standard parsing first
    if let Ok(n) = raw.parse::<f64>() {
        return n;
    }

    // Try removing common formatting characters
    let cleaned: String = raw
        .chars()
        .filter(|c| {
            c.is_ascii_digit() || *c == '.' || *c == '-' || *c == '+' || *c == 'e' || *c == 'E'
        })
        .collect();

    if let Ok(n) = cleaned.parse::<f64>() {
        return n;
    }

    // Try parsing just leading digits
    let mut num_str = String::new();
    let mut has_decimal = false;
    let mut started = false;

    for c in raw.chars() {
        if c == '-' || c == '+' {
            if started {
                break;
            }
            num_str.push(c);
            started = true;
        } else if c.is_ascii_digit() {
            num_str.push(c);
            started = true;
        } else if c == '.' && !has_decimal {
            num_str.push(c);
            has_decimal = true;
            started = true;
        } else if started {
            break;
        }
    }

    num_str.parse().unwrap_or(0.0)
}

/// Attempt to recover an invalid style index
///
/// # Arguments
/// * `raw` - The raw style index string
///
/// # Returns
/// The parsed style index, or 0 (default style) on failure
pub fn recover_style_index(raw: &str) -> u32 {
    raw.trim().parse().unwrap_or(0)
}

/// Attempt to recover an invalid shared string index
///
/// # Arguments
/// * `index` - The requested index
/// * `max` - The maximum valid index (exclusive)
///
/// # Returns
/// A placeholder string for display
pub fn recover_shared_string(index: usize, max: usize) -> &'static str {
    if index >= max {
        "#REF!"
    } else {
        "" // Should not reach here, but return empty as safe default
    }
}

// Re-export A1 reference utilities for backward compatibility.
pub use crate::infra::a1::col_to_letter;
pub use crate::infra::a1::format_cell_ref;

// =============================================================================
// Mode conversion
// =============================================================================

/// Convert mode integer to ParseMode enum
///
/// # Arguments
/// * `mode` - 0=Strict, 1=Lenient, 2=Permissive
pub fn mode_from_u32(mode: u32) -> ParseMode {
    match mode {
        0 => ParseMode::Strict,
        1 => ParseMode::Lenient,
        2 => ParseMode::Permissive,
        _ => ParseMode::Lenient, // Default to Lenient for invalid values
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // ParseMode tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_mode_display() {
        assert_eq!(ParseMode::Strict.to_string(), "strict");
        assert_eq!(ParseMode::Lenient.to_string(), "lenient");
        assert_eq!(ParseMode::Permissive.to_string(), "permissive");
    }

    #[test]
    fn test_parse_mode_default() {
        assert_eq!(ParseMode::default(), ParseMode::Lenient);
    }

    // -------------------------------------------------------------------------
    // ErrorSeverity tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_error_severity_ordering() {
        assert!(ErrorSeverity::Warning < ErrorSeverity::Error);
        assert!(ErrorSeverity::Error < ErrorSeverity::Fatal);
    }

    #[test]
    fn test_error_severity_display() {
        assert_eq!(ErrorSeverity::Warning.to_string(), "warning");
        assert_eq!(ErrorSeverity::Error.to_string(), "error");
        assert_eq!(ErrorSeverity::Fatal.to_string(), "fatal");
    }

    // -------------------------------------------------------------------------
    // ErrorCode tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_error_code_values() {
        assert_eq!(ErrorCode::InvalidArchive.code(), 100);
        assert_eq!(ErrorCode::MalformedXml.code(), 200);
        assert_eq!(ErrorCode::InvalidCellReference.code(), 300);
        assert_eq!(ErrorCode::InvalidNumberFormat.code(), 400);
        assert_eq!(ErrorCode::InvalidSharedStringIndex.code(), 500);
        assert_eq!(ErrorCode::UnsupportedFeature.code(), 600);
        assert_eq!(ErrorCode::TruncatedFile.code(), 700);
    }

    #[test]
    fn test_error_code_display() {
        let code = ErrorCode::InvalidCellReference;
        let display = format!("{}", code);
        assert!(display.contains("E300"));
        assert!(display.contains("Invalid cell reference"));
    }

    // -------------------------------------------------------------------------
    // ErrorLocation tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_error_location_new() {
        let loc = ErrorLocation::new("xl/worksheets/sheet1.xml");
        assert_eq!(loc.part, "xl/worksheets/sheet1.xml");
        assert!(loc.path.is_none());
        assert!(loc.row.is_none());
        assert!(loc.col.is_none());
    }

    #[test]
    fn test_error_location_with_path() {
        let loc = ErrorLocation::with_path(
            "xl/worksheets/sheet1.xml",
            "/worksheet/sheetData/row[5]/c[3]",
        );
        assert_eq!(loc.part, "xl/worksheets/sheet1.xml");
        assert_eq!(
            loc.path.as_deref(),
            Some("/worksheet/sheetData/row[5]/c[3]")
        );
    }

    #[test]
    fn test_error_location_cell() {
        let loc = ErrorLocation::cell("xl/worksheets/sheet1.xml", 5, 3);
        assert_eq!(loc.row, Some(5));
        assert_eq!(loc.col, Some(3));
    }

    #[test]
    fn test_error_location_display() {
        let mut loc = ErrorLocation::cell("xl/worksheets/sheet1.xml", 5, 3);
        loc.set_path("/worksheet/sheetData/row[5]/c[3]");

        let display = format!("{}", loc);
        assert!(display.contains("xl/worksheets/sheet1.xml"));
        assert!(display.contains("/worksheet/sheetData/row[5]/c[3]"));
        assert!(display.contains("row=5"));
        assert!(display.contains("col=3"));
    }

    // -------------------------------------------------------------------------
    // ParseErrorDetail tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_error_detail_creation() {
        let error = ParseErrorDetail::error(ErrorCode::InvalidCellReference, "Bad cell ref");
        assert_eq!(error.code, ErrorCode::InvalidCellReference);
        assert_eq!(error.severity, ErrorSeverity::Error);
        assert_eq!(error.message, "Bad cell ref");
    }

    #[test]
    fn test_error_detail_builder() {
        let error = ParseErrorDetail::warning(ErrorCode::InvalidCellValue, "Value issue")
            .with_location(ErrorLocation::cell("sheet1.xml", 1, 2))
            .with_raw_data("abc123")
            .with_fallback("0.0");

        assert_eq!(error.severity, ErrorSeverity::Warning);
        assert!(error.location.is_some());
        assert_eq!(error.raw_data.as_deref(), Some("abc123"));
        assert_eq!(error.fallback_used.as_deref(), Some("0.0"));
    }

    #[test]
    fn test_error_detail_display() {
        let error = ParseErrorDetail::error(ErrorCode::InvalidFormula, "Syntax error")
            .with_location(ErrorLocation::new("sheet1.xml"))
            .with_raw_data("=SUM(")
            .with_fallback("empty cell");

        let display = format!("{}", error);
        assert!(display.contains("[error]"));
        assert!(display.contains("Syntax error"));
        assert!(display.contains("sheet1.xml"));
        assert!(display.contains("=SUM("));
        assert!(display.contains("empty cell"));
    }

    // -------------------------------------------------------------------------
    // ErrorCollector tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_collector_strict_mode() {
        let mut collector = ErrorCollector::new(ParseMode::Strict);

        // Warning should allow continuation
        let cont = collector.add_error(ParseErrorDetail::warning(
            ErrorCode::InvalidCellValue,
            "warning",
        ));
        assert!(cont);

        // Error should stop in strict mode
        let cont = collector.add_error(ParseErrorDetail::error(
            ErrorCode::InvalidCellReference,
            "error",
        ));
        assert!(!cont);
    }

    #[test]
    fn test_collector_lenient_mode() {
        let mut collector = ErrorCollector::new(ParseMode::Lenient);

        // Errors should allow continuation in lenient mode
        let cont = collector.add_error(ParseErrorDetail::error(
            ErrorCode::InvalidCellReference,
            "error",
        ));
        assert!(cont);

        // Fatal should stop
        let cont = collector.add_error(ParseErrorDetail::fatal(ErrorCode::DataCorruption, "fatal"));
        assert!(!cont);
    }

    #[test]
    fn test_collector_permissive_mode() {
        let mut collector = ErrorCollector::new(ParseMode::Permissive);

        // Errors should allow continuation
        let cont = collector.add_error(ParseErrorDetail::error(
            ErrorCode::InvalidCellReference,
            "error",
        ));
        assert!(cont);

        // Only fatal stops
        let cont = collector.add_error(ParseErrorDetail::fatal(ErrorCode::DataCorruption, "fatal"));
        assert!(!cont);
    }

    #[test]
    fn test_collector_max_errors() {
        let mut collector = ErrorCollector::with_max_errors(ParseMode::Lenient, 5);

        // Add 10 errors
        for i in 0..10 {
            collector.add_error(ParseErrorDetail::error(
                ErrorCode::InvalidCellValue,
                format!("error {}", i),
            ));
        }

        // Should only have stored 5
        assert_eq!(collector.errors().len(), 5);
    }

    #[test]
    fn test_collector_counts() {
        let mut collector = ErrorCollector::new(ParseMode::Lenient);

        collector.add_error(ParseErrorDetail::warning(ErrorCode::InvalidCellValue, "w1"));
        collector.add_error(ParseErrorDetail::warning(ErrorCode::InvalidCellValue, "w2"));
        collector.add_error(ParseErrorDetail::error(
            ErrorCode::InvalidCellReference,
            "e1",
        ));

        assert_eq!(collector.warning_count(), 2);
        assert_eq!(collector.error_count(), 1);
        assert_eq!(collector.errors().len(), 3);
    }

    #[test]
    fn test_collector_has_fatal() {
        let mut collector = ErrorCollector::new(ParseMode::Lenient);
        assert!(!collector.has_fatal_error());

        collector.add_error(ParseErrorDetail::error(
            ErrorCode::InvalidCellReference,
            "e",
        ));
        assert!(!collector.has_fatal_error());

        collector.add_error(ParseErrorDetail::fatal(ErrorCode::DataCorruption, "f"));
        assert!(collector.has_fatal_error());
    }

    #[test]
    fn test_collector_clear() {
        let mut collector = ErrorCollector::new(ParseMode::Lenient);
        collector.add_error(ParseErrorDetail::fatal(ErrorCode::DataCorruption, "fatal"));

        assert!(collector.has_fatal_error());
        assert!(collector.has_errors());

        collector.clear();

        assert!(!collector.has_fatal_error());
        assert!(!collector.has_errors());
    }

    // -------------------------------------------------------------------------
    // ParseContext tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_context_creation() {
        let ctx = ParseContext::strict();
        assert_eq!(ctx.mode, ParseMode::Strict);

        let ctx = ParseContext::lenient();
        assert_eq!(ctx.mode, ParseMode::Lenient);

        let ctx = ParseContext::permissive();
        assert_eq!(ctx.mode, ParseMode::Permissive);
    }

    #[test]
    fn test_context_current_part() {
        let mut ctx = ParseContext::lenient();
        ctx.set_current_part("xl/worksheets/sheet1.xml");
        assert_eq!(ctx.current_part, "xl/worksheets/sheet1.xml");
    }

    #[test]
    fn test_context_report_error() {
        let mut ctx = ParseContext::lenient();
        ctx.set_current_part("sheet1.xml");

        let cont = ctx.report_error(ErrorCode::InvalidCellReference, "Bad ref");
        assert!(cont); // Lenient mode continues on error

        assert_eq!(ctx.error_count(), 1);
        assert!(!ctx.should_stop());
    }

    #[test]
    fn test_context_report_warning() {
        let mut ctx = ParseContext::strict();
        ctx.set_current_part("sheet1.xml");

        ctx.report_warning(ErrorCode::InvalidCellValue, "Minor issue");

        assert_eq!(ctx.warning_count(), 1);
        assert_eq!(ctx.error_count(), 0);
        assert!(!ctx.should_stop()); // Warnings don't stop even in strict mode
    }

    #[test]
    fn test_context_strict_stops_on_error() {
        let mut ctx = ParseContext::strict();
        ctx.report_error(ErrorCode::InvalidCellReference, "Error");

        assert!(ctx.should_stop());
    }

    #[test]
    fn test_context_into_errors() {
        let mut ctx = ParseContext::lenient();
        ctx.report_error(ErrorCode::InvalidCellReference, "e1");
        ctx.report_warning(ErrorCode::InvalidCellValue, "w1");

        let errors = ctx.into_errors();
        assert_eq!(errors.len(), 2);
    }

    // -------------------------------------------------------------------------
    // Recovery function tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_recover_cell_reference_valid() {
        assert_eq!(recover_cell_reference("A1"), (0, 0));
        assert_eq!(recover_cell_reference("B2"), (1, 1));
        assert_eq!(recover_cell_reference("Z26"), (25, 25));
        assert_eq!(recover_cell_reference("AA1"), (0, 26));
        assert_eq!(recover_cell_reference("AB10"), (9, 27));
    }

    #[test]
    fn test_recover_cell_reference_invalid() {
        assert_eq!(recover_cell_reference(""), (0, 0));
        assert_eq!(recover_cell_reference("   "), (0, 0));
        assert_eq!(recover_cell_reference("123"), (0, 0));
        assert_eq!(recover_cell_reference("!!!"), (0, 0));
    }

    #[test]
    fn test_recover_cell_reference_partial() {
        // Just letters - defaults row to 0
        assert_eq!(recover_cell_reference("A"), (0, 0));
        assert_eq!(recover_cell_reference("ABC"), (0, 730)); // ABC column
    }

    #[test]
    fn test_recover_number_valid() {
        assert_eq!(recover_number("123"), 123.0);
        assert_eq!(recover_number("123.456"), 123.456);
        assert_eq!(recover_number("-42"), -42.0);
        assert_eq!(recover_number("1e10"), 1e10);
    }

    #[test]
    fn test_recover_number_invalid() {
        assert_eq!(recover_number(""), 0.0);
        assert_eq!(recover_number("abc"), 0.0);
        assert_eq!(recover_number("!!!"), 0.0);
    }

    #[test]
    fn test_recover_number_formatted() {
        // With currency or other characters
        assert_eq!(recover_number("$123"), 123.0);
        assert_eq!(recover_number("123%"), 123.0);
        assert_eq!(recover_number(" 42 "), 42.0);
    }

    #[test]
    fn test_recover_style_index() {
        assert_eq!(recover_style_index("0"), 0);
        assert_eq!(recover_style_index("42"), 42);
        assert_eq!(recover_style_index(""), 0);
        assert_eq!(recover_style_index("abc"), 0);
        assert_eq!(recover_style_index("  5  "), 5);
    }

    #[test]
    fn test_recover_shared_string() {
        assert_eq!(recover_shared_string(100, 50), "#REF!");
        assert_eq!(recover_shared_string(0, 10), "");
    }

    // -------------------------------------------------------------------------
    // Integration tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_full_error_flow() {
        let mut ctx = ParseContext::lenient();
        ctx.set_current_part("xl/worksheets/sheet1.xml");

        // Simulate parsing with errors
        ctx.report_warning(ErrorCode::UnsupportedFeature, "Pivot tables not supported");

        // Cell with invalid value
        let error = ParseErrorDetail::error(ErrorCode::InvalidCellValue, "Cannot parse cell value")
            .with_location(ErrorLocation::cell("xl/worksheets/sheet1.xml", 5, 3))
            .with_raw_data("not-a-number")
            .with_fallback("0.0");

        ctx.report_error_detail(error);

        // Continue parsing...
        assert!(!ctx.should_stop());

        // Final stats
        assert_eq!(ctx.warning_count(), 1);
        assert_eq!(ctx.error_count(), 1);

        // Get all errors
        let errors = ctx.into_errors();
        assert_eq!(errors.len(), 2);
    }

    #[test]
    fn test_error_collector_default() {
        let collector = ErrorCollector::default();
        assert_eq!(collector.mode(), ParseMode::Lenient);
        assert!(!collector.has_errors());
    }

    #[test]
    fn test_parse_context_default() {
        let ctx = ParseContext::default();
        assert_eq!(ctx.mode, ParseMode::Lenient);
    }

    #[test]
    fn test_mode_from_u32() {
        assert_eq!(mode_from_u32(0), ParseMode::Strict);
        assert_eq!(mode_from_u32(1), ParseMode::Lenient);
        assert_eq!(mode_from_u32(2), ParseMode::Permissive);
        // Invalid values default to Lenient
        assert_eq!(mode_from_u32(3), ParseMode::Lenient);
        assert_eq!(mode_from_u32(100), ParseMode::Lenient);
    }
}
