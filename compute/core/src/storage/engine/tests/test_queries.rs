//! Groups 6, 13: Active cell, query_range, aggregates, regression.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{CellData, RangeData, SheetSnapshot, WorkbookSnapshot};
use cell_types::{ColId, PayloadEncoding, RangeAnchor, RangeId, RangeKind, RowId};
use value_types::{CellValue, FiniteF64};

// -------------------------------------------------------------------
// Test 16: get_active_cell returns value and formula
// -------------------------------------------------------------------

#[test]
fn test_get_active_cell() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // A1 is a plain value cell
    let a1_data = engine.get_active_cell(&sheet_id(), &cell_id_a1());
    assert_eq!(a1_data.value, CellValue::Number(FiniteF64::must(10.0)));
    assert!(a1_data.formula.is_none());
    assert_eq!(a1_data.cell_id, cell_id_a1().to_uuid_string());

    // A2 is a formula cell: =A1+B1 => 30
    let a2_data = engine.get_active_cell(&sheet_id(), &cell_id_a2());
    assert_eq!(a2_data.value, CellValue::Number(FiniteF64::must(30.0)));
    // Formula should be present (from ComputeCore)
    assert!(a2_data.formula.is_some());
    let formula_str = a2_data.formula.unwrap();
    // ComputeCore stores the original formula string "=A1+B1"
    assert!(
        formula_str.contains("A1"),
        "formula should contain A1: {}",
        formula_str
    );
}

// -------------------------------------------------------------------
// Test 17: get_active_cell for nonexistent cell
// -------------------------------------------------------------------

#[test]
fn test_get_active_cell_nonexistent() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let fake_cell = CellId::from_raw(999999);
    let data = engine.get_active_cell(&sheet_id(), &fake_cell);
    assert_eq!(data.value, CellValue::Null);
    assert!(data.formula.is_none());
}

// -------------------------------------------------------------------
// Test 18: query_range returns cells and merges
// -------------------------------------------------------------------

#[test]
fn test_query_range() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let range = engine.query_range(&sheet_id(), 0, 0, 0, 1);
    // Should have A1 and B1
    assert_eq!(range.cells.len(), 2);
    assert!(range.merges.is_empty());

    let a1 = range.cells.iter().find(|c| c.col == 0).unwrap();
    assert_eq!(a1.value, CellValue::Number(FiniteF64::must(10.0)));

    let b1 = range.cells.iter().find(|c| c.col == 1).unwrap();
    assert_eq!(b1.value, CellValue::Number(FiniteF64::must(20.0)));
}

// -------------------------------------------------------------------
// Test 19: get_selection_aggregates computes SUM, COUNT, AVG, MIN, MAX
// -------------------------------------------------------------------

#[test]
fn test_get_selection_aggregates() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Select A1(10) and B1(20)
    let agg = engine.get_selection_aggregates(&sheet_id(), &[(0, 0, 0, 1)]);
    assert_eq!(agg.count, 2);
    assert_eq!(agg.numeric_count, 2);
    assert!((agg.sum.unwrap().get() - 30.0).abs() < f64::EPSILON);
    assert!((agg.average.unwrap().get() - 15.0).abs() < f64::EPSILON);
    assert!((agg.min.unwrap().get() - 10.0).abs() < f64::EPSILON);
    assert!((agg.max.unwrap().get() - 20.0).abs() < f64::EPSILON);
}

// -------------------------------------------------------------------
// Test 20: get_selection_aggregates with multiple ranges
// -------------------------------------------------------------------

#[test]
fn test_get_selection_aggregates_multiple_ranges() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Select A1(10) and A2(30, formula result)
    let agg = engine.get_selection_aggregates(&sheet_id(), &[(0, 0, 0, 0), (1, 0, 1, 0)]);
    assert_eq!(agg.count, 2);
    assert_eq!(agg.numeric_count, 2);
    assert!((agg.sum.unwrap().get() - 40.0).abs() < f64::EPSILON);
    assert!((agg.average.unwrap().get() - 20.0).abs() < f64::EPSILON);
    assert!((agg.min.unwrap().get() - 10.0).abs() < f64::EPSILON);
    assert!((agg.max.unwrap().get() - 30.0).abs() < f64::EPSILON);
}

// -------------------------------------------------------------------
// Test 21: get_selection_aggregates with empty region
// -------------------------------------------------------------------

#[test]
fn test_get_selection_aggregates_empty() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let agg = engine.get_selection_aggregates(&sheet_id(), &[(50, 50, 55, 55)]);
    assert_eq!(agg.count, 0);
    assert_eq!(agg.numeric_count, 0);
    // Empty region: sum is Some(0.0) (no overflow), no min/max/average.
    assert!((agg.sum.unwrap().get() - 0.0).abs() < f64::EPSILON);
    assert!(agg.average.is_none());
    assert!(agg.min.is_none());
    assert!(agg.max.is_none());
}

// -------------------------------------------------------------------
// query_range regression tests (range query unification)
// -------------------------------------------------------------------

/// Verify that query_range returns formula text (not just a boolean flag).
#[test]
fn test_query_range_returns_formula_text() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // A2 has formula =A1+B1
    let range = engine.query_range(&sheet_id(), 1, 0, 1, 0);
    assert_eq!(range.cells.len(), 1);
    let a2 = &range.cells[0];
    assert!(a2.formula.is_some(), "formula text should be present");
    let formula = a2.formula.as_ref().unwrap();
    assert!(
        formula.contains("A1") && formula.contains("B1"),
        "formula should contain cell references, got: {formula}"
    );
    // Value should be the computed result (10 + 20 = 30)
    assert_eq!(a2.value, CellValue::Number(FiniteF64::must(30.0)));
}

#[test]
fn test_query_range_returns_cse_formula_text_for_members() {
    let sheet_id = sheet_id();
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id.to_uuid_string(),
            name: "Sheet1".to_string(),
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
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();

    engine
        .set_array_formula(&sheet_id, 0, 3, 2, 3, "=SEQUENCE(3,1)".to_string())
        .expect("set CSE array formula");

    let range = engine.query_range(&sheet_id, 0, 3, 2, 3);
    assert_eq!(range.cells.len(), 3);
    for row in 0..=2 {
        let cell = range
            .cells
            .iter()
            .find(|cell| cell.row == row && cell.col == 3)
            .expect("CSE cell should be present");
        assert_eq!(cell.formula.as_deref(), Some("=SEQUENCE(3,1)"));
    }
}

/// Verify that non-formula cells have formula = None.
#[test]
fn test_query_range_no_formula_for_literals() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let range = engine.query_range(&sheet_id(), 0, 0, 0, 0);
    assert_eq!(range.cells.len(), 1);
    assert!(range.cells[0].formula.is_none());
}

/// Verify that truly empty cells are excluded from query_range results.
#[test]
fn test_query_range_skips_empty_cells() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    // Query a 3x3 region -- only 3 cells have data (A1, B1, A2)
    let range = engine.query_range(&sheet_id(), 0, 0, 2, 2);
    assert_eq!(range.cells.len(), 3, "should only have 3 non-empty cells");
}

#[test]
fn test_find_data_edge_uses_materialized_range_values() {
    let sheet_id = SheetId::from_uuid_str("660e8400-e29b-41d4-a716-446655440000").unwrap();
    let row_id = RowId::from_raw(1);
    let col_ids: Vec<ColId> = (0..11).map(|i| ColId::from_raw(i + 2)).collect();
    let mut payload = Vec::new();
    for value in [235_658.0_f64, 243_926.0, 258_645.0, 259_544.0] {
        payload.extend_from_slice(&value.to_le_bytes());
    }

    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id.to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 1,
            cols: 11,
            cells: vec![CellData {
                cell_id: "660e8400-e29b-41d4-a716-446655440001".to_string(),
                row: 0,
                col: 0,
                value: CellValue::Text("Long-term assets".into()),
                formula: None,
                identity_formula: None,
                array_ref: None,
            }],
            ranges: vec![RangeData {
                range_id: RangeId::from_uuid_str("660e8400-e29b-41d4-a716-446655440002").unwrap(),
                kind: RangeKind::Data,
                anchor: RangeAnchor::Elastic {
                    start_row: row_id,
                    end_row: row_id,
                    start_col: col_ids[6],
                    end_col: col_ids[9],
                },
                encoding: PayloadEncoding::F64Le,
                payload,
                row_axis: None,
                col_axis: None,
                row_ids: vec![row_id],
                col_ids: col_ids[6..=9].to_vec(),
            }],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();

    let target_left = engine.find_data_edge(&sheet_id, 0, 9, "left");
    assert_eq!((target_left.row, target_left.col), (0, 6));

    let target_right = engine.find_data_edge(&sheet_id, 0, 6, "right");
    assert_eq!((target_right.row, target_right.col), (0, 9));
}

/// Verify that query_range includes formatted display strings.
#[test]
fn test_query_range_includes_formatted() {
    let snap = simple_snapshot();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let range = engine.query_range(&sheet_id(), 0, 0, 0, 0);
    assert_eq!(range.cells.len(), 1);
    assert!(
        range.cells[0].formatted.is_some(),
        "formatted string should be present"
    );
}

#[test]
fn batch_column_width_setters_update_queries_and_dimension_changes() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let (_, pixel_result) = engine
        .set_col_widths(&sid, &[(2, 75.0), (4, 82.0)])
        .expect("set_col_widths");

    assert_eq!(pixel_result.dimension_changes.len(), 2);
    assert_eq!(
        pixel_result.dimension_changes[0].axis,
        crate::snapshot::Axis::Col
    );
    assert_eq!(pixel_result.dimension_changes[0].index, 2);
    assert_eq!(
        pixel_result.dimension_changes[0]
            .size
            .expect("pixel size")
            .get(),
        75.0
    );
    assert_eq!(pixel_result.dimension_changes[1].index, 4);
    assert_eq!(
        pixel_result.dimension_changes[1]
            .size
            .expect("pixel size")
            .get(),
        82.0
    );
    assert_eq!(engine.get_col_width_query(&sid, 2), 75.0);
    assert_eq!(engine.get_col_width_query(&sid, 4), 82.0);
    assert_eq!(
        engine.get_col_widths_batch(&sid, 2, 4),
        vec![
            (2, 75.0),
            (3, engine.get_col_width_query(&sid, 3)),
            (4, 82.0),
        ]
    );

    let (_, char_result) = engine
        .set_col_widths_chars(&sid, &[(6, 10.0), (7, 11.0)])
        .expect("set_col_widths_chars");

    assert_eq!(char_result.dimension_changes.len(), 2);
    assert_eq!(
        char_result.dimension_changes[0].axis,
        crate::snapshot::Axis::Col
    );
    assert_eq!(char_result.dimension_changes[0].index, 6);
    assert_eq!(char_result.dimension_changes[1].index, 7);
    assert_eq!(engine.get_col_width_chars_query(&sid, 6), 10.0);
    assert_eq!(engine.get_col_width_chars_query(&sid, 7), 11.0);
    assert_eq!(
        engine.get_col_widths_batch_chars(&sid, 6, 7),
        vec![(6, 10.0), (7, 11.0)]
    );
}
