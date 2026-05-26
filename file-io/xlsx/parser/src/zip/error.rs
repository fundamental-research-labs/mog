//! Error types for ZIP operations

use crate::infra::error::{ErrorCode, ParseErrorDetail};

/// Error types for ZIP operations
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ZipError {
    /// The archive is not a valid ZIP file
    InvalidArchive,
    /// The requested file was not found in the archive
    FileNotFound(String),
    /// Decompression failed
    DecompressionFailed,
    /// The compression method is not supported
    UnsupportedCompression(u16),
    /// The archive uses a ZIP feature this parser intentionally rejects
    UnsupportedFeature(String),
    /// The archive is corrupted or truncated
    CorruptedArchive,
    /// The archive is corrupted or truncated, with diagnostic detail
    CorruptedArchiveDetail(String),
    /// File is too large to decompress safely
    FileTooLarge,
    /// File is too large to decompress safely, with diagnostic detail
    FileTooLargeDetail {
        /// Configured byte limit
        limit: usize,
        /// Declared or actual byte count that exceeded the limit
        actual: usize,
    },
    /// ZIP part name is invalid under the XLSX parser filename policy
    InvalidFileName(String),
    /// Invalid ZIP file format (alias for compatibility)
    InvalidFormat,
    /// Unsupported compression method (alias for compatibility)
    UnsupportedCompressionMethod,
    /// Data corruption detected
    DataCorruption,
    /// Data corruption detected, with diagnostic detail
    DataCorruptionDetail(String),
    /// Archive is truncated
    UnexpectedEof,
}

impl ZipError {
    /// Returns true when the failure represents hostile or corrupt archive data
    /// that must not be downgraded by parse-mode recovery helpers.
    pub fn is_safety_fatal(&self) -> bool {
        !matches!(self, ZipError::FileNotFound(_))
    }
}

impl std::fmt::Display for ZipError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ZipError::InvalidArchive => write!(f, "Invalid ZIP archive"),
            ZipError::FileNotFound(name) => write!(f, "File not found: {}", name),
            ZipError::DecompressionFailed => write!(f, "Decompression failed"),
            ZipError::UnsupportedCompression(method) => {
                write!(f, "Unsupported compression method: {}", method)
            }
            ZipError::UnsupportedFeature(feature) => {
                write!(f, "Unsupported ZIP feature: {}", feature)
            }
            ZipError::CorruptedArchive => write!(f, "Corrupted archive"),
            ZipError::CorruptedArchiveDetail(message) => {
                write!(f, "Corrupted archive: {}", message)
            }
            ZipError::FileTooLarge => write!(f, "File too large"),
            ZipError::FileTooLargeDetail { limit, actual } => write!(
                f,
                "File too large: actual or declared size {} exceeds limit {}",
                actual, limit
            ),
            ZipError::InvalidFileName(message) => write!(f, "Invalid ZIP filename: {}", message),
            ZipError::InvalidFormat => write!(f, "Invalid ZIP format"),
            ZipError::UnsupportedCompressionMethod => write!(f, "Unsupported compression method"),
            ZipError::DataCorruption => write!(f, "Data corruption detected"),
            ZipError::DataCorruptionDetail(message) => {
                write!(f, "Data corruption detected: {}", message)
            }
            ZipError::UnexpectedEof => write!(f, "Unexpected end of archive"),
        }
    }
}

impl std::error::Error for ZipError {}

impl From<ZipError> for ParseErrorDetail {
    fn from(e: ZipError) -> Self {
        match e {
            ZipError::InvalidArchive => {
                ParseErrorDetail::fatal(ErrorCode::InvalidArchive, "Invalid ZIP archive")
            }
            ZipError::FileNotFound(name) => {
                ParseErrorDetail::error(ErrorCode::MissingPart, format!("File not found: {}", name))
            }
            ZipError::DecompressionFailed => {
                ParseErrorDetail::fatal(ErrorCode::CorruptedArchive, "Decompression failed")
            }
            ZipError::UnsupportedCompression(method) => ParseErrorDetail::fatal(
                ErrorCode::UnsupportedFeature,
                format!("Unsupported compression method: {}", method),
            ),
            ZipError::UnsupportedFeature(feature) => ParseErrorDetail::fatal(
                ErrorCode::UnsupportedFeature,
                format!("Unsupported ZIP feature: {}", feature),
            ),
            ZipError::CorruptedArchive => {
                ParseErrorDetail::fatal(ErrorCode::CorruptedArchive, "Corrupted archive")
            }
            ZipError::CorruptedArchiveDetail(message) => {
                ParseErrorDetail::fatal(ErrorCode::CorruptedArchive, message)
            }
            ZipError::FileTooLarge => ParseErrorDetail::fatal(
                ErrorCode::DataCorruption,
                "File too large to decompress safely",
            ),
            ZipError::FileTooLargeDetail { limit, actual } => ParseErrorDetail::fatal(
                ErrorCode::DataCorruption,
                format!(
                    "File too large to decompress safely: actual or declared size {} exceeds limit {}",
                    actual, limit
                ),
            ),
            ZipError::InvalidFileName(message) => {
                ParseErrorDetail::fatal(ErrorCode::CorruptedArchive, message)
            }
            ZipError::InvalidFormat => {
                ParseErrorDetail::fatal(ErrorCode::InvalidArchive, "Invalid ZIP format")
            }
            ZipError::UnsupportedCompressionMethod => ParseErrorDetail::fatal(
                ErrorCode::UnsupportedFeature,
                "Unsupported compression method",
            ),
            ZipError::DataCorruption => {
                ParseErrorDetail::fatal(ErrorCode::DataCorruption, "Data corruption detected")
            }
            ZipError::DataCorruptionDetail(message) => {
                ParseErrorDetail::fatal(ErrorCode::DataCorruption, message)
            }
            ZipError::UnexpectedEof => {
                ParseErrorDetail::fatal(ErrorCode::TruncatedFile, "Unexpected end of archive")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_zip_error_display() {
        assert_eq!(
            format!("{}", ZipError::InvalidArchive),
            "Invalid ZIP archive"
        );
        assert_eq!(
            format!("{}", ZipError::FileNotFound("test.txt".to_string())),
            "File not found: test.txt"
        );
        assert_eq!(
            format!("{}", ZipError::DecompressionFailed),
            "Decompression failed"
        );
        assert_eq!(
            format!("{}", ZipError::UnsupportedCompression(99)),
            "Unsupported compression method: 99"
        );
        assert_eq!(format!("{}", ZipError::InvalidFormat), "Invalid ZIP format");
    }

    #[test]
    fn test_zip_error_to_parse_error_detail() {
        let error: ParseErrorDetail = ZipError::InvalidArchive.into();
        assert_eq!(error.code, ErrorCode::InvalidArchive);

        let error: ParseErrorDetail = ZipError::FileNotFound("test.xml".to_string()).into();
        assert_eq!(error.code, ErrorCode::MissingPart);

        let error: ParseErrorDetail = ZipError::DecompressionFailed.into();
        assert_eq!(error.code, ErrorCode::CorruptedArchive);

        let error: ParseErrorDetail = ZipError::UnsupportedCompression(99).into();
        assert_eq!(error.code, ErrorCode::UnsupportedFeature);

        let error: ParseErrorDetail = ZipError::DataCorruption.into();
        assert_eq!(error.code, ErrorCode::DataCorruption);

        let error: ParseErrorDetail = ZipError::UnexpectedEof.into();
        assert_eq!(error.code, ErrorCode::TruncatedFile);
    }
}
