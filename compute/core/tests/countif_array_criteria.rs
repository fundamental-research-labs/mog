//! Integration tests for COUNTIF/COUNTIFS with array criteria in SUMPRODUCT context.
//!
//! Regression tests for the bug where the borrowed fast path in
//! `borrowed_multi_criteria.rs` intercepted COUNTIF calls with array criteria
//! and returned a scalar (using only the first element) instead of falling
//! through to `counting.rs` which correctly returns an array.
//!
//! Run:
//!   cd os && cargo test -p compute-core --test countif_array_criteria -- --nocapture

use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

fn build_snapshot(
    sheets: Vec<(&str, u32, u32, Vec<(u32, u32, CellValue, Option<&str>)>)>,
) -> WorkbookSnapshot {
    let sheet_snapshots = sheets
        .into_iter()
        .enumerate()
        .map(|(si, (name, rows, cols, cells))| {
            let si = si as u32;
            let cell_data: Vec<CellData> = cells
                .into_iter()
                .map(|(row, col, value, formula)| CellData {
                    cell_id: cell_uuid(si, row, col),
                    row,
                    col,
                    value,
                    formula: formula.map(|s| s.to_string()),
                    identity_formula: None,
                    array_ref: None,
                })
                .collect();
            SheetSnapshot {
                id: sheet_uuid(si),
                name: name.to_string(),
                rows,
                cols,
                cells: cell_data,
                ranges: vec![],
            }
        })
        .collect();

    WorkbookSnapshot {
        sheets: sheet_snapshots,
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

fn find_changed_value(
    result: &RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
) -> Option<CellValue> {
    let target_cell_id = cell_uuid(sheet_idx, row, col);
    result
        .changed_cells
        .iter()
        .find(|cc| cc.cell_id == target_cell_id)
        .map(|cc| cc.value.clone())
}

fn assert_num(result: &RecalcResult, sheet_idx: u32, row: u32, col: u32, expected: f64) {
    let val = find_changed_value(result, sheet_idx, row, col);
    match val {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - expected).abs() < 1e-6,
                "Cell (sheet={},row={},col={}) expected {}, got {}",
                sheet_idx,
                row,
                col,
                expected,
                n.get()
            );
        }
        Some(other) => panic!(
            "Cell (sheet={},row={},col={}) expected Number({}), got {:?}",
            sheet_idx, row, col, expected, other
        ),
        None => panic!(
            "Cell (sheet={},row={},col={}) not in changed_cells (expected Number({})). \
             This may mean the cell was not recalculated or matched the initial value.",
            sheet_idx, row, col, expected
        ),
    }
}

// ===========================================================================
// Count-distinct pattern: SUMPRODUCT(1/COUNTIF(range, range))
// ===========================================================================

/// Classic count-distinct: SUMPRODUCT(1/COUNTIF(A1:A5, A1:A5))
/// Each element in the criteria range is used as a separate lookup.
/// apple appears 2x → 1/2, banana appears 2x → 1/2, cherry appears 1x → 1/1
/// Sum = 0.5 + 0.5 + 0.5 + 0.5 + 1.0 = 3.0 (3 unique values)
#[test]
fn sumproduct_countif_count_distinct() {
    let cells = vec![
        (0, 0, CellValue::Text("apple".into()), None),  // A1
        (1, 0, CellValue::Text("apple".into()), None),  // A2
        (2, 0, CellValue::Text("banana".into()), None), // A3
        (3, 0, CellValue::Text("banana".into()), None), // A4
        (4, 0, CellValue::Text("cherry".into()), None), // A5
        // B1: count-distinct formula
        (
            0,
            1,
            CellValue::Null,
            Some("SUMPRODUCT(1/COUNTIF(A1:A5,A1:A5))"),
        ),
    ];
    let snapshot = build_snapshot(vec![("Sheet1", 10, 5, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_num(&result, 0, 0, 1, 3.0);
}

/// All unique values: SUMPRODUCT(1/COUNTIF(A1:A3, A1:A3)) = 3.0
#[test]
fn sumproduct_countif_all_unique() {
    let cells = vec![
        (0, 0, CellValue::Text("apple".into()), None),
        (1, 0, CellValue::Text("banana".into()), None),
        (2, 0, CellValue::Text("cherry".into()), None),
        (
            0,
            1,
            CellValue::Null,
            Some("SUMPRODUCT(1/COUNTIF(A1:A3,A1:A3))"),
        ),
    ];
    let snapshot = build_snapshot(vec![("Sheet1", 10, 5, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_num(&result, 0, 0, 1, 3.0);
}

/// All same value: SUMPRODUCT(1/COUNTIF(A1:A3, A1:A3)) = 1.0
#[test]
fn sumproduct_countif_all_same() {
    let cells = vec![
        (0, 0, CellValue::Text("apple".into()), None),
        (1, 0, CellValue::Text("apple".into()), None),
        (2, 0, CellValue::Text("apple".into()), None),
        (
            0,
            1,
            CellValue::Null,
            Some("SUMPRODUCT(1/COUNTIF(A1:A3,A1:A3))"),
        ),
    ];
    let snapshot = build_snapshot(vec![("Sheet1", 10, 5, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_num(&result, 0, 0, 1, 1.0);
}

// ===========================================================================
// COUNTIF with literal array criteria
// ===========================================================================

/// SUMPRODUCT(COUNTIF(A1:A5, {"apple","banana","cherry"}))
/// Should count each element: apple=2, banana=2, cherry=1, sum=5
#[test]
fn sumproduct_countif_literal_array_criteria() {
    let cells = vec![
        (0, 0, CellValue::Text("apple".into()), None),
        (1, 0, CellValue::Text("apple".into()), None),
        (2, 0, CellValue::Text("banana".into()), None),
        (3, 0, CellValue::Text("banana".into()), None),
        (4, 0, CellValue::Text("cherry".into()), None),
        (
            0,
            1,
            CellValue::Null,
            Some(r#"SUMPRODUCT(COUNTIF(A1:A5,{"apple","banana","cherry"}))"#),
        ),
    ];
    let snapshot = build_snapshot(vec![("Sheet1", 10, 5, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_num(&result, 0, 0, 1, 5.0);
}

// ===========================================================================
// COUNTIFS with array criteria (multi-criteria variant)
// ===========================================================================

/// SUMPRODUCT((COUNTIFS(A1:A5, {"apple","banana","cherry"}) > 0) * 1)
/// Each element: apple>0=TRUE, banana>0=TRUE, cherry>0=TRUE → 3
#[test]
fn sumproduct_countifs_literal_array_gt_zero() {
    let cells = vec![
        (0, 0, CellValue::Text("apple".into()), None),
        (1, 0, CellValue::Text("apple".into()), None),
        (2, 0, CellValue::Text("banana".into()), None),
        (3, 0, CellValue::Text("banana".into()), None),
        (4, 0, CellValue::Text("cherry".into()), None),
        (
            0,
            1,
            CellValue::Null,
            Some(r#"SUMPRODUCT((COUNTIFS(A1:A5,{"apple","banana","cherry"})>0)*1)"#),
        ),
    ];
    let snapshot = build_snapshot(vec![("Sheet1", 10, 5, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_num(&result, 0, 0, 1, 3.0);
}

// ===========================================================================
// SUMPRODUCT(IF(..., 1/COUNTIFS(...), 0)) — conditional count-distinct
// ===========================================================================

/// Conditional count-distinct with COUNTIFS inside IF inside SUMPRODUCT.
/// When COUNTIFS returns 0 for a non-matching row, 1/0 would be #DIV/0!,
/// but the IF condition should prevent that path.
#[test]
fn sumproduct_if_countifs_conditional_distinct() {
    let cells = vec![
        // Col A: categories, Col B: flags
        (0, 0, CellValue::Text("apple".into()), None),
        (1, 0, CellValue::Text("apple".into()), None),
        (2, 0, CellValue::Text("banana".into()), None),
        (3, 0, CellValue::Text("banana".into()), None),
        (4, 0, CellValue::Text("cherry".into()), None),
        (0, 1, CellValue::Text("yes".into()), None),
        (1, 1, CellValue::Text("yes".into()), None),
        (2, 1, CellValue::Text("yes".into()), None),
        (3, 1, CellValue::Text("no".into()), None),
        (4, 1, CellValue::Text("yes".into()), None),
        // Count distinct A values where B="yes"
        // Rows matching B="yes": A1=apple, A2=apple, A3=banana, A5=cherry
        // COUNTIFS(A1:A5,A1:A5,B1:B5,"yes") per row: [2,2,1,0,1]
        // IF(B="yes", 1/COUNTIFS, 0) per row: [1/2, 1/2, 1/1, 0, 1/1]
        // SUMPRODUCT = 0.5 + 0.5 + 1.0 + 0 + 1.0 = 3.0
        (
            0,
            2,
            CellValue::Null,
            Some(r#"SUMPRODUCT(IF(B1:B5="yes",1/COUNTIFS(A1:A5,A1:A5,B1:B5,"yes"),0))"#),
        ),
    ];
    let snapshot = build_snapshot(vec![("Sheet1", 10, 5, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_num(&result, 0, 0, 2, 3.0);
}

// ===========================================================================
// Numeric array criteria
// ===========================================================================

/// SUMPRODUCT(COUNTIF(A1:A5, A1:A5)) with numeric data.
/// [10,10,20,20,30] → COUNTIF returns [2,2,2,2,1] → SUMPRODUCT = 9
#[test]
fn sumproduct_countif_numeric_array_criteria() {
    let cells = vec![
        (0, 0, CellValue::number(10.0), None),
        (1, 0, CellValue::number(10.0), None),
        (2, 0, CellValue::number(20.0), None),
        (3, 0, CellValue::number(20.0), None),
        (4, 0, CellValue::number(30.0), None),
        (
            0,
            1,
            CellValue::Null,
            Some("SUMPRODUCT(COUNTIF(A1:A5,A1:A5))"),
        ),
    ];
    let snapshot = build_snapshot(vec![("Sheet1", 10, 5, cells)]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_num(&result, 0, 0, 1, 9.0);
}
