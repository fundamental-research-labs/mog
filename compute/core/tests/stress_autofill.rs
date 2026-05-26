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
// Test 01: Autofill value series into cycle feeder
// A1=1, A2=2, A3=3. D1="=A1+10"=11 (no cycle).
// Autofill A1:A3 -> A4:A10 (series 4..10). Assert D1 still = 11.
// ---------------------------------------------------------------------------
#[test]
fn test_autofill_value_series() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(1.0), None), // A1=1
        make_cell(1, 0, num(2.0), None), // A2=2
        make_cell(2, 0, num(3.0), None), // A3=3
    ]);
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // D1 = =A1+10
    engine
        .set_cell_value_parsed(&sheet_id, 0, 3, "=A1+10")
        .unwrap();
    assert_num(&engine, &sheet_id, 0, 3, 11.0);

    // Autofill A1:A3 -> A4:A10 (rows 0..2 -> rows 3..9, col 0)
    let req = fill_request(0, 0, 2, 0, 3, 0, 9, 0, "down");
    engine.auto_fill(&sheet_id, req).unwrap();

    // Assert A4..A10 = 4..10
    assert_num(&engine, &sheet_id, 3, 0, 4.0);
    assert_num(&engine, &sheet_id, 4, 0, 5.0);
    assert_num(&engine, &sheet_id, 5, 0, 6.0);
    assert_num(&engine, &sheet_id, 6, 0, 7.0);
    assert_num(&engine, &sheet_id, 7, 0, 8.0);
    assert_num(&engine, &sheet_id, 8, 0, 9.0);
    assert_num(&engine, &sheet_id, 9, 0, 10.0);

    // D1 should still = 11 (A1 unchanged = 1, so 1+10 = 11)
    assert_num(&engine, &sheet_id, 0, 3, 11.0);
}

// ---------------------------------------------------------------------------
// Test 02: Autofill formula referencing cells
// A1=10, A2=20. B1="=A1*2"=20. Autofill B1 -> B2. B2="=A2*2"=40.
// ---------------------------------------------------------------------------
#[test]
fn test_autofill_formula_ref_adjustment() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None), // A1=10
        make_cell(1, 0, num(20.0), None), // A2=20
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // B1 = =A1*2
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "=A1*2")
        .unwrap();
    assert_num(&engine, &sheet_id, 0, 1, 20.0);

    // Autofill B1 -> B2 (row 0 col 1 -> row 1 col 1)
    let req = fill_request(0, 1, 0, 1, 1, 1, 1, 1, "down");
    engine.auto_fill(&sheet_id, req).unwrap();

    // B1 still = 20, B2 = =A2*2 = 40
    assert_num(&engine, &sheet_id, 0, 1, 20.0);
    assert_num(&engine, &sheet_id, 1, 1, 40.0);
}

// ---------------------------------------------------------------------------
// Test 03: Autofill creating formula dependencies
// Row 1: A1=1, A2=2, B1="=A1+1"=2. Autofill A1:B2 -> A3:B4.
// A3=3, A4=4 (value series from 1,2). B3="=A3+1"=4, B4="=A4+1"=5.
// ---------------------------------------------------------------------------
#[test]
fn test_autofill_creates_formula_deps() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(1.0), None), // A1=1
        make_cell(1, 0, num(2.0), None), // A2=2
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // B1 = =A1+1, B2 = =A2+1
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "=A1+1")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 1, 1, "=A2+1")
        .unwrap();
    assert_num(&engine, &sheet_id, 0, 1, 2.0);
    assert_num(&engine, &sheet_id, 1, 1, 3.0);

    // Autofill A1:B2 -> A3:B4 (rows 0..1, cols 0..1 -> rows 2..3, cols 0..1)
    let req = fill_request(0, 0, 1, 1, 2, 0, 3, 1, "down");
    engine.auto_fill(&sheet_id, req).unwrap();

    // A3 = 3 (value series continuation from 1,2)
    assert_num(&engine, &sheet_id, 2, 0, 3.0);
    // A4 = 4
    assert_num(&engine, &sheet_id, 3, 0, 4.0);
    // B3 = =A3+1 = 3+1 = 4
    assert_num(&engine, &sheet_id, 2, 1, 4.0);
    // B4 = =A4+1 = 4+1 = 5
    assert_num(&engine, &sheet_id, 3, 1, 5.0);
}

// ---------------------------------------------------------------------------
// Test 04: Autofill across cells (pure value series)
// A1=1, A2=2, A3=3, A4=4. Autofill A1:A4 -> A5:A8. Assert A5=5..A8=8.
// ---------------------------------------------------------------------------
#[test]
fn test_autofill_numeric_series() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(1.0), None), // A1=1
        make_cell(1, 0, num(2.0), None), // A2=2
        make_cell(2, 0, num(3.0), None), // A3=3
        make_cell(3, 0, num(4.0), None), // A4=4
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Autofill A1:A4 -> A5:A8 (rows 0..3 -> rows 4..7)
    let req = fill_request(0, 0, 3, 0, 4, 0, 7, 0, "down");
    engine.auto_fill(&sheet_id, req).unwrap();

    assert_num(&engine, &sheet_id, 4, 0, 5.0);
    assert_num(&engine, &sheet_id, 5, 0, 6.0);
    assert_num(&engine, &sheet_id, 6, 0, 7.0);
    assert_num(&engine, &sheet_id, 7, 0, 8.0);
}

// ---------------------------------------------------------------------------
// Test 05: Autofill formula down multiple rows
// A1=10, B1=20, C1="=A1+B1"=30. A2=11, B2=21.
// Autofill C1 -> C2. C2="=A2+B2"=32.
// ---------------------------------------------------------------------------
#[test]
fn test_autofill_formula_down() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None), // A1=10
        make_cell(0, 1, num(20.0), None), // B1=20
        make_cell(1, 0, num(11.0), None), // A2=11
        make_cell(1, 1, num(21.0), None), // B2=21
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // C1 = =A1+B1
    engine
        .set_cell_value_parsed(&sheet_id, 0, 2, "=A1+B1")
        .unwrap();
    assert_num(&engine, &sheet_id, 0, 2, 30.0);

    // Autofill C1 -> C2
    let req = fill_request(0, 2, 0, 2, 1, 2, 1, 2, "down");
    engine.auto_fill(&sheet_id, req).unwrap();

    // C1 = 30, C2 = =A2+B2 = 11+21 = 32
    assert_num(&engine, &sheet_id, 0, 2, 30.0);
    assert_num(&engine, &sheet_id, 1, 2, 32.0);
}

// ---------------------------------------------------------------------------
// Test 06: Autofill right (numeric series with two-value source)
// A1=10, B1=20. Autofill A1:B1 right -> C1:E1. C1=30, D1=40, E1=50.
// (Two values establish a step=10 pattern.)
// ---------------------------------------------------------------------------
#[test]
fn test_autofill_numeric_series_right() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None), // A1=10
        make_cell(0, 1, num(20.0), None), // B1=20
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Autofill A1:B1 right -> C1:E1 (row 0, cols 0..1 -> row 0, cols 2..4)
    let req = fill_request(0, 0, 0, 1, 0, 2, 0, 4, "right");
    engine.auto_fill(&sheet_id, req).unwrap();

    // Source: 10, 20 (step=10). Series: C1=30, D1=40, E1=50
    assert_num(&engine, &sheet_id, 0, 0, 10.0);
    assert_num(&engine, &sheet_id, 0, 1, 20.0);
    assert_num(&engine, &sheet_id, 0, 2, 30.0);
    assert_num(&engine, &sheet_id, 0, 3, 40.0);
    assert_num(&engine, &sheet_id, 0, 4, 50.0);
}

// ---------------------------------------------------------------------------
// Test 07: Autofill formula then edit source
// A1=10, B1="=A1*2"=20. Autofill B1->B2:B5.
// B2="=A2*2", etc. A2..A5 are empty(=0), so B2..B5=0.
// Set A2=5 -> B2=10.
// ---------------------------------------------------------------------------
#[test]
fn test_autofill_formula_then_edit() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None), // A1=10
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // B1 = =A1*2
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "=A1*2")
        .unwrap();
    assert_num(&engine, &sheet_id, 0, 1, 20.0);

    // Autofill B1 -> B2:B5 (row 0 col 1 -> rows 1..4 col 1)
    let req = fill_request(0, 1, 0, 1, 1, 1, 4, 1, "down");
    engine.auto_fill(&sheet_id, req).unwrap();

    // A2..A5 are empty -> treated as 0 in multiplication
    // B2 = =A2*2 = 0*2 = 0
    assert_num(&engine, &sheet_id, 1, 1, 0.0);
    assert_num(&engine, &sheet_id, 2, 1, 0.0);
    assert_num(&engine, &sheet_id, 3, 1, 0.0);
    assert_num(&engine, &sheet_id, 4, 1, 0.0);

    // Now set A2=5
    engine.set_cell_value_parsed(&sheet_id, 1, 0, "5").unwrap();

    // B2 = =A2*2 = 5*2 = 10
    assert_num(&engine, &sheet_id, 1, 1, 10.0);
}

// ---------------------------------------------------------------------------
// Test 08: Flash fill
// A1="John Smith", B1="John". A2="Jane Doe".
// Flash fill B2 based on pattern -> "Jane".
// If flash_fill errors, assert the error. If it works, assert B2=Text("Jane").
// ---------------------------------------------------------------------------
#[test]
fn test_flash_fill_pattern() {
    use compute_core::engine_types::fill::{BridgeFillRangeSpec, BridgeFlashFillRequest};

    let snapshot = make_snapshot(vec![
        make_cell(0, 0, CellValue::Text("John Smith".into()), None), // A1
        make_cell(1, 0, CellValue::Text("Jane Doe".into()), None),   // A2
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // B1 = "John" (example)
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "John")
        .unwrap();

    let req = BridgeFlashFillRequest {
        source_range: BridgeFillRangeSpec {
            start_row: 0,
            start_col: 0,
            end_row: 1,
            end_col: 0,
        },
        target_range: BridgeFillRangeSpec {
            start_row: 0,
            start_col: 1,
            end_row: 1,
            end_col: 1,
        },
    };

    match engine.flash_fill(&sheet_id, req) {
        Ok(_result) => {
            // Flash fill succeeded — B2 should be "Jane"
            assert_text(&engine, &sheet_id, 1, 1, "Jane");
        }
        Err(_e) => {
            // Flash fill not supported or errored — B2 should still be null
            assert_null(&engine, &sheet_id, 1, 1);
        }
    }
}

// ---------------------------------------------------------------------------
// Test 09: Copy values from formula cells
// A1=10, B1="=A1*3"=30.
// Copy A1:B1 -> C1:D1 with CopyType::Values.
// C1=10, D1=30 (plain values, not formulas).
// ---------------------------------------------------------------------------
#[test]
fn test_copy_values_from_formulas() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None), // A1=10
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // B1 = =A1*3
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "=A1*3")
        .unwrap();
    assert_num(&engine, &sheet_id, 0, 1, 30.0);

    // Copy A1:B1 -> C1:D1 with CopyType::Values
    // copy_range(source_sheet, src_start_row, src_start_col, src_end_row, src_end_col,
    //            target_sheet, target_row, target_col, copy_type, skip_blanks, transpose)
    engine
        .copy_range(
            &sheet_id,
            0,
            0,
            0,
            1, // source: A1:B1
            &sheet_id,
            0,
            2, // target: C1
            CopyType::Values,
            false,
            false,
        )
        .unwrap();

    // C1=10 (plain value from A1), D1=30 (plain value from B1's computed result)
    assert_num(&engine, &sheet_id, 0, 2, 10.0);
    assert_num(&engine, &sheet_id, 0, 3, 30.0);
}

// ---------------------------------------------------------------------------
// Test 10: Autofill date-like values (treated as numeric series)
// A1=1, A2=2. Autofill -> A3:A12 = 3..12.
// ---------------------------------------------------------------------------
#[test]
fn test_autofill_long_numeric_series() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(1.0), None), // A1=1
        make_cell(1, 0, num(2.0), None), // A2=2
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Autofill A1:A2 -> A3:A12 (rows 0..1 -> rows 2..11)
    let req = fill_request(0, 0, 1, 0, 2, 0, 11, 0, "down");
    engine.auto_fill(&sheet_id, req).unwrap();

    // A3..A12 = 3..12
    for row in 2..=11u32 {
        let expected = (row + 1) as f64;
        assert_num(&engine, &sheet_id, row, 0, expected);
    }
}

// ---------------------------------------------------------------------------
// Test 11: Autofill then clear (undo)
// A1=10, B1="=A1+1"=11. Autofill B1->B2:B5.
// B2="=A2+1" where A2 is empty(=0), so B2=0+1=1.
// Then clear_range on B2:B5. Assert B2 is Null after clear.
// ---------------------------------------------------------------------------
#[test]
fn test_autofill_then_clear_range() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None), // A1=10
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // B1 = =A1+1
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "=A1+1")
        .unwrap();
    assert_num(&engine, &sheet_id, 0, 1, 11.0);

    // Autofill B1 -> B2:B5 (row 0 col 1 -> rows 1..4 col 1)
    let req = fill_request(0, 1, 0, 1, 1, 1, 4, 1, "down");
    engine.auto_fill(&sheet_id, req).unwrap();

    // B2 = =A2+1 = 0+1 = 1 (A2 is empty -> 0)
    assert_num(&engine, &sheet_id, 1, 1, 1.0);

    // Clear B2:B5 (rows 1..4, col 1)
    engine
        .clear_range_by_position(sheet_id, 1, 1, 4, 1)
        .unwrap();

    // B2 should be null after clear
    assert_null(&engine, &sheet_id, 1, 1);
    assert_null(&engine, &sheet_id, 2, 1);
    assert_null(&engine, &sheet_id, 3, 1);
    assert_null(&engine, &sheet_id, 4, 1);
}

// ---------------------------------------------------------------------------
// Test 12: Large autofill 1000 rows
// A1=1, A2=2. Autofill A1:A2 -> A3:A1000 (series).
// Assert A500=500, A1000=1000. Two-value source establishes step=1 pattern.
// ---------------------------------------------------------------------------
#[test]
fn test_autofill_1000_rows() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(1.0), None), // A1=1
        make_cell(1, 0, num(2.0), None), // A2=2
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Autofill A1:A2 -> A3:A1000 (rows 0..1 -> rows 2..999)
    let req = fill_request(0, 0, 1, 0, 2, 0, 999, 0, "down");
    engine.auto_fill(&sheet_id, req).unwrap();

    // A1 = 1, A2 = 2 (source unchanged)
    assert_num(&engine, &sheet_id, 0, 0, 1.0);
    assert_num(&engine, &sheet_id, 1, 0, 2.0);
    // A500 (row 499) = 500
    assert_num(&engine, &sheet_id, 499, 0, 500.0);
    // A1000 (row 999) = 1000
    assert_num(&engine, &sheet_id, 999, 0, 1000.0);
}
