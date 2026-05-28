use crate::domain::cells::CellData;
use crate::domain::controls::types::FormControl;
use crate::infra::error::{ErrorSeverity, ParseErrorDetail};
use crate::output::results::{CfSummary, DvSummary, HyperlinkOutput, ProtectionOutput};
use ooxml_types::worksheet::{ColWidth, MergeRange, RowHeight, SheetPane};

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::error::ErrorCode;

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
}
