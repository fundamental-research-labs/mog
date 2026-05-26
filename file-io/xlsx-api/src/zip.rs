//! OOXML ZIP archive utilities — read and write XLSX archive structure.
//!
//! Thin wrappers over the parser's ZIP infrastructure, providing clean
//! error handling via `XlsxApiError`.

use crate::error::XlsxApiError;

/// Read-only access to an OOXML (XLSX) ZIP archive.
///
/// Wraps the parser's `XlsxArchive` with `XlsxApiError` error types.
pub struct OoxmlArchive<'a> {
    inner: xlsx_parser::XlsxArchive<'a>,
}

impl<'a> OoxmlArchive<'a> {
    /// Open a ZIP archive from raw bytes.
    pub fn open(data: &'a [u8]) -> Result<Self, XlsxApiError> {
        let inner = xlsx_parser::XlsxArchive::new(data)?;
        Ok(Self { inner })
    }

    /// List all entry (file) names in the archive.
    pub fn entry_names(&self) -> Vec<&str> {
        self.inner
            .entries()
            .iter()
            .map(|e| e.name.as_str())
            .collect()
    }

    /// Read the contents of an entry by its path within the archive.
    pub fn read_entry(&self, path: &str) -> Result<Vec<u8>, XlsxApiError> {
        self.inner
            .read_file(path)
            .map_err(|e| XlsxApiError::Zip(e.to_string()))
    }

    /// Number of entries in the archive.
    pub fn entry_count(&self) -> usize {
        self.inner.entries().len()
    }

    /// Number of worksheets detected.
    pub fn worksheet_count(&self) -> usize {
        self.inner.worksheet_count()
    }
}

/// OOXML ZIP archive writer.
///
/// Wraps the parser's `ZipWriter` for creating XLSX archives.
pub struct OoxmlWriter {
    inner: xlsx_parser::ZipWriter,
}

impl Default for OoxmlWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl OoxmlWriter {
    /// Create a new writer with default compression (Deflate level 6).
    pub fn new() -> Self {
        Self {
            inner: xlsx_parser::ZipWriter::new(),
        }
    }

    /// Create a new writer with the specified compression method.
    pub fn with_compression(method: xlsx_parser::CompressionMethod) -> Self {
        Self {
            inner: xlsx_parser::ZipWriter::with_compression(method),
        }
    }

    /// Add a file to the archive.
    pub fn add_file(&mut self, path: &str, data: Vec<u8>) -> &mut Self {
        self.inner.add_file(path, data);
        self
    }

    /// Finalize the archive and return the ZIP bytes.
    pub fn finish(self) -> Result<Vec<u8>, XlsxApiError> {
        self.inner
            .finish()
            .map_err(|e| XlsxApiError::Zip(e.to_string()))
    }
}
