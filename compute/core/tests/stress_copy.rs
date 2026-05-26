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
// Test 01: Copy values to new location
// A1=10, B1=20. Copy A1:B1 -> C1:D1 (CopyType::All). Assert C1=10, D1=20.
// ---------------------------------------------------------------------------
#[test]
fn test_copy_values_to_new_location() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None), // A1=10
        make_cell(0, 1, num(20.0), None), // B1=20
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    engine
        .copy_range(
            &sheet_id,
            0,
            0,
            0,
            1, // source A1:B1
            &sheet_id,
            0,
            2, // target C1
            CopyType::All,
            false,
            false,
        )
        .unwrap();

    assert_num(&engine, &sheet_id, 0, 2, 10.0); // C1=10
    assert_num(&engine, &sheet_id, 0, 3, 20.0); // D1=20
}

// ---------------------------------------------------------------------------
// Test 02: Copy formula with ref adjustment
// A1=10, B1="=A1*2"=20. Copy B1 -> B2 (CopyType::All).
// B2="=A2*2". A2 empty -> 0, so B2=0. Set A2=5 -> B2=10.
// ---------------------------------------------------------------------------
#[test]
fn test_copy_formula_adjusts_references() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None),          // A1=10
        make_cell(0, 1, num(20.0), Some("=A1*2")), // B1=A1*2=20
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Copy B1 -> B2
    engine
        .copy_range(
            &sheet_id,
            0,
            1,
            0,
            1, // source B1
            &sheet_id,
            1,
            1, // target B2
            CopyType::All,
            false,
            false,
        )
        .unwrap();

    // B2 = "=A2*2", A2 is empty (0), so B2 = 0
    assert_num(&engine, &sheet_id, 1, 1, 0.0);

    // Set A2=5 -> B2="=A2*2"=10
    engine.set_cell_value_parsed(&sheet_id, 1, 0, "5").unwrap();

    assert_num(&engine, &sheet_id, 1, 1, 10.0);
}

// ---------------------------------------------------------------------------
// Test 03: Copy values only from formula cells
// A1=10, B1="=A1*3"=30. Copy A1:B1 -> C1:D1 (CopyType::Values).
// C1=10, D1=30 (plain values). Set A1=20 -> B1=60, but C1/D1 unchanged.
// ---------------------------------------------------------------------------
#[test]
fn test_copy_values_only_from_formulas() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None),          // A1=10
        make_cell(0, 1, num(30.0), Some("=A1*3")), // B1=A1*3=30
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Copy A1:B1 -> C1:D1, values only
    engine
        .copy_range(
            &sheet_id,
            0,
            0,
            0,
            1, // source A1:B1
            &sheet_id,
            0,
            2, // target C1
            CopyType::Values,
            false,
            false,
        )
        .unwrap();

    assert_num(&engine, &sheet_id, 0, 2, 10.0); // C1=10
    assert_num(&engine, &sheet_id, 0, 3, 30.0); // D1=30

    // Change A1=20 -> B1=60, but C1/D1 should remain unchanged (plain values)
    engine.set_cell_value_parsed(&sheet_id, 0, 0, "20").unwrap();

    assert_num(&engine, &sheet_id, 0, 1, 60.0); // B1=A1*3=60
    assert_num(&engine, &sheet_id, 0, 2, 10.0); // C1 still 10
    assert_num(&engine, &sheet_id, 0, 3, 30.0); // D1 still 30
}

// ---------------------------------------------------------------------------
// Test 04: Copy into cells that have formulas
// C1="=100". Copy A1(=10) -> C1 (CopyType::All). C1 now=10 (overwrites).
// ---------------------------------------------------------------------------
#[test]
fn test_copy_overwrites_existing_formula() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None),          // A1=10
        make_cell(0, 2, num(100.0), Some("=100")), // C1=100
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Verify C1=100 initially
    assert_num(&engine, &sheet_id, 0, 2, 100.0);

    // Copy A1 -> C1
    engine
        .copy_range(
            &sheet_id,
            0,
            0,
            0,
            0, // source A1
            &sheet_id,
            0,
            2, // target C1
            CopyType::All,
            false,
            false,
        )
        .unwrap();

    assert_num(&engine, &sheet_id, 0, 2, 10.0); // C1=10 (overwritten)
}

// ---------------------------------------------------------------------------
// Test 05: Copy with transpose
// A1=1, A2=2, A3=3 (column). Copy A1:A3 -> B1:D1 (transpose=true).
// B1=1, C1=2, D1=3 (row).
// ---------------------------------------------------------------------------
#[test]
fn test_copy_column_to_row_transpose() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(1.0), None), // A1=1
        make_cell(1, 0, num(2.0), None), // A2=2
        make_cell(2, 0, num(3.0), None), // A3=3
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Copy A1:A3 -> B1 with transpose
    engine
        .copy_range(
            &sheet_id,
            0,
            0,
            2,
            0, // source A1:A3
            &sheet_id,
            0,
            1, // target B1
            CopyType::All,
            false,
            true, // transpose=true
        )
        .unwrap();

    assert_num(&engine, &sheet_id, 0, 1, 1.0); // B1=1
    assert_num(&engine, &sheet_id, 0, 2, 2.0); // C1=2
    assert_num(&engine, &sheet_id, 0, 3, 3.0); // D1=3
}

// ---------------------------------------------------------------------------
// Test 06: Paste over existing values
// A1=10, B1=20. C1=99, D1=88. Copy A1:B1 -> C1:D1. C1=10, D1=20.
// ---------------------------------------------------------------------------
#[test]
fn test_paste_overwrites_existing_values() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None), // A1=10
        make_cell(0, 1, num(20.0), None), // B1=20
        make_cell(0, 2, num(99.0), None), // C1=99
        make_cell(0, 3, num(88.0), None), // D1=88
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Verify originals
    assert_num(&engine, &sheet_id, 0, 2, 99.0);
    assert_num(&engine, &sheet_id, 0, 3, 88.0);

    // Copy A1:B1 -> C1:D1
    engine
        .copy_range(
            &sheet_id,
            0,
            0,
            0,
            1,
            &sheet_id,
            0,
            2,
            CopyType::All,
            false,
            false,
        )
        .unwrap();

    assert_num(&engine, &sheet_id, 0, 2, 10.0); // C1=10 (overwritten)
    assert_num(&engine, &sheet_id, 0, 3, 20.0); // D1=20 (overwritten)
}

// ---------------------------------------------------------------------------
// Test 07: Copy large range
// A1:A10 = 1..10, B1:B10 = "=A{i}*2" = 2..20.
// Copy A1:B10 -> C1:D10 (CopyType::Values).
// Assert C1=1,...,C10=10, D1=2,...,D10=20.
// ---------------------------------------------------------------------------
#[test]
fn test_copy_large_10x2_range() {
    let mut cells = Vec::new();
    for i in 0u32..10 {
        let val = (i + 1) as f64;
        cells.push(make_cell(i, 0, num(val), None)); // A{i+1} = i+1
    }
    let snapshot = make_snapshot(cells);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Set B1:B10 = "=A{i}*2" via parsed API
    for i in 0u32..10 {
        let formula = format!("=A{}*2", i + 1);
        engine
            .set_cell_value_parsed(&sheet_id, i, 1, &formula)
            .unwrap();
    }

    // Verify B column
    for i in 0u32..10 {
        let expected = ((i + 1) * 2) as f64;
        assert_num(&engine, &sheet_id, i, 1, expected);
    }

    // Copy A1:B10 -> C1:D10 (values only)
    engine
        .copy_range(
            &sheet_id,
            0,
            0,
            9,
            1, // source A1:B10
            &sheet_id,
            0,
            2, // target C1
            CopyType::Values,
            false,
            false,
        )
        .unwrap();

    // Assert C column = 1..10, D column = 2..20
    for i in 0u32..10 {
        let expected_c = (i + 1) as f64;
        let expected_d = ((i + 1) * 2) as f64;
        assert_num(&engine, &sheet_id, i, 2, expected_c);
        assert_num(&engine, &sheet_id, i, 3, expected_d);
    }
}

// ---------------------------------------------------------------------------
// Test 08: Copy cross-sheet
// Sheet1: A1=10, B1=20. Copy Sheet1!A1:B1 -> Sheet2!A1:B1.
// Assert Sheet2!A1=10, Sheet2!B1=20.
// ---------------------------------------------------------------------------
#[test]
fn test_copy_values_cross_sheet() {
    let snapshot = make_two_sheet_snapshot(
        vec![
            make_cell(0, 0, num(10.0), None), // Sheet1 A1=10
            make_cell(0, 1, num(20.0), None), // Sheet1 B1=20
        ],
        vec![], // Sheet2 empty
    );
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet1_id = engine.mirror().sheet_by_name("Sheet1").unwrap();
    let sheet2_id = engine.mirror().sheet_by_name("Sheet2").unwrap();

    // Copy Sheet1!A1:B1 -> Sheet2!A1:B1
    engine
        .copy_range(
            &sheet1_id,
            0,
            0,
            0,
            1, // source Sheet1 A1:B1
            &sheet2_id,
            0,
            0, // target Sheet2 A1
            CopyType::All,
            false,
            false,
        )
        .unwrap();

    assert_num(&engine, &sheet2_id, 0, 0, 10.0); // Sheet2 A1=10
    assert_num(&engine, &sheet2_id, 0, 1, 20.0); // Sheet2 B1=20
}
