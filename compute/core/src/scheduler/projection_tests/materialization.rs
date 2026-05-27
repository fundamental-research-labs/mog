#![allow(unused_imports)]

use super::super::test_helpers::*;
use super::super::*;
use super::helpers::*;
use crate::mirror::CellMirror;
use crate::snapshot::CellData;
use std::sync::Arc;
use value_types::CellValue;

#[test]
fn test_projection_materialize_col_data() {
    let a1_str = cell_id_str(0, 0);

    let snap = spill_snapshot(vec![CellData {
        cell_id: a1_str.clone(),
        row: 0,
        col: 0,
        value: CellValue::Null,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }]);

    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snap).unwrap();

    let sheet_id = sid(1);
    let a1_id = cell_id_from_str(&a1_str);

    // Set A1 = SEQUENCE(5) — should register projection and materialize col_data
    core.set_cell(&mut mirror, &sheet_id, a1_id, 0, 0, "=SEQUENCE(5)")
        .unwrap();

    // Verify projection is registered
    assert!(
        mirror.projection_registry.is_source(&a1_id),
        "A1 should be registered as a projection source"
    );

    let proj = mirror.projection_registry.get(&a1_id).unwrap();
    assert_eq!(proj.rows, 5, "Projection should have 5 rows");
    assert_eq!(proj.cols, 1, "Projection should have 1 col");
    assert_eq!(proj.origin_row, 0);
    assert_eq!(proj.origin_col, 0);

    // Verify col_data has the materialized projected values
    let sheet_mirror = mirror.get_sheet(&sheet_id).unwrap();
    let col_slice = sheet_mirror
        .get_column_slice(0)
        .expect("col_data for column 0 should exist");

    // Row 0 is the source cell (should be 1.0 from the top-left of the array)
    assert_eq!(
        col_slice[0],
        CellValue::number(1.0),
        "col_data[0] should be 1.0"
    );
    // Rows 1-4 are projected values
    assert_eq!(
        col_slice[1],
        CellValue::number(2.0),
        "col_data[1] should be 2.0"
    );
    assert_eq!(
        col_slice[2],
        CellValue::number(3.0),
        "col_data[2] should be 3.0"
    );
    assert_eq!(
        col_slice[3],
        CellValue::number(4.0),
        "col_data[3] should be 4.0"
    );
    assert_eq!(
        col_slice[4],
        CellValue::number(5.0),
        "col_data[4] should be 5.0"
    );
}

// ---------------------------------------------------------------------------
// Test: clear_materialization zeros out col_data entries
// ---------------------------------------------------------------------------

#[test]
fn test_clear_materialization_zeros_col_data() {
    use crate::mirror::SheetMirror;

    let sheet_id = SheetId::from_raw(100);
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_mirror = SheetMirror::new(sheet_id, "Sheet1".to_string(), 100, 26);
    mirror.add_sheet_mirror(sheet_id, "Sheet1".to_string(), sheet_mirror);

    // Build a 3-element single-column array: [1, 2, 3]
    let arr = CellValue::Array(Arc::new(CellArray::single_column(vec![
        CellValue::number(1.0),
        CellValue::number(2.0),
        CellValue::number(3.0),
    ])));

    // Materialize the projection
    mirror.materialize_projection(&sheet_id, 0, 0, &arr);

    // Verify values are materialized (row 0 skipped by materialize_projection)
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    let col = sheet.get_column_slice(0).unwrap();
    assert_eq!(col[1], CellValue::number(2.0));
    assert_eq!(col[2], CellValue::number(3.0));

    // Now clear the materialization
    mirror.clear_materialization(&sheet_id, 0, 0, 3, 1);

    // Verify values are cleared (row 0 origin is NOT cleared)
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    let col = sheet.get_column_slice(0).unwrap();
    assert_eq!(col[1], CellValue::Null, "row 1 should be cleared");
    assert_eq!(col[2], CellValue::Null, "row 2 should be cleared");
}

// ---------------------------------------------------------------------------
// Test: resolve_projected_value returns correct elements
// ---------------------------------------------------------------------------

#[test]
fn test_resolve_projected_value() {
    use crate::mirror::{CellEntry, SheetMirror};

    let sheet_id = SheetId::from_raw(100);
    let source_id = CellId::from_raw(1);
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_mirror = SheetMirror::new(sheet_id, "Sheet1".to_string(), 100, 26);
    mirror.add_sheet_mirror(sheet_id, "Sheet1".to_string(), sheet_mirror);

    // Build a 3 rows x 2 cols array
    let arr = CellArray::new(
        vec![
            CellValue::number(10.0),
            CellValue::number(20.0),
            CellValue::number(30.0),
            CellValue::number(40.0),
            CellValue::number(50.0),
            CellValue::number(60.0),
        ],
        2,
    );
    let arr_value = CellValue::Array(Arc::new(arr));

    // Insert source cell at (5,3) with the top-left scalar
    mirror.insert_cell(
        &sheet_id,
        source_id,
        SheetPos::new(5, 3),
        CellEntry {
            value: CellValue::number(10.0),
            formula: None,
        },
    );

    // Register projection: 3 rows x 2 cols starting at (5, 3)
    mirror
        .projection_registry
        .register(source_id, sheet_id, 5, 3, 3, 2);

    // Materialize projection into col_data
    mirror.materialize_projection(&sheet_id, 5, 3, &arr_value);

    // Test resolve_projected_value at various positions
    // Origin (5,3) -> elem (0,0) = 10.0 (from col_data, written by insert_cell)
    let val = mirror.resolve_projected_value(&sheet_id, 5, 3);
    assert_eq!(val, Some(CellValue::number(10.0)));

    // (5,4) -> elem (0,1) = 20.0 (from col_data via materialize_projection)
    let val = mirror.resolve_projected_value(&sheet_id, 5, 4);
    assert_eq!(val, Some(CellValue::number(20.0)));

    // (6,3) -> elem (1,0) = 30.0
    let val = mirror.resolve_projected_value(&sheet_id, 6, 3);
    assert_eq!(val, Some(CellValue::number(30.0)));

    // (7,4) -> elem (2,1) = 60.0
    let val = mirror.resolve_projected_value(&sheet_id, 7, 4);
    assert_eq!(val, Some(CellValue::number(60.0)));

    // Outside projection -> None
    let val = mirror.resolve_projected_value(&sheet_id, 8, 3);
    assert_eq!(val, None);

    let val = mirror.resolve_projected_value(&sheet_id, 5, 5);
    assert_eq!(val, None);
}

// ---------------------------------------------------------------------------
// Test: Projection is cleared when formula produces non-array result
// ---------------------------------------------------------------------------
