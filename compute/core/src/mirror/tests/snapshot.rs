use crate::mirror::CellMirror;
use crate::mirror::test_helpers::{make_cell_id, simple_snapshot};
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use cell_types::{CellId, SheetId, SheetPos};
use formula_types::{NamedRangeDef, Scope, TableDef};
use value_types::{CellValue, FiniteF64};

#[test]
fn test_from_snapshot_basic() {
    let snap = simple_snapshot();
    let mirror = CellMirror::from_snapshot(snap).unwrap();

    // Should have 1 sheet
    assert_eq!(mirror.sheet_ids().count(), 1);

    // Sheet lookup by name (case-insensitive)
    let sid = mirror.sheet_by_name("sheet1").unwrap();
    let sheet = mirror.get_sheet(&sid).unwrap();
    assert_eq!(sheet.name, "Sheet1");
    // Ghost-row fix tightens dimensions to actual content bounds:
    // cells occupy rows 0–1 and cols 0–1, so rows=2, cols=2
    assert_eq!(sheet.rows, 2);
    assert_eq!(sheet.cols, 2);
    assert_eq!(sheet.cells.len(), 3);
}
#[test]
fn test_from_snapshot_uuid_parsing() {
    let snap = simple_snapshot();
    let mirror = CellMirror::from_snapshot(snap).unwrap();
    let sid = mirror.sheet_by_name("Sheet1").unwrap();

    // Verify the sheet UUID parsed correctly
    assert_eq!(
        sid,
        SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
    );

    // Verify cell UUID parsed correctly
    let cell_id = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440001").unwrap();
    let val = mirror.get_cell_value(&cell_id).unwrap();
    assert_eq!(*val, CellValue::Number(FiniteF64::must(42.0)));
}
#[test]
fn test_from_snapshot_formula() {
    let snap = simple_snapshot();
    let mirror = CellMirror::from_snapshot(snap).unwrap();

    // CellEntry.formula is None in the mirror (yrs doc is the authoritative source).
    // The scheduler's formula_strings map is the authoritative source.
    let cell_id = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440003").unwrap();
    assert!(mirror.get_formula(&cell_id).is_none());
}
#[test]
fn test_from_snapshot_invalid_uuid() {
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "not-a-uuid".to_string(),
            name: "Bad".to_string(),
            rows: 10,
            cols: 10,
            cells: vec![],
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
    };
    assert!(CellMirror::from_snapshot(snap).is_err());
}
#[test]
fn test_from_snapshot_invalid_cell_uuid() {
    // Use a non-Null value so the cell is not skipped as a ghost cell.
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 10,
            cells: vec![CellData {
                cell_id: "invalid".to_string(),
                row: 0,
                col: 0,
                value: CellValue::Number(FiniteF64::must(1.0)),
                formula: None,
                identity_formula: None,
                array_ref: None,
            }],
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
    };
    assert!(CellMirror::from_snapshot(snap).is_err());
}
#[test]
fn test_named_range_from_snapshot() {
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 10,
            cells: vec![],
            ranges: vec![],
        }],
        named_ranges: vec![NamedRangeDef::from_positions(
            "TestRange".to_string(),
            Scope::Workbook,
            make_cell_id(801),
            make_cell_id(802),
            0,
            0,
            5,
            5,
        )],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };

    let mirror = CellMirror::from_snapshot(snap).unwrap();
    assert!(mirror.get_named_range("testrange").is_some());
}
#[test]
fn test_table_from_snapshot() {
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 10,
            cells: vec![],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![TableDef {
            name: "Table1".to_string(),
            sheet: SheetId::from_raw(1),
            start_row: 0,
            start_col: 0,
            end_row: 5,
            end_col: 2,
            columns: vec!["A".to_string(), "B".to_string(), "C".to_string()],
            has_headers: true,
            has_totals: false,
        }],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };

    let mirror = CellMirror::from_snapshot(snap).unwrap();
    assert!(mirror.get_table("Table1").is_some());
}
#[test]
fn test_empty_mirror() {
    let mirror = CellMirror::new();
    assert!(mirror.get_cell_value(&make_cell_id(1)).is_none());
    assert!(mirror.get_formula(&make_cell_id(1)).is_none());
    assert!(mirror.resolve_position(&make_cell_id(1)).is_none());
    assert!(mirror.sheet_by_name("anything").is_none());
    assert_eq!(mirror.sheet_ids().count(), 0);
}
#[test]
fn test_empty_snapshot() {
    let snap = WorkbookSnapshot {
        sheets: vec![],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let mirror = CellMirror::from_snapshot(snap).unwrap();
    assert_eq!(mirror.sheet_ids().count(), 0);
}
#[test]
fn test_empty_sheet() {
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Empty".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![],
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
    };
    let mirror = CellMirror::from_snapshot(snap).unwrap();
    let sid = mirror.sheet_by_name("empty").unwrap();
    let sheet = mirror.get_sheet(&sid).unwrap();
    assert_eq!(sheet.cells.len(), 0);
    assert!(
        mirror
            .get_cell_value_at(&sid, SheetPos::new(0, 0))
            .is_none()
    );
}
#[test]
fn test_multiple_sheets() {
    let mut mirror = CellMirror::new();

    let snap1 = SheetSnapshot {
        id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
        name: "Sheet1".to_string(),
        rows: 10,
        cols: 10,
        cells: vec![CellData {
            cell_id: "550e8400-e29b-41d4-a716-446655440010".to_string(),
            row: 0,
            col: 0,
            value: CellValue::Number(FiniteF64::must(1.0)),
            formula: None,
            identity_formula: None,
            array_ref: None,
        }],
        ranges: vec![],
    };
    let snap2 = SheetSnapshot {
        id: "550e8400-e29b-41d4-a716-446655440002".to_string(),
        name: "Sheet2".to_string(),
        rows: 10,
        cols: 10,
        cells: vec![CellData {
            cell_id: "550e8400-e29b-41d4-a716-446655440020".to_string(),
            row: 0,
            col: 0,
            value: CellValue::Number(FiniteF64::must(2.0)),
            formula: None,
            identity_formula: None,
            array_ref: None,
        }],
        ranges: vec![],
    };

    mirror.add_sheet(snap1).unwrap();
    mirror.add_sheet(snap2).unwrap();

    assert_eq!(mirror.sheet_ids().count(), 2);

    let sid1 = mirror.sheet_by_name("sheet1").unwrap();
    let sid2 = mirror.sheet_by_name("sheet2").unwrap();
    assert_ne!(sid1, sid2);

    let cell1 = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440010").unwrap();
    let cell2 = CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440020").unwrap();

    assert_eq!(
        *mirror.get_cell_value_in_sheet(&sid1, &cell1).unwrap(),
        CellValue::Number(FiniteF64::must(1.0))
    );
    assert_eq!(
        *mirror.get_cell_value_in_sheet(&sid2, &cell2).unwrap(),
        CellValue::Number(FiniteF64::must(2.0))
    );

    // Cross-sheet: cell1 not in sheet2
    assert!(mirror.get_cell_value_in_sheet(&sid2, &cell1).is_none());
}
