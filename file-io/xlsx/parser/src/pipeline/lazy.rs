//! Lazy sheet loading for XLSX files
//!
//! This module provides on-demand parsing of worksheets to minimize initial load time.
//! Instead of parsing all sheets upfront, only sheet metadata is collected during
//! initialization. Individual sheets are parsed only when requested, with results
//! cached for subsequent accesses.
//!
//! # Performance Goal
//! Reduce time-to-first-cell from ~50ms to <5ms by deferring sheet parsing.
//!
//! # Usage
//! ```ignore
//! use xlsx_parser::lazy::LazyWorkbook;
//!
//! let workbook = LazyWorkbook::new(xlsx_bytes)?;
//!
//! // Parse first sheet immediately if needed
//! workbook.preload_first_sheet()?;
//!
//! // Or get sheets on-demand
//! let sheet = workbook.get_sheet(0)?;
//! println!("Sheet has {} cells", sheet.cell_count);
//! ```
//!
//! # Error Recovery
//!
//! LazyWorkbook supports different parse modes for error handling:
//!
//! ```ignore
//! use xlsx_parser::lazy::LazyWorkbook;
//! use xlsx_parser::ParseMode;
//!
//! // Default: Lenient mode (skip errors, continue parsing)
//! let workbook = LazyWorkbook::new(xlsx_bytes)?;
//!
//! // Strict mode (fail on first error)
//! let workbook = LazyWorkbook::with_mode(xlsx_bytes, ParseMode::Strict)?;
//!
//! // Permissive mode (maximum recovery)
//! let workbook = LazyWorkbook::with_mode(xlsx_bytes, ParseMode::Permissive)?;
//!
//! // Access errors after parsing
//! println!("Errors: {}, Warnings: {}", workbook.error_count(), workbook.warning_count());
//! ```

use std::collections::HashMap;

use crate::domain::strings::read::SharedStrings;
use crate::infra::error::{ParseContext, ParseErrorDetail, ParseMode};
use crate::zip::XlsxArchive;

mod cells;
mod eager;
mod features;
mod format;
mod init;
mod limits;
mod streaming_sheet;
mod types;

pub use types::{ParseError, ParsedSheet, SheetMetadata};

/// Lazy-loading workbook that parses sheets on demand
///
/// This struct holds the XLSX archive data and shared strings, deferring
/// worksheet parsing until sheets are explicitly requested. Parsed sheets
/// are cached for subsequent accesses.
///
/// # Error Recovery
///
/// The workbook supports different parse modes that control error handling:
///
/// - **Strict**: Fail on first error - useful for validation
/// - **Lenient** (default): Skip items with errors, continue parsing, collect warnings
/// - **Permissive**: Maximum recovery, ignore most errors - useful for data recovery
///
/// Use `with_mode()` or `with_context()` to specify the parse mode.
pub struct LazyWorkbook<'a> {
    /// The underlying ZIP archive
    archive: XlsxArchive<'a>,
    /// Shared strings table (parsed once upfront)
    shared_strings: SharedStrings,
    /// Pre-computed shared string references for fast parsing
    shared_string_refs: Vec<String>,
    /// Metadata for each sheet (names, sizes)
    sheet_metadata: Vec<SheetMetadata>,
    /// Cache of already-parsed sheets (keyed by 0-based index)
    parsed_sheets: HashMap<usize, ParsedSheet>,
    /// Error recovery context
    context: ParseContext,
}

impl<'a> LazyWorkbook<'a> {
    /// Create a new LazyWorkbook from raw XLSX bytes with default Lenient mode
    ///
    /// This performs minimal parsing:
    /// 1. Opens the ZIP archive
    /// 2. Parses the shared strings table (required for all sheets)
    /// 3. Collects sheet metadata from workbook.xml
    ///
    /// No worksheet content is parsed at this stage.
    pub fn new(xlsx_data: &'a [u8]) -> Result<Self, ParseError> {
        Self::with_context(xlsx_data, ParseContext::lenient())
    }

    /// Create a new LazyWorkbook with a specific parse mode
    pub fn with_mode(xlsx_data: &'a [u8], mode: ParseMode) -> Result<Self, ParseError> {
        Self::with_context(xlsx_data, ParseContext::new(mode))
    }

    /// Create a new LazyWorkbook with a full ParseContext
    pub fn with_context(xlsx_data: &'a [u8], context: ParseContext) -> Result<Self, ParseError> {
        let parts = init::initialize_workbook(xlsx_data, context)?;
        Ok(Self {
            archive: parts.archive,
            shared_strings: parts.shared_strings,
            shared_string_refs: parts.shared_string_refs,
            sheet_metadata: parts.sheet_metadata,
            parsed_sheets: parts.parsed_sheets,
            context: parts.context,
        })
    }

    /// Get a sheet by index, parsing it if not already cached
    pub fn get_sheet(&mut self, index: usize) -> Result<&ParsedSheet, ParseError> {
        if self.should_stop() {
            return Err(ParseError::ParseFailed(
                "Parsing stopped due to previous errors".to_string(),
            ));
        }

        if self.parsed_sheets.contains_key(&index) {
            return Ok(self.parsed_sheets.get(&index).unwrap());
        }

        if index >= self.sheet_metadata.len() {
            return Err(ParseError::SheetNotFound(index));
        }

        let parsed = eager::parse_sheet_internal(self, index)?;
        self.parsed_sheets.insert(index, parsed);
        Ok(self.parsed_sheets.get(&index).unwrap())
    }

    /// Parse a worksheet using streaming decompression.
    ///
    /// Unlike `get_sheet()`, this method does NOT cache the result.
    pub fn get_sheet_streaming<F>(
        &mut self,
        index: usize,
        chunk_size: usize,
        on_progress: F,
    ) -> Result<ParsedSheet, ParseError>
    where
        F: FnMut(usize, usize),
    {
        streaming_sheet::get_sheet_streaming(self, index, chunk_size, on_progress)
    }

    /// Convenience method to parse the first sheet immediately
    pub fn preload_first_sheet(&mut self) -> Result<(), ParseError> {
        if self.sheet_metadata.is_empty() {
            return Err(ParseError::SheetNotFound(0));
        }
        self.get_sheet(0)?;
        Ok(())
    }

    /// Get the number of sheets in the workbook
    pub fn sheet_count(&self) -> usize {
        self.sheet_metadata.len()
    }

    /// Get metadata for all sheets
    pub fn sheet_metadata(&self) -> &[SheetMetadata] {
        &self.sheet_metadata
    }

    /// Get metadata for a specific sheet
    pub fn get_sheet_metadata(&self, index: usize) -> Option<&SheetMetadata> {
        self.sheet_metadata.get(index)
    }

    /// Check if a sheet has been parsed and cached
    pub fn is_sheet_cached(&self, index: usize) -> bool {
        self.parsed_sheets.contains_key(&index)
    }

    /// Get the number of shared strings in the workbook
    pub fn shared_string_count(&self) -> usize {
        self.shared_strings.len()
    }

    /// Get access to the underlying archive
    pub fn archive(&self) -> &XlsxArchive<'a> {
        &self.archive
    }

    /// Get all errors collected so far
    pub fn errors(&self) -> &[ParseErrorDetail] {
        self.context.errors()
    }

    /// Get the total error count (excluding warnings)
    pub fn error_count(&self) -> usize {
        self.context.error_count()
    }

    /// Get the total warning count
    pub fn warning_count(&self) -> usize {
        self.context.warning_count()
    }

    /// Get the current parse mode
    pub fn parse_mode(&self) -> ParseMode {
        self.context.mode
    }

    /// Check if parsing should stop due to fatal error or strict mode error
    pub fn should_stop(&self) -> bool {
        self.context.should_stop()
    }

    /// Get access to the full ParseContext
    pub fn context(&self) -> &ParseContext {
        &self.context
    }

    /// Check if any errors have been recorded
    pub fn has_errors(&self) -> bool {
        self.context.error_count() > 0
    }

    /// Check if any warnings have been recorded
    pub fn has_warnings(&self) -> bool {
        self.context.warning_count() > 0
    }
}
