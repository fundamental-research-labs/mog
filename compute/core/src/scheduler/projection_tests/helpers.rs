#![allow(unused_imports)]

use super::super::*;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build a snapshot with a 10x10 sheet and the given cells.
pub(super) fn spill_snapshot(cells: Vec<CellData>) -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells,
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

/// Generate a deterministic cell ID string from a row/col pair.
pub(super) fn cell_id_str(row: u32, col: u32) -> String {
    format!("00000000-0000-0000-0000-{:04x}{:04x}{:04x}", 0, row, col)
}

/// Parse a cell ID string to CellId.
pub(super) fn cell_id_from_str(s: &str) -> CellId {
    CellId::from_uuid_str(s).unwrap()
}

// ---------------------------------------------------------------------------
// Test 1: Interactive SEQUENCE(5) spills to A2:A5
// ---------------------------------------------------------------------------
