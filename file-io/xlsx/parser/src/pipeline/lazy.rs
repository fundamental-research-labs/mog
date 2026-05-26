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

use crate::common::range::{ColWidth, MergeRange, RowHeight, SheetPane};
use crate::domain::cells::{CellData, parse_worksheet_fast};
use crate::domain::cond_format::read::parse_conditional_formats;
use crate::domain::controls::read::FormControl;
use crate::domain::strings::read::SharedStrings;
use crate::domain::validation::read::parse_data_validations;
use crate::domain::workbook::read::parse_workbook;
use crate::domain::worksheet::read::{
    parse_dimensions, parse_frozen_pane, parse_merge_cells, parse_sheet_views,
};
use crate::infra::error::{
    ErrorCode, ErrorLocation, ErrorSeverity, ParseContext, ParseErrorDetail, ParseMode,
};
use crate::output::results::{CfSummary, DvSummary, HyperlinkOutput, ProtectionOutput};
use crate::zip::constants::{MAX_MERGES, MAX_SHARED_STRINGS, MAX_VALIDATIONS, MAX_WORKSHEET_CELLS};
use crate::zip::{XlsxArchive, ZipError};

fn count_worksheet_cell_elements(xml: &[u8]) -> usize {
    let mut count = 0usize;
    let mut pos = 0usize;
    while let Some(rel) = memchr::memmem::find(&xml[pos..], b"<c") {
        let start = pos + rel;
        let next = start + 2;
        if next >= xml.len() || matches!(xml[next], b' ' | b'>' | b'/' | b'\t' | b'\n' | b'\r') {
            count += 1;
        }
        pos = next;
    }
    count
}

fn ensure_lazy_limit(label: &str, count: usize, limit: usize) -> Result<(), ParseError> {
    if count > limit {
        Err(ParseError::ParseFailed(format!(
            "{label} count {count} exceeds XLSX parser safety limit {limit}"
        )))
    } else {
        Ok(())
    }
}

/// Error types for lazy workbook operations
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    /// The XLSX archive is invalid or corrupted
    InvalidArchive(String),
    /// The requested sheet index was not found
    SheetNotFound(usize),
    /// Parsing the worksheet failed
    ParseFailed(String),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::InvalidArchive(msg) => write!(f, "Invalid archive: {}", msg),
            ParseError::SheetNotFound(idx) => write!(f, "Sheet not found at index: {}", idx),
            ParseError::ParseFailed(msg) => write!(f, "Parse failed: {}", msg),
        }
    }
}

impl std::error::Error for ParseError {}

/// Metadata for a worksheet without parsing its contents
#[derive(Debug, Clone)]
pub struct SheetMetadata {
    /// 0-based index of the sheet in the workbook
    pub sheet_idx: usize,
    /// Display name of the sheet (from workbook.xml)
    pub name: String,
    /// Uncompressed size of the worksheet XML in bytes (for buffer allocation hints)
    pub uncompressed_size: usize,
}

impl SheetMetadata {
    /// Create new sheet metadata
    pub fn new(sheet_idx: usize, name: String, uncompressed_size: usize) -> Self {
        Self {
            sheet_idx,
            name,
            uncompressed_size,
        }
    }
}

/// Parsed worksheet data
#[derive(Debug, Clone)]
pub struct ParsedSheet {
    /// Cell data parsed from the worksheet
    pub cells: Vec<CellData>,
    /// String buffer containing cell string values
    pub strings: Vec<u8>,
    /// Total number of cells in this sheet
    pub cell_count: usize,
    /// Number of cells that failed to parse and were skipped
    pub cells_skipped: usize,
    /// Errors encountered during parsing of this sheet
    pub errors: Vec<ParseErrorDetail>,

    // === Additional worksheet features ===
    /// Merge ranges in this sheet
    pub merges: Vec<MergeRange>,
    /// Conditional formatting rules
    pub conditional_formats: Vec<CfSummary>,
    /// Data validations
    pub data_validations: Vec<DvSummary>,
    /// Hyperlinks
    pub hyperlinks: Vec<HyperlinkOutput>,
    /// Sheet protection settings
    pub protection: Option<ProtectionOutput>,
    /// Print settings (structured output)
    pub print_settings: Option<crate::output::results::PrintSettingsOutput>,
    /// Page breaks
    pub page_breaks: Option<crate::output::results::PageBreaksOutput>,
    /// Sheet view options (canonical OOXML SheetView).
    /// Multiple `<sheetView>` elements are preserved for round-trip fidelity.
    pub view_options: Vec<ooxml_types::worksheet::SheetView>,
    /// Column widths
    pub col_widths: Vec<ColWidth>,
    /// Row heights
    pub row_heights: Vec<RowHeight>,
    /// Frozen pane settings
    pub frozen_pane: Option<SheetPane>,
    /// Form controls (checkboxes, dropdowns, buttons, etc.)
    pub form_controls: Vec<FormControl>,
}

impl ParsedSheet {
    /// Create a new empty parsed sheet
    pub fn new() -> Self {
        Self {
            cells: Vec::new(),
            strings: Vec::new(),
            cell_count: 0,
            cells_skipped: 0,
            errors: Vec::new(),
            // Additional features - initialized empty
            merges: Vec::new(),
            conditional_formats: Vec::new(),
            data_validations: Vec::new(),
            hyperlinks: Vec::new(),
            protection: None,
            print_settings: None,
            page_breaks: None,
            view_options: Vec::new(),
            col_widths: Vec::new(),
            row_heights: Vec::new(),
            frozen_pane: None,
            form_controls: Vec::new(),
        }
    }

    /// Create a parsed sheet with the given capacity
    pub fn with_capacity(cell_capacity: usize, string_capacity: usize) -> Self {
        Self {
            cells: Vec::with_capacity(cell_capacity),
            strings: Vec::with_capacity(string_capacity),
            cell_count: 0,
            cells_skipped: 0,
            errors: Vec::new(),
            // Additional features - initialized empty
            merges: Vec::new(),
            conditional_formats: Vec::new(),
            data_validations: Vec::new(),
            hyperlinks: Vec::new(),
            protection: None,
            print_settings: None,
            page_breaks: None,
            view_options: Vec::new(),
            col_widths: Vec::new(),
            row_heights: Vec::new(),
            frozen_pane: None,
            form_controls: Vec::new(),
        }
    }

    /// Check if there were any errors during parsing
    pub fn has_errors(&self) -> bool {
        !self.errors.is_empty()
    }

    /// Get the number of errors (excluding warnings)
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
}

impl Default for ParsedSheet {
    fn default() -> Self {
        Self::new()
    }
}

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
    ///
    /// # Arguments
    /// * `xlsx_data` - Raw bytes of the XLSX file
    ///
    /// # Returns
    /// * `Ok(LazyWorkbook)` - Successfully initialized workbook
    /// * `Err(ParseError)` - Archive is invalid or required files are missing
    ///
    /// # Example
    /// ```ignore
    /// let workbook = LazyWorkbook::new(&xlsx_bytes)?;
    /// println!("Found {} sheets", workbook.sheet_count());
    /// ```
    pub fn new(xlsx_data: &'a [u8]) -> Result<Self, ParseError> {
        Self::with_context(xlsx_data, ParseContext::lenient())
    }

    /// Create a new LazyWorkbook with a specific parse mode
    ///
    /// # Arguments
    /// * `xlsx_data` - Raw bytes of the XLSX file
    /// * `mode` - The parse mode (Strict, Lenient, or Permissive)
    ///
    /// # Returns
    /// * `Ok(LazyWorkbook)` - Successfully initialized workbook
    /// * `Err(ParseError)` - Archive is invalid or required files are missing
    ///
    /// # Example
    /// ```ignore
    /// use xlsx_parser::ParseMode;
    ///
    /// // Create with strict mode for validation
    /// let workbook = LazyWorkbook::with_mode(&xlsx_bytes, ParseMode::Strict)?;
    ///
    /// // Create with permissive mode for data recovery
    /// let workbook = LazyWorkbook::with_mode(&xlsx_bytes, ParseMode::Permissive)?;
    /// ```
    pub fn with_mode(xlsx_data: &'a [u8], mode: ParseMode) -> Result<Self, ParseError> {
        Self::with_context(xlsx_data, ParseContext::new(mode))
    }

    /// Create a new LazyWorkbook with a full ParseContext
    ///
    /// This provides the most control over error handling behavior.
    ///
    /// # Arguments
    /// * `xlsx_data` - Raw bytes of the XLSX file
    /// * `context` - The parse context with mode and error collector
    ///
    /// # Returns
    /// * `Ok(LazyWorkbook)` - Successfully initialized workbook
    /// * `Err(ParseError)` - Archive is invalid or required files are missing
    ///
    /// # Example
    /// ```ignore
    /// use xlsx_parser::{ParseContext, ParseMode};
    ///
    /// let mut context = ParseContext::new(ParseMode::Lenient);
    /// context.set_current_part("initialization");
    /// let workbook = LazyWorkbook::with_context(&xlsx_bytes, context)?;
    /// ```
    pub fn with_context(
        xlsx_data: &'a [u8],
        mut context: ParseContext,
    ) -> Result<Self, ParseError> {
        context.set_current_part("initialization");

        // Validate input
        if xlsx_data.is_empty() {
            return Err(ParseError::InvalidArchive("Empty XLSX data".to_string()));
        }

        // Verify ZIP signature
        if xlsx_data.len() < 4 || &xlsx_data[0..4] != b"PK\x03\x04" {
            return Err(ParseError::InvalidArchive(
                "Not a valid ZIP archive".to_string(),
            ));
        }

        // Open the archive
        let archive = XlsxArchive::new(xlsx_data)
            .map_err(|e| ParseError::InvalidArchive(format!("Failed to open archive: {}", e)))?;

        // Parse shared strings (this is required for all sheets)
        context.set_current_part("xl/sharedStrings.xml");
        let shared_strings_xml = match archive.get_shared_strings() {
            Ok(xml) => xml,
            Err(ZipError::FileNotFound(_)) => Vec::new(),
            Err(e) => {
                return Err(ParseError::ParseFailed(format!(
                    "Failed to read xl/sharedStrings.xml: {}",
                    e
                )));
            }
        };
        let mut shared_strings = SharedStrings::parse(shared_strings_xml);

        // Pre-compute shared string references for fast parsing
        let string_count = shared_strings.len();
        ensure_lazy_limit("shared string", string_count, MAX_SHARED_STRINGS)?;
        let mut shared_string_refs: Vec<String> = Vec::with_capacity(string_count);
        for i in 0..string_count {
            let bytes = shared_strings.get(i);
            let s = std::str::from_utf8(bytes).map_err(|err| {
                ParseError::ParseFailed(format!(
                    "xl/sharedStrings.xml contains malformed UTF-8 in shared string {} at byte {}",
                    i,
                    err.valid_up_to()
                ))
            })?;
            shared_string_refs.push(s.to_owned());
        }

        // Collect sheet metadata from workbook.xml
        context.set_current_part("xl/workbook.xml");
        let sheet_metadata = Self::collect_sheet_metadata(&archive)?;

        Ok(Self {
            archive,
            shared_strings,
            shared_string_refs,
            sheet_metadata,
            parsed_sheets: HashMap::new(),
            context,
        })
    }

    /// Collect metadata for all sheets without parsing their contents
    fn collect_sheet_metadata(archive: &XlsxArchive<'a>) -> Result<Vec<SheetMetadata>, ParseError> {
        let mut metadata = Vec::new();

        // Try to parse workbook.xml for sheet names
        let sheet_names: Vec<String> = if let Ok(workbook_xml) = archive.get_workbook() {
            let sheets = parse_workbook(&workbook_xml);
            sheets.into_iter().map(|s| s.name).collect()
        } else {
            Vec::new()
        };

        // Collect metadata for each worksheet in the archive
        let worksheet_count = archive.worksheet_count();

        for i in 0..worksheet_count {
            let sheet_num = i + 1; // Worksheets are 1-indexed in the archive
            let sheet_path = format!("xl/worksheets/sheet{}.xml", sheet_num);

            // Get uncompressed size from archive entry if available
            let uncompressed_size = archive
                .find_entry(&sheet_path)
                .map(|e| e.uncompressed_size)
                .unwrap_or(0);

            // Use sheet name from workbook.xml if available, otherwise generate default name
            let name = sheet_names
                .get(i)
                .cloned()
                .unwrap_or_else(|| format!("Sheet{}", sheet_num));

            metadata.push(SheetMetadata::new(i, name, uncompressed_size));
        }

        Ok(metadata)
    }

    /// Get a sheet by index, parsing it if not already cached
    ///
    /// The first call for a given index will parse the worksheet XML.
    /// Subsequent calls return the cached result.
    ///
    /// # Arguments
    /// * `index` - 0-based sheet index
    ///
    /// # Returns
    /// * `Ok(&ParsedSheet)` - Reference to the parsed sheet data
    /// * `Err(ParseError)` - Sheet not found or parsing failed
    ///
    /// # Example
    /// ```ignore
    /// let sheet = workbook.get_sheet(0)?;
    /// for cell in &sheet.cells {
    ///     println!("Cell at ({}, {})", cell.row, cell.col);
    /// }
    /// ```
    pub fn get_sheet(&mut self, index: usize) -> Result<&ParsedSheet, ParseError> {
        // Check if we should stop due to previous errors
        if self.should_stop() {
            return Err(ParseError::ParseFailed(
                "Parsing stopped due to previous errors".to_string(),
            ));
        }

        // Check if sheet is already cached
        if self.parsed_sheets.contains_key(&index) {
            return Ok(self.parsed_sheets.get(&index).unwrap());
        }

        // Validate index
        if index >= self.sheet_metadata.len() {
            return Err(ParseError::SheetNotFound(index));
        }

        // Parse the sheet
        let parsed = self.parse_sheet_internal(index)?;

        // Cache and return
        self.parsed_sheets.insert(index, parsed);
        Ok(self.parsed_sheets.get(&index).unwrap())
    }

    /// Parse a worksheet by index (internal implementation)
    fn parse_sheet_internal(&mut self, index: usize) -> Result<ParsedSheet, ParseError> {
        let sheet_num = index + 1; // Worksheets are 1-indexed in the archive
        let sheet_path = format!("xl/worksheets/sheet{}.xml", sheet_num);

        // Set current part in context for error reporting
        self.context.set_current_part(&sheet_path);

        // Get worksheet XML
        let worksheet_xml = match self.archive.get_worksheet(sheet_num) {
            Ok(xml) => xml,
            Err(e) => {
                let error_msg = format!("Failed to read worksheet {}: {}", sheet_num, e);
                // Report the error through context
                let error = ParseErrorDetail::error(ErrorCode::MissingPart, &error_msg)
                    .with_location(ErrorLocation::new(&sheet_path));
                self.context.report_error_detail(error);

                // In strict mode, this is a fatal error; in lenient/permissive, return empty sheet
                if self.context.mode == ParseMode::Strict {
                    return Err(ParseError::ParseFailed(error_msg));
                } else {
                    // Return empty sheet with the error recorded
                    let mut parsed = ParsedSheet::new();
                    parsed.errors.push(
                        ParseErrorDetail::error(ErrorCode::MissingPart, &error_msg)
                            .with_location(ErrorLocation::new(&sheet_path)),
                    );
                    return Ok(parsed);
                }
            }
        };
        ensure_lazy_limit(
            "worksheet cell",
            count_worksheet_cell_elements(&worksheet_xml),
            MAX_WORKSHEET_CELLS,
        )?;

        // Estimate capacity based on uncompressed size
        let metadata = &self.sheet_metadata[index];
        let estimated_cells = (metadata.uncompressed_size / 50)
            .max(1000)
            .min(MAX_WORKSHEET_CELLS); // ~50 bytes per cell estimate
        let estimated_strings = metadata.uncompressed_size / 4; // ~25% string content estimate

        let mut parsed = ParsedSheet::with_capacity(estimated_cells, estimated_strings);

        // Allocate cells buffer
        let mut buffer_size = estimated_cells;
        parsed.cells.resize(buffer_size, CellData::default());

        // Build shared string refs for parsing
        let shared_string_refs: Vec<&str> =
            self.shared_string_refs.iter().map(|s| s.as_str()).collect();

        // Parse the worksheet
        // Note: parse_worksheet_fast doesn't currently report errors individually,
        // but we can track overall success and add error reporting later
        let mut row_heights_buf: Vec<RowHeight> = Vec::new();
        let mut cell_count = parse_worksheet_fast(
            &worksheet_xml,
            &shared_string_refs,
            &mut parsed.cells,
            &mut parsed.strings,
            &mut row_heights_buf,
            &[],
        );

        // If the buffer was completely filled, the parser may have truncated cells.
        // Retry with progressively larger buffers until all cells are captured.
        while cell_count == buffer_size {
            if buffer_size >= MAX_WORKSHEET_CELLS {
                return Err(ParseError::ParseFailed(format!(
                    "worksheet {} has more than {} cells",
                    sheet_num, MAX_WORKSHEET_CELLS
                )));
            }
            buffer_size = buffer_size.saturating_mul(2).min(MAX_WORKSHEET_CELLS);
            parsed.cells.resize(buffer_size, CellData::default());
            parsed.strings.clear();
            row_heights_buf.clear();

            cell_count = parse_worksheet_fast(
                &worksheet_xml,
                &shared_string_refs,
                &mut parsed.cells,
                &mut parsed.strings,
                &mut row_heights_buf,
                &[],
            );
        }

        // Truncate cells to actual count
        parsed.cells.truncate(cell_count);
        parsed.cell_count = cell_count;

        // Calculate cells_skipped based on estimated vs actual (rough heuristic)
        // This would be more accurate with detailed error tracking in parse_worksheet_fast
        let expected_cells = estimated_cells;
        if cell_count < expected_cells / 2 {
            // If we got significantly fewer cells than expected, report a warning
            let warning_msg = format!(
                "Sheet {} parsed {} cells (estimated {}); some cells may have been skipped",
                index, cell_count, expected_cells
            );
            self.context
                .report_warning(ErrorCode::InvalidCellValue, &warning_msg);
            parsed.errors.push(
                ParseErrorDetail::warning(ErrorCode::InvalidCellValue, &warning_msg)
                    .with_location(ErrorLocation::new(&sheet_path)),
            );
        }

        // =========================================================================
        // Parse additional worksheet features (reusing helpers from lib.rs)
        // =========================================================================

        // Parse merge cells
        parsed.merges = parse_merge_cells(&worksheet_xml);
        ensure_lazy_limit("merge", parsed.merges.len(), MAX_MERGES)?;

        // Parse conditional formatting (lazy pipeline only needs summaries)
        parsed.conditional_formats = parse_conditional_formats(&worksheet_xml).0;

        // Parse data validations
        let (dvs, _disable_prompts) = parse_data_validations(&worksheet_xml);
        ensure_lazy_limit("data validation", dvs.len(), MAX_VALIDATIONS)?;
        parsed.data_validations = dvs;

        // Parse hyperlinks
        parsed.hyperlinks = format_hyperlinks(&worksheet_xml);

        // Parse sheet protection
        parsed.protection = format_protection(&worksheet_xml);

        // Parse print settings
        let (ps, pb) = format_print_settings(&worksheet_xml);
        parsed.print_settings = ps;
        parsed.page_breaks = pb;

        // Parse frozen panes
        parsed.frozen_pane = parse_frozen_pane(&worksheet_xml);

        // Parse sheet view options
        parsed.view_options = parse_sheet_views(&worksheet_xml);

        // Parse column widths and row heights
        let (col_widths, row_heights) = parse_dimensions(&worksheet_xml);
        parsed.col_widths = col_widths;
        parsed.row_heights = row_heights;

        // Check if we should stop after this sheet (strict mode with errors)
        if self.should_stop() {
            parsed.errors.push(
                ParseErrorDetail::error(
                    ErrorCode::DataCorruption,
                    "Parsing stopped due to errors in strict mode",
                )
                .with_location(ErrorLocation::new(&sheet_path)),
            );
        }

        Ok(parsed)
    }

    /// Parse a worksheet using streaming decompression.
    ///
    /// This method decompresses and parses the worksheet in chunks, allowing
    /// progress reporting and yielding between chunks. This is useful for
    /// large worksheets where you want to:
    ///
    /// 1. Report progress during decompression
    /// 2. Avoid blocking the event loop (in async contexts)
    /// 3. Reduce peak memory usage
    ///
    /// Unlike `get_sheet()`, this method does NOT cache the result.
    ///
    /// # Arguments
    /// * `index` - 0-based sheet index
    /// * `chunk_size` - Size of decompression chunks (0 = default 64KB)
    /// * `on_progress` - Optional callback called after each chunk with (bytes_decompressed, total_bytes)
    ///
    /// # Returns
    /// * `Ok(ParsedSheet)` - The parsed sheet data (NOT cached)
    /// * `Err(ParseError)` - Sheet not found or parsing failed
    ///
    /// # Example
    /// ```ignore
    /// let sheet = workbook.get_sheet_streaming(0, 0, |decompressed, total| {
    ///     let progress = decompressed as f64 / total as f64 * 100.0;
    ///     println!("Decompression progress: {:.1}%", progress);
    /// })?;
    /// ```
    pub fn get_sheet_streaming<F>(
        &mut self,
        index: usize,
        chunk_size: usize,
        mut on_progress: F,
    ) -> Result<ParsedSheet, ParseError>
    where
        F: FnMut(usize, usize),
    {
        use crate::pipeline::streaming::{
            DEFAULT_BUFFER_SIZE, StreamingCellParser, StreamingDeflate,
        };
        use crate::zip::CompressedEntry;

        // Check if we should stop due to previous errors
        if self.should_stop() {
            return Err(ParseError::ParseFailed(
                "Parsing stopped due to previous errors".to_string(),
            ));
        }

        // Validate index
        if index >= self.sheet_metadata.len() {
            return Err(ParseError::SheetNotFound(index));
        }

        let sheet_num = index + 1;
        let sheet_path = format!("xl/worksheets/sheet{}.xml", sheet_num);
        self.context.set_current_part(&sheet_path);

        // Get compressed data
        let compressed_entry: CompressedEntry =
            match self.archive.get_worksheet_compressed(sheet_num) {
                Ok(entry) => entry,
                Err(e) => {
                    let error_msg =
                        format!("Failed to get compressed worksheet {}: {}", sheet_num, e);
                    return Err(ParseError::ParseFailed(error_msg));
                }
            };

        let metadata = &self.sheet_metadata[index];
        let estimated_cells = (metadata.uncompressed_size / 50)
            .max(1000)
            .min(MAX_WORKSHEET_CELLS);
        let estimated_strings = metadata.uncompressed_size / 4;

        let mut parsed = ParsedSheet::with_capacity(estimated_cells, estimated_strings);

        // Build shared string refs for parsing
        let shared_string_refs: Vec<&str> =
            self.shared_string_refs.iter().map(|s| s.as_str()).collect();

        // Check compression method
        if compressed_entry.is_stored() {
            // Stored entries still go through the materialized archive read so
            // size, UTF-8, and CRC validation match the eager path.
            let stored_xml = self
                .archive
                .get_worksheet(sheet_num)
                .map_err(|e| ParseError::ParseFailed(e.to_string()))?;
            ensure_lazy_limit(
                "worksheet cell",
                count_worksheet_cell_elements(&stored_xml),
                MAX_WORKSHEET_CELLS,
            )?;
            on_progress(stored_xml.len(), stored_xml.len());

            let mut buf_size = estimated_cells;
            parsed.cells.resize(buf_size, CellData::default());
            let mut row_heights_buf: Vec<RowHeight> = Vec::new();
            let mut cell_count = parse_worksheet_fast(
                &stored_xml,
                &shared_string_refs,
                &mut parsed.cells,
                &mut parsed.strings,
                &mut row_heights_buf,
                &[],
            );

            // If the buffer was completely filled, retry with larger buffers.
            while cell_count == buf_size {
                if buf_size >= MAX_WORKSHEET_CELLS {
                    return Err(ParseError::ParseFailed(format!(
                        "worksheet {} has more than {} cells",
                        sheet_num, MAX_WORKSHEET_CELLS
                    )));
                }
                buf_size = buf_size.saturating_mul(2).min(MAX_WORKSHEET_CELLS);
                parsed.cells.resize(buf_size, CellData::default());
                parsed.strings.clear();
                row_heights_buf.clear();

                cell_count = parse_worksheet_fast(
                    &stored_xml,
                    &shared_string_refs,
                    &mut parsed.cells,
                    &mut parsed.strings,
                    &mut row_heights_buf,
                    &[],
                );
            }
            parsed.cells.truncate(cell_count);
            parsed.cell_count = cell_count;
        } else if compressed_entry.is_deflate() {
            // Stream decompress and parse
            let buffer_size = if chunk_size == 0 {
                DEFAULT_BUFFER_SIZE
            } else {
                chunk_size
            };
            let total_compressed = compressed_entry.data.len();

            let mut decompressor = StreamingDeflate::new(
                compressed_entry.data,
                buffer_size,
                compressed_entry.uncompressed_size,
                compressed_entry.output_limit,
                compressed_entry.crc32,
            )
            .map_err(|e| ParseError::ParseFailed(e.to_string()))?;
            let mut cell_parser = StreamingCellParser::new(&shared_string_refs);

            while let Some(chunk) = decompressor
                .next_chunk()
                .map_err(|e| ParseError::ParseFailed(e.to_string()))?
            {
                cell_parser.process_chunk(chunk, &mut parsed.cells, &mut parsed.strings);
                ensure_lazy_limit("worksheet cell", parsed.cells.len(), MAX_WORKSHEET_CELLS)?;
                on_progress(decompressor.bytes_consumed(), total_compressed);
            }

            // Process any remaining data
            cell_parser.finish(&mut parsed.cells, &mut parsed.strings);
            parsed.cell_count = parsed.cells.len();

            // Final progress
            on_progress(total_compressed, total_compressed);
        } else {
            return Err(ParseError::ParseFailed(format!(
                "Unsupported compression method: {}",
                compressed_entry.compression_method
            )));
        }

        // =========================================================================
        // Parse additional worksheet features
        // For streaming, we need to re-read the worksheet XML for these features.
        // This is a trade-off: we get streaming benefits for cells but need
        // full XML for merges, formatting, etc.
        // =========================================================================
        let worksheet_xml = match self.archive.get_worksheet(sheet_num) {
            Ok(xml) => Some(xml),
            Err(ZipError::FileNotFound(_)) => None,
            Err(e) => return Err(ParseError::ParseFailed(e.to_string())),
        };
        if let Some(worksheet_xml) = worksheet_xml {
            ensure_lazy_limit(
                "worksheet cell",
                count_worksheet_cell_elements(&worksheet_xml),
                MAX_WORKSHEET_CELLS,
            )?;
            parsed.merges = parse_merge_cells(&worksheet_xml);
            ensure_lazy_limit("merge", parsed.merges.len(), MAX_MERGES)?;
            parsed.conditional_formats = parse_conditional_formats(&worksheet_xml).0;
            parsed.data_validations = parse_data_validations(&worksheet_xml).0;
            ensure_lazy_limit(
                "data validation",
                parsed.data_validations.len(),
                MAX_VALIDATIONS,
            )?;
            parsed.hyperlinks = format_hyperlinks(&worksheet_xml);
            parsed.protection = format_protection(&worksheet_xml);
            let (ps, pb) = format_print_settings(&worksheet_xml);
            parsed.print_settings = ps;
            parsed.page_breaks = pb;
            parsed.frozen_pane = parse_frozen_pane(&worksheet_xml);
            parsed.view_options = parse_sheet_views(&worksheet_xml);
            let (col_widths, row_heights) = parse_dimensions(&worksheet_xml);
            parsed.col_widths = col_widths;
            parsed.row_heights = row_heights;
        }

        Ok(parsed)
    }

    /// Convenience method to parse the first sheet immediately
    ///
    /// This is useful when you know you'll need the first sheet and want
    /// to trigger parsing upfront rather than on first access.
    ///
    /// # Returns
    /// * `Ok(())` - First sheet parsed successfully
    /// * `Err(ParseError)` - No sheets found or parsing failed
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

    // =========================================================================
    // Error Recovery Methods
    // =========================================================================

    /// Get all errors collected so far
    ///
    /// This returns errors from the ParseContext, which collects errors
    /// during initialization and sheet parsing.
    ///
    /// # Example
    /// ```ignore
    /// let mut workbook = LazyWorkbook::new(&xlsx_bytes)?;
    /// workbook.get_sheet(0)?;
    ///
    /// for error in workbook.errors() {
    ///     println!("{}: {}", error.severity, error.message);
    /// }
    /// ```
    pub fn errors(&self) -> &[ParseErrorDetail] {
        self.context.errors()
    }

    /// Get the total error count (excluding warnings)
    ///
    /// # Example
    /// ```ignore
    /// let workbook = LazyWorkbook::new(&xlsx_bytes)?;
    /// if workbook.error_count() > 0 {
    ///     eprintln!("Workbook has {} errors", workbook.error_count());
    /// }
    /// ```
    pub fn error_count(&self) -> usize {
        self.context.error_count()
    }

    /// Get the total warning count
    ///
    /// # Example
    /// ```ignore
    /// let workbook = LazyWorkbook::new(&xlsx_bytes)?;
    /// if workbook.warning_count() > 0 {
    ///     println!("Workbook has {} warnings", workbook.warning_count());
    /// }
    /// ```
    pub fn warning_count(&self) -> usize {
        self.context.warning_count()
    }

    /// Get the current parse mode
    ///
    /// # Example
    /// ```ignore
    /// let workbook = LazyWorkbook::with_mode(&xlsx_bytes, ParseMode::Strict)?;
    /// assert_eq!(workbook.parse_mode(), ParseMode::Strict);
    /// ```
    pub fn parse_mode(&self) -> ParseMode {
        self.context.mode
    }

    /// Check if parsing should stop due to fatal error or strict mode error
    ///
    /// In strict mode, parsing stops after the first error.
    /// In lenient/permissive mode, parsing only stops on fatal errors.
    ///
    /// # Example
    /// ```ignore
    /// let mut workbook = LazyWorkbook::with_mode(&xlsx_bytes, ParseMode::Strict)?;
    /// if workbook.should_stop() {
    ///     eprintln!("Cannot continue parsing due to errors");
    /// }
    /// ```
    pub fn should_stop(&self) -> bool {
        self.context.should_stop()
    }

    /// Get access to the full ParseContext
    ///
    /// This provides full access to error collection and reporting.
    ///
    /// # Example
    /// ```ignore
    /// let workbook = LazyWorkbook::new(&xlsx_bytes)?;
    /// let ctx = workbook.context();
    /// println!("Mode: {}, Errors: {}", ctx.mode, ctx.error_count());
    /// ```
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

// =============================================================================
// JSON formatting helpers for parsed worksheet features
// These call module-level parsers and format the results as JSON strings.
// =============================================================================

use crate::domain::hyperlinks;
use crate::domain::print;
use crate::domain::protection::read as protection;
use crate::domain::protection::read::SheetProtectionParse;

/// Parse hyperlinks from worksheet XML and return typed output structs
fn format_hyperlinks(xml: &[u8]) -> Vec<HyperlinkOutput> {
    hyperlinks::Hyperlinks::parse(xml)
        .map(|hl| {
            hl.hyperlinks
                .iter()
                .map(|h| HyperlinkOutput {
                    cell_ref: h.cell_ref.clone(),
                    location: h.location.as_deref().unwrap_or("").to_string(),
                    display: h.display.as_deref().unwrap_or("").to_string(),
                    tooltip: h.tooltip.as_deref().unwrap_or("").to_string(),
                    r_id: h.r_id.clone(),
                    uid: h.uid.clone(),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Parse sheet protection from worksheet XML and return typed output struct
fn format_protection(xml: &[u8]) -> Option<ProtectionOutput> {
    protection::SheetProtection::parse(xml).map(|sp| ProtectionOutput {
        sheet: sp.sheet,
        objects: sp.objects,
        scenarios: sp.scenarios,
        format_cells: sp.format_cells,
        format_columns: sp.format_columns,
        format_rows: sp.format_rows,
        insert_columns: sp.insert_columns,
        insert_rows: sp.insert_rows,
        insert_hyperlinks: sp.insert_hyperlinks,
        delete_columns: sp.delete_columns,
        delete_rows: sp.delete_rows,
        sort: sp.sort,
        auto_filter: sp.auto_filter,
        pivot_tables: sp.pivot_tables,
        select_locked_cells: sp.select_locked_cells,
        select_unlocked_cells: sp.select_unlocked_cells,
    })
}

/// Parse print settings from worksheet XML and return structured output
fn format_print_settings(
    xml: &[u8],
) -> (
    Option<crate::output::results::PrintSettingsOutput>,
    Option<crate::output::results::PageBreaksOutput>,
) {
    let ps = print::PrintSettings::parse(xml);
    crate::output::results::build_print_settings_output(&ps)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_error_display() {
        assert_eq!(
            format!("{}", ParseError::InvalidArchive("test".to_string())),
            "Invalid archive: test"
        );
        assert_eq!(
            format!("{}", ParseError::SheetNotFound(5)),
            "Sheet not found at index: 5"
        );
        assert_eq!(
            format!("{}", ParseError::ParseFailed("error".to_string())),
            "Parse failed: error"
        );
    }

    #[test]
    fn test_sheet_metadata_new() {
        let meta = SheetMetadata::new(0, "Test Sheet".to_string(), 1024);
        assert_eq!(meta.sheet_idx, 0);
        assert_eq!(meta.name, "Test Sheet");
        assert_eq!(meta.uncompressed_size, 1024);
    }

    #[test]
    fn test_parsed_sheet_new() {
        let sheet = ParsedSheet::new();
        assert!(sheet.cells.is_empty());
        assert!(sheet.strings.is_empty());
        assert_eq!(sheet.cell_count, 0);
        assert_eq!(sheet.cells_skipped, 0);
        assert!(sheet.errors.is_empty());
    }

    #[test]
    fn test_parsed_sheet_with_capacity() {
        let sheet = ParsedSheet::with_capacity(100, 1024);
        assert!(sheet.cells.capacity() >= 100);
        assert!(sheet.strings.capacity() >= 1024);
        assert_eq!(sheet.cell_count, 0);
        assert_eq!(sheet.cells_skipped, 0);
        assert!(sheet.errors.is_empty());
    }

    #[test]
    fn test_parsed_sheet_default() {
        let sheet: ParsedSheet = Default::default();
        assert!(sheet.cells.is_empty());
        assert!(sheet.strings.is_empty());
        assert_eq!(sheet.cell_count, 0);
        assert_eq!(sheet.cells_skipped, 0);
        assert!(sheet.errors.is_empty());
    }

    #[test]
    fn test_parsed_sheet_error_counts() {
        let mut sheet = ParsedSheet::new();

        // Add some errors and warnings
        sheet.errors.push(ParseErrorDetail::warning(
            ErrorCode::InvalidCellValue,
            "Warning 1",
        ));
        sheet.errors.push(ParseErrorDetail::warning(
            ErrorCode::InvalidCellValue,
            "Warning 2",
        ));
        sheet.errors.push(ParseErrorDetail::error(
            ErrorCode::InvalidCellReference,
            "Error 1",
        ));

        assert!(sheet.has_errors());
        assert_eq!(sheet.warning_count(), 2);
        assert_eq!(sheet.error_count(), 1);
    }

    #[test]
    fn test_lazy_workbook_empty_data() {
        let result = LazyWorkbook::new(&[]);
        assert!(matches!(result, Err(ParseError::InvalidArchive(_))));
    }

    #[test]
    fn test_lazy_workbook_invalid_signature() {
        let result = LazyWorkbook::new(b"not a zip file");
        assert!(matches!(result, Err(ParseError::InvalidArchive(_))));
    }

    #[test]
    fn test_lazy_workbook_too_short() {
        let result = LazyWorkbook::new(b"PK");
        assert!(matches!(result, Err(ParseError::InvalidArchive(_))));
    }

    // -------------------------------------------------------------------------
    // Parse Mode Tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_lazy_workbook_with_strict_mode() {
        // Test that we can create with strict mode
        let result = LazyWorkbook::with_mode(b"not a zip", ParseMode::Strict);
        assert!(matches!(result, Err(ParseError::InvalidArchive(_))));
    }

    #[test]
    fn test_lazy_workbook_with_lenient_mode() {
        // Test that we can create with lenient mode (default)
        let result = LazyWorkbook::with_mode(b"not a zip", ParseMode::Lenient);
        assert!(matches!(result, Err(ParseError::InvalidArchive(_))));
    }

    #[test]
    fn test_lazy_workbook_with_permissive_mode() {
        // Test that we can create with permissive mode
        let result = LazyWorkbook::with_mode(b"not a zip", ParseMode::Permissive);
        assert!(matches!(result, Err(ParseError::InvalidArchive(_))));
    }

    #[test]
    fn test_lazy_workbook_with_context() {
        // Test that we can create with a custom context
        let context = ParseContext::strict();
        let result = LazyWorkbook::with_context(b"not a zip", context);
        assert!(matches!(result, Err(ParseError::InvalidArchive(_))));
    }

    #[test]
    fn test_parse_context_modes() {
        // Test the different ParseContext constructors
        let strict = ParseContext::strict();
        assert_eq!(strict.mode, ParseMode::Strict);

        let lenient = ParseContext::lenient();
        assert_eq!(lenient.mode, ParseMode::Lenient);

        let permissive = ParseContext::permissive();
        assert_eq!(permissive.mode, ParseMode::Permissive);
    }

    #[test]
    fn test_parse_mode_default() {
        // Default should be Lenient
        let default_mode = ParseMode::default();
        assert_eq!(default_mode, ParseMode::Lenient);
    }

    #[test]
    fn test_error_code_categories() {
        // Test that error codes have the right numeric ranges
        assert!(ErrorCode::InvalidArchive.code() >= 100 && ErrorCode::InvalidArchive.code() < 200);
        assert!(ErrorCode::MalformedXml.code() >= 200 && ErrorCode::MalformedXml.code() < 300);
        assert!(
            ErrorCode::InvalidCellReference.code() >= 300
                && ErrorCode::InvalidCellReference.code() < 400
        );
        assert!(
            ErrorCode::InvalidNumberFormat.code() >= 400
                && ErrorCode::InvalidNumberFormat.code() < 500
        );
        assert!(
            ErrorCode::InvalidSharedStringIndex.code() >= 500
                && ErrorCode::InvalidSharedStringIndex.code() < 600
        );
        assert!(
            ErrorCode::UnsupportedFeature.code() >= 600
                && ErrorCode::UnsupportedFeature.code() < 700
        );
        assert!(ErrorCode::TruncatedFile.code() >= 700 && ErrorCode::TruncatedFile.code() < 800);
    }

    #[test]
    fn test_error_severity_ordering() {
        // Test that severity levels are properly ordered
        assert!(ErrorSeverity::Warning < ErrorSeverity::Error);
        assert!(ErrorSeverity::Error < ErrorSeverity::Fatal);
    }

    #[test]
    fn test_error_location_creation() {
        // Test ErrorLocation constructors
        let loc1 = ErrorLocation::new("sheet1.xml");
        assert_eq!(loc1.part, "sheet1.xml");
        assert!(loc1.path.is_none());
        assert!(loc1.row.is_none());
        assert!(loc1.col.is_none());

        let loc2 = ErrorLocation::cell("sheet1.xml", 5, 3);
        assert_eq!(loc2.part, "sheet1.xml");
        assert_eq!(loc2.row, Some(5));
        assert_eq!(loc2.col, Some(3));
    }

    #[test]
    fn test_parse_error_detail_builder() {
        // Test the builder pattern for ParseErrorDetail
        let error = ParseErrorDetail::error(ErrorCode::InvalidCellValue, "Bad value")
            .with_location(ErrorLocation::cell("sheet1.xml", 1, 2))
            .with_raw_data("abc123")
            .with_fallback("0.0");

        assert_eq!(error.code, ErrorCode::InvalidCellValue);
        assert_eq!(error.severity, ErrorSeverity::Error);
        assert_eq!(error.message, "Bad value");
        assert!(error.location.is_some());
        assert_eq!(error.raw_data.as_deref(), Some("abc123"));
        assert_eq!(error.fallback_used.as_deref(), Some("0.0"));
    }
}
