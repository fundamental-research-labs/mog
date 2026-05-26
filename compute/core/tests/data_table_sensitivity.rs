//! Integration tests for data table sensitivity analysis through the full
//! compute pipeline (snapshot → init → data_table_prepass → body cell values).
//!
//! These tests exercise `run_data_table_prepass` end-to-end — a code path that
//! the unit tests in `data_table.rs` skip entirely (those use mock evaluators).
//!
//! The key bug these catch: when the dependency chain between input cells and
//! the result formula is incomplete (e.g., due to named range scope mismatch),
//! intermediate cells are never re-evaluated during the data table prepass,
//! causing all body cells to return the same "constant-collapsed" value.
//!
//! Run:
//!   cargo test -p compute-core --test data_table_sensitivity -- --nocapture

use cell_types::SheetId;
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use formula_types::{CellRef, NamedRangeDef, Scope};
use snapshot_types::DataTableRegionDef;
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

fn find_value(result: &RecalcResult, sheet_idx: u32, row: u32, col: u32) -> Option<CellValue> {
    let target = cell_uuid(sheet_idx, row, col);
    result
        .changed_cells
        .iter()
        .find(|cc| cc.cell_id == target)
        .map(|cc| cc.value.clone())
}

fn get_number(result: &RecalcResult, sheet_idx: u32, row: u32, col: u32) -> Option<f64> {
    match find_value(result, sheet_idx, row, col) {
        Some(CellValue::Number(n)) => Some(n.get()),
        _ => None,
    }
}

fn make_cell(
    sheet_idx: u32,
    row: u32,
    col: u32,
    value: CellValue,
    formula: Option<&str>,
) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_idx, row, col),
        row,
        col,
        value,
        formula: formula.map(|s| s.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

// ---------------------------------------------------------------------------
// Layout for both tests (identical except for how B1 references the input):
//
//       Col 0 (A)    Col 1 (B)     Col 2 (C)       Col 3 (D)
// Row 0: 0.05        =A1 or =Rate  (empty)          =B1*100    ← result formula
// Row 1:                            0.01             =TABLE(A1)  ← body
// Row 2:                            0.03             =TABLE(A1)  ← body
// Row 3:                            0.05             =TABLE(A1)  ← body
// Row 4:                            0.07             =TABLE(A1)  ← body
// Row 5:                            0.10             =TABLE(A1)  ← body
//
// Data table region: rows 1–5, col 3.
// Row headers: col 2, rows 1–5 → [0.01, 0.03, 0.05, 0.07, 0.10].
// Row input cell: A1.
// Result formula: D1 (0,3) = =B1*100.
//   (Candidates tried: (0,2)=empty→skip, (0,3)=formula→selected.)
//
// Expected body values when pipeline works correctly:
//   Override A1=0.01 → B1=0.01 → D1=1.0
//   Override A1=0.03 → B1=0.03 → D1=3.0
//   Override A1=0.05 → B1=0.05 → D1=5.0
//   Override A1=0.07 → B1=0.07 → D1=7.0
//   Override A1=0.10 → B1=0.10 → D1=10.0
//
// If constant-collapsed (chain broken): all body cells = 5.0 (base-case).
// ---------------------------------------------------------------------------

/// Build a data table snapshot where B1's formula is the given string.
fn build_data_table_snapshot(
    b1_formula: &str,
    named_ranges: Vec<NamedRangeDef>,
) -> WorkbookSnapshot {
    let sheet_id_str = sheet_uuid(0);

    let cells = vec![
        // A1: input cell (rate)
        make_cell(0, 0, 0, CellValue::number(0.05), None),
        // B1: intermediate cell — either "=A1" (direct) or "=Rate" (named range)
        make_cell(0, 0, 1, CellValue::Null, Some(b1_formula)),
        // D1: result formula
        make_cell(0, 0, 3, CellValue::Null, Some("B1*100")),
        // C2:C6 — row header values
        make_cell(0, 1, 2, CellValue::number(0.01), None),
        make_cell(0, 2, 2, CellValue::number(0.03), None),
        make_cell(0, 3, 2, CellValue::number(0.05), None),
        make_cell(0, 4, 2, CellValue::number(0.07), None),
        make_cell(0, 5, 2, CellValue::number(0.10), None),
        // D2:D6 — TABLE body cells
        make_cell(0, 1, 3, CellValue::Null, Some("TABLE(A1)")),
        make_cell(0, 2, 3, CellValue::Null, Some("TABLE(A1)")),
        make_cell(0, 3, 3, CellValue::Null, Some("TABLE(A1)")),
        make_cell(0, 4, 3, CellValue::Null, Some("TABLE(A1)")),
        make_cell(0, 5, 3, CellValue::Null, Some("TABLE(A1)")),
    ];

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id_str.clone(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 10,
            cells,
            ranges: vec![],
        }],
        named_ranges,
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![DataTableRegionDef {
            sheet: sheet_id_str,
            start_row: 1,
            start_col: 3,
            end_row: 5,
            end_col: 3,
            // Typed-boundary W4.b: typed `CellRef` (was `Some("A1".to_string())`).
            row_input_ref: Some(CellRef::Positional {
                sheet: SheetId::from_raw(0),
                row: 0,
                col: 0,
            }),
            col_input_ref: None,
            ooxml_flags: None,
        }],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

/// Collect body cell values from recalc result (D2:D6 = rows 1-5, col 3).
fn collect_body_values(result: &RecalcResult) -> Vec<Option<f64>> {
    (1..=5).map(|row| get_number(result, 0, row, 3)).collect()
}

// ===========================================================================
// Test 1: Control — direct cell reference (should pass)
// ===========================================================================

/// Data table with B1=A1 (direct reference). The dependency chain
/// A1 → B1 → D1 is fully tracked. Body cells should have distinct values.
#[test]
fn data_table_direct_ref_produces_distinct_values() {
    let snapshot = build_data_table_snapshot("A1", vec![]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init_from_snapshot failed");

    let body = collect_body_values(&result);
    eprintln!("Direct ref body values: {:?}", body);

    // All body cells should be numeric
    let numeric: Vec<f64> = body.iter().filter_map(|v| *v).collect();
    assert!(
        numeric.len() >= 3,
        "Expected at least 3 numeric body cells, got {}: {:?}",
        numeric.len(),
        body
    );

    // Body cells should NOT all be the same (constant-collapse detection)
    let first = numeric[0];
    let all_same = numeric.iter().all(|v| (*v - first).abs() < 1e-10);
    assert!(
        !all_same,
        "CONSTANT COLLAPSE: all body cells = {} — dependency chain is broken",
        first
    );

    // Spot-check expected values: override A1=0.01 → B1=0.01 → D1=1.0
    if let Some(v) = body[0] {
        assert!(
            (v - 1.0).abs() < 0.01,
            "Body[0] (A1=0.01): expected ~1.0, got {}",
            v
        );
    }
    if let Some(v) = body[4] {
        assert!(
            (v - 10.0).abs() < 0.01,
            "Body[4] (A1=0.10): expected ~10.0, got {}",
            v
        );
    }
}

// ===========================================================================
// Test 2: Wrong scope → constant collapse (negative test, documents expected behavior)
// ===========================================================================

/// Verifies that a named range with a mismatched SheetId breaks the dependency
/// chain and causes constant collapse. This is expected behavior — scope
/// resolution is exact, not fuzzy.
///
/// This scenario can't occur through the XLSX import path (SheetResolver maps
/// `localSheetId` indices to real UUIDs using the same sheet array). The test
/// exists to document the consequence of wrong scopes and guard against
/// regressions if new entry points are added.
#[test]
fn data_table_named_range_wrong_scope_causes_constant_collapse() {
    let wrong_scope = Scope::Sheet(cell_types::SheetId::from_raw(0));

    let snapshot = build_data_table_snapshot(
        "Rate",
        vec![NamedRangeDef::from_expression(
            "Rate".to_string(),
            wrong_scope,
            "Sheet1!$A$1".to_string(),
        )],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init_from_snapshot failed");

    let body = collect_body_values(&result);
    let numeric: Vec<f64> = body.iter().filter_map(|v| *v).collect();

    // Wrong scope breaks the dep chain → all body cells get the same value.
    assert!(
        numeric.len() >= 2,
        "Expected at least 2 numeric body cells, got {}: {:?}",
        numeric.len(),
        body
    );
    let first = numeric[0];
    let all_same = numeric.iter().all(|v| (*v - first).abs() < 1e-10);
    assert!(
        all_same,
        "Expected constant collapse (all same value) with wrong scope, \
         but got distinct values: {:?}",
        numeric
    );
}

// ===========================================================================
// Test 3: Named range with CORRECT scope (should pass when scope is correct)
// ===========================================================================

/// Same as test 2, but the named range has the CORRECT scope SheetId.
/// This verifies the pipeline works when named ranges are properly scoped.
#[test]
fn data_table_named_range_correct_scope_produces_distinct_values() {
    let sheet_id = cell_types::SheetId::from_uuid_str(&sheet_uuid(0)).expect("valid sheet UUID");
    let correct_scope = Scope::Sheet(sheet_id);

    let snapshot = build_data_table_snapshot(
        "Rate",
        vec![NamedRangeDef::from_expression(
            "Rate".to_string(),
            correct_scope,
            "Sheet1!$A$1".to_string(),
        )],
    );

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init_from_snapshot failed");

    let body = collect_body_values(&result);
    eprintln!("Correct-scope named range body values: {:?}", body);

    let numeric: Vec<f64> = body.iter().filter_map(|v| *v).collect();
    assert!(
        numeric.len() >= 3,
        "Expected at least 3 numeric body cells, got {}: {:?}",
        numeric.len(),
        body
    );

    let first = numeric[0];
    let all_same = numeric.iter().all(|v| (*v - first).abs() < 1e-10);
    assert!(
        !all_same,
        "CONSTANT COLLAPSE (even with correct scope): all body cells = {} \
         — something else is broken in the data table prepass pipeline. \
         Values: {:?}",
        first, numeric
    );
}
