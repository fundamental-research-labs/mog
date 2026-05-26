//! Range types used across storage submodules.

use serde::{Deserialize, Serialize};

/// A position-only cell range (no sheet context).
///
/// Used by filters, sparklines, grouping, sorting, and other modules
/// that operate within a single sheet context.
///
/// This is a type alias for [`cell_types::SheetRange`], which has
/// identical fields: `start_row`, `start_col`, `end_row`, `end_col`.
pub type PositionRange = cell_types::SheetRange;

/// A structured A1-style cell reference (e.g., `$A$1`, `B2`).
///
/// Carries absolute/relative markers for row and column, which control
/// whether the reference shifts during row/column insert/delete and copy/paste.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A1CellRef {
    /// Zero-based row index.
    pub row: u32,
    /// Zero-based column index.
    pub col: u32,
    /// True for absolute row reference (`$1`) -- does not shift on insert/delete.
    pub row_absolute: bool,
    /// True for absolute column reference (`$A`) -- does not shift on insert/delete.
    pub col_absolute: bool,
}

/// A structured A1-style range reference (e.g., `$A$1:$B$10`, `Sheet2!A1:B10`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A1RangeRef {
    /// Start cell (typically top-left, but may be inverted).
    pub start: A1CellRef,
    /// End cell (typically bottom-right, but may be inverted).
    pub end: A1CellRef,
    /// Sheet name for cross-sheet references like `Sheet2!A1:B10`.
    pub sheet_name: Option<String>,
}

/// A range defined by two cell IDs (string UUIDs).
///
/// Used by charts and conditional formatting to reference ranges
/// at the IPC boundary where string cell IDs are used.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellIdRange {
    /// The top-left cell ID (UUID string).
    pub top_left_cell_id: String,
    /// The bottom-right cell ID (UUID string).
    pub bottom_right_cell_id: String,
}
