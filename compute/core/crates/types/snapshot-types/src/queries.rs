//! Query-specific return types for engine IPC methods.
//!
//! These are serializable structs returned by `queries.rs` bridge methods
//! that previously built ad-hoc JSON via `serde_json::json!{}`.

use serde::{Deserialize, Serialize};
use value_types::FiniteF64;

/// Data bounds (min/max row/col with actual cell data) for a sheet.
///
/// Used by `get_data_bounds`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataBounds {
    pub min_row: u32,
    pub min_col: u32,
    pub max_row: u32,
    pub max_col: u32,
}

/// Rectangular bounds using start/end naming convention.
///
/// Used by `get_projection_range`, `get_current_region`,
/// `get_data_bounds_for_range`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RectBounds {
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
}

/// Sheet protection configuration (subset of SheetSettings).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetProtectionConfig {
    pub is_protected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protection_password_hash: Option<String>,
}

/// Default font settings for the workbook.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultFont {
    pub name: String,
    pub size: u32,
    pub color: String,
}

/// Target cell position for navigation operations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellPosition {
    pub row: u32,
    pub col: u32,
}

/// Projection entry returned by viewport projection queries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionData {
    pub origin_row: u32,
    pub origin_col: u32,
    pub rows: u32,
    pub cols: u32,
}

/// Result of a table hit-region query: which part of a table a cell falls in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableHitRegion {
    pub table_name: String,
    pub region: String,
    pub column_index: u32,
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
    pub has_headers: bool,
    pub has_totals: bool,
    pub column_name: String,
}

/// Result of auto-expansion detection for a table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoExpansionResult {
    pub should_expand: bool,
    pub new_end_row: u32,
    pub new_end_col: u32,
}

/// Result of resolving a CellId to its (sheetId, row, col) position.
///
/// Used by `get_cell_position` and `resolve_cell_positions`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellPositionResult {
    pub sheet_id: String,
    pub sheet_name: String,
    pub row: u32,
    pub col: u32,
}

/// Options for the `regex_search` bridge method.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegexSearchOptions {
    pub patterns: Vec<String>,
    /// Default: false (case-insensitive by default).
    #[serde(default)]
    pub case_sensitive: Option<bool>,
    /// Default: false (substring match).
    #[serde(default)]
    pub whole_cell: Option<bool>,
    /// Default: false.
    #[serde(default)]
    pub include_formulas: Option<bool>,
    /// Optional range constraint (0-based inclusive).
    /// When set, only cells within this bounding box are searched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_row: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_col: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_row: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_col: Option<u32>,
}

/// A single regex search match.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegexSearchMatch {
    pub row: u32,
    pub col: u32,
    pub address: String,
    pub sheet_name: String,
    pub value: String,
    pub matched_pattern: String,
}

/// Result of a `regex_search` call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegexSearchResult {
    pub matches: Vec<RegexSearchMatch>,
    pub errors: Vec<String>,
}

// -------------------------------------------------------------------
// Column / Row Edge (findLastRow / findLastColumn)
// -------------------------------------------------------------------

/// Edge info for a single column — returned by `find_last_row`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnEdge {
    /// Last row containing a value, formula, or spill result (includes spill extents).
    pub last_data_row: Option<u32>,
    /// Last row with formatting applied (fill, border, number format, etc.).
    pub last_format_row: Option<u32>,
}

/// Edge info for a single row — returned by `find_last_column`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowEdge {
    /// Last column containing a value, formula, or spill result (includes spill extents).
    pub last_data_col: Option<u32>,
    /// Last column with formatting applied (fill, border, number format, etc.).
    pub last_format_col: Option<u32>,
}

// -------------------------------------------------------------------
// Sign Check
// -------------------------------------------------------------------

/// Options for sign anomaly detection within a range.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignCheckOptions {
    /// `"column"` (default), `"row"`, or `"both"`.
    #[serde(default)]
    pub axis: Option<String>,

    /// Number of non-empty numeric neighbors per direction. Default: 3.
    #[serde(default)]
    pub window: Option<u32>,
}

/// A single cell whose sign disagrees with its neighbors.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignAnomaly {
    pub row: u32,
    pub col: u32,
    pub cell: String,
    pub value: FiniteF64,
    pub disagreement: FiniteF64,
    pub neighbors: Vec<SignNeighbor>,
}

/// A neighbor cell used in sign comparison.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignNeighbor {
    pub cell: String,
    pub value: FiniteF64,
}

/// Result of a `sign_check` call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignCheckResult {
    pub cells_checked: u32,
    pub anomalies: Vec<SignAnomaly>,
}

// -------------------------------------------------------------------
// Chart Statistics (relocated from compute/core/src/bridge_pure.rs in
// nullable-boundary: the no_bare_f64_at_boundary walker only scans the type
// crates, so all bridge boundary types must live here.)
//
// Bridge-only output type: derives `Serialize` only, no `Deserialize`.
// Producer (`chart_compute_statistics`) wraps each value with
// `FiniteF64::new(...)` — `None` is the correct signal when the input
// vector is empty / degenerate and a stat would otherwise return NaN
// or +/-inf (e.g. mean([]) = NaN, variance([x]) with sample_variance
// would divide by zero).
//
// Wire shape: present, possibly null. No `skip_serializing_if`.
// -------------------------------------------------------------------

/// Descriptive statistics returned by `chart_compute_statistics()`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartStatistics {
    pub mean: Option<FiniteF64>,
    pub median: Option<FiniteF64>,
    pub std_dev: Option<FiniteF64>,
    pub sample_std_dev: Option<FiniteF64>,
    pub min: Option<FiniteF64>,
    pub max: Option<FiniteF64>,
    pub variance: Option<FiniteF64>,
    pub sample_variance: Option<FiniteF64>,
    pub sum: Option<FiniteF64>,
    pub range: Option<FiniteF64>,
    pub q1: Option<FiniteF64>,
    pub q3: Option<FiniteF64>,
    pub iqr: Option<FiniteF64>,
}

// -------------------------------------------------------------------
// Find in Range (regex pattern search)
// -------------------------------------------------------------------

/// Options for regex find-in-range operations.
///
/// The `text` field is interpreted as a regex pattern. Plain text without
/// regex metacharacters continues to behave as substring search.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindInRangeOptions {
    pub text: String,
    #[serde(default)]
    pub case_sensitive: Option<bool>,
    #[serde(default)]
    pub whole_cell: Option<bool>,
    #[serde(default)]
    pub include_formulas: Option<bool>,
}

/// A single cell match from find-in-range.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindInRangeResult {
    pub row: u32,
    pub col: u32,
    pub address: String,
    pub value: String,
}

// -------------------------------------------------------------------
// Workbook-wide Search
// -------------------------------------------------------------------

/// A single match from workbook-wide regex search, with sheet attribution.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookSearchMatch {
    pub sheet_id: String,
    pub sheet_name: String,
    pub row: u32,
    pub col: u32,
    pub address: String,
    pub value: String,
    pub matched_pattern: String,
}

/// Result of a workbook-wide regex search across all sheets.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookSearchResult {
    pub matches: Vec<WorkbookSearchMatch>,
    pub errors: Vec<String>,
}
