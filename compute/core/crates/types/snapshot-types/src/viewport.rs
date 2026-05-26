//! Viewport and query types for rendering and selection.
//!
//! [`ActiveCellData`] and [`RangeQueryResult`] serve toolbar and off-viewport queries.
//! [`SelectionAggregates`] provides SUM/COUNT/AVG/MIN/MAX for the status bar.

use serde::{Deserialize, Serialize};

use cell_types::SheetRange;
use value_types::{CellValue, FiniteF64};

/// A merge region in the viewport.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportMerge {
    /// Start row of the merge region (zero-based).
    pub start_row: u32,
    /// Start column of the merge region (zero-based).
    pub start_col: u32,
    /// End row of the merge region (zero-based, inclusive).
    pub end_row: u32,
    /// End column of the merge region (zero-based, inclusive).
    pub end_col: u32,
}

impl From<SheetRange> for ViewportMerge {
    fn from(r: SheetRange) -> Self {
        ViewportMerge {
            start_row: r.start_row(),
            start_col: r.start_col(),
            end_row: r.end_row(),
            end_col: r.end_col(),
        }
    }
}

impl From<ViewportMerge> for SheetRange {
    fn from(m: ViewportMerge) -> Self {
        SheetRange::new(m.start_row, m.start_col, m.end_row, m.end_col)
    }
}

/// Full data for the active cell — returned by `compute_get_active_cell()`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveCellData {
    /// Cell ID (hex string).
    pub cell_id: String,
    /// Cell value.
    pub value: CellValue,
    /// Formula text if this cell has a formula.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    /// Full cell format for toolbar display.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<serde_json::Value>,
    /// Cell metadata (hyperlinks, validation, notes, etc.).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
    /// Editing text for date/time cells (same as ViewportCell.edit_text).
    /// Examples: serial 44635 → "3/15/2024", serial 0.5 → "12:00:00 PM"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edit_text: Option<String>,
    /// Whether the formula should be hidden (sheet is protected AND cell has hidden flag).
    /// When true, FormulaBar shows computed value instead of formula.
    #[serde(default)]
    pub is_formula_hidden: bool,
    /// Hyperlink URL if this cell has a hyperlink attached.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hyperlink_url: Option<String>,
    /// The number format code string (e.g., "0.00", "M/d/yyyy", "General").
    /// Extracted from effective format for easy date-format detection by TS.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
}

/// A single cell returned by `query_range` — uses `grid_indexes` + ComputeCore (authoritative).
///
/// Replaces `ViewportCell` (for range queries) and `BatchCellData`:
/// - No `edit_text` (belongs in `get_active_cell` only)
/// - No `error` string (zero consumers)
/// - No `has_formula` bool — use `formula.is_some()` instead
/// - Has `hyperlink_url` (needed by `forEach` in cell-iteration.ts)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeCellData {
    /// Zero-based row.
    pub row: u32,
    /// Zero-based column.
    pub col: u32,
    /// Cell ID (UUID string).
    pub cell_id: String,
    /// Computed value (ComputeCore-first, mirror fallback).
    pub value: CellValue,
    /// Actual formula text (e.g., "=SUM(A1:A3)") — from ComputeCore or mirror identity formula.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    /// Pre-formatted display string (number format applied).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formatted: Option<String>,
    /// Cell format (serialized JSON).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<serde_json::Value>,
    /// Hyperlink URL if this cell has a hyperlink.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hyperlink_url: Option<String>,
}

/// A cell with identity info, pre-normalized for API consumers.
/// Errors are pre-stringified (e.g., "#DIV/0!"), display_string is always populated.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityCell {
    pub cell_id: String,
    pub row: u32,
    pub col: u32,
    /// Normalized value: errors converted to display strings, primitives unchanged.
    pub value: CellValue,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula_text: Option<String>,
    /// Always populated — pre-formatted display string.
    pub display_string: String,
}

/// Result of `query_range` — flat list of non-empty cells + merge regions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeQueryResult {
    /// Non-empty cells within the queried range.
    pub cells: Vec<RangeCellData>,
    /// Merge regions intersecting the queried range.
    #[serde(default)]
    pub merges: Vec<ViewportMerge>,
}

/// Selection aggregate data — returned by `compute_get_selection_aggregates()`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionAggregates {
    /// SUM of numeric values. `None` represents overflow during accumulation —
    /// preserves the signal instead of lying with `0.0`.
    /// Wire shape: present, possibly null. Do NOT add `skip_serializing_if`.
    pub sum: Option<FiniteF64>,
    /// COUNT of non-empty cells.
    pub count: u64,
    /// COUNT of numeric values only.
    pub numeric_count: u64,
    /// AVERAGE of numeric values (None if no numeric values or non-finite).
    pub average: Option<FiniteF64>,
    /// MIN of numeric values (None if no numeric values).
    pub min: Option<FiniteF64>,
    /// MAX of numeric values (None if no numeric values).
    pub max: Option<FiniteF64>,
}

impl SelectionAggregates {
    /// Create empty aggregates (zero counts, None for statistical values).
    #[must_use]
    pub fn empty() -> Self {
        Self {
            sum: Some(FiniteF64::ZERO),
            count: 0,
            numeric_count: 0,
            average: None,
            min: None,
            max: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Binary viewport rendering types have been moved to
// compute-core/src/storage/engine/viewport_render_types.rs
// so they can directly reference CellFormat without a cross-crate dependency.
// ---------------------------------------------------------------------------

/// A single request in a batch range query.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRangeRequest {
    /// Sheet name (resolved to SheetId in Rust).
    pub sheet_name: String,
    /// Start row (0-based). If None, auto-detect used range.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_row: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_col: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_row: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_col: Option<u32>,
}

/// Result for a successful batch range entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRangeResult {
    pub sheet_id: String,
    pub sheet_name: String,
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
    pub result: RangeQueryResult,
}

/// A single entry in the batch response — either success or error.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum BatchRangeEntry {
    #[serde(rename = "ok")]
    Ok(BatchRangeResult),
    #[serde(rename = "error")]
    Err { message: String },
}

/// Response from `query_ranges` — same length and order as input requests.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRangeResponse {
    pub entries: Vec<BatchRangeEntry>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_cell_data_serde_roundtrip() {
        let acd = ActiveCellData {
            cell_id: "abc".into(),
            value: CellValue::Text("hello".into()),
            formula: Some("=A1&B1".into()),
            format: Some(serde_json::json!({"bold": true, "italic": false})),
            metadata: Some(serde_json::json!({"hyperlink": "https://example.com"})),
            edit_text: Some("hello".into()),
            is_formula_hidden: false,
            hyperlink_url: Some("https://example.com".into()),
            number_format: Some("General".into()),
        };
        let json = serde_json::to_string(&acd).unwrap();
        let acd2: ActiveCellData = serde_json::from_str(&json).unwrap();
        assert_eq!(acd2.cell_id, "abc");
        assert_eq!(acd2.value, CellValue::Text("hello".into()));
        assert_eq!(acd2.formula, Some("=A1&B1".into()));
        assert!(acd2.format.is_some());
        assert!(acd2.metadata.is_some());
        assert_eq!(acd2.edit_text, Some("hello".into()));
        assert!(!acd2.is_formula_hidden);
        assert_eq!(acd2.hyperlink_url, Some("https://example.com".into()));
        assert_eq!(acd2.number_format, Some("General".into()));
    }

    #[test]
    fn active_cell_data_optional_fields_skipped() {
        let acd = ActiveCellData {
            cell_id: "x".into(),
            value: CellValue::Null,
            formula: None,
            format: None,
            metadata: None,
            edit_text: None,
            is_formula_hidden: false,
            hyperlink_url: None,
            number_format: None,
        };
        let json = serde_json::to_string(&acd).unwrap();
        // Use quoted field names to avoid substring collisions
        // (e.g. "is_formula_hidden" contains "formula").
        assert!(!json.contains("\"formula\""));
        assert!(!json.contains("\"format\""));
        assert!(!json.contains("\"metadata\""));
        assert!(!json.contains("\"editText\""));
        assert!(!json.contains("\"hyperlinkUrl\""));
        assert!(!json.contains("\"numberFormat\""));
        // isFormulaHidden defaults to false and IS serialized (not skipped),
        // but its default value is acceptable for wire size.
        assert!(json.contains("\"isFormulaHidden\":false"));
    }

    #[test]
    fn selection_aggregates_empty() {
        let sa = SelectionAggregates::empty();
        assert_eq!(sa.sum, Some(FiniteF64::ZERO));
        assert_eq!(sa.count, 0);
        assert_eq!(sa.numeric_count, 0);
        assert_eq!(sa.average, None);
        assert_eq!(sa.min, None);
        assert_eq!(sa.max, None);
    }

    #[test]
    fn selection_aggregates_serde_roundtrip() {
        let sa = SelectionAggregates {
            sum: Some(FiniteF64::must(150.0)),
            count: 5,
            numeric_count: 3,
            average: Some(FiniteF64::must(50.0)),
            min: Some(FiniteF64::must(10.0)),
            max: Some(FiniteF64::must(80.0)),
        };
        let json = serde_json::to_string(&sa).unwrap();
        let sa2: SelectionAggregates = serde_json::from_str(&json).unwrap();
        assert_eq!(sa2.sum.map(|v| v.get()), Some(150.0));
        assert_eq!(sa2.count, 5);
        assert_eq!(sa2.numeric_count, 3);
        assert_eq!(sa2.average.map(|v| v.get()), Some(50.0));
        assert_eq!(sa2.min.map(|v| v.get()), Some(10.0));
        assert_eq!(sa2.max.map(|v| v.get()), Some(80.0));
    }

    #[test]
    fn selection_aggregates_none_serialization() {
        // None fields serialize to null and deserialize back to None,
        // unlike the old NaN approach which broke JSON roundtripping.
        // sum is now also Option<FiniteF64>; nullable-boundary made it nullable to
        // surface accumulator overflow as an honest signal.
        let sa = SelectionAggregates {
            sum: None,
            count: 0,
            numeric_count: 0,
            average: None,
            min: None,
            max: None,
        };
        // JSON roundtrip works correctly with Option<FiniteF64>.
        let json = serde_json::to_string(&sa).unwrap();
        // Wire shape: present, possibly null. No skip_serializing_if.
        assert!(
            json.contains("\"sum\":null"),
            "sum:None must serialize as null (no skip_serializing_if): {json}"
        );
        assert!(
            json.contains("\"average\":null"),
            "average:None must serialize as null: {json}"
        );
        let sa2: SelectionAggregates = serde_json::from_str(&json).unwrap();
        assert_eq!(sa2.sum, None);
        assert_eq!(sa2.average, None);
        assert_eq!(sa2.min, None);
        assert_eq!(sa2.max, None);
        // Cloning preserves None.
        let sa3 = sa.clone();
        assert_eq!(sa3.average, None);
    }

    #[test]
    fn range_cell_data_serde_roundtrip() {
        let rcd = RangeCellData {
            row: 2,
            col: 3,
            cell_id: "abc-123".into(),
            value: CellValue::number(42.0),
            formula: Some("=SUM(A1:A3)".into()),
            formatted: Some("42.00".into()),
            format: Some(serde_json::json!({"numberFormat": "0.00"})),
            hyperlink_url: Some("https://example.com".into()),
        };
        let json = serde_json::to_string(&rcd).unwrap();
        let rcd2: RangeCellData = serde_json::from_str(&json).unwrap();
        assert_eq!(rcd2.row, 2);
        assert_eq!(rcd2.col, 3);
        assert_eq!(rcd2.cell_id, "abc-123");
        assert_eq!(rcd2.formula, Some("=SUM(A1:A3)".into()));
        assert_eq!(rcd2.formatted, Some("42.00".into()));
        assert_eq!(rcd2.hyperlink_url, Some("https://example.com".into()));
    }

    #[test]
    fn range_cell_data_optional_fields_skipped() {
        let rcd = RangeCellData {
            row: 0,
            col: 0,
            cell_id: "x".into(),
            value: CellValue::Null,
            formula: None,
            formatted: None,
            format: None,
            hyperlink_url: None,
        };
        let json = serde_json::to_string(&rcd).unwrap();
        assert!(!json.contains("formula"));
        assert!(!json.contains("formatted"));
        assert!(!json.contains("\"format\""));
        assert!(!json.contains("hyperlinkUrl"));
    }

    #[test]
    fn range_query_result_serde_roundtrip() {
        let result = RangeQueryResult {
            cells: vec![
                RangeCellData {
                    row: 0,
                    col: 0,
                    cell_id: "c1".into(),
                    value: CellValue::Text("hello".into()),
                    formula: None,
                    formatted: Some("hello".into()),
                    format: None,
                    hyperlink_url: None,
                },
                RangeCellData {
                    row: 1,
                    col: 0,
                    cell_id: "c2".into(),
                    value: CellValue::number(99.0),
                    formula: Some("=A1+1".into()),
                    formatted: Some("99".into()),
                    format: None,
                    hyperlink_url: Some("https://example.com".into()),
                },
            ],
            merges: vec![ViewportMerge {
                start_row: 0,
                start_col: 0,
                end_row: 1,
                end_col: 1,
            }],
        };
        let json = serde_json::to_string(&result).unwrap();
        let result2: RangeQueryResult = serde_json::from_str(&json).unwrap();
        assert_eq!(result2.cells.len(), 2);
        assert_eq!(result2.cells[0].cell_id, "c1");
        assert_eq!(result2.cells[1].formula, Some("=A1+1".into()));
        assert_eq!(
            result2.cells[1].hyperlink_url,
            Some("https://example.com".into())
        );
        assert_eq!(result2.merges.len(), 1);
        assert_eq!(result2.merges[0].end_row, 1);
    }
}
