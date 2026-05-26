//! Result and response types for XLSX parsing operations.
//!
//! This module contains all the struct types used to return parse results,
//! including timing information, error details, and parsed cell data.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::infra::error::ParseErrorDetail;

pub type RawVmlDrawing = (String, Vec<u8>, Option<(String, Vec<u8>)>);

// =============================================================================
// Cell type constants for serialization
// =============================================================================

/// Empty cell type value
pub const CELL_TYPE_VAL_EMPTY: u8 = 0;
/// Number cell type value
pub const CELL_TYPE_VAL_NUMBER: u8 = 1;
/// String cell type value
pub const CELL_TYPE_VAL_STRING: u8 = 2;
/// Boolean cell type value
pub const CELL_TYPE_VAL_BOOL: u8 = 3;
/// Error cell type value
pub const CELL_TYPE_VAL_ERROR: u8 = 4;
/// Formula cell type value
pub const CELL_TYPE_VAL_FORMULA: u8 = 5;

// =============================================================================
// ParseResult
// =============================================================================

/// Result returned from parsing an XLSX file
#[derive(Debug, Clone)]
pub struct ParseResult {
    /// Number of sheets parsed
    sheet_count: u32,
    /// Total number of cells parsed
    cell_count: u32,
    /// Parse duration in microseconds
    parse_time_us: u32,
    /// Error message if parsing failed (empty string if successful)
    error: String,
}

impl ParseResult {
    /// Returns the number of sheets parsed
    pub fn sheet_count(&self) -> u32 {
        self.sheet_count
    }

    /// Returns the total number of cells parsed
    pub fn cell_count(&self) -> u32 {
        self.cell_count
    }

    /// Returns the parse duration in microseconds
    pub fn parse_time_us(&self) -> u32 {
        self.parse_time_us
    }

    /// Returns the error message (empty if successful)
    pub fn error_message(&self) -> String {
        self.error.clone()
    }

    /// Returns true if parsing was successful
    pub fn is_ok(&self) -> bool {
        self.error.is_empty()
    }
}

impl ParseResult {
    /// Create a successful result
    pub fn success(sheet_count: u32, cell_count: u32, parse_time_us: u32) -> Self {
        Self {
            sheet_count,
            cell_count,
            parse_time_us,
            error: String::new(),
        }
    }

    /// Create an error result
    pub fn error(message: &str) -> Self {
        Self {
            sheet_count: 0,
            cell_count: 0,
            parse_time_us: 0,
            error: message.to_string(),
        }
    }
}

// =============================================================================
// ParseTimings (for profiled parsing)
// =============================================================================

/// Detailed phase timings from a profiled parse operation.
///
/// Each field records the time in microseconds spent in that parsing phase.
/// This struct is returned alongside the parse result when using profiled
/// parse functions, enabling performance analysis of the parser.
///
/// **Important:** `zip_index_us` measures only the ZIP central directory
/// parsing (`XlsxArchive::new()`). Actual DEFLATE decompression happens
/// lazily inside `read_file()` / `read_entry()`, so the real decompression
/// cost is distributed across `shared_strings_us`, `styles_us`,
/// `metadata_us`, and `worksheet_parse_us`.
///
/// All timing fields use `f64` to avoid silent truncation on phases
/// exceeding ~4.3 seconds (the u32 microsecond limit).
///
/// The TypeScript side converts these timings into a `RustPhaseTimings`
/// interface for consumption by `ProfileContext.recordRustTimings()`.
#[derive(Debug, Clone)]
pub struct ParseTimings {
    /// Time spent parsing ZIP central directory index (us).
    /// Does NOT include actual DEFLATE decompression of entries - that cost
    /// is included in the phase that reads each entry (shared_strings_us,
    /// styles_us, metadata_us, worksheet_parse_us).
    pub(crate) zip_index_us: f64,
    /// Time spent on shared strings (us).
    /// Includes ZIP decompression of sharedStrings.xml + XML parsing.
    pub(crate) shared_strings_us: f64,
    /// Time spent on styles (us).
    /// Includes ZIP decompression of styles.xml + XML parsing.
    pub(crate) styles_us: f64,
    /// Time spent on metadata: theme, workbook, defined names, and protection (us).
    /// Includes ZIP decompression of theme1.xml, workbook.xml, etc. + XML parsing.
    pub(crate) metadata_us: f64,
    /// Total time spent parsing all worksheets (us).
    /// Includes ZIP decompression of each sheet's XML + cell/feature parsing.
    pub(crate) worksheet_parse_us: f64,
    /// Time spent in serialization (us)
    pub(crate) serde_serialize_us: f64,
    /// Total parse time including all phases (us)
    pub(crate) total_us: f64,

    // --- Shared strings sub-phase breakdown ---
    /// Sub-phase: ZIP decompression of sharedStrings.xml (us)
    pub(crate) ss_zip_us: f64,
    /// Sub-phase: offset parsing — SharedStrings::parse() builds Vec<StringRef> (us)
    pub(crate) ss_parse_refs_us: f64,
    /// Sub-phase: string materialization — get() + String allocation loop (us)
    pub(crate) ss_materialize_us: f64,
    /// Uncompressed size of sharedStrings.xml in bytes
    pub(crate) ss_xml_bytes: f64,
    /// Total shared string count
    pub(crate) ss_count_total: f64,
    /// Strings that are zero-copy (plain, no decoding needed)
    pub(crate) ss_count_plain: f64,
    /// Strings that need XML entity decoding only
    pub(crate) ss_count_entities: f64,
    /// Rich text strings (need <t> extraction + concatenation)
    pub(crate) ss_count_rich_text: f64,

    // --- Worksheet sub-phase breakdown (cumulative across all sheets) ---
    /// Sub-phase: ZIP decompression of worksheet XMLs (us)
    pub(crate) ws_zip_decompress_us: f64,
    /// Sub-phase: parse_worksheet_fast() core cell parsing (us)
    pub(crate) ws_cell_parse_us: f64,
    /// Sub-phase: CellData → FullCellData conversion (us)
    pub(crate) ws_cell_convert_us: f64,
    /// Sub-phase: postprocessing — shared formulas, cached values, data tables (us)
    pub(crate) ws_postprocess_us: f64,
    /// Sub-phase: auxiliary parsers — merges, CF, DV, hyperlinks, dimensions, etc. (us)
    pub(crate) ws_auxiliary_us: f64,
    /// Sub-phase: auxiliary ZIP I/O — comments + tables (requires ZIP reads) (us)
    pub(crate) ws_aux_zip_io_us: f64,

    // --- Auxiliary parser individual breakdown (cumulative across all sheets) ---
    /// Auxiliary: parse_merge_cells (us)
    pub(crate) ws_aux_merge_us: f64,
    /// Auxiliary: parse_conditional_formats (us)
    pub(crate) ws_aux_cond_fmt_us: f64,
    /// Auxiliary: parse_data_validations (us)
    pub(crate) ws_aux_data_val_us: f64,
    /// Auxiliary: hyperlinks parsing (us)
    pub(crate) ws_aux_hyperlinks_us: f64,
    /// Auxiliary: sheet protection parsing (us)
    pub(crate) ws_aux_protection_us: f64,
    /// Auxiliary: print settings parsing (us)
    pub(crate) ws_aux_print_us: f64,
    /// Auxiliary: frozen pane parsing (us)
    pub(crate) ws_aux_frozen_pane_us: f64,
    /// Auxiliary: dimensions — col widths + row heights (us)
    pub(crate) ws_aux_dimensions_us: f64,
    /// Auxiliary: sparklines parsing (us)
    pub(crate) ws_aux_sparklines_us: f64,

    // --- Aux ZIP I/O sub-phase breakdown (cumulative across all sheets) ---
    /// Aux ZIP: comments parsing (us)
    pub(crate) aux_zip_comments_us: f64,
    /// Aux ZIP: tables parsing (us)
    pub(crate) aux_zip_tables_us: f64,
    /// Aux ZIP: pivot tables parsing (us)
    pub(crate) aux_zip_pivots_us: f64,
    /// Aux ZIP: charts parsing (us)
    pub(crate) aux_zip_charts_us: f64,
    /// Aux ZIP: SmartArt parsing (us)
    pub(crate) aux_zip_smartart_us: f64,
    /// Aux ZIP: slicers parsing (us)
    pub(crate) aux_zip_slicers_us: f64,
    /// Aux ZIP: form controls parsing (us)
    pub(crate) aux_zip_form_controls_us: f64,
    /// Aux ZIP: OLE objects parsing (us)
    pub(crate) aux_zip_ole_us: f64,
    /// Aux ZIP: connectors parsing (us)
    pub(crate) aux_zip_connectors_us: f64,
    /// Aux ZIP: OPC rels + VML drawings (us)
    pub(crate) aux_zip_rels_vml_us: f64,
}

impl ParseTimings {
    /// Time spent parsing ZIP central directory index (us).
    /// Does NOT include actual DEFLATE decompression of entries.
    pub fn zip_index_us(&self) -> f64 {
        self.zip_index_us
    }

    /// Time spent on shared strings (us).
    /// Includes ZIP decompression of sharedStrings.xml + XML parsing.
    pub fn shared_strings_us(&self) -> f64 {
        self.shared_strings_us
    }

    /// Time spent on styles (us).
    /// Includes ZIP decompression of styles.xml + XML parsing.
    pub fn styles_us(&self) -> f64 {
        self.styles_us
    }

    /// Time spent on metadata: theme, workbook, defined names, and protection (us).
    /// Includes ZIP decompression of respective XML entries.
    pub fn metadata_us(&self) -> f64 {
        self.metadata_us
    }

    /// Total time spent parsing all worksheets (us).
    /// Includes ZIP decompression of each sheet's XML.
    pub fn worksheet_parse_us(&self) -> f64 {
        self.worksheet_parse_us
    }

    /// Time spent in serialization (us)
    pub fn serde_serialize_us(&self) -> f64 {
        self.serde_serialize_us
    }

    /// Total parse time including all phases (us)
    pub fn total_us(&self) -> f64 {
        self.total_us
    }

    // --- Shared strings sub-phase getters ---

    /// Sub-phase: ZIP decompression of sharedStrings.xml (us)
    pub fn ss_zip_us(&self) -> f64 {
        self.ss_zip_us
    }

    /// Sub-phase: offset parsing — SharedStrings::parse() (us)
    pub fn ss_parse_refs_us(&self) -> f64 {
        self.ss_parse_refs_us
    }

    /// Sub-phase: string materialization loop (us)
    pub fn ss_materialize_us(&self) -> f64 {
        self.ss_materialize_us
    }

    /// Uncompressed size of sharedStrings.xml in bytes
    pub fn ss_xml_bytes(&self) -> f64 {
        self.ss_xml_bytes
    }

    /// Total shared string count
    pub fn ss_count_total(&self) -> f64 {
        self.ss_count_total
    }

    /// Zero-copy plain strings count
    pub fn ss_count_plain(&self) -> f64 {
        self.ss_count_plain
    }

    /// Entity-decoded strings count
    pub fn ss_count_entities(&self) -> f64 {
        self.ss_count_entities
    }

    /// Rich text strings count
    pub fn ss_count_rich_text(&self) -> f64 {
        self.ss_count_rich_text
    }

    // --- Worksheet sub-phase getters ---

    /// Sub-phase: ZIP decompression of worksheet XMLs (us)
    pub fn ws_zip_decompress_us(&self) -> f64 {
        self.ws_zip_decompress_us
    }

    /// Sub-phase: parse_worksheet_fast() core cell parsing (us)
    pub fn ws_cell_parse_us(&self) -> f64 {
        self.ws_cell_parse_us
    }

    /// Sub-phase: CellData → FullCellData conversion (us)
    pub fn ws_cell_convert_us(&self) -> f64 {
        self.ws_cell_convert_us
    }

    /// Sub-phase: postprocessing — shared formulas, cached values, data tables (us)
    pub fn ws_postprocess_us(&self) -> f64 {
        self.ws_postprocess_us
    }

    /// Sub-phase: auxiliary parsers — merges, CF, DV, hyperlinks, dimensions, etc. (us)
    pub fn ws_auxiliary_us(&self) -> f64 {
        self.ws_auxiliary_us
    }

    /// Sub-phase: auxiliary ZIP I/O — comments + tables (us)
    pub fn ws_aux_zip_io_us(&self) -> f64 {
        self.ws_aux_zip_io_us
    }

    // --- Auxiliary parser individual getters ---

    pub fn ws_aux_merge_us(&self) -> f64 {
        self.ws_aux_merge_us
    }

    pub fn ws_aux_cond_fmt_us(&self) -> f64 {
        self.ws_aux_cond_fmt_us
    }

    pub fn ws_aux_data_val_us(&self) -> f64 {
        self.ws_aux_data_val_us
    }

    pub fn ws_aux_hyperlinks_us(&self) -> f64 {
        self.ws_aux_hyperlinks_us
    }

    pub fn ws_aux_protection_us(&self) -> f64 {
        self.ws_aux_protection_us
    }

    pub fn ws_aux_print_us(&self) -> f64 {
        self.ws_aux_print_us
    }

    pub fn ws_aux_frozen_pane_us(&self) -> f64 {
        self.ws_aux_frozen_pane_us
    }

    pub fn ws_aux_dimensions_us(&self) -> f64 {
        self.ws_aux_dimensions_us
    }

    pub fn ws_aux_sparklines_us(&self) -> f64 {
        self.ws_aux_sparklines_us
    }

    // --- Aux ZIP I/O sub-phase getters ---

    pub fn aux_zip_comments_us(&self) -> f64 {
        self.aux_zip_comments_us
    }
    pub fn aux_zip_tables_us(&self) -> f64 {
        self.aux_zip_tables_us
    }
    pub fn aux_zip_pivots_us(&self) -> f64 {
        self.aux_zip_pivots_us
    }
    pub fn aux_zip_charts_us(&self) -> f64 {
        self.aux_zip_charts_us
    }
    pub fn aux_zip_smartart_us(&self) -> f64 {
        self.aux_zip_smartart_us
    }
    pub fn aux_zip_slicers_us(&self) -> f64 {
        self.aux_zip_slicers_us
    }
    pub fn aux_zip_form_controls_us(&self) -> f64 {
        self.aux_zip_form_controls_us
    }
    pub fn aux_zip_ole_us(&self) -> f64 {
        self.aux_zip_ole_us
    }
    pub fn aux_zip_connectors_us(&self) -> f64 {
        self.aux_zip_connectors_us
    }
    pub fn aux_zip_rels_vml_us(&self) -> f64 {
        self.aux_zip_rels_vml_us
    }
}

impl ParseTimings {
    /// Create a new ParseTimings with all zeroes
    pub fn zero() -> Self {
        Self {
            zip_index_us: 0.0,
            shared_strings_us: 0.0,
            styles_us: 0.0,
            metadata_us: 0.0,
            worksheet_parse_us: 0.0,
            serde_serialize_us: 0.0,
            total_us: 0.0,
            ss_zip_us: 0.0,
            ss_parse_refs_us: 0.0,
            ss_materialize_us: 0.0,
            ss_xml_bytes: 0.0,
            ss_count_total: 0.0,
            ss_count_plain: 0.0,
            ss_count_entities: 0.0,
            ss_count_rich_text: 0.0,
            ws_zip_decompress_us: 0.0,
            ws_cell_parse_us: 0.0,
            ws_cell_convert_us: 0.0,
            ws_postprocess_us: 0.0,
            ws_auxiliary_us: 0.0,
            ws_aux_zip_io_us: 0.0,
            ws_aux_merge_us: 0.0,
            ws_aux_cond_fmt_us: 0.0,
            ws_aux_data_val_us: 0.0,
            ws_aux_hyperlinks_us: 0.0,
            ws_aux_protection_us: 0.0,
            ws_aux_print_us: 0.0,
            ws_aux_frozen_pane_us: 0.0,
            ws_aux_dimensions_us: 0.0,
            ws_aux_sparklines_us: 0.0,
            aux_zip_comments_us: 0.0,
            aux_zip_tables_us: 0.0,
            aux_zip_pivots_us: 0.0,
            aux_zip_charts_us: 0.0,
            aux_zip_smartart_us: 0.0,
            aux_zip_slicers_us: 0.0,
            aux_zip_form_controls_us: 0.0,
            aux_zip_ole_us: 0.0,
            aux_zip_connectors_us: 0.0,
            aux_zip_rels_vml_us: 0.0,
        }
    }

    /// Create a new ParseTimings with top-level phase values (sub-phases zeroed)
    pub fn new(
        zip_index_us: f64,
        shared_strings_us: f64,
        styles_us: f64,
        metadata_us: f64,
        worksheet_parse_us: f64,
        serde_serialize_us: f64,
        total_us: f64,
    ) -> Self {
        Self {
            zip_index_us,
            shared_strings_us,
            styles_us,
            metadata_us,
            worksheet_parse_us,
            serde_serialize_us,
            total_us,
            ss_zip_us: 0.0,
            ss_parse_refs_us: 0.0,
            ss_materialize_us: 0.0,
            ss_xml_bytes: 0.0,
            ss_count_total: 0.0,
            ss_count_plain: 0.0,
            ss_count_entities: 0.0,
            ss_count_rich_text: 0.0,
            ws_zip_decompress_us: 0.0,
            ws_cell_parse_us: 0.0,
            ws_cell_convert_us: 0.0,
            ws_postprocess_us: 0.0,
            ws_auxiliary_us: 0.0,
            ws_aux_zip_io_us: 0.0,
            ws_aux_merge_us: 0.0,
            ws_aux_cond_fmt_us: 0.0,
            ws_aux_data_val_us: 0.0,
            ws_aux_hyperlinks_us: 0.0,
            ws_aux_protection_us: 0.0,
            ws_aux_print_us: 0.0,
            ws_aux_frozen_pane_us: 0.0,
            ws_aux_dimensions_us: 0.0,
            ws_aux_sparklines_us: 0.0,
            aux_zip_comments_us: 0.0,
            aux_zip_tables_us: 0.0,
            aux_zip_pivots_us: 0.0,
            aux_zip_charts_us: 0.0,
            aux_zip_smartart_us: 0.0,
            aux_zip_slicers_us: 0.0,
            aux_zip_form_controls_us: 0.0,
            aux_zip_ole_us: 0.0,
            aux_zip_connectors_us: 0.0,
            aux_zip_rels_vml_us: 0.0,
        }
    }
}

// =============================================================================
// LazyParseResult
// =============================================================================

/// Result from lazy parsing
///
/// This struct provides metadata about sheets without parsing cell data.
/// Use this when you need to know sheet names and count before deciding
/// which sheets to load.
#[derive(Debug, Clone)]
pub struct LazyParseResult {
    /// Number of sheets in the workbook
    sheet_count: u32,
    /// Names of all sheets
    sheet_names: Vec<String>,
    /// Error message if parsing failed (empty string if successful)
    error: String,
}

impl LazyParseResult {
    /// Returns the number of sheets in the workbook
    pub fn sheet_count(&self) -> u32 {
        self.sheet_count
    }

    /// Returns the names of all sheets
    pub fn sheet_names(&self) -> Vec<String> {
        self.sheet_names.clone()
    }

    /// Returns the error message (empty if successful)
    pub fn error_message(&self) -> String {
        self.error.clone()
    }

    /// Returns true if parsing was successful
    pub fn is_ok(&self) -> bool {
        self.error.is_empty()
    }
}

impl LazyParseResult {
    /// Create a successful result
    pub fn success(sheet_count: u32, sheet_names: Vec<String>) -> Self {
        Self {
            sheet_count,
            sheet_names,
            error: String::new(),
        }
    }

    /// Create an error result
    pub fn error(message: &str) -> Self {
        Self {
            sheet_count: 0,
            sheet_names: Vec::new(),
            error: message.to_string(),
        }
    }
}

// =============================================================================
// LazyParseResultWithErrors
// =============================================================================

/// Result from lazy parsing with error recovery info
///
/// Extended version of LazyParseResult that includes error recovery information.
#[derive(Debug, Clone)]
pub struct LazyParseResultWithErrors {
    /// Number of sheets in the workbook
    sheet_count: u32,
    /// Names of all sheets
    sheet_names: Vec<String>,
    /// Number of warnings generated
    warning_count: u32,
    /// Number of errors generated
    error_count: u32,
    /// Parse mode used
    parse_mode: u32,
    /// Error message if parsing failed (empty string if successful)
    error: String,
    /// JSON array of error details for JS consumption
    errors_json: String,
}

impl LazyParseResultWithErrors {
    /// Returns the number of sheets in the workbook
    pub fn sheet_count(&self) -> u32 {
        self.sheet_count
    }

    /// Returns the names of all sheets
    pub fn sheet_names(&self) -> Vec<String> {
        self.sheet_names.clone()
    }

    /// Returns the number of warnings
    pub fn warning_count(&self) -> u32 {
        self.warning_count
    }

    /// Returns the number of errors
    pub fn error_count(&self) -> u32 {
        self.error_count
    }

    /// Returns the parse mode used (0=Strict, 1=Lenient, 2=Permissive)
    pub fn parse_mode(&self) -> u32 {
        self.parse_mode
    }

    /// Returns the error message (empty if successful)
    pub fn error_message(&self) -> String {
        self.error.clone()
    }

    /// Returns the errors as a JSON array for JS consumption
    pub fn errors_json(&self) -> String {
        self.errors_json.clone()
    }

    /// Returns true if parsing was successful
    pub fn is_ok(&self) -> bool {
        self.error.is_empty()
    }

    /// Returns true if parsing completed without any errors (warnings ok)
    pub fn is_clean(&self) -> bool {
        self.error.is_empty() && self.error_count == 0
    }
}

impl LazyParseResultWithErrors {
    /// Create a successful result
    pub fn success(
        sheet_count: u32,
        sheet_names: Vec<String>,
        warning_count: u32,
        error_count: u32,
        parse_mode: u32,
        errors_json: String,
    ) -> Self {
        Self {
            sheet_count,
            sheet_names,
            warning_count,
            error_count,
            parse_mode,
            error: String::new(),
            errors_json,
        }
    }

    /// Create an error result
    pub fn error(message: &str, parse_mode: u32) -> Self {
        Self {
            sheet_count: 0,
            sheet_names: Vec::new(),
            warning_count: 0,
            error_count: 0,
            parse_mode,
            error: message.to_string(),
            errors_json: String::from("[]"),
        }
    }
}

// =============================================================================
// ParseResultWithErrors
// =============================================================================

/// Result returned from parsing an XLSX file with error recovery
///
/// This struct provides detailed parsing statistics including error recovery
/// information.
#[derive(Debug, Clone)]
pub struct ParseResultWithErrors {
    /// Number of sheets parsed
    sheet_count: u32,
    /// Total number of cells parsed
    cell_count: u32,
    /// Number of cells that were skipped due to errors
    cells_skipped: u32,
    /// Number of warnings generated
    warning_count: u32,
    /// Number of errors generated
    error_count: u32,
    /// Parse duration in microseconds
    parse_time_us: u32,
    /// Fatal error message if parsing failed completely (empty string if successful)
    fatal_error: String,
    /// JSON array of error details for JS consumption
    errors_json: String,
}

impl ParseResultWithErrors {
    /// Returns the number of sheets parsed
    pub fn sheet_count(&self) -> u32 {
        self.sheet_count
    }

    /// Returns the total number of cells parsed
    pub fn cell_count(&self) -> u32 {
        self.cell_count
    }

    /// Returns the number of cells skipped due to errors
    pub fn cells_skipped(&self) -> u32 {
        self.cells_skipped
    }

    /// Returns the number of warnings generated
    pub fn warning_count(&self) -> u32 {
        self.warning_count
    }

    /// Returns the number of errors generated
    pub fn error_count(&self) -> u32 {
        self.error_count
    }

    /// Returns the parse duration in microseconds
    pub fn parse_time_us(&self) -> u32 {
        self.parse_time_us
    }

    /// Returns the fatal error message (empty if no fatal error)
    pub fn fatal_error(&self) -> String {
        self.fatal_error.clone()
    }

    /// Returns the errors as a JSON array for JS consumption
    pub fn errors_json(&self) -> String {
        self.errors_json.clone()
    }

    /// Returns true if parsing was successful (no fatal errors)
    pub fn is_ok(&self) -> bool {
        self.fatal_error.is_empty()
    }

    /// Returns true if parsing completed without any errors (warnings ok)
    pub fn is_clean(&self) -> bool {
        self.fatal_error.is_empty() && self.error_count == 0
    }
}

impl ParseResultWithErrors {
    /// Create a successful result
    pub fn success(
        sheet_count: u32,
        cell_count: u32,
        cells_skipped: u32,
        warning_count: u32,
        error_count: u32,
        parse_time_us: u32,
        errors_json: String,
    ) -> Self {
        Self {
            sheet_count,
            cell_count,
            cells_skipped,
            warning_count,
            error_count,
            parse_time_us,
            fatal_error: String::new(),
            errors_json,
        }
    }

    /// Create a fatal error result
    pub fn fatal(message: &str) -> Self {
        Self {
            sheet_count: 0,
            cell_count: 0,
            cells_skipped: 0,
            warning_count: 0,
            error_count: 0,
            parse_time_us: 0,
            fatal_error: message.to_string(),
            errors_json: String::from("[]"),
        }
    }
}

// =============================================================================
// ParseStats
// =============================================================================

/// Statistics about the parse operation
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseStats {
    /// Total number of cells parsed across all sheets
    pub total_cells: u32,
    /// Total number of sheets in the workbook
    pub total_sheets: u32,
    /// Parse duration in microseconds (placeholder - timing done on JS side)
    pub parse_time_us: u32,
}

// =============================================================================
// FullCellData
// =============================================================================

/// Serde helper: skip serializing false booleans.
fn is_false(v: &bool) -> bool {
    !(*v)
}

/// Serde helper: skip serializing zero u8 values.
fn is_zero(v: &u8) -> bool {
    *v == 0
}

/// Cell data for full parse result (serializable version)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullCellData {
    /// Row index (0-based)
    pub row: u32,
    /// Column index (0-based)
    pub col: u32,
    /// Cell type: 0=empty, 1=number, 2=string, 3=bool, 4=error, 5=formula
    #[serde(rename = "type")]
    pub cell_type: u8,
    /// Style index
    #[serde(rename = "styleIndex")]
    pub style_idx: u16,
    /// The cell value (number as string, actual string, bool as "true"/"false", error code)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    /// Formula if present
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    /// Whether the formula has `ca="1"` (calculate always / needs recalculation).
    /// When true, the cached `<v>` value may be stale or a placeholder (e.g., `0`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub force_recalc: bool,
    /// For array formula source cells, the `ref` attribute from `<f t="array" ref="A1:C5">`.
    /// Indicates this cell is a dynamic array source and the ref gives the spill range.
    /// Phantom cells within this range should be excluded from snapshots.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub array_ref: Option<String>,
    /// Whether the `<c>` element has a `cm` attribute (cell metadata index).
    /// The `cm` attribute marks cells as participating in dynamic array formulas
    /// (XLDAPR metadata). Some Excel 365 files use ONLY `cm` without `t="array"`.
    /// Cells with `cm` and a formula are dynamic array sources; cells with `cm`
    /// but no formula are likely phantom (spill) cells.
    #[serde(default, skip_serializing_if = "is_false")]
    pub cm: bool,
    /// Value metadata index from the `vm` attribute on the `<c>` element.
    /// A 1-based index into `xl/richData/` parts (linked data types, images-in-cells).
    /// `None` means no `vm` attribute was present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vm: Option<u32>,
    /// For formula cells (cell_type == 5), the original XLSX `t` attribute that
    /// indicates the cached value type. Uses the internal cell-parser type codes:
    ///   6 = CELL_TYPE_FORMULA_STRING (t="str", cached value is a literal string)
    ///   4 = CELL_TYPE_ERROR          (t="e",   cached value is an error)
    ///   3 = CELL_TYPE_BOOL           (t="b",   cached value is boolean)
    ///   0 = unset / default (infer from value string)
    /// This lets downstream consumers distinguish e.g. a formula returning the
    /// *string* "#N/A" (t="str") from a formula returning the *error* #N/A (t="e").
    #[serde(default, skip_serializing_if = "is_zero")]
    pub cached_value_type: u8,
    /// Original OOXML formula metadata for round-trip preservation.
    /// The `formula` field continues to hold the expanded text for WASM consumers.
    /// This field is NOT serialized to JSON (WASM doesn't need it).
    #[serde(skip)]
    pub cell_formula: Option<ooxml_types::worksheet::CellFormula>,
    /// Whether the `<f>` element had `xml:space="preserve"`, for round-trip fidelity.
    #[serde(default, skip_serializing_if = "is_false")]
    pub preserve_space_formula: bool,
    /// Whether the `<v>` element had `xml:space="preserve"`, for round-trip fidelity.
    #[serde(default, skip_serializing_if = "is_false")]
    pub preserve_space_value: bool,
    /// Original SST index from `<v>N</v>` for `t="s"` cells.
    /// Preserved for raw SST passthrough to avoid lossy text-based reverse lookup.
    #[serde(skip)]
    pub sst_index: Option<u32>,
    /// Whether the cell had an explicit `s` attribute in the original XML.
    /// Needed for round-trip fidelity: `s="0"` vs absent `s` are semantically
    /// equivalent but must be preserved for byte-fidelity.
    #[serde(skip)]
    pub has_explicit_style: bool,
}

// =============================================================================
// Re-exports from common module for range types
// =============================================================================

// Re-export common range types for backward compatibility
// These types have the same core fields but common versions may have extra
// optional fields with skip_serializing_if, so JSON output should be the same.
pub use crate::common::range::{ColWidth, MergeRange, Pane, PaneState, RowHeight, SheetPane};

// Re-export style enums used as public field types on FontOutput, FillOutput,
// BorderSideOutput, AlignmentOutput. This lets downstream consumers (e.g.,
// compute-core) name these types without adding ooxml-types as a direct
// dependency.
pub use ooxml_types::styles::{
    BorderStyle, HorizontalAlign, PatternType, UnderlineStyle, VerticalAlign,
};

// Re-exports from json_utils (moved for separation of concerns)
pub use crate::infra::json::{errors_to_json, escape_json_string};

// Re-export from error (moved for separation of concerns)
pub use crate::infra::error::mode_from_u32;

// =============================================================================
// ParsedTable and related types
// =============================================================================

/// Parsed cell range with 0-based coordinates.
///
/// Matches the TypeScript `CellRange` interface:
/// `{ startRow: number, startCol: number, endRow: number, endCol: number }`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedCellRange {
    /// Start row (0-based)
    pub start_row: u32,
    /// Start column (0-based)
    pub start_col: u32,
    /// End row (0-based, inclusive)
    pub end_row: u32,
    /// End column (0-based, inclusive)
    pub end_col: u32,
}

/// Parsed table column.
///
/// Matches the TypeScript `TableColumn` interface (subset):
/// `{ id: number, name: string }`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedTableColumn {
    /// Column ID
    pub id: u32,
    /// Column display name
    pub name: String,
    /// Header row DXF ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_row_dxf_id: Option<u32>,
    /// Data body DXF ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_dxf_id: Option<u32>,
    /// Totals row DXF ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_row_dxf_id: Option<u32>,
    /// Header row cell style name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_row_cell_style: Option<String>,
    /// Data cell style name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_cell_style: Option<String>,
    /// Totals row cell style name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_row_cell_style: Option<String>,
    /// Calculated column formula
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calculated_column_formula: Option<String>,
    /// Whether calculated column formula is an array formula
    #[serde(default, skip_serializing_if = "is_false")]
    pub calculated_column_formula_array: bool,
    /// Totals row formula
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_row_formula: Option<String>,
    /// Whether totals row formula is an array formula
    #[serde(default, skip_serializing_if = "is_false")]
    pub totals_row_formula_array: bool,
    /// Totals row label
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_row_label: Option<String>,
    /// Totals row function name (e.g., "sum", "count")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_row_function: Option<String>,
    /// Unique name for the column (uniqueName attribute, used by query tables)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unique_name: Option<String>,
    /// Query table field ID (queryTableFieldId attribute)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query_table_field_id: Option<u32>,
    /// Extension UID for revision tracking (xr3:uid)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xr3_uid: Option<String>,
}

/// A fully parsed Excel Table (ListObject).
///
/// Matches the TypeScript `Table` interface with structured fields
/// instead of raw JSON strings. The `range` field provides parsed
/// 0-based coordinates from the `ref` string (e.g., "A1:Q34").
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedTable {
    /// Table ID
    pub id: u32,
    /// Internal table name
    pub name: String,
    /// Display name shown to users
    pub display_name: String,
    /// Reference range string (e.g., "A1:Q34")
    #[serde(rename = "ref")]
    pub ref_range: String,
    /// Parsed range with 0-based coordinates
    pub range: ParsedCellRange,
    /// Table columns
    pub columns: Vec<ParsedTableColumn>,
    /// Whether the table has a header row
    pub has_headers: bool,
    /// Whether the table has a totals row
    pub has_totals: bool,
    /// Style preset name (e.g., "TableStyleMedium2")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style_name: Option<String>,
    /// Show first column emphasis
    pub show_first_column: bool,
    /// Show last column emphasis
    pub show_last_column: bool,
    /// Show row stripes
    pub show_row_stripes: bool,
    /// Show column stripes
    pub show_column_stripes: bool,
    // DXF formatting IDs for table regions
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_row_dxf_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_dxf_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_row_dxf_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_row_border_dxf_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table_border_dxf_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_row_border_dxf_id: Option<u32>,
    // Named cell styles
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_row_cell_style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_cell_style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_row_cell_style: Option<String>,
    /// Auto-filter reference range
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_filter_ref: Option<String>,
    /// Auto-filter xr:uid for revision tracking
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_filter_xr_uid: Option<String>,
    /// Table type (e.g., "queryTable", "xml"). None means default "worksheet".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table_type: Option<String>,
    /// Whether totals row is shown (totalsRowShown attribute).
    /// None = attribute absent (OOXML default is true).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub totals_row_shown: Option<bool>,
    /// Connection ID for external data sources.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<u32>,
    /// Whether to insert a blank row below table.
    #[serde(skip_serializing_if = "is_false")]
    pub insert_row: bool,
    /// Whether insert row shifts existing rows.
    #[serde(skip_serializing_if = "is_false")]
    pub insert_row_shift: bool,
    /// Whether the table is published.
    #[serde(skip_serializing_if = "is_false")]
    pub published: bool,
    /// Extension UID for revision tracking (xr:uid).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xr_uid: Option<String>,
    /// Table-level sort state (sortState element at table level, outside autoFilter).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_state: Option<ParsedTableSortState>,
    /// Auto-filter column definitions (active filter criteria).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub filter_columns: Vec<domain_types::FilterColumnSpec>,
}

/// Sort state for a table (simplified representation for round-trip).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedTableSortState {
    /// Reference range for the sort
    pub ref_range: String,
    /// Whether sort is case sensitive
    #[serde(default, skip_serializing_if = "is_false")]
    pub case_sensitive: bool,
    /// Sort conditions
    pub conditions: Vec<ParsedTableSortCondition>,
}

/// A single sort condition within a table sort state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedTableSortCondition {
    /// Reference range for this sort condition
    pub ref_range: String,
    /// Whether this condition sorts descending
    #[serde(default, skip_serializing_if = "is_false")]
    pub descending: bool,
}

// Re-export A1 range parsing utilities from the canonical module.
pub use crate::infra::a1::{parse_a1_cell, parse_a1_range};

// =============================================================================
// Typed output structs (replace JSON blob strings)
// =============================================================================

/// Conditional formatting summary for parse output.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CfSummary {
    pub sqref: String,
    pub pivot: bool,
    pub rules_count: usize,
}

/// Data validation summary for parse output.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DvSummary {
    pub sqref: String,
    #[serde(rename = "type")]
    pub validation_type: String,
    pub operator: String,
    pub allow_blank: bool,
    /// First formula/value for validation criteria
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula1: Option<String>,
    /// Second formula (for between/notBetween operators)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula2: Option<String>,
    /// Whether to show the dropdown for list validations (inverted OOXML: showDropDown="1" hides it)
    #[serde(default = "default_true")]
    pub show_dropdown: bool,
    /// Error style: "stop", "warning", or "information"
    #[serde(default)]
    pub error_style: String,
    /// Whether to show error alert
    #[serde(default)]
    pub show_error: bool,
    /// Error alert title
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_title: Option<String>,
    /// Error alert message
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    /// Whether to show input prompt
    #[serde(default)]
    pub show_input: bool,
    /// Input prompt title
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_title: Option<String>,
    /// Input prompt message
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_message: Option<String>,
    /// IME mode for Asian locales (OOXML `imeMode`). Empty string means the
    /// attribute was absent (equivalent to the default `noControl`).
    #[serde(default)]
    pub ime_mode: String,
    /// Extension UID for revision tracking (xr:uid), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
}

fn default_true() -> bool {
    true
}

/// Hyperlink output for parse result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HyperlinkOutput {
    #[serde(rename = "ref")]
    pub cell_ref: String,
    pub location: String,
    pub display: String,
    pub tooltip: String,
    /// Relationship ID for external hyperlinks (r:id), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r_id: Option<String>,
    /// Extension UID for revision tracking (xr:uid), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
}

/// A run of formatted text within a comment (output form).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentRunOutput {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    pub bold: bool,
    pub italic: bool,
    /// Underline formatting, for round-trip fidelity.
    pub underline: bool,
    /// Strike-through formatting, for round-trip fidelity.
    pub strike: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Font color by indexed palette (e.g. 81 for comment default), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_indexed: Option<u32>,
    /// Font color by theme index, for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_theme: Option<u32>,
    /// Font color tint (used with theme colors), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_tint: Option<f64>,
    /// Font family (numeric, e.g. 2 = Swiss/sans-serif), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<u32>,
    /// Font scheme (e.g. "minor", "major"), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheme: Option<String>,
    /// Character set (e.g. 1 for DEFAULT_CHARSET), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub charset: Option<u32>,
    /// Vertical alignment ("superscript" or "subscript"), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vert_align: Option<String>,
    /// Whether the original `<t>` element had `xml:space="preserve"`, for round-trip fidelity.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub preserve_space: bool,
}

/// Comment output for parse result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentOutput {
    pub cell_ref: String,
    pub author_id: usize,
    pub text: String,
    /// Rich text runs preserving formatting for round-trip fidelity.
    pub runs: Vec<CommentRunOutput>,
    /// Shape ID (shapeId attribute), for VML round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape_id: Option<u32>,
    /// Excel revision UID (xr:uid attribute), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xr_uid: Option<String>,
}

/// Sheet protection output for parse result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionOutput {
    pub sheet: bool,
    pub objects: bool,
    pub scenarios: bool,
    pub format_cells: bool,
    pub format_columns: bool,
    pub format_rows: bool,
    pub insert_columns: bool,
    pub insert_rows: bool,
    pub insert_hyperlinks: bool,
    pub delete_columns: bool,
    pub delete_rows: bool,
    pub sort: bool,
    pub auto_filter: bool,
    pub pivot_tables: bool,
    pub select_locked_cells: bool,
    pub select_unlocked_cells: bool,
}

// =============================================================================
// Print Settings Output Structs
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarginsOutput {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
    pub header: f64,
    pub footer: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderFooterOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub odd_header: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub odd_footer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub even_header: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub even_footer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_header: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_footer: Option<String>,
    pub different_odd_even: bool,
    pub different_first: bool,
    /// Scale headers/footers with document scaling (None = not specified in original XML)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_with_doc: Option<bool>,
    /// Align headers/footers with page margins (None = not specified in original XML)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align_with_margins: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintSettingsOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paper_size: Option<u8>,
    pub orientation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale: Option<u16>,
    /// Fit to width in pages (None = attribute absent, Some(0) = auto/unlimited)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fit_to_width: Option<u16>,
    /// Fit to height in pages (None = attribute absent, Some(0) = auto/unlimited)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fit_to_height: Option<u16>,
    pub grid_lines: bool,
    pub headings: bool,
    pub horizontal_centered: bool,
    pub vertical_centered: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub margins: Option<MarginsOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_footer: Option<HeaderFooterOutput>,
    /// Whether a `<pageSetup>` element was present in the original XML.
    /// When false, the writer should not emit `<pageSetup>`.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub has_page_setup: bool,
    /// Whether a `<printOptions>` element was present in the original XML.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub has_print_options: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal_dpi: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical_dpi: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r_id: Option<String>,
    /// Whether to use printer defaults (None = attribute absent, Some = explicit).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_printer_defaults: Option<bool>,
    /// Page order for printing ("downThenOver" or "overThenDown").
    /// Preserved for round-trip fidelity even when it equals the default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_order: Option<String>,
    /// Whether to use the firstPageNumber value instead of automatic numbering.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub use_first_page_number: bool,
    /// First page number (None = attribute absent, Some(0) = auto).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_page_number: Option<u32>,
    /// Print in black and white.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub black_and_white: bool,
    /// Print in draft quality.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub draft: bool,
    /// How to print cell comments ("none", "atEnd", "asDisplayed").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell_comments: Option<String>,
    /// How to print cell errors ("displayed", "blank", "dash", "NA").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub print_errors: Option<String>,
    /// Number of copies to print.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub copies: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageBreakOutput {
    pub id: u32,
    pub min: u32,
    pub max: u32,
    pub man: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub pt: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageBreaksOutput {
    pub row_breaks: Vec<PageBreakOutput>,
    pub col_breaks: Vec<PageBreakOutput>,
}

// =============================================================================
// Alignment + Protection Output Structs
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentOutput {
    /// Horizontal alignment (ECMA-376 ST_HorizontalAlignment). Serializes as
    /// OOXML tokens like `"left"`, `"center"`, `"right"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal: Option<HorizontalAlign>,
    /// Vertical alignment (ECMA-376 ST_VerticalAlignment). Serializes as
    /// OOXML tokens like `"top"`, `"center"`, `"bottom"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical: Option<VerticalAlign>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wrap_text: Option<bool>,
    /// Text rotation (0-180, or 255 for stacked/vertical text per ECMA-376
    /// §18.8.1).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_rotation: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indent: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shrink_to_fit: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reading_order: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_indent: Option<bool>,
    /// Relative indent adjustment (ECMA-376 CT_CellAlignment/@relativeIndent).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_indent: Option<i32>,
    /// Whether to justify the last line (ECMA-376 CT_CellAlignment/@justifyLastLine).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub justify_last_line: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellProtectionOutput {
    pub locked: bool,
    pub hidden: bool,
}

// =============================================================================
// Sheet View Output
// =============================================================================

/// Sheet view output, converted from the canonical `ooxml_types::worksheet::SheetView`.
///
/// Uses camelCase serialization for backward compatibility with TS consumers.
/// Only non-default values are serialized.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetViewOutput {
    #[serde(skip_serializing_if = "is_true")]
    pub show_grid_lines: bool,
    #[serde(skip_serializing_if = "is_true")]
    pub show_row_col_headers: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub show_formulas: bool,
    #[serde(skip_serializing_if = "is_true")]
    pub show_zeros: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub tab_selected: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub right_to_left: bool,
    #[serde(skip_serializing_if = "is_true")]
    pub show_ruler: bool,
    #[serde(skip_serializing_if = "is_true")]
    pub show_outline_symbols: bool,
    #[serde(skip_serializing_if = "is_true")]
    pub show_white_space: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub window_protection: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_left_cell: Option<String>,
    #[serde(skip_serializing_if = "is_true")]
    pub default_grid_color: bool,
    #[serde(skip_serializing_if = "is_default_color_id")]
    pub color_id: u32,
    #[serde(skip_serializing_if = "is_default_zoom_scale")]
    pub zoom_scale: u32,
    #[serde(skip_serializing_if = "is_zero_u32")]
    pub zoom_scale_normal: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom_scale_page_layout_view: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom_scale_sheet_layout_view: Option<u32>,
    pub workbook_view_id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view: Option<String>,
    /// Preserved pane configuration (frozen or split) for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pane: Option<crate::common::range::SheetPane>,
    /// Preserved selection elements for round-trip fidelity.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub selections: Vec<ooxml_types::worksheet::Selection>,
}

/// Helper for skip_serializing_if on bool fields that default to true.
fn is_true(v: &bool) -> bool {
    *v
}

fn is_default_color_id(v: &u32) -> bool {
    *v == 64
}
fn is_default_zoom_scale(v: &u32) -> bool {
    *v == 100
}
fn is_zero_u32(v: &u32) -> bool {
    *v == 0
}

impl From<ooxml_types::worksheet::SheetView> for SheetViewOutput {
    fn from(sv: ooxml_types::worksheet::SheetView) -> Self {
        let view = if sv.view.is_default() {
            None
        } else {
            Some(sv.view.to_ooxml().to_string())
        };
        Self {
            show_grid_lines: sv.show_grid_lines,
            show_row_col_headers: sv.show_row_col_headers,
            show_formulas: sv.show_formulas,
            show_zeros: sv.show_zeros,
            tab_selected: sv.tab_selected,
            right_to_left: sv.right_to_left,
            show_ruler: sv.show_ruler,
            show_outline_symbols: sv.show_outline_symbols,
            show_white_space: sv.show_white_space,
            window_protection: sv.window_protection,
            top_left_cell: sv.top_left_cell,
            default_grid_color: sv.default_grid_color,
            color_id: sv.color_id,
            zoom_scale: sv.zoom_scale,
            zoom_scale_normal: sv.zoom_scale_normal,
            zoom_scale_page_layout_view: sv.zoom_scale_page_layout_view,
            zoom_scale_sheet_layout_view: sv.zoom_scale_sheet_layout_view,
            workbook_view_id: sv.workbook_view_id,
            view,
            pane: sv.pane,
            selections: sv.selections,
        }
    }
}

impl From<SheetViewOutput> for ooxml_types::worksheet::SheetView {
    fn from(sv: SheetViewOutput) -> Self {
        let view = sv
            .view
            .as_deref()
            .map(ooxml_types::worksheet::SheetViewType::from_ooxml)
            .unwrap_or_default();
        Self {
            show_grid_lines: sv.show_grid_lines,
            show_row_col_headers: sv.show_row_col_headers,
            show_formulas: sv.show_formulas,
            show_zeros: sv.show_zeros,
            tab_selected: sv.tab_selected,
            right_to_left: sv.right_to_left,
            show_ruler: sv.show_ruler,
            show_outline_symbols: sv.show_outline_symbols,
            show_white_space: sv.show_white_space,
            window_protection: sv.window_protection,
            top_left_cell: sv.top_left_cell,
            default_grid_color: sv.default_grid_color,
            color_id: sv.color_id,
            zoom_scale: sv.zoom_scale,
            zoom_scale_normal: sv.zoom_scale_normal,
            zoom_scale_page_layout_view: sv.zoom_scale_page_layout_view,
            zoom_scale_sheet_layout_view: sv.zoom_scale_sheet_layout_view,
            workbook_view_id: sv.workbook_view_id,
            view,
            pane: sv.pane,
            pivot_selection: Vec::new(),
            selections: sv.selections,
        }
    }
}

/// Sparkline summary for parse output.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SparklineSummary {
    #[serde(rename = "type")]
    pub sparkline_type: String,
    pub sparklines_count: usize,
}

/// Defined name output for parse result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinedNameOutput {
    pub name: String,
    pub refers_to: String,
    pub local_sheet_id: Option<u32>,
    pub hidden: bool,
    /// Comment/description for the name (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// Description text (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Help topic text (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
    /// Status bar text (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_bar: Option<String>,
    /// Custom menu text (optional, for XLM macros)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_menu: Option<String>,
    /// Whether this name is a function (XLM macro function)
    #[serde(skip_serializing_if = "is_false")]
    pub function: bool,
    /// Whether this is a VBA procedure name
    #[serde(skip_serializing_if = "is_false")]
    pub vb_procedure: bool,
    /// Whether this is an XLM macro
    #[serde(skip_serializing_if = "is_false")]
    pub xlm: bool,
    /// Whether to publish this name to the server (SharePoint)
    #[serde(skip_serializing_if = "is_false")]
    pub publish_to_server: bool,
    /// Whether this name is a workbook parameter (for web queries)
    #[serde(skip_serializing_if = "is_false")]
    pub workbook_parameter: bool,
    /// Whether xml:space="preserve" should be emitted
    #[serde(skip_serializing_if = "is_false")]
    pub xml_space_preserve: bool,
}

// =============================================================================
// StylesOutput — structured replacement for JSON string serialization
// =============================================================================

use crate::domain::styles::read::{
    BorderDef, BorderSideDef, CellStyleDef, CellXfDef, ColorDef, FillDef, FontDef, Stylesheet,
};

/// Structured styles output matching the TS `ParsedStyles` interface.
/// Replaces the old `build_styles_json()` string approach with proper
/// serde camelCase serialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StylesOutput {
    pub number_formats: Vec<NumberFormatOutput>,
    pub fonts: Vec<FontOutput>,
    pub fills: Vec<FillOutput>,
    pub borders: Vec<BorderOutput>,
    pub cell_xfs: Vec<CellXfOutput>,
    pub cell_style_xfs: Vec<CellXfOutput>,
    pub cell_styles: Vec<CellStyleOutput>,
    /// Whether the `x14ac:knownFonts` attribute was set on the `<fonts>` element.
    /// Indicates the producing application verified all fonts are available.
    #[serde(skip_serializing_if = "is_false")]
    pub known_fonts: bool,
    /// Raw FontDef data for round-trip fidelity (preserves Option<bool> for bold/italic).
    /// Not serialized to TypeScript — used only by the write path.
    #[serde(skip)]
    pub raw_fonts: Vec<ooxml_types::styles::FontDef>,
    /// Raw CellXfDef data for round-trip fidelity (preserves Option<bool> for apply* flags).
    /// Not serialized to TypeScript — used only by the write path.
    #[serde(skip)]
    pub raw_cell_xfs: Vec<ooxml_types::styles::CellXfDef>,
    /// Raw CellXfDef data for round-trip fidelity (preserves Option<bool> for apply* flags).
    /// Not serialized to TypeScript — used only by the write path.
    #[serde(skip)]
    pub raw_cell_style_xfs: Vec<ooxml_types::styles::CellXfDef>,
    /// Default table style name for round-trip fidelity.
    /// Not serialized to TypeScript — used only by the write path.
    #[serde(skip)]
    pub default_table_style: Option<String>,
    /// Default pivot table style name for round-trip fidelity.
    /// Not serialized to TypeScript — used only by the write path.
    #[serde(skip)]
    pub default_pivot_style: Option<String>,
    /// Raw DxfDef data for round-trip fidelity (differential formatting records).
    /// Not serialized to TypeScript — used only by the write path.
    #[serde(skip)]
    pub raw_dxfs: Vec<ooxml_types::styles::DxfDef>,
    /// Raw ColorsDef for round-trip fidelity (custom color palette).
    /// Not serialized to TypeScript — used only by the write path.
    #[serde(skip)]
    pub raw_colors: Option<ooxml_types::styles::ColorsDef>,
    /// Raw TableStyleDef data for round-trip fidelity.
    /// Not serialized to TypeScript — used only by the write path.
    #[serde(skip)]
    pub raw_table_styles: Vec<ooxml_types::styles::TableStyleDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NumberFormatOutput {
    pub id: u32,
    pub format_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rgb: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tint: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indexed: Option<u32>,
    #[serde(skip_serializing_if = "is_false")]
    pub auto: bool,
    /// Original tint string for round-trip fidelity (preserves scientific notation).
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub raw_tint: Option<String>,
}

impl From<&ColorDef> for ColorOutput {
    fn from(c: &ColorDef) -> Self {
        fn parse_tint(t: &Option<String>) -> Option<f64> {
            t.as_deref().and_then(|s| s.parse::<f64>().ok())
        }
        match c {
            ColorDef::Theme { id, tint } => Self {
                rgb: None,
                theme: Some(*id),
                tint: parse_tint(tint),
                indexed: None,
                auto: false,
                raw_tint: tint.clone(),
            },
            ColorDef::Rgb { val, tint } => Self {
                rgb: Some(val.clone()),
                theme: None,
                tint: parse_tint(tint),
                indexed: None,
                auto: false,
                raw_tint: tint.clone(),
            },
            ColorDef::Indexed { id, tint } => Self {
                rgb: None,
                theme: None,
                tint: parse_tint(tint),
                indexed: Some(*id),
                auto: false,
                raw_tint: tint.clone(),
            },
            ColorDef::Auto { tint } => Self {
                rgb: None,
                theme: None,
                tint: parse_tint(tint),
                indexed: None,
                auto: true,
                raw_tint: tint.clone(),
            },
        }
    }
}

/// Serde helper: serialize an ooxml-types enum via `to_ooxml()`.
mod serde_ooxml_output {
    use serde::Serializer;

    pub mod opt_underline_style {
        use super::*;
        use crate::domain::styles::read::UnderlineStyle;

        pub fn serialize<S: Serializer>(
            val: &Option<UnderlineStyle>,
            ser: S,
        ) -> Result<S::Ok, S::Error> {
            match val {
                Some(u) => ser.serialize_str(u.to_ooxml()),
                None => ser.serialize_str("none"),
            }
        }
    }

    pub mod pattern_type {
        use super::*;
        use crate::domain::styles::read::PatternType;

        pub fn serialize<S: Serializer>(val: &PatternType, ser: S) -> Result<S::Ok, S::Error> {
            ser.serialize_str(val.to_ooxml())
        }
    }

    pub mod border_style {
        use super::*;
        use crate::domain::styles::read::BorderStyle;

        pub fn serialize<S: Serializer>(val: &BorderStyle, ser: S) -> Result<S::Ok, S::Error> {
            ser.serialize_str(val.to_ooxml())
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontOutput {
    pub name: String,
    pub size: f64,
    pub bold: bool,
    pub italic: bool,
    #[serde(serialize_with = "serde_ooxml_output::opt_underline_style::serialize")]
    pub underline: Option<UnderlineStyle>,
    pub strikethrough: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<ColorOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub family: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vert_align: Option<String>,
}

impl From<&FontDef> for FontOutput {
    fn from(f: &FontDef) -> Self {
        Self {
            name: f.name.clone().unwrap_or_default(),
            size: f.size.unwrap_or(0.0),
            bold: f.bold.unwrap_or(false),
            italic: f.italic.unwrap_or(false),
            underline: f.underline,
            strikethrough: f.strikethrough.unwrap_or(false),
            color: f.color.as_ref().map(ColorOutput::from),
            family: f.family,
            scheme: f.scheme.map(|s| s.to_ooxml().to_string()),
            vert_align: f.vert_align.map(|v| v.to_ooxml().to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FillOutput {
    /// Fill type — "pattern" or "gradient"
    #[serde(rename = "type")]
    pub fill_type: String,
    #[serde(serialize_with = "serde_ooxml_output::pattern_type::serialize")]
    pub pattern_type: PatternType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fg_color: Option<ColorOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bg_color: Option<ColorOutput>,
    /// Gradient fill data (only present when fill_type == "gradient").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gradient: Option<GradientFillOutput>,
}

/// Gradient fill output for serialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradientFillOutput {
    /// "linear" or "path".
    pub gradient_type: String,
    /// Angle in degrees for linear gradients.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub degree: Option<f64>,
    /// Color stops.
    pub stops: Vec<GradientStopOutput>,
    /// Fill-to rectangle boundaries for path gradients.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bottom: Option<f64>,
}

/// A gradient color stop for output.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradientStopOutput {
    /// Position along gradient (0.0 to 1.0).
    pub position: f64,
    /// Color at this position.
    pub color: ColorOutput,
}

impl From<&FillDef> for FillOutput {
    fn from(f: &FillDef) -> Self {
        match f {
            FillDef::None => Self {
                fill_type: "pattern".to_string(),
                pattern_type: PatternType::None,
                fg_color: None,
                bg_color: None,
                gradient: None,
            },
            FillDef::Solid { fg_color } => Self {
                fill_type: "pattern".to_string(),
                pattern_type: PatternType::Solid,
                fg_color: Some(ColorOutput::from(fg_color)),
                bg_color: None,
                gradient: None,
            },
            FillDef::Pattern {
                pattern_type,
                fg_color,
                bg_color,
            } => Self {
                fill_type: "pattern".to_string(),
                pattern_type: pattern_type.unwrap_or(PatternType::None),
                fg_color: fg_color.as_ref().map(ColorOutput::from),
                bg_color: bg_color.as_ref().map(ColorOutput::from),
                gradient: None,
            },
            FillDef::Gradient {
                gradient_type,
                degree,
                stops,
                left,
                right,
                top,
                bottom,
            } => Self {
                fill_type: "gradient".to_string(),
                pattern_type: PatternType::None,
                fg_color: None,
                bg_color: None,
                gradient: Some(GradientFillOutput {
                    gradient_type: match gradient_type {
                        ooxml_types::styles::GradientType::Linear => "linear".to_string(),
                        ooxml_types::styles::GradientType::Path => "path".to_string(),
                    },
                    degree: *degree,
                    stops: stops
                        .iter()
                        .map(|s| GradientStopOutput {
                            position: s.position,
                            color: ColorOutput::from(&s.color),
                        })
                        .collect(),
                    left: *left,
                    right: *right,
                    top: *top,
                    bottom: *bottom,
                }),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BorderSideOutput {
    #[serde(serialize_with = "serde_ooxml_output::border_style::serialize")]
    pub style: crate::domain::styles::read::BorderStyle,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<ColorOutput>,
}

impl From<&BorderSideDef> for BorderSideOutput {
    fn from(s: &BorderSideDef) -> Self {
        Self {
            style: s.style,
            color: s.color.as_ref().map(ColorOutput::from),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BorderOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left: Option<BorderSideOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right: Option<BorderSideOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top: Option<BorderSideOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bottom: Option<BorderSideOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagonal: Option<BorderSideOutput>,
    /// `None` = `@diagonalUp` absent on the OOXML element; `Some(bool)` =
    /// explicit attribute value. Distinguishing absent from `Some(false)`
    /// is required for styles-blob round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagonal_up: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagonal_down: Option<bool>,
}

impl From<&BorderDef> for BorderOutput {
    fn from(b: &BorderDef) -> Self {
        Self {
            left: b.left.as_ref().map(BorderSideOutput::from),
            right: b.right.as_ref().map(BorderSideOutput::from),
            top: b.top.as_ref().map(BorderSideOutput::from),
            bottom: b.bottom.as_ref().map(BorderSideOutput::from),
            diagonal: b.diagonal.as_ref().map(BorderSideOutput::from),
            diagonal_up: b.diagonal_up,
            diagonal_down: b.diagonal_down,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellXfOutput {
    /// TS expects `numFmtId`, not `numberFormatId`
    #[serde(rename = "numFmtId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_format_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply_number_format: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply_font: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply_fill: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply_border: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xf_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply_alignment: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alignment: Option<AlignmentOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply_protection: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protection: Option<CellProtectionOutput>,
}

impl From<&CellXfDef> for CellXfOutput {
    fn from(xf: &CellXfDef) -> Self {
        Self {
            number_format_id: xf.num_fmt_id,
            font_id: xf.font_id,
            fill_id: xf.fill_id,
            border_id: xf.border_id,
            apply_number_format: xf.apply_number_format,
            apply_font: xf.apply_font,
            apply_fill: xf.apply_fill,
            apply_border: xf.apply_border,
            xf_id: xf.xf_id,
            apply_alignment: xf.apply_alignment,
            alignment: xf.alignment.as_ref().map(|a| AlignmentOutput {
                horizontal: a.horizontal,
                vertical: a.vertical,
                // Preserve `Some(false)` as well as `Some(true)` — collapsing
                // explicit-false to absent loses the inheritance override.
                wrap_text: a.wrap_text,
                text_rotation: a.text_rotation.map(|v| v as u16),
                indent: a.indent,
                shrink_to_fit: a.shrink_to_fit,
                reading_order: a.reading_order,
                auto_indent: a.auto_indent,
                relative_indent: a.relative_indent,
                justify_last_line: a.justify_last_line,
            }),
            apply_protection: xf.apply_protection,
            protection: xf.protection.as_ref().map(|p| CellProtectionOutput {
                locked: p.locked.unwrap_or(true),
                hidden: p.hidden.unwrap_or(false),
            }),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellStyleOutput {
    pub name: Option<String>,
    pub xf_id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub builtin_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_builtin: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub i_level: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    /// Revision UID (xr:uid attribute) for co-authoring / revision tracking.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xr_uid: Option<String>,
}

impl From<&CellStyleDef> for CellStyleOutput {
    fn from(cs: &CellStyleDef) -> Self {
        Self {
            name: cs.name.clone(),
            xf_id: cs.xf_id,
            builtin_id: cs.builtin_id,
            custom_builtin: cs.custom_builtin,
            i_level: cs.i_level,
            hidden: cs.hidden,
            xr_uid: cs.xr_uid.clone(),
        }
    }
}

impl From<&Stylesheet> for StylesOutput {
    fn from(s: &Stylesheet) -> Self {
        Self {
            number_formats: s
                .num_fmts
                .iter()
                .map(|nf| NumberFormatOutput {
                    id: nf.id,
                    format_code: nf.format_code.clone(),
                })
                .collect(),
            fonts: s.fonts.iter().map(FontOutput::from).collect(),
            fills: s.fills.iter().map(FillOutput::from).collect(),
            borders: s.borders.iter().map(BorderOutput::from).collect(),
            cell_xfs: s.cell_xfs.iter().map(CellXfOutput::from).collect(),
            cell_style_xfs: s.cell_style_xfs.iter().map(CellXfOutput::from).collect(),
            cell_styles: s.cell_styles.iter().map(CellStyleOutput::from).collect(),
            // known_fonts is parsed separately from the <fonts> element attribute,
            // not from Stylesheet. Default to false here; caller sets it explicitly.
            known_fonts: false,
            raw_fonts: Vec::new(),
            raw_cell_xfs: Vec::new(),
            raw_cell_style_xfs: Vec::new(),
            default_table_style: s.default_table_style.clone(),
            default_pivot_style: s.default_pivot_style.clone(),
            raw_dxfs: s.dxfs.clone(),
            raw_colors: s.colors.clone(),
            raw_table_styles: s.table_styles.clone(),
        }
    }
}

// =============================================================================
// Print Settings Conversion
// =============================================================================

impl From<&crate::domain::print::PageMargins> for MarginsOutput {
    fn from(m: &crate::domain::print::PageMargins) -> Self {
        Self {
            top: m.top,
            right: m.right,
            bottom: m.bottom,
            left: m.left,
            header: m.header,
            footer: m.footer,
        }
    }
}

impl From<&crate::domain::print::HeaderFooter> for HeaderFooterOutput {
    fn from(hf: &crate::domain::print::HeaderFooter) -> Self {
        Self {
            odd_header: hf.odd_header.clone(),
            odd_footer: hf.odd_footer.clone(),
            even_header: hf.even_header.clone(),
            even_footer: hf.even_footer.clone(),
            first_header: hf.first_header.clone(),
            first_footer: hf.first_footer.clone(),
            different_odd_even: hf.different_odd_even,
            different_first: hf.different_first,
            scale_with_doc: hf.scale_with_doc,
            align_with_margins: hf.align_with_margins,
        }
    }
}

impl From<&crate::domain::print::PageBreak> for PageBreakOutput {
    fn from(b: &crate::domain::print::PageBreak) -> Self {
        Self {
            id: b.id,
            min: b.min,
            max: b.max,
            man: b.manual,
            pt: b.pt,
        }
    }
}

/// Build structured print settings + page breaks from the parsed PrintSettings.
///
/// Returns `(print_settings, page_breaks)`. Both are `None` if no settings are present.
pub fn build_print_settings_output(
    ps: &crate::domain::print::PrintSettings,
) -> (Option<PrintSettingsOutput>, Option<PageBreaksOutput>) {
    if !ps.has_settings() {
        return (None, None);
    }

    let page_setup = ps.page_setup.as_ref();
    let print_options = ps.print_options.as_ref();

    let settings = PrintSettingsOutput {
        paper_size: page_setup.and_then(|p| p.paper_size.map(|ps| ps.as_u32() as u8)),
        orientation: page_setup
            .map(|p| p.orientation.to_ooxml().to_string())
            .unwrap_or_else(|| "default".to_string()),
        scale: page_setup.and_then(|p| p.scale),
        fit_to_width: page_setup.and_then(|p| p.fit_to_width),
        fit_to_height: page_setup.and_then(|p| p.fit_to_height),
        grid_lines: print_options.map(|o| o.grid_lines).unwrap_or(false),
        headings: print_options.map(|o| o.headings).unwrap_or(false),
        horizontal_centered: print_options
            .map(|o| o.horizontal_centered)
            .unwrap_or(false),
        vertical_centered: print_options.map(|o| o.vertical_centered).unwrap_or(false),
        margins: ps.page_margins.as_ref().map(MarginsOutput::from),
        header_footer: ps.header_footer.as_ref().map(HeaderFooterOutput::from),
        has_page_setup: page_setup.is_some(),
        has_print_options: print_options.is_some(),
        horizontal_dpi: page_setup.and_then(|p| p.horizontal_dpi),
        vertical_dpi: page_setup.and_then(|p| p.vertical_dpi),
        r_id: page_setup.and_then(|p| p.r_id.clone()),
        use_printer_defaults: page_setup.and_then(|p| p.use_printer_defaults),
        page_order: page_setup.and_then(|p| p.page_order.map(|po| po.to_ooxml().to_string())),
        use_first_page_number: page_setup.map(|p| p.use_first_page_number).unwrap_or(false),
        first_page_number: page_setup.and_then(|p| p.first_page_number),
        black_and_white: page_setup.map(|p| p.black_and_white).unwrap_or(false),
        draft: page_setup.map(|p| p.draft).unwrap_or(false),
        cell_comments: page_setup.and_then(|p| {
            let s = p.cell_comments.to_ooxml();
            if s == "none" {
                None
            } else {
                Some(s.to_string())
            }
        }),
        print_errors: page_setup.and_then(|p| {
            let s = p.errors.to_ooxml();
            if s == "displayed" {
                None
            } else {
                Some(s.to_string())
            }
        }),
        copies: page_setup.and_then(|p| p.copies),
    };

    let row_breaks: Vec<PageBreakOutput> = ps
        .row_breaks
        .as_ref()
        .map(|rb| rb.breaks.iter().map(PageBreakOutput::from).collect())
        .unwrap_or_default();

    let col_breaks: Vec<PageBreakOutput> = ps
        .col_breaks
        .as_ref()
        .map(|cb| cb.breaks.iter().map(PageBreakOutput::from).collect())
        .unwrap_or_default();

    let page_breaks = if row_breaks.is_empty() && col_breaks.is_empty() {
        None
    } else {
        Some(PageBreaksOutput {
            row_breaks,
            col_breaks,
        })
    };

    (Some(settings), page_breaks)
}

// =============================================================================
// PivotTableOutput and ChartImportOutput — REMOVED
// =============================================================================
// These intermediate types have been removed. The parser now produces
// `domain_types::PivotSpec` and `domain_types::ChartSpec` directly.
// See `domain/pivot/read.rs` and `domain/charts/read.rs`.

// =============================================================================
// SmartArt Output Types
// =============================================================================

/// Raw XML parts for a single SmartArt diagram, serialized for TypeScript.
///
/// Each field contains the raw XML content of the corresponding diagram part.
/// The TypeScript side will parse these XML blobs to build the SmartArt rendering model.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartArtPartsOutput {
    /// Index of the graphicFrame anchor in the drawing (for position correlation)
    pub anchor_index: usize,
    /// `xl/diagrams/data{N}.xml` — `<dgm:dataModel>` (node tree, text, connections)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_xml: Option<String>,
    /// `xl/diagrams/layout{N}.xml` — `<dgm:layoutDef>` (layout algorithm definition)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout_xml: Option<String>,
    /// `xl/diagrams/colors{N}.xml` — `<dgm:colorsDef>` (color transform)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub colors_xml: Option<String>,
    /// `xl/diagrams/quickStyles{N}.xml` — `<dgm:styleDef>` (style definition)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style_xml: Option<String>,
    /// `xl/diagrams/drawing{N}.xml` — `<dsp:drawing>` (pre-rendered drawing cache, MS extension)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drawing_xml: Option<String>,
}

// =============================================================================
// FormControlOutput
// =============================================================================

/// Serializable form control output for WASM consumers.
///
/// Mirrors all CT_FormControlPr attributes plus anchor and VML data
/// for lossless roundtrip and rendering on the TypeScript side.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormControlOutput {
    /// ST_ObjectType value (e.g. "CheckBox", "ComboBox", "Button")
    pub object_type: String,
    /// VML shape identifier
    pub shape_id: u32,
    /// Human-readable control name
    pub name: Option<String>,
    /// Alternative text for accessibility
    pub alt_text: Option<String>,

    // --- Formula references ---
    /// Linked cell formula (fmlaLink)
    pub fmla_link: Option<String>,
    /// Input range formula (fmlaRange)
    pub fmla_range: Option<String>,
    /// Group formula (fmlaGroup)
    pub fmla_group: Option<String>,
    /// Text box formula (fmlaTxbx)
    pub fmla_txbx: Option<String>,

    // --- State fields ---
    /// Check state: "Unchecked", "Checked", or "Mixed"
    pub checked: Option<String>,
    /// Current value for scroll/spin
    pub val: Option<u32>,
    /// Selected index for list/combo
    pub sel: Option<u32>,
    /// Minimum value for scroll/spin
    pub min: Option<i32>,
    /// Maximum value for scroll/spin
    pub max: Option<i32>,
    /// Increment for scroll/spin
    pub inc: Option<i32>,
    /// Page increment for scroll bar
    pub page: Option<i32>,

    // --- Appearance fields ---
    /// Number of visible drop lines for combo/list
    pub drop_lines: Option<u32>,
    /// Drop style for combo box
    pub drop_style: Option<String>,
    /// Scroll bar width in pixels
    pub dx: Option<u32>,
    /// Horizontal orientation for scroll/spin
    pub horiz: bool,
    /// Whether the control uses colored appearance
    pub colored: bool,
    /// Flat appearance for control border
    pub no_three_d: bool,
    /// Flat appearance for control text
    pub no_three_d2: bool,

    // --- Behavior fields ---
    /// Whether this is the first button in a radio group
    pub first_button: bool,
    /// Prevents text editing on control
    pub lock_text: bool,
    /// Selection type for list box
    pub sel_type: Option<String>,
    /// Multiple selection mode
    pub multi_sel: Option<String>,
    /// Text horizontal alignment
    pub text_h_align: Option<String>,
    /// Text vertical alignment
    pub text_v_align: Option<String>,
    /// Edit validation type
    pub edit_val: Option<String>,
    /// Multi-line text box
    pub multi_line: bool,
    /// Vertical scroll bar
    pub vertical_bar: bool,
    /// Password edit mode
    pub password_edit: bool,
    /// Justify last line
    pub just_last_x: bool,
    /// Minimum width
    pub width_min: Option<u32>,

    // --- List items ---
    /// Items from <itemLst> child element
    pub items: Vec<String>,

    // --- Macro ---
    /// Assigned macro name
    pub macro_name: Option<String>,

    // --- Anchor data ---
    /// Starting column (0-indexed)
    pub from_col: u32,
    /// X offset from column start
    pub from_col_offset: i64,
    /// Starting row (0-indexed)
    pub from_row: u32,
    /// Y offset from row start
    pub from_row_offset: i64,
    /// Ending column (0-indexed)
    pub to_col: u32,
    /// X offset at end column
    pub to_col_offset: i64,
    /// Ending row (0-indexed)
    pub to_row: u32,
    /// Y offset at end row
    pub to_row_offset: i64,
    /// "Modern" (EMU offsets) or "Vml" (pixel offsets)
    pub anchor_source: String,

    // --- VML extras ---
    /// VML-only CT_ClientData children with no modern equivalent (tag-name -> text-content)
    pub vml_extras: std::collections::HashMap<String, String>,

    // --- Worksheet-level controlPr attributes ---
    /// Raw attributes from the worksheet `<controlPr>` element for round-trip fidelity.
    pub control_pr_attrs: std::collections::HashMap<String, String>,

    // --- Anchor positioning policy ---
    /// Whether the control moves with the cells it is anchored to.
    #[serde(default)]
    pub move_with_cells: bool,
    /// Whether the control resizes with the cells it is anchored to.
    #[serde(default)]
    pub size_with_cells: bool,

    // --- VML shape-level visual properties ---
    /// VML shape visual properties for round-trip fidelity.
    #[serde(default)]
    pub vml_shape: crate::domain::controls::read::VmlShapeProps,
}

impl FormControlOutput {
    /// Convert a `FormControlOutput` (WASM-serializable) back into a `FormControl` (parser-internal).
    ///
    /// This is the reverse of `from_form_control()` and enables semantic round-trip:
    /// parse → FormControlOutput → FormControl → ControlsWriter → ctrlProp XML.
    pub fn to_form_control(&self) -> crate::domain::controls::read::FormControl {
        use crate::domain::controls::read::{
            AnchorSource, CheckState, ControlAnchor, FormControl, FormControlProperties,
            FormControlType,
        };

        let object_type = FormControlType::from_str(&self.object_type);
        let checked = self.checked.as_deref().map(CheckState::from_str);

        let anchor_source = match self.anchor_source.as_str() {
            "Modern" => AnchorSource::Modern,
            _ => AnchorSource::Vml,
        };

        let anchor = ControlAnchor {
            from_col: self.from_col,
            from_col_offset: self.from_col_offset,
            from_row: self.from_row,
            from_row_offset: self.from_row_offset,
            to_col: self.to_col,
            to_col_offset: self.to_col_offset,
            to_row: self.to_row,
            to_row_offset: self.to_row_offset,
            anchor_source,
        };

        let properties = FormControlProperties {
            name: self.name.clone(),
            alt_text: self.alt_text.clone(),
            linked_cell: self.fmla_link.clone(),
            input_range: self.fmla_range.clone(),
            fmla_group: self.fmla_group.clone(),
            fmla_txbx: self.fmla_txbx.clone(),
            checked,
            val: self.val,
            sel: self.sel,
            min_value: self.min,
            max_value: self.max,
            increment: self.inc,
            page_increment: self.page,
            drop_lines: self.drop_lines,
            sel_type: self.sel_type.clone(),
            drop_style: self.drop_style.clone(),
            macro_name: self.macro_name.clone(),
            colored: self.colored,
            dx: self.dx,
            horiz: self.horiz,
            first_button: self.first_button,
            no_three_d: self.no_three_d,
            no_three_d2: self.no_three_d2,
            lock_text: self.lock_text,
            multi_sel: self.multi_sel.clone(),
            text_h_align: self.text_h_align.clone(),
            text_v_align: self.text_v_align.clone(),
            edit_val: self.edit_val.clone(),
            multi_line: self.multi_line,
            vertical_bar: self.vertical_bar,
            password_edit: self.password_edit,
            just_last_x: self.just_last_x,
            width_min: self.width_min,
            items: self.items.clone(),
            vml_extras: self.vml_extras.clone(),
        };

        FormControl {
            object_type,
            anchor,
            properties,
            shape_id: Some(self.shape_id),
            control_pr_attrs: self.control_pr_attrs.clone(),
            move_with_cells: self.move_with_cells,
            size_with_cells: self.size_with_cells,
            vml_shape: self.vml_shape.clone(),
        }
    }

    /// Convert a `FormControl` (parser-internal) into a `FormControlOutput` (WASM-serializable).
    ///
    /// `shape_id` is provided externally because it comes from the worksheet-level
    /// `<control shapeId="...">` element, not from the ctrlProp XML.
    pub fn from_form_control(
        fc: &crate::domain::controls::read::FormControl,
        shape_id: u32,
    ) -> Self {
        use crate::domain::controls::read::{AnchorSource, CheckState};

        let checked = fc.properties.checked.map(|c| match c {
            CheckState::Unchecked => "Unchecked".to_string(),
            CheckState::Checked => "Checked".to_string(),
            CheckState::Mixed => "Mixed".to_string(),
        });

        let anchor_source = match fc.anchor.anchor_source {
            AnchorSource::Modern => "Modern".to_string(),
            AnchorSource::Vml => "Vml".to_string(),
        };

        Self {
            object_type: fc.object_type.to_string(),
            shape_id,
            name: fc.properties.name.clone(),
            alt_text: fc.properties.alt_text.clone(),
            fmla_link: fc.properties.linked_cell.clone(),
            fmla_range: fc.properties.input_range.clone(),
            fmla_group: fc.properties.fmla_group.clone(),
            fmla_txbx: fc.properties.fmla_txbx.clone(),
            checked,
            val: fc.properties.val,
            sel: fc.properties.sel,
            min: fc.properties.min_value,
            max: fc.properties.max_value,
            inc: fc.properties.increment,
            page: fc.properties.page_increment,
            drop_lines: fc.properties.drop_lines,
            drop_style: fc.properties.drop_style.clone(),
            dx: fc.properties.dx,
            horiz: fc.properties.horiz,
            colored: fc.properties.colored,
            no_three_d: fc.properties.no_three_d,
            no_three_d2: fc.properties.no_three_d2,
            first_button: fc.properties.first_button,
            lock_text: fc.properties.lock_text,
            sel_type: fc.properties.sel_type.clone(),
            multi_sel: fc.properties.multi_sel.clone(),
            text_h_align: fc.properties.text_h_align.clone(),
            text_v_align: fc.properties.text_v_align.clone(),
            edit_val: fc.properties.edit_val.clone(),
            multi_line: fc.properties.multi_line,
            vertical_bar: fc.properties.vertical_bar,
            password_edit: fc.properties.password_edit,
            just_last_x: fc.properties.just_last_x,
            width_min: fc.properties.width_min,
            items: fc.properties.items.clone(),
            macro_name: fc.properties.macro_name.clone(),
            from_col: fc.anchor.from_col,
            from_col_offset: fc.anchor.from_col_offset,
            from_row: fc.anchor.from_row,
            from_row_offset: fc.anchor.from_row_offset,
            to_col: fc.anchor.to_col,
            to_col_offset: fc.anchor.to_col_offset,
            to_row: fc.anchor.to_row,
            to_row_offset: fc.anchor.to_row_offset,
            anchor_source,
            vml_extras: fc.properties.vml_extras.clone(),
            control_pr_attrs: fc.control_pr_attrs.clone(),
            move_with_cells: fc.move_with_cells,
            size_with_cells: fc.size_with_cells,
            vml_shape: fc.vml_shape.clone(),
        }
    }
}

// =============================================================================
// OleObjectOutput
// =============================================================================

/// Serializable OLE object output for WASM consumers.
///
/// Mirrors the enriched CT_OleObject attributes plus objectPr child data
/// and preview image paths for rendering on the TypeScript side.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OleObjectOutput {
    /// Program ID (e.g., "Excel.Sheet.12", "Word.Document.12")
    pub prog_id: String,
    /// Shape ID in the VML drawing
    pub shape_id: u32,
    /// Relationship ID for the embedded binary part
    pub r_id: Option<String>,
    /// Resolved path to the embedded binary blob (e.g., "xl/embeddings/oleObject1.bin")
    pub data_path: Option<String>,
    /// Object name
    pub name: Option<String>,
    /// Path to linked data (external file)
    pub link: Option<String>,
    /// Display aspect: "DVASPECT_CONTENT" or "DVASPECT_ICON"
    pub dv_aspect: String,
    /// Update mode: "OLEUPDATE_ALWAYS" or "OLEUPDATE_ONCALL"
    pub ole_update: String,
    /// Whether to auto-load on workbook open
    pub auto_load: bool,
    /// VML relationship ID for the preview image
    pub preview_image_rel_id: Option<String>,
    /// Resolved path to the preview image (e.g., "xl/media/image1.png")
    pub preview_image_path: Option<String>,
    /// Object properties from `<objectPr>` child element
    pub object_pr: Option<OleObjectPropertiesOutput>,
}

// `OleObjectPropertiesOutput` / `OleObjectAnchorOutput` / `OleAnchorPointOutput`
// have moved to `domain-types::domain::drawings::ole_object` (typed OOXML preservation
// inventory row 1.7) under their plain domain names (`OleObjectProperties`,
// `OleObjectAnchor`, `OleAnchorPoint`). Alias the historical `*Output` names
// here so the `OleObjectOutput` struct and WASM JSON consumers compile
// unchanged.
pub use domain_types::domain::drawings::{
    OleAnchorPoint as OleAnchorPointOutput, OleObjectAnchor as OleObjectAnchorOutput,
    OleObjectProperties as OleObjectPropertiesOutput,
};

impl OleObjectOutput {
    /// Convert an `OleObject` (parser-internal) into an `OleObjectOutput` (WASM-serializable).
    pub fn from_ole_object(obj: &crate::domain::controls::read::OleObject) -> Self {
        let object_pr = obj.object_pr.as_ref().map(|pr| {
            let anchor = pr.anchor.as_ref().map(|a| OleObjectAnchorOutput {
                move_with_cells: a.move_with_cells,
                size_with_cells: a.size_with_cells,
                from: OleAnchorPointOutput {
                    col: a.from.col,
                    col_off: a.from.col_offset,
                    row: a.from.row,
                    row_off: a.from.row_offset,
                },
                to: OleAnchorPointOutput {
                    col: a.to.col,
                    col_off: a.to.col_offset,
                    row: a.to.row,
                    row_off: a.to.row_offset,
                },
            });

            OleObjectPropertiesOutput {
                default_size: pr.default_size,
                print: pr.print,
                disabled: pr.disabled,
                locked: pr.locked,
                auto_fill: pr.auto_fill,
                auto_line: pr.auto_line,
                auto_pict: pr.auto_pict,
                r#macro: pr.r#macro.clone(),
                alt_text: pr.alt_text.clone(),
                dde: pr.dde,
                anchor,
            }
        });

        Self {
            prog_id: obj.prog_id.clone(),
            shape_id: obj.shape_id,
            r_id: obj.r_id.clone(),
            data_path: obj.data_path.clone(),
            name: obj.name.clone(),
            link: obj.link_path.clone(),
            dv_aspect: obj.dv_aspect.to_ooxml().to_string(),
            ole_update: obj.ole_update.to_ooxml().to_string(),
            auto_load: obj.auto_load,
            preview_image_rel_id: obj.preview_image_rel_id.clone(),
            preview_image_path: obj.preview_image_path.clone(),
            object_pr,
        }
    }
}

// =============================================================================
// FullParsedSheet
// =============================================================================

/// A fully parsed sheet with all features
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullParsedSheet {
    /// Sheet name
    pub name: String,
    /// 0-based sheet index
    pub index: usize,
    /// Original sheetId from workbook.xml (preserved for round-trip fidelity).
    #[serde(skip)]
    pub sheet_id: Option<u32>,
    /// Sheet visibility state from workbook.xml (preserved for round-trip fidelity).
    #[serde(skip)]
    pub state: crate::domain::workbook::write::SheetState,
    /// All cells in the sheet
    pub cells: Vec<FullCellData>,
    /// Compact authored blank cells with explicit `s` attributes.
    #[serde(skip)]
    pub authored_style_runs: Vec<domain_types::AuthoredStyleRun>,
    /// 0-based coordinates of explicit style-less blank `<c/>` nodes skipped by semantic parsing.
    /// Kept for round-trip fidelity without allocating empty compute cells.
    #[serde(skip)]
    pub explicit_blank_cells: Vec<(u32, u32)>,
    /// Merge ranges
    pub merges: Vec<MergeRange>,
    /// Whether the original `<mergeCells>` element had a `count` attribute.
    /// Used for round-trip fidelity — the attribute is optional per OOXML spec.
    #[serde(skip)]
    pub merge_cells_has_count: bool,
    /// Conditional formatting rules (summary for JSON/WASM output)
    pub conditional_formats: Vec<CfSummary>,
    /// Full conditional formatting data for domain conversion (not serialized to JSON/WASM).
    /// Contains complete rule definitions (color scales, data bars, icon sets, cell-is conditions, etc.).
    #[serde(skip)]
    pub conditional_formatting_full: Vec<ooxml_types::cond_format::ConditionalFormatting>,
    /// Data validations
    pub data_validations: Vec<DvSummary>,
    /// Declared count attribute on the `<dataValidations>` container.
    #[serde(skip)]
    pub data_validations_declared_count: Option<u32>,
    /// Whether the `<dataValidations>` container had `disablePrompts="1"`.
    #[serde(skip)]
    pub data_validations_disable_prompts: bool,
    /// X window position for the data validation prompt dialog.
    #[serde(skip)]
    pub data_validations_x_window: Option<u32>,
    /// Y window position for the data validation prompt dialog.
    #[serde(skip)]
    pub data_validations_y_window: Option<u32>,
    /// Tables (structured objects matching TypeScript Table interface)
    pub tables: Vec<ParsedTable>,
    /// Parsed pivot tables with compute-ready config + OOXML sidecar.
    #[serde(skip)]
    pub parsed_pivot_configs: Vec<domain_types::domain::pivot::ParsedPivotTable>,
    /// Data table regions in this sheet
    pub data_tables: Vec<DataTableInfo>,
    /// Sparkline groups (summary for JSON/WASM output)
    pub sparklines: Vec<SparklineSummary>,
    /// Full sparkline group data for domain conversion (not serialized to JSON/WASM).
    #[serde(skip)]
    pub sparkline_groups: Vec<ooxml_types::sparklines::SparklineGroup>,
    /// Comments
    pub comments: Vec<CommentOutput>,
    /// Comment author names (indexed by CommentOutput::author_id)
    pub comment_authors: Vec<String>,
    /// Original root element namespace declarations from the comments XML file.
    /// Preserved for round-trip fidelity (xmlns:mc, mc:Ignorable, xmlns:xr, etc.).
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub comments_root_namespace_attrs: Vec<(String, String)>,
    /// Hyperlinks
    pub hyperlinks: Vec<HyperlinkOutput>,
    /// Sheet protection settings
    pub protection: Option<ProtectionOutput>,
    /// Print settings (structured output)
    pub print_settings: Option<PrintSettingsOutput>,
    /// Raw `<headerFooter>...</headerFooter>` XML for verbatim round-trip passthrough.
    #[serde(skip)]
    pub header_footer_xml: Option<String>,
    /// Page breaks
    pub page_breaks: Option<PageBreaksOutput>,
    pub default_row_height: Option<f64>,
    pub default_col_width: Option<f64>,
    /// Base column width (baseColWidth on sheetFormatPr) — roundtrip only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_col_width: Option<u32>,
    /// Default row descent (x14ac:dyDescent on sheetFormatPr) — text baseline offset in points.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_row_descent: Option<f64>,
    /// Outline level for rows (outlineLevelRow on sheetFormatPr) — roundtrip only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline_level_row: Option<u8>,
    /// Outline level for columns (outlineLevelCol on sheetFormatPr) — roundtrip only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline_level_col: Option<u8>,
    /// Whether the default row height is custom (customHeight on sheetFormatPr) — roundtrip only.
    #[serde(skip_serializing_if = "is_false")]
    pub custom_height: bool,
    /// Whether zero-height rows are the default (zeroHeight on sheetFormatPr) — roundtrip only.
    #[serde(skip_serializing_if = "is_false")]
    pub zero_height: bool,
    /// Stable sheet identity for co-authoring (xr:uid on <worksheet> root).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
    /// Per-row descent values (x14ac:dyDescent on <row>) — all original values preserved.
    /// Write-only roundtrip data, not serialized to TypeScript.
    #[serde(skip)]
    pub row_descents: HashMap<u32, f64>,
    /// Per-row spans attribute values — preserved from the original XML for roundtrip fidelity.
    /// Write-only roundtrip data, not serialized to TypeScript.
    #[serde(skip)]
    pub row_spans: HashMap<u32, String>,
    /// 0-based row indices for bare empty rows (`<row r="N"/>` with no attributes or cells).
    /// Write-only roundtrip data, not serialized to TypeScript.
    #[serde(skip)]
    pub bare_empty_rows: Vec<u32>,
    /// Column widths
    pub col_widths: Vec<ColWidth>,
    /// Row heights
    pub row_heights: Vec<RowHeight>,
    /// Frozen pane settings
    pub frozen_pane: Option<SheetPane>,
    /// Sheet view options (gridlines, headers visibility).
    /// Multiple `<sheetView>` elements are preserved for round-trip fidelity.
    pub view_options: Vec<SheetViewOutput>,
    /// Charts embedded in this sheet
    pub charts: Vec<domain_types::ChartSpec>,
    /// SmartArt diagrams embedded in this sheet (raw XML parts for TS-side rendering)
    pub smartart_diagrams: Vec<SmartArtPartsOutput>,
    /// Slicer definitions parsed from this sheet's slicer parts
    pub slicers: Vec<ooxml_types::slicers::SlicerDef>,
    /// Slicer anchors (positions in the drawing layer) for this sheet
    pub slicer_anchors: Vec<ooxml_types::slicers::SlicerAnchor>,
    /// Form controls (checkboxes, dropdowns, buttons, scroll bars, etc.)
    pub form_controls: Vec<FormControlOutput>,
    /// Raw worksheet-level controls XML for verbatim round-trip passthrough.
    ///
    /// This is usually an `mc:AlternateContent` block containing `<controls>`.
    /// It is intentionally separate from parsed `form_controls`, which are the
    /// editable semantic representation.
    #[serde(skip)]
    pub worksheet_controls_xml: Option<String>,
    /// OLE embedded objects
    pub ole_objects: Vec<OleObjectOutput>,
    /// Connector lines between shapes
    pub connectors: Vec<ConnectorOutput>,
    /// Original `<dimension ref="..."/>` value from the source worksheet XML.
    /// When present the writer uses this instead of recalculating from cell data.
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub original_dimension: Option<String>,
    /// Whether the original worksheet had an empty `<extLst/>` element.
    #[serde(skip)]
    pub has_empty_ext_lst: bool,
    /// Raw `<extLst>...</extLst>` XML from the worksheet for round-trip passthrough.
    /// Captures extension elements (x14:dataValidations, x14:conditionalFormattings, etc.)
    /// that live inside `<extLst>` in the post-sheetData region.
    #[serde(skip)]
    pub ext_lst_xml: Option<String>,
    /// Original OPC relationships from `xl/worksheets/_rels/sheetN.xml.rels`, preserved for
    /// round-trip fidelity. When present, the writer replays these instead of regenerating them.
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub sheet_opc_rels: Vec<ooxml_types::shared::OpcRelationship>,
    /// Raw table XML bytes for round-trip passthrough.
    ///
    /// Each entry is `(zip_path, raw_xml_bytes)`, e.g.,
    /// `("xl/tables/table1.xml", <bytes>)`.  Populated during parse from the
    /// source archive; replayed verbatim into the output ZIP during write.
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub table_xml_passthroughs: Vec<(String, Vec<u8>)>,
    /// Worksheet-level `<autoFilter>` element, parsed into typed form.
    ///
    /// Typed OOXML preservation: replaced the prior raw-XML passthrough
    /// (`auto_filter_xml: Option<String>`) with a typed
    /// [`domain_types::AutoFilter`] covering the closed CT_AutoFilter XSD
    /// losslessly. Written after `</sheetData>` and before `<mergeCells>`.
    #[serde(skip)]
    pub auto_filter: Option<domain_types::AutoFilter>,
    /// Standalone worksheet-level `<sortState>` element, parsed into typed form.
    ///
    /// Typed OOXML preservation: replaced the prior raw-XML passthrough
    /// (`sort_state_xml: Option<String>`) so sort state survives the parse →
    /// domain → write path losslessly even when no raw blob is present.
    #[serde(skip)]
    pub sort_state: Option<domain_types::SortState>,
    /// Raw `<customProperties>` XML for verbatim round-trip passthrough.
    ///
    /// Stores the complete `<customProperties>...</customProperties>` element
    /// from the original worksheet XML. These are worksheet-level custom property
    /// references (with r:id links to binary parts).
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub custom_properties_xml: Option<String>,
    /// Raw VML drawing files for verbatim round-trip passthrough.
    ///
    /// Populated during parse from the source archive.  A sheet can have
    /// multiple VML drawings — one for comment shapes and another for
    /// embedded images referenced by those comments.  Each entry stores
    /// the ZIP path, raw bytes, and an optional `.rels` file.
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub raw_vml_drawings: Vec<RawVmlDrawing>,
    /// Relationship ID of the `<legacyDrawing r:id="..."/>` element in the sheet XML.
    /// Points to the VML drawing part that contains comment shapes, form controls, etc.
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub legacy_drawing_r_id: Option<String>,
    /// Relationship ID of the `<legacyDrawingHF r:id="..."/>` element in the sheet XML.
    /// Points to the VML drawing part that contains header/footer images.
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub legacy_drawing_hf_r_id: Option<String>,
    /// Rich parsed drawing with all anchored objects (pictures, shapes, charts, connectors, etc.).
    /// Used by the structured write path to regenerate `xl/drawings/drawingN.xml` from domain types.
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub parsed_drawing: Option<crate::domain::drawings::Drawing>,
    /// Rich parsed chart data for each chart embedded in this sheet.
    /// Used by the structured write path to regenerate `xl/charts/chartN.xml` via
    /// `Chart::to_chart_writer()`. Ordered to match chart GraphicFrame anchors in `parsed_drawing`.
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub parsed_charts: Vec<crate::domain::charts::Chart>,
    /// Parsed ChartEx parts (modern chart types: Waterfall, Treemap, etc.).
    /// Each entry holds the structured ChartExSpace plus auxiliary files for round-trip.
    /// Not serialized to TypeScript -- internal round-trip data only.
    #[serde(skip)]
    pub parsed_chart_ex: Vec<ParsedChartEx>,
}

/// A parsed ChartEx part with its auxiliary files.
#[derive(Debug, Clone)]
pub struct ParsedChartEx {
    /// The parsed ChartEx model.
    pub chart_space: ooxml_types::chart_ex::ChartExSpace,
    /// Original ZIP entry name (e.g., "xl/charts/chartEx1.xml").
    pub original_path: String,
    /// Raw bytes of the .rels file for this chartEx part.
    pub chart_rels_bytes: Option<(String, Vec<u8>)>,
    /// Auxiliary files referenced by the chartEx .rels (style, colors).
    pub auxiliary_files: Vec<(String, Vec<u8>)>,
}

/// Connector output for the import pipeline.
///
/// Extracted from `<cxnSp>` elements within drawing anchors.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorOutput {
    /// Display name (from cNvPr/@name).
    pub name: Option<String>,
    /// Start connection (shape ID + site index).
    pub start_connection: Option<ConnectorEndpointOutput>,
    /// End connection (shape ID + site index).
    pub end_connection: Option<ConnectorEndpointOutput>,
    /// Preset geometry type (e.g., "line", "bentConnector3").
    pub preset_geometry: Option<String>,
    /// Anchor row (0-based).
    pub anchor_row: Option<u32>,
    /// Anchor column (0-based).
    pub anchor_col: Option<u32>,
    /// Anchor row offset in EMU.
    pub anchor_row_offset: i64,
    /// Anchor column offset in EMU.
    pub anchor_col_offset: i64,
    /// End anchor row (for two-cell anchors).
    pub end_row: Option<u32>,
    /// End anchor column (for two-cell anchors).
    pub end_col: Option<u32>,
    /// End anchor row offset in EMU (for two-cell anchors).
    pub end_row_offset: Option<i64>,
    /// End anchor column offset in EMU (for two-cell anchors).
    pub end_col_offset: Option<i64>,
    /// Width in EMU.
    pub width: Option<i64>,
    /// Height in EMU.
    pub height: Option<i64>,
    /// Full connector data as JSON for roundtrip fidelity.
    pub raw_json: Option<String>,
}

/// Connector endpoint referencing a shape and connection site.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorEndpointOutput {
    /// Target shape ID.
    pub shape_id: u32,
    /// Connection site index.
    pub idx: u32,
}

/// Data table region metadata extracted from `<f t="dataTable">` elements.
///
/// Propagated through to the snapshot for TABLE formula evaluation.
///
/// Typed data-table input refs: input refs are typed `Option<CellRef>` end-to-end (parser
/// → lowering → snapshot) so the lowering step is stateless. The
/// `r1 -> col` / `r2 -> row` swap (Excel's inverted naming) happens at the
/// parser → domain boundary in `convert_data_tables`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataTableInfo {
    /// 0-based start row of the data table region.
    pub start_row: u32,
    /// 0-based start column of the data table region.
    pub start_col: u32,
    /// 0-based end row (inclusive) of the data table region.
    pub end_row: u32,
    /// 0-based end column (inclusive) of the data table region.
    pub end_col: u32,
    /// Typed reference from the r1 attribute (single cell, sheet-local).
    /// `None` for a missing or `#REF!` r1 attribute.
    /// WARNING: Excel's naming is inverted — r1 ("row input cell") actually
    /// receives top-row (column-varying) values. Normalized at the parser→domain
    /// boundary in `convert_data_tables`.
    pub row_input_ref: Option<formula_types::CellRef>,
    /// Typed reference from the r2 attribute (single cell, sheet-local).
    /// `None` for a missing or `#REF!` r2 attribute.
    /// WARNING: Excel's naming is inverted — r2 ("column input cell") actually
    /// receives left-column (row-varying) values. Normalized at the parser→domain
    /// boundary in `convert_data_tables`.
    pub col_input_ref: Option<formula_types::CellRef>,
    /// OOXML formula flags preserved from `<f t="dataTable">`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ooxml_flags: Option<domain_types::DataTableOoxmlFlags>,
}

// =============================================================================
// DocProps types — canonical definitions in ooxml_types::doc_props
// =============================================================================

/// Core document properties from `docProps/core.xml`.
pub type DocPropsCore = ooxml_types::doc_props::CoreProperties;

/// Extended (app) document properties from `docProps/app.xml`.
pub type DocPropsApp = ooxml_types::doc_props::ExtendedProperties;

/// Custom document properties from `docProps/custom.xml`.
pub type DocPropsCustom = ooxml_types::doc_props::CustomProperties;

/// A single custom property from `docProps/custom.xml`.
pub type CustomProperty = ooxml_types::doc_props::CustomProperty;

/// Value types for custom document properties.
pub type CustomPropertyValue = ooxml_types::doc_props::CustomPropertyValue;

// =============================================================================
// Metadata types (xl/metadata.xml)
// =============================================================================

/// A single metadata type record from `<metadataTypes>`.
///
/// Defines a metadata type with its name and behavioral flags (copy, paste, merge, etc.).
/// See ECMA-376 Part 1, Section 18.9.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataTypeOutput {
    /// Metadata type name (e.g., "XLDAPR" for dynamic arrays)
    pub name: String,
    /// Minimum supported version
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub min_supported_version: u32,
    /// Copy behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub copy: bool,
    /// Paste-all behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub paste_all: bool,
    /// Paste-values behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub paste_values: bool,
    /// Merge behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub merge: bool,
    /// Split-first behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub split_first: bool,
    /// Row/column shift behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub row_col_shift: bool,
    /// Clear-formats behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub clear_formats: bool,
    /// Clear-comments behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub clear_comments: bool,
    /// Assign behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub assign: bool,
    /// Coerce behavior flag
    #[serde(default, skip_serializing_if = "is_false")]
    pub coerce: bool,
    /// Whether this type applies to cell metadata (vs. value metadata)
    #[serde(default, skip_serializing_if = "is_false")]
    pub cell_meta: bool,
}

/// A single block (`<bk>`) within `<futureMetadata>`.
///
/// Since future metadata blocks can contain arbitrary extension XML (e.g., XLDAPR
/// dynamic array properties), we store the raw inner XML of each `<bk>` element
/// to ensure faithful round-trip of unknown extensions.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FutureMetadataBlock {
    /// Raw inner XML content of the `<bk>` element (everything between `<bk>` and `</bk>`).
    pub raw_xml: String,
}

/// A future metadata group from `<futureMetadata>`.
///
/// Each group is associated with a metadata type by name and contains one or more blocks.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FutureMetadataGroup {
    /// Name of the metadata type this group corresponds to (e.g., "XLDAPR")
    pub name: String,
    /// The blocks within this future metadata group
    pub blocks: Vec<FutureMetadataBlock>,
}

/// A single record (`<rc>`) within a cell metadata block.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellMetadataRecord {
    /// Type index (`t` attribute) — 1-based index into `metadataTypes`
    pub t: u32,
    /// Value index (`v` attribute) — 0-based index into the corresponding `futureMetadata` blocks
    pub v: u32,
}

/// A single block (`<bk>`) within `<cellMetadata>`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellMetadataBlock {
    /// Records within this block
    pub records: Vec<CellMetadataRecord>,
}

/// Parsed metadata from `xl/metadata.xml`.
///
/// This represents the OOXML metadata part (ECMA-376 Part 1, Section 18.9).
/// It stores metadata types, future metadata extension blocks, and cell metadata
/// records referenced by cells via the `cm` attribute.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataOutput {
    /// Metadata type definitions from `<metadataTypes>`
    pub metadata_types: Vec<MetadataTypeOutput>,
    /// Future metadata groups from `<futureMetadata>` elements
    pub future_metadata: Vec<FutureMetadataGroup>,
    /// Cell metadata blocks from `<cellMetadata>`
    pub cell_metadata: Vec<CellMetadataBlock>,
}

// =============================================================================
// FullParseResult
// =============================================================================

/// Complete parsed workbook result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullParseResult {
    /// All parsed sheets
    pub sheets: Vec<FullParsedSheet>,
    /// Shared strings table (plain text, concatenated for rich text entries).
    pub shared_strings: Vec<String>,
    /// Rich text runs for SST entries that have formatting.
    /// Index-aligned with `shared_strings`. `None` = plain text, `Some` = rich text runs.
    #[serde(skip)]
    pub shared_strings_rich_runs: Vec<Option<Vec<domain_types::RichTextRun>>>,
    /// Raw phonetic XML (`<rPh>...</rPh>` + `<phoneticPr .../>`) per SST entry.
    /// Index-aligned with `shared_strings`. `None` = no phonetic data.
    #[serde(skip)]
    pub shared_strings_phonetic_xml: Vec<Option<Vec<u8>>>,
    /// Parsed styles (structured camelCase output)
    pub styles: StylesOutput,
    /// Theme (as JSON string for flexibility)
    pub theme: Option<String>,
    /// Defined names
    #[serde(default)]
    pub defined_names: Vec<DefinedNameOutput>,
    /// Workbook protection
    pub workbook_protection: Option<domain_types::WorkbookProtection>,
    /// Parse errors
    #[serde(default)]
    pub errors: Vec<FullParseError>,
    /// Parse statistics
    #[serde(default)]
    pub stats: ParseStats,
    /// The calcId from `<calcPr calcId="..."/>` — identifies the calculation engine version.
    /// Preserved for round-trip fidelity so the output file matches the original.
    #[serde(skip)]
    pub calc_id: Option<u32>,
    /// Whether iterative calculation is enabled (from `<calcPr iterate="1"/>`)
    pub iterative_calc: bool,
    /// Maximum iterations for iterative calculation (from `<calcPr iterateCount="..."/>`)
    pub max_iterations: Option<u32>,
    /// Maximum change threshold for convergence (from `<calcPr iterateDelta="..."/>`)
    pub max_change: Option<f64>,
    /// Full calculation settings from `<calcPr>` for round-trip fidelity.
    /// Contains all CT_CalcPr attributes (calcOnSave, concurrentCalc, etc.).
    #[serde(skip)]
    pub calc_pr_settings: Option<crate::domain::workbook::read::CalcPrSettings>,
    /// Full pivot cache definitions for structured round-trip writing.
    /// Keyed by cache_id. Contains source, fields, shared items — everything
    /// needed to reconstruct pivotCacheDefinition XML.
    /// Not serialized to TypeScript/WASM (internal round-trip data only).
    #[serde(skip)]
    pub pivot_caches: std::collections::HashMap<u32, crate::domain::pivot::types::ParsedPivotCache>,
    /// Original archive paths for pivot caches: (cache_id, definition_path, records_path).
    /// Used for path-faithful writing in from_parse_output.rs.
    #[serde(skip)]
    pub pivot_cache_paths: Vec<(u32, String, Option<String>)>,
    /// Slicer cache definitions (workbook-level, shared across sheets)
    pub slicer_caches: Vec<ooxml_types::slicers::SlicerCacheDef>,
    /// Parsed theme name (e.g., "Office Theme")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_name: Option<String>,
    /// Parsed theme color scheme (preserves DrawingColor variants for faithful roundtrip)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_color_scheme: Option<ooxml_types::themes::ColorScheme>,
    /// Parsed theme font scheme (preserves font definitions with panose, script fonts, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_font_scheme: Option<ooxml_types::themes::FontScheme>,
    /// Parsed theme format scheme (fill, line, and effect styles for round-trip fidelity)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_format_scheme: Option<ooxml_types::themes::FormatScheme>,
    /// Raw XML content inside <a:objectDefaults>...</a:objectDefaults> for round-trip fidelity
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_object_defaults_xml: Option<Vec<u8>>,
    /// Raw XML content inside <a:extraClrSchemeLst>...</a:extraClrSchemeLst> for round-trip fidelity
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_extra_clr_scheme_lst_xml: Option<Vec<u8>>,
    /// Raw XML of <a:extLst>...</a:extLst> (full element) for round-trip fidelity
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_ext_lst_xml: Option<Vec<u8>>,
    /// Raw XML of <extLst>...</extLst> from xl/styles.xml for round-trip fidelity
    #[serde(skip)]
    pub styles_ext_lst_xml: Option<Vec<u8>>,
    /// Full parsed OOXML stylesheet for lossless style round-tripping.
    /// Preserves theme/indexed color references, cellStyleXfs, dxfs, etc.
    #[serde(skip)]
    pub parsed_stylesheet: Option<ooxml_types::styles::Stylesheet>,
    /// Core document properties (docProps/core.xml)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc_props_core: Option<DocPropsCore>,
    /// Extended document properties (docProps/app.xml)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc_props_app: Option<DocPropsApp>,
    /// Custom document properties (docProps/custom.xml)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc_props_custom: Option<DocPropsCustom>,
    /// Raw bytes of `docProps/core.xml` for verbatim round-trip passthrough.
    /// Avoids element reordering and formatting differences.
    #[serde(skip)]
    pub raw_doc_props_core_xml: Option<Vec<u8>>,
    /// Raw bytes of `docProps/app.xml` for verbatim round-trip passthrough.
    /// Avoids element reordering and loss of uncommon properties (e.g., Pages, Words).
    #[serde(skip)]
    pub raw_doc_props_app_xml: Option<Vec<u8>>,
    /// Raw bytes of `docProps/custom.xml` for verbatim round-trip passthrough.
    #[serde(skip)]
    pub raw_doc_props_custom_xml: Option<Vec<u8>>,
    /// Metadata from `xl/metadata.xml` (cell metadata for dynamic arrays, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<MetadataOutput>,
    /// Original content type default mappings from `[Content_Types].xml`.
    /// Preserves the exact extension-to-MIME mappings (e.g., `"jpg" -> "image/jpg"`)
    /// from the source file so that round-trip writing maintains fidelity.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub content_type_defaults: Vec<(String, String)>,
    /// Original content type override mappings from `[Content_Types].xml`.
    /// Preserves the exact part-name-to-MIME mappings in their original order
    /// from the source file so that round-trip writing maintains fidelity.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub content_type_overrides: Vec<(String, String)>,
    /// Original OPC relationships from `_rels/.rels`, preserved for round-trip fidelity.
    /// When present, the writer replays these instead of regenerating relationship IDs.
    #[serde(skip)]
    pub root_relationships: Vec<ooxml_types::shared::OpcRelationship>,
    /// Original OPC relationships from `xl/_rels/workbook.xml.rels`, preserved for round-trip fidelity.
    #[serde(skip)]
    pub workbook_relationships: Vec<ooxml_types::shared::OpcRelationship>,
    /// Original workbook-level relationship IDs per sheet, in document order.
    /// Extracted from `<sheet r:id="rIdN"/>` in workbook.xml.
    #[serde(skip)]
    pub sheet_workbook_r_ids: Vec<String>,
    /// Tier 2 extension preservation: captured namespace declarations, unknown elements,
    /// and binary passthrough entries for round-trip fidelity. Internal only — not sent to TypeScript.
    #[serde(skip)]
    pub extensions: Option<crate::roundtrip::preservation::ExtensionPreservation>,
    /// Raw bytes of `xl/metadata.xml` for verbatim round-trip passthrough.
    /// Avoids namespace rewriting issues (e.g., `xda` vs `xlrd`).
    #[serde(skip)]
    pub raw_metadata_xml: Option<Vec<u8>>,
    /// Raw bytes of `docMetadata/LabelInfo.xml` for verbatim round-trip passthrough.
    /// This part is entirely missing from the structured write path, so we store and write it verbatim.
    #[serde(skip)]
    pub raw_doc_metadata_label_info: Option<Vec<u8>>,
    /// Raw bytes of `xl/sharedStrings.xml` for verbatim round-trip passthrough.
    /// Avoids SST reordering issues when doing a pure round-trip (no string modifications).
    #[serde(skip)]
    pub raw_shared_strings_xml: Option<Vec<u8>>,
    /// Parsed external link definitions for domain-based round-tripping.
    #[serde(skip)]
    pub external_links: Vec<domain_types::domain::external_link::ExternalLink>,
    /// Raw `customXml/` parts for verbatim round-trip passthrough.
    /// Stores all `customXml/item*.xml`, `customXml/itemProps*.xml`, and
    /// `customXml/_rels/item*.xml.rels` entries keyed by their ZIP path.
    #[serde(skip)]
    pub custom_xml_parts: Vec<(String, Vec<u8>)>,
    /// Raw bytes of `xl/persons/person.xml` for verbatim round-trip passthrough.
    /// This file stores person metadata for threaded comments (modern comments).
    #[serde(skip)]
    pub raw_persons_xml: Option<Vec<u8>>,
    /// Raw `xl/threadedComments/threadedComment*.xml` parts for verbatim round-trip passthrough.
    /// These are the companion files to person.xml for modern threaded comments.
    #[serde(skip)]
    pub raw_threaded_comments: Vec<(String, Vec<u8>)>,
    /// Parsed workbook views (window position/size/active tab) for round-trip fidelity.
    /// Multiple `<workbookView>` elements are preserved.
    #[serde(skip)]
    pub workbook_views: Vec<ooxml_types::workbook::BookView>,
    /// Parsed workbook properties from `<workbookPr>` for domain output.
    #[serde(skip)]
    pub workbook_properties: Option<domain_types::domain::workbook::WorkbookProperties>,
    /// Parsed file version from `<fileVersion>` for domain output.
    #[serde(skip)]
    pub file_version: Option<domain_types::domain::workbook::FileVersion>,
    /// Parsed file sharing settings from `<fileSharing>` for domain output.
    #[serde(skip)]
    pub file_sharing: Option<domain_types::domain::workbook::FileSharing>,
}

// =============================================================================
// FullParseError
// =============================================================================

/// Serializable parse error
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullParseError {
    /// Error code
    pub code: u32,
    /// Severity: "warning", "error", "fatal"
    pub severity: String,
    /// Error message
    pub message: String,
    /// Part/file where error occurred
    pub part: Option<String>,
    /// Row if applicable
    pub row: Option<u32>,
    /// Column if applicable
    pub col: Option<u32>,
}

impl From<&ParseErrorDetail> for FullParseError {
    fn from(e: &ParseErrorDetail) -> Self {
        Self {
            code: e.code.code(),
            severity: e.severity.to_string(),
            message: e.message.clone(),
            part: e.location.as_ref().map(|l| l.part.clone()),
            row: e.location.as_ref().and_then(|l| l.row),
            col: e.location.as_ref().and_then(|l| l.col),
        }
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::error::{ErrorCode, ParseErrorDetail};

    #[test]
    fn test_parse_result_success() {
        let result = ParseResult::success(3, 1000, 5000);
        assert!(result.is_ok());
        assert_eq!(result.sheet_count(), 3);
        assert_eq!(result.cell_count(), 1000);
        assert_eq!(result.parse_time_us(), 5000);
    }

    #[test]
    fn test_parse_result_error() {
        let result = ParseResult::error("Test error");
        assert!(!result.is_ok());
        assert_eq!(result.error_message(), "Test error");
    }

    #[test]
    fn test_lazy_parse_result_success() {
        let result = LazyParseResult::success(
            3,
            vec![
                "Sheet1".to_string(),
                "Sheet2".to_string(),
                "Sheet3".to_string(),
            ],
        );
        assert!(result.is_ok());
        assert_eq!(result.sheet_count(), 3);
        assert_eq!(result.sheet_names(), vec!["Sheet1", "Sheet2", "Sheet3"]);
        assert_eq!(result.error_message(), "");
    }

    #[test]
    fn test_lazy_parse_result_error() {
        let result = LazyParseResult::error("Test error");
        assert!(!result.is_ok());
        assert_eq!(result.sheet_count(), 0);
        assert!(result.sheet_names().is_empty());
        assert_eq!(result.error_message(), "Test error");
    }

    #[test]
    fn test_parse_result_with_errors_success() {
        let result = ParseResultWithErrors::success(
            3,    // sheet_count
            1000, // cell_count
            5,    // cells_skipped
            2,    // warning_count
            1,    // error_count
            5000, // parse_time_us
            String::from("[]"),
        );
        assert!(result.is_ok());
        assert!(!result.is_clean()); // has errors
        assert_eq!(result.sheet_count(), 3);
        assert_eq!(result.cell_count(), 1000);
        assert_eq!(result.cells_skipped(), 5);
        assert_eq!(result.warning_count(), 2);
        assert_eq!(result.error_count(), 1);
        assert_eq!(result.parse_time_us(), 5000);
        assert_eq!(result.fatal_error(), "");
        assert_eq!(result.errors_json(), "[]");
    }

    #[test]
    fn test_parse_result_with_errors_clean() {
        let result = ParseResultWithErrors::success(
            1,    // sheet_count
            100,  // cell_count
            0,    // cells_skipped
            0,    // warning_count
            0,    // error_count
            1000, // parse_time_us
            String::from("[]"),
        );
        assert!(result.is_ok());
        assert!(result.is_clean()); // no errors
    }

    #[test]
    fn test_parse_result_with_errors_fatal() {
        let result = ParseResultWithErrors::fatal("Something went wrong");
        assert!(!result.is_ok());
        assert!(!result.is_clean());
        assert_eq!(result.sheet_count(), 0);
        assert_eq!(result.cell_count(), 0);
        assert_eq!(result.fatal_error(), "Something went wrong");
        assert_eq!(result.errors_json(), "[]");
    }

    #[test]
    fn test_parse_stats_serialize() {
        let stats = ParseStats {
            total_cells: 100,
            total_sheets: 3,
            parse_time_us: 5000,
        };
        // Just verify it can be serialized
        let json = serde_json::to_string(&stats).unwrap();
        assert!(json.contains("\"totalCells\":100"));
        assert!(json.contains("\"totalSheets\":3"));
    }

    #[test]
    fn test_full_cell_data_serialize() {
        let cell = FullCellData {
            row: 0,
            col: 0,
            cell_type: CELL_TYPE_VAL_NUMBER,
            style_idx: 1,
            value: Some("42".to_string()),
            formula: None,
            force_recalc: false,
            array_ref: None,
            cm: false,
            vm: None,
            cached_value_type: 0,
            cell_formula: None,
            preserve_space_formula: false,
            preserve_space_value: false,
            sst_index: None,
            has_explicit_style: false,
        };
        let json = serde_json::to_string(&cell).unwrap();
        assert!(json.contains("\"row\":0"));
        assert!(json.contains("\"value\":\"42\""));
        // cm=false should be skipped in serialization
        assert!(!json.contains("\"cm\""));
        // cached_value_type=0 should be skipped in serialization
        assert!(!json.contains("\"cachedValueType\""));
    }

    #[test]
    fn test_merge_range_serialize() {
        let merge = MergeRange::from_ref("A1:B2");
        let json = serde_json::to_string(&merge).unwrap();
        assert!(json.contains("\"ref_range\":\"A1:B2\""));
    }

    #[test]
    fn test_sheet_pane_serialize() {
        let pane =
            SheetPane::from_parsed(1.0, 2.0, Some("B3"), Pane::BottomRight, PaneState::Frozen);
        let json = serde_json::to_string(&pane).unwrap();
        assert!(json.contains("\"x_split\":1.0"));
        assert!(json.contains("\"y_split\":2.0"));
        assert!(json.contains("\"active_pane\""));
        assert!(json.contains("\"state\""));
    }

    #[test]
    fn test_full_parse_error_from_detail() {
        let detail = ParseErrorDetail::error(ErrorCode::InvalidCellReference, "Bad ref");
        let full_error: FullParseError = (&detail).into();
        assert_eq!(full_error.code, 300);
        assert_eq!(full_error.severity, "error");
        assert_eq!(full_error.message, "Bad ref");
    }

    // =========================================================================
    // ParsedTable and range parsing tests
    // =========================================================================

    #[test]
    fn test_parse_a1_range_simple() {
        let result = parse_a1_range("A1:Q34");
        assert_eq!(result, Some((0, 0, 33, 16)));
    }

    #[test]
    fn test_parse_a1_range_single_cell() {
        let result = parse_a1_range("B2:B2");
        assert_eq!(result, Some((1, 1, 1, 1)));
    }

    #[test]
    fn test_parse_a1_range_large() {
        let result = parse_a1_range("A1:XFD1048576");
        assert_eq!(result, Some((0, 0, 1048575, 16383)));
    }

    #[test]
    fn test_parse_a1_range_invalid_no_colon() {
        let result = parse_a1_range("A1");
        assert_eq!(result, None);
    }

    #[test]
    fn test_parse_a1_range_with_dollars() {
        // Absolute references like $A$1:$Q$34
        let result = parse_a1_range("$A$1:$Q$34");
        assert_eq!(result, Some((0, 0, 33, 16)));
    }

    #[test]
    fn test_parsed_table_serialization() {
        let table = ParsedTable {
            id: 1,
            name: "Table1".to_string(),
            display_name: "Table1".to_string(),
            ref_range: "A1:E10".to_string(),
            range: ParsedCellRange {
                start_row: 0,
                start_col: 0,
                end_row: 9,
                end_col: 4,
            },
            columns: vec![
                ParsedTableColumn {
                    id: 1,
                    name: "Name".to_string(),
                    header_row_dxf_id: None,
                    data_dxf_id: None,
                    totals_row_dxf_id: None,
                    header_row_cell_style: None,
                    data_cell_style: None,
                    totals_row_cell_style: None,
                    calculated_column_formula: None,
                    totals_row_formula: None,
                    totals_row_label: None,
                    totals_row_function: None,
                    unique_name: None,
                    query_table_field_id: None,
                    calculated_column_formula_array: false,
                    totals_row_formula_array: false,
                    xr3_uid: None,
                },
                ParsedTableColumn {
                    id: 2,
                    name: "Value".to_string(),
                    header_row_dxf_id: None,
                    data_dxf_id: None,
                    totals_row_dxf_id: None,
                    header_row_cell_style: None,
                    data_cell_style: None,
                    totals_row_cell_style: None,
                    calculated_column_formula: None,
                    totals_row_formula: None,
                    totals_row_label: None,
                    totals_row_function: None,
                    unique_name: None,
                    query_table_field_id: None,
                    calculated_column_formula_array: false,
                    totals_row_formula_array: false,
                    xr3_uid: None,
                },
            ],
            has_headers: true,
            has_totals: false,
            style_name: Some("TableStyleMedium2".to_string()),
            show_first_column: false,
            show_last_column: false,
            show_row_stripes: true,
            show_column_stripes: false,
            header_row_dxf_id: None,
            data_dxf_id: None,
            totals_row_dxf_id: None,
            header_row_border_dxf_id: None,
            table_border_dxf_id: None,
            totals_row_border_dxf_id: None,
            header_row_cell_style: None,
            data_cell_style: None,
            totals_row_cell_style: None,
            auto_filter_ref: None,
            auto_filter_xr_uid: None,
            table_type: None,
            totals_row_shown: None,
            connection_id: None,
            insert_row: false,
            insert_row_shift: false,
            published: false,
            filter_columns: vec![],
            sort_state: None,
            xr_uid: None,
        };
        let json = serde_json::to_string(&table).unwrap();
        // Check camelCase field names
        assert!(json.contains("\"displayName\":\"Table1\""));
        assert!(json.contains("\"ref\":\"A1:E10\""));
        assert!(json.contains("\"startRow\":0"));
        assert!(json.contains("\"startCol\":0"));
        assert!(json.contains("\"endRow\":9"));
        assert!(json.contains("\"endCol\":4"));
        // Check columns
        assert!(json.contains("\"id\":1"));
        assert!(json.contains("\"name\":\"Name\""));
        assert!(json.contains("\"name\":\"Value\""));
        // Check style fields
        assert!(json.contains("\"styleName\":\"TableStyleMedium2\""));
        assert!(json.contains("\"showRowStripes\":true"));
        assert!(json.contains("\"showColumnStripes\":false"));
    }

    #[test]
    fn test_parsed_cell_range_serialization_camel_case() {
        let range = ParsedCellRange {
            start_row: 5,
            start_col: 2,
            end_row: 20,
            end_col: 10,
        };
        let json = serde_json::to_string(&range).unwrap();
        assert_eq!(
            json,
            r#"{"startRow":5,"startCol":2,"endRow":20,"endCol":10}"#
        );
    }

    // =========================================================================
    // StylesOutput serialization tests
    // =========================================================================

    #[test]
    fn test_styles_output_camel_case() {
        let output = StylesOutput {
            number_formats: vec![NumberFormatOutput {
                id: 164,
                format_code: "yyyy-mm-dd".to_string(),
            }],
            fonts: vec![FontOutput {
                name: "Calibri".to_string(),
                size: 11.0,
                bold: true,
                italic: false,
                underline: Some(ooxml_types::styles::UnderlineStyle::None),
                strikethrough: false,
                color: Some(ColorOutput {
                    rgb: Some("FF000000".to_string()),
                    theme: None,
                    tint: None,
                    indexed: None,
                    auto: false,
                    raw_tint: None,
                }),
                family: Some(2),
                scheme: Some("minor".to_string()),
                vert_align: None,
            }],
            fills: vec![FillOutput {
                fill_type: "pattern".to_string(),
                pattern_type: ooxml_types::styles::PatternType::Solid,
                fg_color: Some(ColorOutput {
                    rgb: Some("FFFFFF00".to_string()),
                    theme: None,
                    tint: None,
                    indexed: None,
                    auto: false,
                    raw_tint: None,
                }),
                bg_color: None,
                gradient: None,
            }],
            borders: vec![BorderOutput {
                left: Some(BorderSideOutput {
                    style: ooxml_types::styles::BorderStyle::Thin,
                    color: None,
                }),
                right: None,
                top: None,
                bottom: None,
                diagonal: None,
                diagonal_up: None,
                diagonal_down: None,
            }],
            cell_xfs: vec![CellXfOutput {
                number_format_id: Some(164),
                font_id: Some(0),
                fill_id: Some(1),
                border_id: Some(0),
                apply_number_format: Some(true),
                apply_font: Some(false),
                apply_fill: Some(true),
                apply_border: Some(false),
                xf_id: Some(0),
                apply_alignment: None,
                alignment: None,
                apply_protection: None,
                protection: None,
            }],
            cell_style_xfs: vec![],
            cell_styles: vec![],
            known_fonts: false,
            raw_fonts: vec![],
            raw_cell_xfs: vec![],
            raw_cell_style_xfs: vec![],
            default_table_style: None,
            default_pivot_style: None,
            raw_dxfs: vec![],
            raw_colors: None,
            raw_table_styles: vec![],
        };
        let json = serde_json::to_string(&output).unwrap();
        // Top-level camelCase keys
        assert!(json.contains("\"cellXfs\""));
        assert!(json.contains("\"numberFormats\""));
        // NumberFormat fields
        assert!(json.contains("\"formatCode\":\"yyyy-mm-dd\""));
        // CellXf: numFmtId (special rename), not numberFormatId
        assert!(json.contains("\"numFmtId\":164"));
        assert!(!json.contains("\"numberFormatId\""));
        // CellXf: camelCase id fields
        assert!(json.contains("\"fontId\":0"));
        assert!(json.contains("\"fillId\":1"));
        assert!(json.contains("\"applyNumberFormat\":true"));
        assert!(json.contains("\"xfId\":0"));
        // Fill: type field + camelCase
        assert!(json.contains("\"type\":\"pattern\""));
        assert!(json.contains("\"patternType\":\"solid\""));
        assert!(json.contains("\"fgColor\""));
        // Font: camelCase
        assert!(json.contains("\"name\":\"Calibri\""));
        // Border: camelCase
        assert!(json.contains("\"left\":{\"style\":\"thin\""));
    }

    #[test]
    fn test_styles_output_from_parsed_styles() {
        let xml = br#"<?xml version="1.0"?>
<styleSheet>
    <numFmts count="1">
        <numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>
    </numFmts>
    <fonts count="1">
        <font><b/><sz val="11"/><name val="Calibri"/></font>
    </fonts>
    <fills count="1">
        <fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill>
    </fills>
    <borders count="1">
        <border><left style="thin"/><right/><top/><bottom/><diagonal/></border>
    </borders>
    <cellXfs count="1">
        <xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1" xfId="0"/>
    </cellXfs>
</styleSheet>"#;

        let styles = crate::domain::styles::read::parse_styles(xml);
        let output = StylesOutput::from(&styles);

        assert_eq!(output.number_formats.len(), 1);
        assert_eq!(output.number_formats[0].id, 164);
        assert_eq!(output.number_formats[0].format_code, "yyyy-mm-dd");

        assert_eq!(output.fonts.len(), 1);
        assert!(output.fonts[0].bold);
        assert_eq!(output.fonts[0].name, "Calibri");

        assert_eq!(output.fills.len(), 1);
        assert_eq!(output.fills[0].fill_type, "pattern");
        assert!(output.fills[0].fg_color.is_some());

        assert_eq!(output.borders.len(), 1);
        assert!(output.borders[0].left.is_some());

        assert_eq!(output.cell_xfs.len(), 1);
        assert_eq!(output.cell_xfs[0].number_format_id, Some(164));
        assert_eq!(output.cell_xfs[0].apply_number_format, Some(true));

        // Verify JSON round-trip produces correct camelCase
        let json = serde_json::to_string(&output).unwrap();
        assert!(json.contains("\"numFmtId\":164"));
        assert!(json.contains("\"formatCode\":\"yyyy-mm-dd\""));
    }

    // ---- W-styles typed enum round-trip tests (Round D) --------------------

    #[test]
    fn alignment_output_typed_fields_serialize_as_ooxml_tokens() {
        // Verify the JSON wire format for the retyped fields matches what the
        // pre-Round-D `Option<String>` representation emitted byte-for-byte.
        let a = AlignmentOutput {
            horizontal: Some(HorizontalAlign::CenterContinuous),
            vertical: Some(VerticalAlign::Justify),
            wrap_text: Some(true),
            text_rotation: None,
            indent: None,
            shrink_to_fit: None,
            reading_order: None,
            auto_indent: None,
            relative_indent: None,
            justify_last_line: None,
        };
        let json = serde_json::to_value(&a).unwrap();
        assert_eq!(json["horizontal"], "centerContinuous");
        assert_eq!(json["vertical"], "justify");

        let rt: AlignmentOutput = serde_json::from_value(json).unwrap();
        assert_eq!(rt.horizontal, Some(HorizontalAlign::CenterContinuous));
        assert_eq!(rt.vertical, Some(VerticalAlign::Justify));
    }

    #[test]
    fn alignment_output_none_variants_omitted() {
        // `None` fields must be omitted entirely (skip_serializing_if still works
        // on typed enum Options).
        let a = AlignmentOutput {
            horizontal: None,
            vertical: None,
            wrap_text: None,
            text_rotation: None,
            indent: None,
            shrink_to_fit: None,
            reading_order: None,
            auto_indent: None,
            relative_indent: None,
            justify_last_line: None,
        };
        let json = serde_json::to_string(&a).unwrap();
        assert_eq!(json, "{}");
    }

    #[test]
    fn alignment_output_preserves_explicit_false() {
        // Pre-existing bug: `wrap_text: Some(false)` used to collapse to
        // `None` on the CellXfDef → CellXfOutput conversion, losing the
        // explicit-false override. Guard against regression.
        let xf = CellXfDef {
            alignment: Some(ooxml_types::styles::AlignmentDef {
                wrap_text: Some(false),
                shrink_to_fit: Some(false),
                text_rotation: Some(255), // stacked/vertical sentinel
                reading_order: Some(2),
                relative_indent: Some(-1),
                justify_last_line: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        };
        let out = CellXfOutput::from(&xf);
        let a = out.alignment.unwrap();
        assert_eq!(a.wrap_text, Some(false));
        assert_eq!(a.shrink_to_fit, Some(false));
        assert_eq!(a.text_rotation, Some(255));
        assert_eq!(a.reading_order, Some(2));
        assert_eq!(a.relative_indent, Some(-1));
        assert_eq!(a.justify_last_line, Some(true));
    }

    #[test]
    fn border_output_diagonal_flags_preserve_option() {
        use ooxml_types::styles::{BorderDef, BorderSideDef, BorderStyle};

        // None → None, Some(false) → Some(false), Some(true) → Some(true).
        let cases: Vec<(Option<bool>, Option<bool>)> = vec![
            (None, None),
            (Some(false), None),
            (None, Some(false)),
            (Some(true), None),
            (None, Some(true)),
            (Some(false), Some(false)),
            (Some(true), Some(false)),
            (Some(false), Some(true)),
            (Some(true), Some(true)),
        ];
        for (up, down) in cases {
            let b = BorderDef {
                diagonal: Some(BorderSideDef {
                    style: BorderStyle::Thin,
                    color: None,
                }),
                diagonal_up: up,
                diagonal_down: down,
                ..Default::default()
            };
            let out = BorderOutput::from(&b);
            assert_eq!(
                out.diagonal_up, up,
                "diagonal_up dropped for ({up:?}, {down:?})"
            );
            assert_eq!(
                out.diagonal_down, down,
                "diagonal_down dropped for ({up:?}, {down:?})"
            );
        }
    }
}
