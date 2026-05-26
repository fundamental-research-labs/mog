//! Error type for XLSX write operations.

/// Errors that can occur during XLSX write/export.
#[derive(Debug)]
pub enum WriteError {
    /// Failed to deserialize the input JSON.
    Deserialization(String),
    /// ZIP archive creation failed.
    Zip(String),
    /// Exported package violates OPC relationship/content integrity.
    PackageIntegrity(String),
    /// General I/O error.
    Io(String),
}

impl std::fmt::Display for WriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WriteError::Deserialization(msg) => write!(f, "Deserialization error: {}", msg),
            WriteError::Zip(msg) => write!(f, "ZIP error: {}", msg),
            WriteError::PackageIntegrity(msg) => write!(f, "Package integrity error: {}", msg),
            WriteError::Io(msg) => write!(f, "I/O error: {}", msg),
        }
    }
}

impl std::error::Error for WriteError {}

impl From<super::zip_writer::ZipWriteError> for WriteError {
    fn from(e: super::zip_writer::ZipWriteError) -> Self {
        WriteError::Zip(e.to_string())
    }
}
