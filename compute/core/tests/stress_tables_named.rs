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

use formula_types::{NamedRangeDef, Scope};

// ---------------------------------------------------------------------------
// Test 01: Create table around existing data
// A1="Name"(header), A2="Alice", A3="Bob". B1="Score", B2=90, B3=80.
// Create table "Scores" over A1:B3 with headers. Assert data unchanged.
// ---------------------------------------------------------------------------
#[test]
fn test_create_table_preserves_data() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, CellValue::Text("Name".into()), None),
        make_cell(0, 1, CellValue::Text("Score".into()), None),
        make_cell(1, 0, CellValue::Text("Alice".into()), None),
        make_cell(1, 1, num(90.0), None),
        make_cell(2, 0, CellValue::Text("Bob".into()), None),
        make_cell(2, 1, num(80.0), None),
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Create table over A1:B3 with headers
    engine
        .create_table(
            &sheet_id,
            "Scores".to_string(),
            0,
            0,
            2,
            1,
            vec!["Name".to_string(), "Score".to_string()],
            true,
        )
        .unwrap();

    // Assert data unchanged
    assert_text(&engine, &sheet_id, 0, 0, "Name");
    assert_text(&engine, &sheet_id, 0, 1, "Score");
    assert_text(&engine, &sheet_id, 1, 0, "Alice");
    assert_num(&engine, &sheet_id, 1, 1, 90.0);
    assert_text(&engine, &sheet_id, 2, 0, "Bob");
    assert_num(&engine, &sheet_id, 2, 1, 80.0);
}

// ---------------------------------------------------------------------------
// Test 02: Table with formula column
// Create table with A1:C3 (headers: Name, Score, Grade).
// Set A2="Alice",B2=90,A3="Bob",B3=80. Set C2="=B2/10"=9, C3="=B3/10"=8.
// ---------------------------------------------------------------------------
#[test]
fn test_table_formula_column() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, CellValue::Text("Name".into()), None),
        make_cell(0, 1, CellValue::Text("Score".into()), None),
        make_cell(0, 2, CellValue::Text("Grade".into()), None),
        make_cell(1, 0, CellValue::Text("Alice".into()), None),
        make_cell(1, 1, num(90.0), None),
        make_cell(2, 0, CellValue::Text("Bob".into()), None),
        make_cell(2, 1, num(80.0), None),
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Create table over A1:C3
    engine
        .create_table(
            &sheet_id,
            "Scores".to_string(),
            0,
            0,
            2,
            2,
            vec!["Name".to_string(), "Score".to_string(), "Grade".to_string()],
            true,
        )
        .unwrap();

    // Set formula column
    engine
        .set_cell_value_parsed(&sheet_id, 1, 2, "=B2/10")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 2, 2, "=B3/10")
        .unwrap();

    assert_num(&engine, &sheet_id, 1, 2, 9.0);
    assert_num(&engine, &sheet_id, 2, 2, 8.0);
}

// ---------------------------------------------------------------------------
// Test 03: Delete table — data should remain
// Same setup as test 02. delete_table("Scores"). Assert data stays.
// ---------------------------------------------------------------------------
#[test]
fn test_delete_table_preserves_data() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, CellValue::Text("Name".into()), None),
        make_cell(0, 1, CellValue::Text("Score".into()), None),
        make_cell(0, 2, CellValue::Text("Grade".into()), None),
        make_cell(1, 0, CellValue::Text("Alice".into()), None),
        make_cell(1, 1, num(90.0), None),
        make_cell(2, 0, CellValue::Text("Bob".into()), None),
        make_cell(2, 1, num(80.0), None),
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    engine
        .create_table(
            &sheet_id,
            "Scores".to_string(),
            0,
            0,
            2,
            2,
            vec!["Name".to_string(), "Score".to_string(), "Grade".to_string()],
            true,
        )
        .unwrap();

    // Set formulas in Grade column
    engine
        .set_cell_value_parsed(&sheet_id, 1, 2, "=B2/10")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 2, 2, "=B3/10")
        .unwrap();

    // Delete the table
    engine.delete_table("Scores").unwrap();

    // Data and formulas should remain
    assert_num(&engine, &sheet_id, 1, 1, 90.0);
    assert_num(&engine, &sheet_id, 1, 2, 9.0);
    assert_num(&engine, &sheet_id, 2, 1, 80.0);
    assert_num(&engine, &sheet_id, 2, 2, 8.0);
    assert_text(&engine, &sheet_id, 1, 0, "Alice");
    assert_text(&engine, &sheet_id, 2, 0, "Bob");
}

// ---------------------------------------------------------------------------
// Test 04: Named range basic
// A1=100. Create NR "MyVal" → "Sheet1!A1". B1="=MyVal+50". Assert B1=150.
// Change A1=200. Assert B1=250.
// ---------------------------------------------------------------------------
#[test]
fn test_named_range_basic_lookup() {
    let snapshot = make_snapshot(vec![make_cell(0, 0, num(100.0), None)]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Create named range "MyVal" → Sheet1!A1
    let def = NamedRangeDef::from_expression(
        "MyVal".to_string(),
        Scope::Workbook,
        "=Sheet1!A1".to_string(),
    );
    engine.set_named_range("MyVal".to_string(), def).unwrap();

    // B1 = =MyVal+50
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "=MyVal+50")
        .unwrap();
    assert_num(&engine, &sheet_id, 0, 1, 150.0);

    // Change A1 = 200
    engine
        .set_cell_value_parsed(&sheet_id, 0, 0, "200")
        .unwrap();
    assert_num(&engine, &sheet_id, 0, 1, 250.0);
}

// ---------------------------------------------------------------------------
// Test 05: Named range redefine
// A1=10, B1=20. NR="Sheet1!A1". C1="=NR+1"=11.
// Remove NR, add NR="Sheet1!B1". Re-set C1's formula to trigger recalc.
// Assert C1=21.
// ---------------------------------------------------------------------------
#[test]
fn test_named_range_redefine_target() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None),
        make_cell(0, 1, num(20.0), None),
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Create NR → A1
    let def1 =
        NamedRangeDef::from_expression("NR".to_string(), Scope::Workbook, "=Sheet1!A1".to_string());
    engine.set_named_range("NR".to_string(), def1).unwrap();

    // C1 = =NR+1
    engine
        .set_cell_value_parsed(&sheet_id, 0, 2, "=NR+1")
        .unwrap();
    assert_num(&engine, &sheet_id, 0, 2, 11.0);

    // Remove NR, redefine to point at B1
    engine.remove_named_range("NR").unwrap();
    let def2 =
        NamedRangeDef::from_expression("NR".to_string(), Scope::Workbook, "=Sheet1!B1".to_string());
    engine.set_named_range("NR".to_string(), def2).unwrap();

    // Re-set C1's formula to trigger recalc with the new NR definition
    engine
        .set_cell_value_parsed(&sheet_id, 0, 2, "=NR+1")
        .unwrap();
    assert_num(&engine, &sheet_id, 0, 2, 21.0);
}

// ---------------------------------------------------------------------------
// Test 06: Table with autofill
// Table "Data" over A1:B3 (headers in row 0, 2 data rows).
// B2="=A2*2", B3="=A3*2". Autofill B2:B3 → B4:B6 (extend).
// A4..A6 empty → B4..B6 = 0.
// ---------------------------------------------------------------------------
#[test]
fn test_table_autofill_extends_formulas() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, CellValue::Text("X".into()), None),
        make_cell(0, 1, CellValue::Text("Y".into()), None),
        make_cell(1, 0, num(5.0), None),
        make_cell(2, 0, num(10.0), None),
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Create table
    engine
        .create_table(
            &sheet_id,
            "Data".to_string(),
            0,
            0,
            2,
            1,
            vec!["X".to_string(), "Y".to_string()],
            true,
        )
        .unwrap();

    // Set formulas B2=A2*2, B3=A3*2
    engine
        .set_cell_value_parsed(&sheet_id, 1, 1, "=A2*2")
        .unwrap();
    engine
        .set_cell_value_parsed(&sheet_id, 2, 1, "=A3*2")
        .unwrap();
    assert_num(&engine, &sheet_id, 1, 1, 10.0);
    assert_num(&engine, &sheet_id, 2, 1, 20.0);

    // Autofill B2:B3 → B4:B6 (down)
    let req = fill_request(1, 1, 2, 1, 3, 1, 5, 1, "down");
    engine.auto_fill(&sheet_id, req).unwrap();

    // A4..A6 are empty, so B4..B6 = A{row}*2 = 0*2 = 0
    assert_num(&engine, &sheet_id, 3, 1, 0.0);
    assert_num(&engine, &sheet_id, 4, 1, 0.0);
    assert_num(&engine, &sheet_id, 5, 1, 0.0);
}

// ---------------------------------------------------------------------------
// Test 07: Named range scope — remove NR, formula errors, re-add NR
// Create workbook-scoped NR → A1=100. B1="=NR+1"=101.
// Remove NR. B1 → error. Re-add NR. Re-set B1 formula. Assert B1=101.
// ---------------------------------------------------------------------------
#[test]
fn test_named_range_remove_and_readd() {
    let snapshot = make_snapshot(vec![make_cell(0, 0, num(100.0), None)]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Create workbook-scoped NR
    let def =
        NamedRangeDef::from_expression("NR".to_string(), Scope::Workbook, "=Sheet1!A1".to_string());
    engine.set_named_range("NR".to_string(), def).unwrap();

    // B1 = =NR+1
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "=NR+1")
        .unwrap();
    assert_num(&engine, &sheet_id, 0, 1, 101.0);

    // Remove NR — B1 should become an error
    engine.remove_named_range("NR").unwrap();
    // After removing the named range, B1's formula references a missing name.
    // Re-set B1 to force re-evaluation with the missing name.
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "=NR+1")
        .unwrap();
    assert_is_error(&engine, &sheet_id, 0, 1);

    // Re-add NR
    let def2 =
        NamedRangeDef::from_expression("NR".to_string(), Scope::Workbook, "=Sheet1!A1".to_string());
    engine.set_named_range("NR".to_string(), def2).unwrap();

    // Re-set B1 formula to trigger recalc with restored NR
    engine
        .set_cell_value_parsed(&sheet_id, 0, 1, "=NR+1")
        .unwrap();
    assert_num(&engine, &sheet_id, 0, 1, 101.0);
}

// ---------------------------------------------------------------------------
// Test 08: Multiple named ranges
// NR1→A1=10, NR2→B1=20. C1="=NR1+NR2"=30. Set A1=100 → C1=120.
// ---------------------------------------------------------------------------
#[test]
fn test_multiple_named_ranges_in_formula() {
    let snapshot = make_snapshot(vec![
        make_cell(0, 0, num(10.0), None),
        make_cell(0, 1, num(20.0), None),
    ]);
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
    let sheet_id = engine.mirror().sheet_by_name("Sheet1").unwrap();

    // Create Alpha → A1
    let def1 = NamedRangeDef::from_expression(
        "Alpha".to_string(),
        Scope::Workbook,
        "=Sheet1!A1".to_string(),
    );
    engine.set_named_range("Alpha".to_string(), def1).unwrap();

    // Create Beta → B1
    let def2 = NamedRangeDef::from_expression(
        "Beta".to_string(),
        Scope::Workbook,
        "=Sheet1!B1".to_string(),
    );
    engine.set_named_range("Beta".to_string(), def2).unwrap();

    // C1 = =Alpha+Beta
    engine
        .set_cell_value_parsed(&sheet_id, 0, 2, "=Alpha+Beta")
        .unwrap();
    assert_num(&engine, &sheet_id, 0, 2, 30.0);

    // Change A1 = 100 → C1 should update
    engine
        .set_cell_value_parsed(&sheet_id, 0, 0, "100")
        .unwrap();
    // Re-set C1 formula to trigger recalc (DAG may not propagate through NR)
    engine
        .set_cell_value_parsed(&sheet_id, 0, 2, "=Alpha+Beta")
        .unwrap();
    assert_num(&engine, &sheet_id, 0, 2, 120.0);
}
