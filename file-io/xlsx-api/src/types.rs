//! Re-exports from xlsx-parser type modules.
//!
//! `xlsx-api` does NOT define parallel type hierarchies. All domain types
//! come from the parser crate. This module provides a single import path.

pub use domain_types::{
    ImportDiagnostic, ImportDiagnosticCode, ImportDiagnosticRef, ImportEditability,
    ImportFeatureKind, ImportForceRecalcCell, ImportObjectStatus, ImportRecoverability,
    ImportRenderability, ImportReport, ImportSeverity, ImportSource, ImportStats,
};

// --- Parse result types ---
// FullParseResult, FullParsedSheet, FullCellData, FullParseError are now crate-private in xlsx-parser.
// External consumers should use parse_xlsx_to_output() which returns domain_types::ParseOutput.
pub use xlsx_parser::{ParseStats, ParseTimings};

// --- Cell data types (low-level) ---
pub use xlsx_parser::CellData;

// --- Cell type constants ---
pub use xlsx_parser::{
    CELL_TYPE_VAL_BOOL, CELL_TYPE_VAL_EMPTY, CELL_TYPE_VAL_ERROR, CELL_TYPE_VAL_FORMULA,
    CELL_TYPE_VAL_NUMBER, CELL_TYPE_VAL_STRING,
};

// --- Lazy loading types ---
pub use xlsx_parser::{ParsedSheet, SheetMetadata};

// --- Error handling types ---
pub use xlsx_parser::{ErrorCode, ErrorCollector, ErrorLocation, ErrorSeverity};

// --- Style types ---
pub use xlsx_parser::{Stylesheet, get_number_format, is_date_format, parse_styles};

// --- Structure types ---
pub use xlsx_parser::{ColWidth, MergeRange, Pane, PaneState, RowHeight, SheetPane};

// --- Feature types ---
pub use xlsx_parser::{ParsedTable, ParsedTableColumn};

// --- Domain types ---
pub use xlsx_parser::{DefinedName, DefinedNames, Hyperlink, Hyperlinks, SharedStrings, Theme};

// --- Print types ---
pub use xlsx_parser::{HeaderFooter, PageBreaks, PageMargins, PageSetup, PrintSettings};

// --- Protection types (read/parse side) ---
pub use xlsx_parser::{SheetProtection, WorkbookProtection};

// --- Sparkline types ---
pub use xlsx_parser::{Sparkline, SparklineGroup, SparklineGroups};

// --- Write error types ---
pub use xlsx_parser::write::write_error::WriteError;

// --- ZIP types ---
pub use xlsx_parser::{XlsxArchive, ZipEntry, ZipError};

// --- Bridge types ---
pub use xlsx_parser::bridge::error::XlsxBridgeError;
pub use xlsx_parser::bridge::types::{
    BridgeLazyParseResult, BridgeLazyParseResultWithErrors, BridgeParseTimings,
};

// --- Write types ---
pub use xlsx_parser::ZipWriter as ParserZipWriter;
