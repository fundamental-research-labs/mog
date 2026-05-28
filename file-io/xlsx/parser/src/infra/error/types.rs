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

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn test_error_code_values() {
        assert_eq!(ErrorCode::InvalidArchive.code(), 100);
        assert_eq!(ErrorCode::CorruptedArchive.code(), 101);
        assert_eq!(ErrorCode::MissingPart.code(), 102);
        assert_eq!(ErrorCode::MalformedXml.code(), 200);
        assert_eq!(ErrorCode::InvalidElement.code(), 201);
        assert_eq!(ErrorCode::MissingAttribute.code(), 202);
        assert_eq!(ErrorCode::InvalidCellReference.code(), 300);
        assert_eq!(ErrorCode::InvalidCellValue.code(), 301);
        assert_eq!(ErrorCode::InvalidFormula.code(), 302);
        assert_eq!(ErrorCode::InvalidNumberFormat.code(), 400);
        assert_eq!(ErrorCode::InvalidStyleIndex.code(), 401);
        assert_eq!(ErrorCode::InvalidSharedStringIndex.code(), 500);
        assert_eq!(ErrorCode::MissingRelationship.code(), 501);
        assert_eq!(ErrorCode::UnsupportedFeature.code(), 600);
        assert_eq!(ErrorCode::TruncatedFile.code(), 700);
        assert_eq!(ErrorCode::DataCorruption.code(), 701);
    }

    #[test]
    fn test_error_code_display() {
        assert_eq!(
            ErrorCode::InvalidCellReference.to_string(),
            "E300: Invalid cell reference"
        );
    }
}
