//! Error locations and detailed parse-error formatting.
//!
//! `ParseErrorDetail` raw preview truncation remains byte-based to preserve
//! existing display output.

#![allow(clippy::string_slice)]

use std::fmt;

use super::types::{ErrorCode, ErrorSeverity};

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
            // Preserve byte-count preview truncation for existing error output.
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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn test_error_location_setters_and_display() {
        let mut loc = ErrorLocation::cell("xl/worksheets/sheet1.xml", 5, 3);
        loc.set_path("/worksheet/sheetData/row[5]/c[3]");

        assert_eq!(
            loc.to_string(),
            "xl/worksheets/sheet1.xml at /worksheet/sheetData/row[5]/c[3] [row=5, col=3]"
        );

        let mut row_only = ErrorLocation::new("sheet.xml");
        row_only.row = Some(9);
        assert_eq!(row_only.to_string(), "sheet.xml [row=9]");

        let mut col_only = ErrorLocation::new("sheet.xml");
        col_only.col = Some(4);
        assert_eq!(col_only.to_string(), "sheet.xml [col=4]");

        let mut setter = ErrorLocation::new("sheet.xml");
        setter.set_cell(2, 8);
        assert_eq!(setter.to_string(), "sheet.xml [row=2, col=8]");
    }

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

        assert_eq!(
            error.to_string(),
            "[error] E302: Invalid formula: Syntax error in sheet1.xml (raw: \"=SUM(\") -> using empty cell"
        );
    }

    #[test]
    fn test_error_detail_display_truncates_raw_at_ascii_byte_boundary() {
        let raw = "123456789012345678901234567890123456789012345678901";
        let error =
            ParseErrorDetail::error(ErrorCode::InvalidCellValue, "Bad value").with_raw_data(raw);

        assert_eq!(
            error.to_string(),
            "[error] E301: Invalid cell value: Bad value (raw: \"12345678901234567890123456789012345678901234567...\")"
        );
    }
}
