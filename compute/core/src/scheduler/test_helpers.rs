use super::*;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

pub(super) fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

pub(super) fn make_cell_id(n: u128) -> CellId {
    CellId::from_raw(n)
}

/// Create a snapshot with a single sheet containing some cells.
/// Sheet ID and Cell IDs are deterministic UUID strings for easy reference.
pub(super) fn basic_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "00000000-0000-0000-0000-000000000001".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000010".to_string(),
                    row: 0,
                    col: 0, // A1
                    value: CellValue::number(10.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000011".to_string(),
                    row: 0,
                    col: 1, // B1
                    value: CellValue::number(20.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "00000000-0000-0000-0000-000000000012".to_string(),
                    row: 0,
                    col: 2, // C1
                    value: CellValue::number(0.0),
                    formula: Some("=A1+B1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
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

/// Parse a UUID string to CellId.
pub(super) fn cid(suffix: u128) -> CellId {
    CellId::from_uuid_str(&format!("00000000-0000-0000-0000-{:012x}", suffix)).unwrap()
}

/// Parse a UUID string to SheetId.
pub(super) fn sid(suffix: u128) -> SheetId {
    SheetId::from_uuid_str(&format!("00000000-0000-0000-0000-{:012x}", suffix)).unwrap()
}
