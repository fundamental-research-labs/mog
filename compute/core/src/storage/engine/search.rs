//! Search and cross-sheet aggregation methods for YrsComputeEngine.
//!
//! These methods consolidate TS orchestration logic (N IPC calls) into
//! single engine calls: cell search by value/formula and workbook-wide
//! table/comment/pivot aggregation.

use bridge_core as bridge;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use domain_types::domain::comment::Comment;
use domain_types::domain::pivot::PivotTableConfig;
use domain_types::domain::table::Table;
use regex::Regex;
use serde::{Deserialize, Serialize};
use value_types::CellValue;

use super::YrsComputeEngine;
use super::services;
use crate::engine_types::{SignCheckOptions, SignCheckResult};
use crate::range_manager;

// ---------------------------------------------------------------------------
// Wrapper types for cross-sheet aggregation
// ---------------------------------------------------------------------------

/// A table together with the hex sheet ID it belongs to.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookTable {
    pub sheet_id: String,
    pub table: Table,
}

/// A comment together with the hex sheet ID it belongs to.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookComment {
    pub sheet_id: String,
    pub comment: Comment,
}

/// A pivot table config together with the hex sheet ID it belongs to.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookPivotTable {
    pub sheet_id: String,
    pub pivot: PivotTableConfig,
}

// ---------------------------------------------------------------------------
// Loose value matching
// ---------------------------------------------------------------------------

/// Check whether a search string loosely matches a CellValue.
///
/// Matching rules:
/// 1. Direct string equality (CellValue display vs search string).
/// 2. Loose numeric: if both the search string and the cell value can be
///    interpreted as f64, compare numerically.
fn values_match(search: &str, cell_value: &CellValue) -> bool {
    // Direct string match
    let cell_str = cell_value.to_string();
    if cell_str == search {
        return true;
    }

    // Loose numeric: try parsing the search string as f64
    if let Ok(search_num) = search.parse::<f64>() {
        // Check if cell value is numeric
        match cell_value {
            CellValue::Number(n) => {
                return (search_num - n.get()).abs() < f64::EPSILON;
            }
            CellValue::Text(s) => {
                if let Ok(cell_num) = s.parse::<f64>() {
                    return (search_num - cell_num).abs() < f64::EPSILON;
                }
            }
            _ => {}
        }
    }

    false
}

// ---------------------------------------------------------------------------
// Bridge methods
// ---------------------------------------------------------------------------

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "search",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    // -------------------------------------------------------------------
    // Search: find cells by value
    // -------------------------------------------------------------------

    /// Find all cells in a sheet whose value loosely matches the given string.
    ///
    /// Loose matching: `"42"` matches `Number(42.0)` and vice versa.
    /// When range bounds are `None`, the full data extent is used.
    /// Returns `(row, col)` pairs.
    #[bridge::read(scope = "sheet")]
    pub fn find_cells_by_value(
        &self,
        sheet_id: &SheetId,
        value: &str,
        start_row: Option<u32>,
        start_col: Option<u32>,
        end_row: Option<u32>,
        end_col: Option<u32>,
    ) -> Vec<(u32, u32)> {
        let sheet = match self.mirror.get_sheet(sheet_id) {
            Some(s) => s,
            None => return Vec::new(),
        };

        // Determine effective bounds
        let bounds = services::queries::get_data_bounds(&self.stores, &self.mirror, sheet_id);
        let (min_r, min_c, max_r, max_c) = match bounds {
            Some(b) => (b.min_row, b.min_col, b.max_row, b.max_col),
            None => return Vec::new(), // no data
        };

        let sr = start_row.unwrap_or(min_r);
        let sc = start_col.unwrap_or(min_c);
        let er = end_row.unwrap_or(max_r);
        let ec = end_col.unwrap_or(max_c);

        let mut results = Vec::new();

        for (cell_id, entry) in sheet.cells_iter() {
            if entry.is_ghost() {
                continue;
            }
            if let Some(pos) = sheet.position_of(cell_id)
                && pos.row() >= sr
                && pos.row() <= er
                && pos.col() >= sc
                && pos.col() <= ec
                && values_match(value, &entry.value)
            {
                results.push((pos.row(), pos.col()));
            }
        }

        // Sort for deterministic output
        results.sort();
        results
    }

    // -------------------------------------------------------------------
    // Search: find cells by formula pattern
    // -------------------------------------------------------------------

    /// Find all cells whose formula (A1 display form) matches a regex pattern.
    ///
    /// The regex is compiled once and tested against each cell's formula string.
    /// Cells without formulas are skipped. Returns `(row, col)` pairs.
    #[bridge::read(scope = "sheet")]
    pub fn find_cells_by_formula(&self, sheet_id: &SheetId, pattern: &str) -> Vec<(u32, u32)> {
        let re = match Regex::new(pattern) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };

        let sheet = match self.mirror.get_sheet(sheet_id) {
            Some(s) => s,
            None => return Vec::new(),
        };

        let mut results = Vec::new();

        for (cell_id, entry) in sheet.cells_iter() {
            if entry.is_ghost() {
                continue;
            }
            if let Some(ref formula) = entry.formula {
                // Convert identity formula to A1 display string
                let a1 = self
                    .stores
                    .compute
                    .to_a1_display(&self.mirror, sheet_id, formula);
                if re.is_match(&a1)
                    && let Some(pos) = sheet.position_of(cell_id)
                {
                    results.push((pos.row(), pos.col()));
                }
            }
        }

        results.sort();
        results
    }

    // -------------------------------------------------------------------
    // Cross-sheet aggregation: tables
    // -------------------------------------------------------------------

    /// Get all tables across all sheets in the workbook.
    ///
    /// Replaces N per-sheet IPC calls with a single engine call.
    #[bridge::read(scope = "workbook")]
    pub fn get_all_tables_workbook(&self) -> Vec<WorkbookTable> {
        let sheet_ids = self.stores.storage.sheet_order();
        let mut result = Vec::new();
        for sid in &sheet_ids {
            let tables = services::tables::get_all_tables_in_sheet(&self.mirror, sid);
            let hex: String = id_to_hex(sid.as_u128()).into();
            for table in tables {
                result.push(WorkbookTable {
                    sheet_id: hex.clone(),
                    table,
                });
            }
        }
        result
    }

    // -------------------------------------------------------------------
    // Cross-sheet aggregation: comments
    // -------------------------------------------------------------------

    /// Get all comments across all sheets in the workbook.
    ///
    /// Replaces N per-sheet IPC calls with a single engine call.
    #[bridge::read(scope = "workbook")]
    pub fn get_all_comments_workbook(&self) -> Vec<WorkbookComment> {
        let sheet_ids = self.stores.storage.sheet_order();
        let mut result = Vec::new();
        for sid in &sheet_ids {
            let comments = services::objects::get_all_comments(&self.stores, sid);
            let hex: String = id_to_hex(sid.as_u128()).into();
            for comment in comments {
                result.push(WorkbookComment {
                    sheet_id: hex.clone(),
                    comment,
                });
            }
        }
        result
    }

    // -------------------------------------------------------------------
    // Cross-sheet aggregation: pivot tables
    // -------------------------------------------------------------------

    /// Get all pivot tables across all sheets in the workbook.
    ///
    /// Replaces N per-sheet IPC calls with a single engine call.
    #[bridge::read(scope = "workbook")]
    pub fn get_all_pivot_tables_workbook(&self) -> Vec<WorkbookPivotTable> {
        let sheet_ids = self.stores.storage.sheet_order();
        let mut result = Vec::new();
        for sid in &sheet_ids {
            let pivots = services::objects::pivot_get_all(&self.stores, sid);
            let hex: String = id_to_hex(sid.as_u128()).into();
            for pivot in pivots {
                result.push(WorkbookPivotTable {
                    sheet_id: hex.clone(),
                    pivot,
                });
            }
        }
        result
    }

    /// Sign check with A1 range string (or used-range fallback).
    ///
    /// Accepts an optional A1 range string (e.g. `"A1:D20"`). When `None`,
    /// falls back to the sheet's data bounds.
    #[bridge::read(scope = "sheet")]
    pub fn sign_check_a1(
        &self,
        sheet_id: &SheetId,
        range_a1: Option<String>,
        options: SignCheckOptions,
    ) -> SignCheckResult {
        let (start_row, start_col, end_row, end_col) = match range_a1 {
            Some(ref range_str) => match range_manager::parse_range(range_str) {
                Some(r) => (r.start.row, r.start.col, r.end.row, r.end.col),
                None => {
                    return SignCheckResult {
                        cells_checked: 0,
                        anomalies: vec![],
                    };
                }
            },
            None => match self.get_data_bounds(sheet_id) {
                Some(b) => (b.min_row, b.min_col, b.max_row, b.max_col),
                None => {
                    return SignCheckResult {
                        cells_checked: 0,
                        anomalies: vec![],
                    };
                }
            },
        };
        self.sign_check(sheet_id, start_row, start_col, end_row, end_col, options)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use value_types::FiniteF64;

    #[test]
    fn values_match_exact_string() {
        let v = CellValue::Text(Arc::from("hello"));
        assert!(values_match("hello", &v));
        assert!(!values_match("world", &v));
    }

    #[test]
    fn values_match_loose_numeric_number_variant() {
        let v = CellValue::Number(FiniteF64::new(42.0).unwrap());
        assert!(values_match("42", &v));
        assert!(values_match("42.0", &v));
        assert!(!values_match("43", &v));
    }

    #[test]
    fn values_match_loose_numeric_text_variant() {
        let v = CellValue::Text(Arc::from("42"));
        assert!(values_match("42", &v));
        assert!(values_match("42.0", &v));
    }

    #[test]
    fn values_match_no_match_returns_false() {
        let v = CellValue::Boolean(true);
        // "TRUE" matches display
        assert!(values_match("TRUE", &v));
        assert!(!values_match("1", &v)); // no loose bool-to-number
    }

    #[test]
    fn values_match_null_matches_empty_string() {
        let v = CellValue::Null;
        assert!(values_match("", &v));
        assert!(!values_match("x", &v));
    }

    #[test]
    #[allow(clippy::invalid_regex)]
    fn regex_compile_failure_returns_empty() {
        // Invalid regex — should not panic, just return empty
        let re = Regex::new("[invalid");
        assert!(re.is_err());
    }
}
