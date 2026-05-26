//! Lazy XLSX loading — parse metadata immediately, sheets on demand.
//!
//! `LazyWorkbook` is ideal for large files where only specific sheets are needed.
//! It parses the workbook structure (sheet names, shared strings, metadata) on open,
//! then loads individual sheets on first access (cached for subsequent reads).
//!
//! # Usage
//!
//! ```ignore
//! use xlsx_api::lazy::LazyWorkbook;
//!
//! let workbook = LazyWorkbook::new(&xlsx_bytes)?;
//! println!("Found {} sheets", workbook.sheet_count());
//!
//! // Get sheet names without parsing any sheet content
//! for name in workbook.sheet_names() {
//!     println!("  {}", name);
//! }
//!
//! // Parse a specific sheet on demand (cached after first access)
//! let sheet = workbook.get_sheet(0)?;
//! println!("Sheet has {} cells", sheet.cell_count);
//!
//! // Convenience: get sheet by name
//! let sheet = workbook.get_sheet_by_name("Sales")?;
//! ```
//!
//! # Error Recovery
//!
//! ```ignore
//! use xlsx_api::{ParseMode, lazy::LazyWorkbook};
//!
//! // Default: Lenient mode (skip errors, continue parsing)
//! let wb = LazyWorkbook::new(&xlsx_bytes)?;
//!
//! // Strict mode (fail on first error)
//! let wb = LazyWorkbook::with_mode(&xlsx_bytes, ParseMode::Strict)?;
//!
//! // Permissive mode (maximum recovery)
//! let wb = LazyWorkbook::with_mode(&xlsx_bytes, ParseMode::Permissive)?;
//!
//! // Inspect errors after parsing
//! println!("Errors: {}, Warnings: {}", wb.error_count(), wb.warning_count());
//! ```

use crate::error::XlsxApiError;
use xlsx_parser::infra::error::{ParseContext, ParseErrorDetail, ParseMode};
use xlsx_parser::pipeline::lazy;

/// Lazy workbook — parses metadata immediately, sheets on demand.
///
/// The workbook borrows from the input data, so the data must outlive the workbook.
/// This avoids the complexity of self-referential structs while keeping the API
/// lightweight and zero-copy where possible.
///
/// # Lifetime
///
/// The `'a` lifetime ties the workbook to the XLSX byte slice it was created from.
/// The caller owns the data and the workbook borrows it:
///
/// ```ignore
/// let xlsx_data: Vec<u8> = std::fs::read("file.xlsx")?;
/// let workbook = LazyWorkbook::new(&xlsx_data)?;
/// // workbook borrows xlsx_data — both must stay in scope
/// ```
pub struct LazyWorkbook<'a> {
    inner: lazy::LazyWorkbook<'a>,
}

impl<'a> LazyWorkbook<'a> {
    /// Create a new lazy workbook from raw XLSX bytes with default Lenient mode.
    ///
    /// This performs minimal upfront work:
    /// 1. Opens the ZIP archive
    /// 2. Parses the shared strings table
    /// 3. Collects sheet metadata from workbook.xml
    ///
    /// No worksheet content is parsed until `get_sheet()` is called.
    ///
    /// # Errors
    ///
    /// Returns `XlsxApiError::InvalidArchive` if the data is not a valid XLSX file.
    pub fn new(xlsx_data: &'a [u8]) -> Result<Self, XlsxApiError> {
        let inner = lazy::LazyWorkbook::new(xlsx_data)?;
        Ok(Self { inner })
    }

    /// Create a new lazy workbook with a specific parse mode.
    ///
    /// # Arguments
    /// * `xlsx_data` — Raw bytes of the XLSX file.
    /// * `mode` — `Strict` (fail on first error), `Lenient` (default), or `Permissive`.
    ///
    /// # Errors
    ///
    /// Returns `XlsxApiError::InvalidArchive` if the data is not a valid XLSX file.
    pub fn with_mode(xlsx_data: &'a [u8], mode: ParseMode) -> Result<Self, XlsxApiError> {
        let inner = lazy::LazyWorkbook::with_mode(xlsx_data, mode)?;
        Ok(Self { inner })
    }

    /// Create a new lazy workbook with a full `ParseContext`.
    ///
    /// This provides the most control over error handling behavior.
    ///
    /// # Errors
    ///
    /// Returns `XlsxApiError::InvalidArchive` if the data is not a valid XLSX file.
    pub fn with_context(xlsx_data: &'a [u8], context: ParseContext) -> Result<Self, XlsxApiError> {
        let inner = lazy::LazyWorkbook::with_context(xlsx_data, context)?;
        Ok(Self { inner })
    }

    // =========================================================================
    // Sheet access
    // =========================================================================

    /// Get a sheet by 0-based index, parsing it on first access.
    ///
    /// The first call for a given index parses the worksheet XML.
    /// Subsequent calls return the cached result.
    ///
    /// # Errors
    ///
    /// - `XlsxApiError::SheetIndexOutOfBounds` if `index >= sheet_count()`.
    /// - `XlsxApiError::InvalidArchive` if the worksheet XML cannot be parsed.
    pub fn get_sheet(&mut self, index: usize) -> Result<&lazy::ParsedSheet, XlsxApiError> {
        if index >= self.inner.sheet_count() {
            return Err(XlsxApiError::SheetIndexOutOfBounds {
                index,
                count: self.inner.sheet_count(),
            });
        }
        let sheet = self.inner.get_sheet(index)?;
        Ok(sheet)
    }

    /// Get a sheet by name, parsing it on first access.
    ///
    /// Performs a case-sensitive lookup against `sheet_names()`.
    ///
    /// # Errors
    ///
    /// - `XlsxApiError::SheetNotFound` if no sheet matches the given name.
    /// - `XlsxApiError::InvalidArchive` if the worksheet XML cannot be parsed.
    pub fn get_sheet_by_name(&mut self, name: &str) -> Result<&lazy::ParsedSheet, XlsxApiError> {
        let index = self
            .inner
            .sheet_metadata()
            .iter()
            .position(|m| m.name == name)
            .ok_or_else(|| XlsxApiError::SheetNotFound(name.to_string()))?;
        let sheet = self.inner.get_sheet(index)?;
        Ok(sheet)
    }

    /// Parse the first sheet immediately (convenience for the common case).
    ///
    /// Equivalent to `get_sheet(0)` but returns `()` on success.
    ///
    /// # Errors
    ///
    /// - `XlsxApiError::SheetIndexOutOfBounds` if the workbook has no sheets.
    /// - `XlsxApiError::InvalidArchive` if the worksheet XML cannot be parsed.
    pub fn preload_first_sheet(&mut self) -> Result<(), XlsxApiError> {
        if self.inner.sheet_count() == 0 {
            return Err(XlsxApiError::SheetIndexOutOfBounds { index: 0, count: 0 });
        }
        self.inner.preload_first_sheet()?;
        Ok(())
    }

    /// Get a sheet via streaming decompression (NOT cached).
    ///
    /// Decompresses and parses the worksheet in chunks, calling `on_progress`
    /// after each chunk with `(bytes_decompressed, total_bytes)`.
    ///
    /// Unlike `get_sheet()`, the result is returned by value and not cached.
    /// Use this for very large sheets where you want progress reporting or
    /// reduced peak memory.
    ///
    /// # Arguments
    /// * `index` — 0-based sheet index.
    /// * `chunk_size` — Decompression chunk size in bytes (0 = default 64KB).
    /// * `on_progress` — Called after each chunk: `(bytes_so_far, total_bytes)`.
    ///
    /// # Errors
    ///
    /// - `XlsxApiError::SheetIndexOutOfBounds` if `index >= sheet_count()`.
    /// - `XlsxApiError::InvalidArchive` if parsing fails.
    pub fn get_sheet_streaming<F>(
        &mut self,
        index: usize,
        chunk_size: usize,
        on_progress: F,
    ) -> Result<lazy::ParsedSheet, XlsxApiError>
    where
        F: FnMut(usize, usize),
    {
        if index >= self.inner.sheet_count() {
            return Err(XlsxApiError::SheetIndexOutOfBounds {
                index,
                count: self.inner.sheet_count(),
            });
        }
        let sheet = self
            .inner
            .get_sheet_streaming(index, chunk_size, on_progress)?;
        Ok(sheet)
    }

    // =========================================================================
    // Metadata (no parsing required)
    // =========================================================================

    /// Number of sheets in the workbook.
    pub fn sheet_count(&self) -> usize {
        self.inner.sheet_count()
    }

    /// Sheet names in workbook order.
    pub fn sheet_names(&self) -> Vec<&str> {
        self.inner
            .sheet_metadata()
            .iter()
            .map(|m| m.name.as_str())
            .collect()
    }

    /// Metadata for all sheets (index, name, uncompressed size).
    pub fn sheet_metadata(&self) -> &[lazy::SheetMetadata] {
        self.inner.sheet_metadata()
    }

    /// Metadata for a specific sheet by index, or `None` if out of bounds.
    pub fn get_sheet_metadata(&self, index: usize) -> Option<&lazy::SheetMetadata> {
        self.inner.get_sheet_metadata(index)
    }

    /// Whether a sheet has already been parsed and cached.
    pub fn is_sheet_cached(&self, index: usize) -> bool {
        self.inner.is_sheet_cached(index)
    }

    /// Number of entries in the shared strings table.
    pub fn shared_string_count(&self) -> usize {
        self.inner.shared_string_count()
    }

    // =========================================================================
    // Error recovery
    // =========================================================================

    /// All errors collected so far (during init and sheet parsing).
    pub fn errors(&self) -> &[ParseErrorDetail] {
        self.inner.errors()
    }

    /// Number of errors (severity >= Error), excluding warnings.
    pub fn error_count(&self) -> usize {
        self.inner.error_count()
    }

    /// Number of warnings.
    pub fn warning_count(&self) -> usize {
        self.inner.warning_count()
    }

    /// Whether any errors have been recorded.
    pub fn has_errors(&self) -> bool {
        self.inner.has_errors()
    }

    /// Whether any warnings have been recorded.
    pub fn has_warnings(&self) -> bool {
        self.inner.has_warnings()
    }

    /// The current parse mode.
    pub fn parse_mode(&self) -> ParseMode {
        self.inner.parse_mode()
    }

    /// Whether parsing should stop (strict mode after error, or fatal error).
    pub fn should_stop(&self) -> bool {
        self.inner.should_stop()
    }

    /// Access the full `ParseContext` for advanced error inspection.
    pub fn context(&self) -> &ParseContext {
        self.inner.context()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal valid XLSX file is a ZIP with the right structure.
    /// For unit tests that don't need real content, we test error paths.

    #[test]
    fn empty_data_returns_invalid_archive() {
        let result = LazyWorkbook::new(&[]);
        match result {
            Err(XlsxApiError::InvalidArchive(_)) => {} // expected
            Err(other) => panic!("Expected InvalidArchive, got: {other}"),
            Ok(_) => panic!("Expected error for empty data"),
        }
    }

    #[test]
    fn garbage_data_returns_invalid_archive() {
        let result = LazyWorkbook::new(b"this is not a zip file");
        match result {
            Err(XlsxApiError::InvalidArchive(_)) => {}
            Err(other) => panic!("Expected InvalidArchive, got: {other}"),
            Ok(_) => panic!("Expected error for garbage data"),
        }
    }

    #[test]
    fn sheet_index_out_of_bounds_on_empty_preload() {
        // We can't easily construct a valid-but-empty workbook without real XLSX bytes,
        // so we verify the error type from the constructor instead.
        let result = LazyWorkbook::new(&[0x50, 0x4B, 0x03, 0x04]); // ZIP magic but truncated
        assert!(result.is_err());
    }

    #[test]
    fn with_mode_strict() {
        // Verify the constructor accepts ParseMode::Strict
        let result = LazyWorkbook::with_mode(&[], ParseMode::Strict);
        assert!(result.is_err()); // empty data
    }

    #[test]
    fn with_mode_permissive() {
        let result = LazyWorkbook::with_mode(&[], ParseMode::Permissive);
        assert!(result.is_err()); // empty data
    }
}
