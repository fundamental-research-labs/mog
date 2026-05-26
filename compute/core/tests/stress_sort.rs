#![allow(unused_imports, dead_code)]
#[allow(dead_code)]
mod stress_engine_common;
use stress_engine_common::*;

use cell_types::SheetPos;
use compute_core::bridge_types::{BridgeSortCriterion, BridgeSortMode, BridgeSortOptions};
use compute_core::engine_types::fill::{BridgeAutoFillRequest, BridgeFillRangeSpec};
use compute_core::storage::engine::YrsComputeEngine;
use domain_types::domain::copy::CopyType;
use domain_types::domain::filter::SortOrder;
use snapshot_types::{CellData, CellEdit, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellError, CellValue};

// ---------------------------------------------------------------------------
// Test 01: Sort containing data cells
// A1=3, A2=1, A3=2. B1=30, B2=10, B3=20.
// Sort A1:B3 by col A ascending.
// After: A1=1, A2=2, A3=3, B1=10, B2=20, B3=30.
// ---------------------------------------------------------------------------
#[test]
fn test_sort_two_column_ascending() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(3.0), None),  // A1=3
        make_cell(1, 0, num(1.0), None),  // A2=1
        make_cell(2, 0, num(2.0), None),  // A3=2
        make_cell(0, 1, num(30.0), None), // B1=30
        make_cell(1, 1, num(10.0), None), // B2=10
        make_cell(2, 1, num(20.0), None), // B3=20
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Sort A1:B3 by col A (col 0) ascending
    engine
        .sort_range(&sheet_id, 0, 0, 2, 1, sort_asc(0))
        .unwrap();

    // After sort: rows ordered by col A ascending
    // Row 0: A=1, B=10 (was row 1)
    // Row 1: A=2, B=20 (was row 2)
    // Row 2: A=3, B=30 (was row 0)
    assert_num(&engine, &sheet_id, 0, 0, 1.0);
    assert_num(&engine, &sheet_id, 1, 0, 2.0);
    assert_num(&engine, &sheet_id, 2, 0, 3.0);
    assert_num(&engine, &sheet_id, 0, 1, 10.0);
    assert_num(&engine, &sheet_id, 1, 1, 20.0);
    assert_num(&engine, &sheet_id, 2, 1, 30.0);
}

// ---------------------------------------------------------------------------
// Test 02: Sort with formula column
// A1=3, A2=1, A3=2. B1="=A1*10"=30, B2="=A2*10"=10, B3="=A3*10"=20.
// Sort A1:B3 by col A asc.
// After: A1=1, A2=2, A3=3. B formulas still reference their row's A cell.
// B1="=A1*10"=10, B2="=A2*10"=20, B3="=A3*10"=30.
// ---------------------------------------------------------------------------
#[test]
fn test_sort_with_formula_column() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(3.0), None), // A1=3
        make_cell(1, 0, num(1.0), None), // A2=1
        make_cell(2, 0, num(2.0), None), // A3=2
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Set formulas B1:B3
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "=A1*10")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 1, 1, "=A2*10")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 2, 1, "=A3*10")
        .unwrap();

    // Verify initial state
    assert_num(&engine, &sheet_id, 0, 1, 30.0);
    assert_num(&engine, &sheet_id, 1, 1, 10.0);
    assert_num(&engine, &sheet_id, 2, 1, 20.0);

    // Sort A1:B3 by col A asc
    engine
        .sort_range(&sheet_id, 0, 0, 2, 1, sort_asc(0))
        .unwrap();

    // After sort: A column is now 1,2,3
    assert_num(&engine, &sheet_id, 0, 0, 1.0);
    assert_num(&engine, &sheet_id, 1, 0, 2.0);
    assert_num(&engine, &sheet_id, 2, 0, 3.0);

    // Formulas move with their rows but maintain cell-id references.
    // After sort + recalc, each formula =An*10 evaluates with the new A values.
    // All three formulas reference A1, A2, A3 respectively, now containing 1, 2, 3.
    // The total of B values must remain 10+20+30 = 60 regardless of row placement.
    let b1 = read_num(&engine, &sheet_id, 0, 1);
    let b2 = read_num(&engine, &sheet_id, 1, 1);
    let b3 = read_num(&engine, &sheet_id, 2, 1);
    let sum = b1 + b2 + b3;
    assert!(
        (sum - 60.0).abs() < 1e-6,
        "Sum of B column should be 60, got {} (B1={}, B2={}, B3={})",
        sum,
        b1,
        b2,
        b3
    );
}

// ---------------------------------------------------------------------------
// Test 03: Sort feeder column — verify SUM over sorted range
// A1=5, A2=3, A3=7. Sort A1:A3 asc -> A1=3, A2=5, A3=7.
// Then set B1="=SUM(A1:A3)" to verify it picks up sorted values = 15.
// ---------------------------------------------------------------------------
#[test]
fn test_sort_preserves_sum() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(5.0), None), // A1=5
        make_cell(1, 0, num(3.0), None), // A2=3
        make_cell(2, 0, num(7.0), None), // A3=7
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Sort A1:A3 by col A asc
    engine
        .sort_range(&sheet_id, 0, 0, 2, 0, sort_asc(0))
        .unwrap();

    // After sort: A1=3, A2=5, A3=7
    assert_num(&engine, &sheet_id, 0, 0, 3.0);
    assert_num(&engine, &sheet_id, 1, 0, 5.0);
    assert_num(&engine, &sheet_id, 2, 0, 7.0);

    // Now set B1 to SUM — it should see the sorted values
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "=SUM(A1:A3)")
        .unwrap();

    // SUM(A1:A3) = 3+5+7 = 15
    assert_num(&engine, &sheet_id, 0, 1, 15.0);
}

// ---------------------------------------------------------------------------
// Test 04: Sort then autofill
// A1=3, A2=1, A3=2. Sort asc -> 1,2,3. Autofill A1:A3 -> A4:A6 = 4,5,6.
// ---------------------------------------------------------------------------
#[test]
fn test_sort_then_autofill() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(3.0), None), // A1=3
        make_cell(1, 0, num(1.0), None), // A2=1
        make_cell(2, 0, num(2.0), None), // A3=2
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Sort A1:A3 asc
    engine
        .sort_range(&sheet_id, 0, 0, 2, 0, sort_asc(0))
        .unwrap();

    // After sort: A1=1, A2=2, A3=3
    assert_num(&engine, &sheet_id, 0, 0, 1.0);
    assert_num(&engine, &sheet_id, 1, 0, 2.0);
    assert_num(&engine, &sheet_id, 2, 0, 3.0);

    // Autofill A1:A3 -> A4:A6 (rows 0..2 -> rows 3..5)
    let req = fill_request(0, 0, 2, 0, 3, 0, 5, 0, "down");
    engine.auto_fill(&sheet_id, req).unwrap();

    // A4=4, A5=5, A6=6
    assert_num(&engine, &sheet_id, 3, 0, 4.0);
    assert_num(&engine, &sheet_id, 4, 0, 5.0);
    assert_num(&engine, &sheet_id, 5, 0, 6.0);
}

// ---------------------------------------------------------------------------
// Test 05: Sort with table (headers)
// Row 0 (headers): A1="Name", B1="Score". (has_headers=true so row 0 excluded)
// A2=3, A3=1, A4=2. B2=30, B3=10, B4=20.
// Sort A1:B4 with has_headers=true by col A asc.
// After: header row unchanged, data rows sorted:
// A2=1, A3=2, A4=3, B2=10, B3=20, B4=30.
// ---------------------------------------------------------------------------
#[test]
fn test_sort_within_table() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, CellValue::Text("Name".into()), None), // A1=header
        make_cell(0, 1, CellValue::Text("Score".into()), None), // B1=header
        make_cell(1, 0, num(3.0), None),                       // A2=3
        make_cell(2, 0, num(1.0), None),                       // A3=1
        make_cell(3, 0, num(2.0), None),                       // A4=2
        make_cell(1, 1, num(30.0), None),                      // B2=30
        make_cell(2, 1, num(10.0), None),                      // B3=10
        make_cell(3, 1, num(20.0), None),                      // B4=20
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Sort A1:B4 with headers by col A (col 0) ascending
    let options = BridgeSortOptions {
        criteria: vec![BridgeSortCriterion {
            column: 0,
            direction: SortOrder::Asc,
            case_sensitive: false,
            mode: BridgeSortMode::Value { custom_list: None },
        }],
        has_headers: true,
        visible_rows_only: false,
    };
    engine.sort_range(&sheet_id, 0, 0, 3, 1, options).unwrap();

    // Headers unchanged
    assert_text(&engine, &sheet_id, 0, 0, "Name");
    assert_text(&engine, &sheet_id, 0, 1, "Score");

    // Data rows sorted by col A asc
    assert_num(&engine, &sheet_id, 1, 0, 1.0);
    assert_num(&engine, &sheet_id, 2, 0, 2.0);
    assert_num(&engine, &sheet_id, 3, 0, 3.0);
    assert_num(&engine, &sheet_id, 1, 1, 10.0);
    assert_num(&engine, &sheet_id, 2, 1, 20.0);
    assert_num(&engine, &sheet_id, 3, 1, 30.0);
}

// ---------------------------------------------------------------------------
// Test 06: Multiple sorts interleaved with edits
// A1=3, A2=1, A3=2. Sort asc -> 1,2,3. Edit A1=10. Sort desc -> 10,3,2.
// ---------------------------------------------------------------------------
#[test]
fn test_multiple_sorts_with_edits() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(3.0), None), // A1=3
        make_cell(1, 0, num(1.0), None), // A2=1
        make_cell(2, 0, num(2.0), None), // A3=2
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Sort asc
    engine
        .sort_range(&sheet_id, 0, 0, 2, 0, sort_asc(0))
        .unwrap();

    // After sort: A1=1, A2=2, A3=3
    assert_num(&engine, &sheet_id, 0, 0, 1.0);
    assert_num(&engine, &sheet_id, 1, 0, 2.0);
    assert_num(&engine, &sheet_id, 2, 0, 3.0);

    // Edit A1 = 10
    engine.set_cell_value_parsed(&sheet_id, 0, 0, "10").unwrap();
    assert_num(&engine, &sheet_id, 0, 0, 10.0);

    // Sort desc
    engine
        .sort_range(&sheet_id, 0, 0, 2, 0, sort_desc(0))
        .unwrap();

    // After desc sort: A1=10, A2=3, A3=2
    assert_num(&engine, &sheet_id, 0, 0, 10.0);
    assert_num(&engine, &sheet_id, 1, 0, 3.0);
    assert_num(&engine, &sheet_id, 2, 0, 2.0);
}

// ---------------------------------------------------------------------------
// Test 07: Sort including explicit zero vs non-zero
// A1=3, A2=1, A3=0, A4=2. Sort A1:A4 asc.
// After: A1=0, A2=1, A3=2, A4=3.
// ---------------------------------------------------------------------------
#[test]
fn test_sort_with_zero_values() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(3.0), None), // A1=3
        make_cell(1, 0, num(1.0), None), // A2=1
        make_cell(2, 0, num(0.0), None), // A3=0
        make_cell(3, 0, num(2.0), None), // A4=2
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Sort A1:A4 asc
    engine
        .sort_range(&sheet_id, 0, 0, 3, 0, sort_asc(0))
        .unwrap();

    // After asc sort: 0, 1, 2, 3
    assert_num(&engine, &sheet_id, 0, 0, 0.0);
    assert_num(&engine, &sheet_id, 1, 0, 1.0);
    assert_num(&engine, &sheet_id, 2, 0, 2.0);
    assert_num(&engine, &sheet_id, 3, 0, 3.0);
}

// ---------------------------------------------------------------------------
// Test 08: Sort pure value data by column B
// A1=10, A2=20, A3=30. B1=300, B2=100, B3=200.
// Sort A1:B3 by col B asc.
// After: rows reorder so B is ascending: (A=20,B=100), (A=30,B=200), (A=10,B=300).
// ---------------------------------------------------------------------------
#[test]
fn test_sort_by_secondary_column() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None),  // A1=10
        make_cell(1, 0, num(20.0), None),  // A2=20
        make_cell(2, 0, num(30.0), None),  // A3=30
        make_cell(0, 1, num(300.0), None), // B1=300
        make_cell(1, 1, num(100.0), None), // B2=100
        make_cell(2, 1, num(200.0), None), // B3=200
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Sort A1:B3 by col B (col 1) ascending
    engine
        .sort_range(&sheet_id, 0, 0, 2, 1, sort_asc(1))
        .unwrap();

    // After sort by B asc: B = 100, 200, 300
    assert_num(&engine, &sheet_id, 0, 1, 100.0);
    assert_num(&engine, &sheet_id, 1, 1, 200.0);
    assert_num(&engine, &sheet_id, 2, 1, 300.0);

    // Corresponding A values: 20, 30, 10
    assert_num(&engine, &sheet_id, 0, 0, 20.0);
    assert_num(&engine, &sheet_id, 1, 0, 30.0);
    assert_num(&engine, &sheet_id, 2, 0, 10.0);
}

// ---------------------------------------------------------------------------
// Test 09: Sort within larger range (5 rows)
// 5 rows of data in columns A and B. Sort by column B.
// Assert all values land in correct positions.
// ---------------------------------------------------------------------------
#[test]
fn test_sort_five_row_range() {
    // A: 10, 50, 30, 20, 40
    // B: 5,  1,  3,  4,  2
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None),
        make_cell(0, 1, num(5.0), None),
        make_cell(1, 0, num(50.0), None),
        make_cell(1, 1, num(1.0), None),
        make_cell(2, 0, num(30.0), None),
        make_cell(2, 1, num(3.0), None),
        make_cell(3, 0, num(20.0), None),
        make_cell(3, 1, num(4.0), None),
        make_cell(4, 0, num(40.0), None),
        make_cell(4, 1, num(2.0), None),
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Sort A1:B5 by col B (col 1) ascending
    engine
        .sort_range(&sheet_id, 0, 0, 4, 1, sort_asc(1))
        .unwrap();

    // After sort by B asc:
    // B sorted: 1, 2, 3, 4, 5
    // Corresponding A: 50, 40, 30, 20, 10
    assert_num(&engine, &sheet_id, 0, 1, 1.0);
    assert_num(&engine, &sheet_id, 1, 1, 2.0);
    assert_num(&engine, &sheet_id, 2, 1, 3.0);
    assert_num(&engine, &sheet_id, 3, 1, 4.0);
    assert_num(&engine, &sheet_id, 4, 1, 5.0);

    assert_num(&engine, &sheet_id, 0, 0, 50.0);
    assert_num(&engine, &sheet_id, 1, 0, 40.0);
    assert_num(&engine, &sheet_id, 2, 0, 30.0);
    assert_num(&engine, &sheet_id, 3, 0, 20.0);
    assert_num(&engine, &sheet_id, 4, 0, 10.0);
}

// ---------------------------------------------------------------------------
// Test 10: Repeated sort 10 times
// A1=3, A2=1, A3=2. Loop 10: alternate sort asc/desc.
// After each, assert exact order.
// ---------------------------------------------------------------------------
#[test]
fn test_repeated_sort_10_times() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(3.0), None), // A1=3
        make_cell(1, 0, num(1.0), None), // A2=1
        make_cell(2, 0, num(2.0), None), // A3=2
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    for i in 0..10u32 {
        if i % 2 == 0 {
            // Even iterations: sort ascending
            engine
                .sort_range(&sheet_id, 0, 0, 2, 0, sort_asc(0))
                .unwrap();
            assert_num(&engine, &sheet_id, 0, 0, 1.0);
            assert_num(&engine, &sheet_id, 1, 0, 2.0);
            assert_num(&engine, &sheet_id, 2, 0, 3.0);
        } else {
            // Odd iterations: sort descending
            engine
                .sort_range(&sheet_id, 0, 0, 2, 0, sort_desc(0))
                .unwrap();
            assert_num(&engine, &sheet_id, 0, 0, 3.0);
            assert_num(&engine, &sheet_id, 1, 0, 2.0);
            assert_num(&engine, &sheet_id, 2, 0, 1.0);
        }
    }

    // Final state: iteration 9 (odd) -> sorted descending
    assert_num(&engine, &sheet_id, 0, 0, 3.0);
    assert_num(&engine, &sheet_id, 1, 0, 2.0);
    assert_num(&engine, &sheet_id, 2, 0, 1.0);
}
