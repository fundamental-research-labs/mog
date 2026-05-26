#![allow(unused_imports, dead_code)]
#[allow(dead_code)]
mod stress_engine_common;
use stress_engine_common::*;

use cell_types::SheetPos;
use compute_core::bridge_types::{BridgeSortCriterion, BridgeSortOptions};
use compute_core::engine_types::fill::{BridgeAutoFillRequest, BridgeFillRangeSpec};
use compute_core::storage::engine::YrsComputeEngine;
use domain_types::domain::copy::CopyType;
use domain_types::domain::filter::{SortBy, SortOrder};
use snapshot_types::{CellData, CellEdit, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellError, CellValue};

// ---------------------------------------------------------------------------
// Test 01: Insert row above data
// A1=10, A2=20, A3=30. Insert 1 row at row 0 (shift down).
// After: A1=empty, A2=10, A3=20, A4=30.
// ---------------------------------------------------------------------------
#[test]
fn test_insert_row_shifts_data_down() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None), // A1=10
        make_cell(1, 0, num(20.0), None), // A2=20
        make_cell(2, 0, num(30.0), None), // A3=30
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Insert 1 row at row 0, shift_right=false means shift DOWN
    engine
        .insert_cells_with_shift(&sheet_id, 0, 0, 1, 1, false)
        .unwrap();

    assert_null(&engine, &sheet_id, 0, 0); // A1 = empty
    assert_num(&engine, &sheet_id, 1, 0, 10.0); // A2 = 10
    assert_num(&engine, &sheet_id, 2, 0, 20.0); // A3 = 20
    assert_num(&engine, &sheet_id, 3, 0, 30.0); // A4 = 30
}

// ---------------------------------------------------------------------------
// Test 02: Insert row between formula cells
// A1=10, A2="=A1+1"=11, A3="=A2+1"=12. Insert 1 row at row 1.
// After: A1=10, A2=empty, A3 adjusts to "=A1+1"=11, A4="=A3+1"=12.
// ---------------------------------------------------------------------------
#[test]
fn test_insert_row_adjusts_formulas() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None),          // A1=10
        make_cell(1, 0, num(11.0), Some("=A1+1")), // A2=A1+1=11
        make_cell(2, 0, num(12.0), Some("=A2+1")), // A3=A2+1=12
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Insert 1 row at row 1, shift down
    engine
        .insert_cells_with_shift(&sheet_id, 1, 0, 1, 1, false)
        .unwrap();

    assert_num(&engine, &sheet_id, 0, 0, 10.0); // A1=10 unchanged
    assert_num(&engine, &sheet_id, 2, 0, 11.0); // A3 (was A2) = A1+1 = 11
    assert_num(&engine, &sheet_id, 3, 0, 12.0); // A4 (was A3) = A3+1 = 12
}

// ---------------------------------------------------------------------------
// Test 03: Delete row with data
// A1=10, A2=20, A3=30. Delete row 1 (A2). After: A1=10, A2=30.
// ---------------------------------------------------------------------------
#[test]
fn test_delete_row_shifts_data_up() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None), // A1=10
        make_cell(1, 0, num(20.0), None), // A2=20
        make_cell(2, 0, num(30.0), None), // A3=30
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Delete row 1, shift_left=false means shift UP
    engine
        .delete_cells_with_shift(&sheet_id, 1, 0, 1, 1, false)
        .unwrap();

    assert_num(&engine, &sheet_id, 0, 0, 10.0); // A1=10
    assert_num(&engine, &sheet_id, 1, 0, 30.0); // A2=30 (was A3)
}

// ---------------------------------------------------------------------------
// Test 04: Insert column splitting adjacent cells
// A1=10, B1=20, C1="=A1+B1"=30. Insert 1 col at col 1 (shift right).
// After: A1=10, B1=empty, C1=20(was B1), D1 adjusts to "=A1+C1"=30.
// ---------------------------------------------------------------------------
#[test]
fn test_insert_column_adjusts_formulas() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None),           // A1=10
        make_cell(0, 1, num(20.0), None),           // B1=20
        make_cell(0, 2, num(30.0), Some("=A1+B1")), // C1=A1+B1=30
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Insert 1 column at col 1, shift_right=true
    engine
        .insert_cells_with_shift(&sheet_id, 0, 1, 1, 1, true)
        .unwrap();

    assert_num(&engine, &sheet_id, 0, 0, 10.0); // A1=10 unchanged
    assert_num(&engine, &sheet_id, 0, 3, 30.0); // D1 (was C1) formula adjusted = A1+C1 = 30
}

// ---------------------------------------------------------------------------
// Test 05: Delete column that feeds formula
// A1=100, B1="=A1+10"=110. Delete col 0. B1(now A1) has "=#REF!+10" -> error.
// ---------------------------------------------------------------------------
#[test]
fn test_delete_column_creates_ref_error() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(100.0), None),           // A1=100
        make_cell(0, 1, num(110.0), Some("=A1+10")), // B1=A1+10=110
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Delete col 0, shift_left=true
    engine
        .delete_cells_with_shift(&sheet_id, 0, 0, 1, 1, true)
        .unwrap();

    // A1 (was B1) should have #REF! error
    assert_error(&engine, &sheet_id, 0, 0, CellError::Ref);
}

#[test]
fn test_partial_insert_shift_down_preserves_adjacent_columns() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None),
        make_cell(0, 1, num(20.0), None),
        make_cell(1, 0, num(30.0), None),
        make_cell(1, 1, num(40.0), None),
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    engine
        .insert_cells_with_shift(&sheet_id, 0, 0, 1, 1, false)
        .unwrap();

    assert_null(&engine, &sheet_id, 0, 0);
    assert_num(&engine, &sheet_id, 1, 0, 10.0);
    assert_num(&engine, &sheet_id, 2, 0, 30.0);
    assert_num(&engine, &sheet_id, 0, 1, 20.0);
    assert_num(&engine, &sheet_id, 1, 1, 40.0);
}

#[test]
fn test_partial_insert_shift_right_preserves_adjacent_rows() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None),
        make_cell(0, 1, num(20.0), None),
        make_cell(1, 0, num(30.0), None),
        make_cell(1, 1, num(40.0), None),
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    engine
        .insert_cells_with_shift(&sheet_id, 0, 1, 1, 1, true)
        .unwrap();

    assert_num(&engine, &sheet_id, 0, 0, 10.0);
    assert_null(&engine, &sheet_id, 0, 1);
    assert_num(&engine, &sheet_id, 0, 2, 20.0);
    assert_num(&engine, &sheet_id, 1, 0, 30.0);
    assert_num(&engine, &sheet_id, 1, 1, 40.0);
}

#[test]
fn test_partial_delete_shift_up_preserves_adjacent_columns() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None),
        make_cell(0, 1, num(20.0), None),
        make_cell(1, 0, num(30.0), None),
        make_cell(1, 1, num(40.0), None),
        make_cell(2, 0, num(50.0), None),
        make_cell(2, 1, num(60.0), None),
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    engine
        .delete_cells_with_shift(&sheet_id, 0, 0, 1, 1, false)
        .unwrap();

    assert_num(&engine, &sheet_id, 0, 0, 30.0);
    assert_num(&engine, &sheet_id, 1, 0, 50.0);
    assert_num(&engine, &sheet_id, 0, 1, 20.0);
    assert_num(&engine, &sheet_id, 1, 1, 40.0);
    assert_num(&engine, &sheet_id, 2, 1, 60.0);
}

#[test]
fn test_partial_delete_shift_left_preserves_adjacent_rows() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None),
        make_cell(0, 1, num(20.0), None),
        make_cell(0, 2, num(30.0), None),
        make_cell(1, 0, num(40.0), None),
        make_cell(1, 1, num(50.0), None),
        make_cell(1, 2, num(60.0), None),
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    engine
        .delete_cells_with_shift(&sheet_id, 0, 1, 1, 1, true)
        .unwrap();

    assert_num(&engine, &sheet_id, 0, 0, 10.0);
    assert_num(&engine, &sheet_id, 0, 1, 30.0);
    assert_num(&engine, &sheet_id, 1, 0, 40.0);
    assert_num(&engine, &sheet_id, 1, 1, 50.0);
    assert_num(&engine, &sheet_id, 1, 2, 60.0);
}

// ---------------------------------------------------------------------------
// Test 06: Insert then autofill
// A1=10, A2=20. Insert 3 rows at row 2 -> A1=10, A2=20, A3..A5=empty.
// Autofill A1:A2 -> A3:A5 (series 30,40,50).
// ---------------------------------------------------------------------------
#[test]
fn test_insert_rows_then_autofill() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None), // A1=10
        make_cell(1, 0, num(20.0), None), // A2=20
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Insert 3 rows at row 2, shift down
    engine
        .insert_cells_with_shift(&sheet_id, 2, 0, 3, 1, false)
        .unwrap();

    // A1=10, A2=20, A3..A5=empty. Autofill A1:A2 -> A3:A5
    let request = fill_request(0, 0, 1, 0, 2, 0, 4, 0, "down");
    engine.auto_fill(&sheet_id, request).unwrap();

    assert_num(&engine, &sheet_id, 0, 0, 10.0); // A1=10
    assert_num(&engine, &sheet_id, 1, 0, 20.0); // A2=20
    assert_num(&engine, &sheet_id, 2, 0, 30.0); // A3=30
    assert_num(&engine, &sheet_id, 3, 0, 40.0); // A4=40
    assert_num(&engine, &sheet_id, 4, 0, 50.0); // A5=50
}

// ---------------------------------------------------------------------------
// Test 07: Delete then set_cell on shifted cell
// A1=10, A2=20, A3=30, A4=40. Delete row 0 -> A1=20, A2=30, A3=40.
// Set A1="=A2+A3" = 30+40 = 70.
// ---------------------------------------------------------------------------
#[test]
fn test_delete_then_set_cell_on_shifted() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None), // A1=10
        make_cell(1, 0, num(20.0), None), // A2=20
        make_cell(2, 0, num(30.0), None), // A3=30
        make_cell(3, 0, num(40.0), None), // A4=40
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Delete row 0, shift up
    engine
        .delete_cells_with_shift(&sheet_id, 0, 0, 1, 1, false)
        .unwrap();

    // After delete: A1=20, A2=30, A3=40
    assert_num(&engine, &sheet_id, 0, 0, 20.0);
    assert_num(&engine, &sheet_id, 1, 0, 30.0);
    assert_num(&engine, &sheet_id, 2, 0, 40.0);

    // Set A1="=A2+A3" = 30+40 = 70
    engine
        .set_cell_value_parsed(&sheet_id, 0, 0, "=A2+A3")
        .unwrap();

    assert_num(&engine, &sheet_id, 0, 0, 70.0);
}

// ---------------------------------------------------------------------------
// Test 08: Insert 100 rows in formula range
// A1="=SUM(A2:A6)", A2=1, A3=2, A4=3, A5=4, A6=5 -> SUM=15.
// Insert 100 rows at row 3 -> data cells shift, SUM range adjusts.
// After insert, verify A1 still sums correctly to 15.
// ---------------------------------------------------------------------------
#[test]
fn test_insert_100_rows_in_range() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(15.0), Some("=SUM(A2:A6)")), // A1=SUM(A2:A6)=15
        make_cell(1, 0, num(1.0), None),                 // A2=1
        make_cell(2, 0, num(2.0), None),                 // A3=2
        make_cell(3, 0, num(3.0), None),                 // A4=3
        make_cell(4, 0, num(4.0), None),                 // A5=4
        make_cell(5, 0, num(5.0), None),                 // A6=5
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Verify initial SUM
    assert_num(&engine, &sheet_id, 0, 0, 15.0);

    // Insert 100 rows at row 3, shift down
    engine
        .insert_cells_with_shift(&sheet_id, 3, 0, 100, 1, false)
        .unwrap();

    // The SUM range should have adjusted to include the shifted cells.
    // A2=1, A3=2 stayed. A4..A103=empty (inserted). A104=3, A105=4, A106=5 (shifted).
    // The range A2:A6 should expand to A2:A106 (or equivalent) so SUM still = 15.
    assert_num(&engine, &sheet_id, 0, 0, 15.0);
}

// ---------------------------------------------------------------------------
// Test 09: Rapid insert/delete stress
// A1=10. Loop 20x: insert row at 0, then delete row at 0.
// After each pair A1 should be back at 10.
// ---------------------------------------------------------------------------
#[test]
fn test_rapid_insert_delete_20_cycles() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None), // A1=10
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    for _ in 0..20 {
        // Insert row at 0 (shift down): A1 moves to A2
        engine
            .insert_cells_with_shift(&sheet_id, 0, 0, 1, 1, false)
            .unwrap();

        // Delete row at 0 (shift up): A2 moves back to A1
        engine
            .delete_cells_with_shift(&sheet_id, 0, 0, 1, 1, false)
            .unwrap();
    }

    assert_num(&engine, &sheet_id, 0, 0, 10.0);
}

// ---------------------------------------------------------------------------
// Test 10: Merge adjacent to data
// A1=10, B1=20. Merge C1:D1 (adjacent, doesn't touch A1/B1).
// Assert A1=10, B1=20. Then unmerge. Assert still A1=10, B1=20.
// ---------------------------------------------------------------------------
#[test]
fn test_merge_unmerge_adjacent_to_data() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None), // A1=10
        make_cell(0, 1, num(20.0), None), // B1=20
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Merge C1:D1 (row 0, col 2..3)
    engine.merge_range(&sheet_id, 0, 2, 0, 3).unwrap();

    assert_num(&engine, &sheet_id, 0, 0, 10.0); // A1=10
    assert_num(&engine, &sheet_id, 0, 1, 20.0); // B1=20

    // Unmerge C1:D1
    engine.unmerge_range(&sheet_id, 0, 2, 0, 3).unwrap();

    assert_num(&engine, &sheet_id, 0, 0, 10.0); // A1=10
    assert_num(&engine, &sheet_id, 0, 1, 20.0); // B1=20
}
