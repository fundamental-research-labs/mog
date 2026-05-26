//! Cell data operations domain types.
//!
//! Pure data contracts — no Yrs, no storage internals.

use serde::{Deserialize, Serialize};

/// Options for the Remove Duplicates operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveDuplicatesOptions {
    /// Whether the first row contains headers (should not be removed).
    pub has_headers: bool,
    /// Column indices to compare for duplicates (if empty, compare all columns in range).
    pub columns_to_compare: Vec<u32>,
    /// Whether comparison is case-sensitive.
    pub case_sensitive: bool,
}

/// Result of the Remove Duplicates operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveDuplicatesResult {
    /// Number of duplicate rows found.
    pub duplicates_found: u32,
    /// Number of duplicate rows removed.
    pub duplicates_removed: u32,
    /// Number of unique values remaining.
    pub unique_values_remaining: u32,
}

/// Column header info for the Remove Duplicates dialog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnHeader {
    /// Column index.
    pub col: u32,
    /// Header text.
    pub header: String,
}

/// Options for the Text to Columns operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextToColumnsOptions {
    /// Split type.
    pub split_type: TextToColumnsSplitType,
    /// Delimiters (for Delimited split type).
    pub delimiters: Delimiters,
    /// Whether to treat consecutive delimiters as one.
    pub treat_consecutive_as_one: bool,
    /// Text qualifier character for quoted values.
    pub text_qualifier: TextQualifier,
    /// Column positions for fixed width splitting.
    pub fixed_width_breaks: Vec<usize>,
}

/// Split type for Text to Columns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextToColumnsSplitType {
    /// Delimited by specific characters.
    Delimited,
    /// Fixed width columns.
    FixedWidth,
}

/// Delimiter flags for Text to Columns.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Delimiters {
    /// Use tab as delimiter.
    pub tab: bool,
    /// Use semicolon as delimiter.
    pub semicolon: bool,
    /// Use comma as delimiter.
    pub comma: bool,
    /// Use space as delimiter.
    pub space: bool,
    /// Custom delimiter character.
    pub other: Option<String>,
}

impl Default for Delimiters {
    fn default() -> Self {
        Self {
            tab: false,
            semicolon: false,
            comma: true,
            space: false,
            other: None,
        }
    }
}

/// Text qualifier for Text to Columns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextQualifier {
    /// Double quote (").
    DoubleQuote,
    /// Single quote (').
    SingleQuote,
    /// No text qualifier.
    None,
}

/// Result of the Text to Columns operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextToColumnsResult {
    /// Number of rows processed.
    pub rows_processed: u32,
    /// Number of columns created.
    pub columns_created: u32,
}

/// Destination position for Text to Columns output.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Destination {
    /// Row index.
    pub row: u32,
    /// Column index.
    pub col: u32,
}

/// Result of a cell relocation (cut-paste / drag-move) operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelocateResult {
    /// Hex CellId strings of cells that were moved to new positions.
    pub moved_cell_ids: Vec<String>,
    /// Hex CellId strings of cells that were cleared at the target.
    pub target_cells_cleared: Vec<String>,
    /// Whether the operation succeeded.
    pub success: bool,
    /// Error message if the operation failed.
    pub error: Option<String>,
}

/// Input for a single cell in a `set_cells_batch` call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchCellInput {
    /// A1 address (optional — if provided, `row`/`col` are ignored).
    pub addr: Option<String>,
    /// 0-based row (used when `addr` is `None`).
    pub row: Option<u32>,
    /// 0-based column (used when `addr` is `None`).
    pub col: Option<u32>,
    /// Already-stringified value. `None` means clear.
    pub value: Option<String>,
}

/// Result of a `set_cells_batch` operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetCellsBatchResult {
    /// Number of cells actually written.
    pub cells_written: u32,
    /// Number of duplicate (row, col) entries removed via last-write-wins.
    pub duplicates_removed: u32,
}

/// Raw internal cell data returned by `get_raw_cell_data`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawCellData {
    /// Raw cell value (for value cells) or null.
    pub raw: Option<value_types::CellValue>,
    /// Formula string with "=" prefix (if the cell is a formula cell).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    /// Computed value (for formula cells, the evaluation result).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub computed: Option<value_types::CellValue>,
}
