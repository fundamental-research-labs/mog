//! Regression tests for u32 overflow in COUNTIFS/SUMIFS/AVERAGEIFS
//! with full-column references (A:A, B:B).
//!
//! The bug: `(end_row + 1) as usize` overflows when `end_row == u32::MAX`
//! (full-column references), causing panics or hangs. Similarly,
//! `(end_row - start_row + 1) as usize` produces `usize::MAX` for
//! total_rows, hanging the engine.
//!
//! Run:
//!   cd os && cargo test -p compute-core --test overflow_countifs_sumifs

use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

const SHEET_UUID: &str = "10000000000000000000000000000001";

fn cell_uuid(row: u32, col: u32) -> String {
    format!("200000000000{:04x}0000{:012x}", col, row as u64)
}

fn formula_uuid(idx: u32) -> String {
    format!("30000000000000000000{:012x}", idx as u64)
}

fn build_snapshot_with_formulas(
    data: Vec<(u32, u32, CellValue)>,
    formulas: Vec<(u32, u32, &str)>,
    rows: u32,
    cols: u32,
) -> WorkbookSnapshot {
    let mut cells: Vec<CellData> = data
        .into_iter()
        .map(|(row, col, value)| CellData {
            cell_id: cell_uuid(row, col),
            row,
            col,
            value,
            formula: None,
            identity_formula: None,
            array_ref: None,
        })
        .collect();

    for (i, (row, col, formula)) in formulas.into_iter().enumerate() {
        cells.push(CellData {
            cell_id: formula_uuid(i as u32),
            row,
            col,
            value: CellValue::Null,
            formula: Some(formula.to_string()),
            identity_formula: None,
            array_ref: None,
        });
    }

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows,
            cols,
            cells,
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
    }
}

fn find_formula_value(result: &compute_core::RecalcResult, idx: u32) -> Option<CellValue> {
    let target = formula_uuid(idx);
    result
        .changed_cells
        .iter()
        .find(|cc| cc.cell_id == target)
        .map(|cc| cc.value.clone())
}

fn assert_number(val: &Option<CellValue>, expected: f64, desc: &str) {
    match val {
        Some(CellValue::Number(n)) => assert!(
            (n.get() - expected).abs() < 1e-10,
            "{}: expected {}, got {}",
            desc,
            expected,
            n.get()
        ),
        other => panic!("{}: expected Number({}), got {:?}", desc, expected, other),
    }
}

// ---------------------------------------------------------------------------
// Test 1: COUNTIFS with full-column range references (A:A, B:B)
// ---------------------------------------------------------------------------
#[test]
fn countifs_full_column_no_overflow() {
    // 5 data rows in col A with values 1..5, col B with "yes"/"no"
    let data = vec![
        (0, 0, CellValue::number(1.0)),
        (1, 0, CellValue::number(2.0)),
        (2, 0, CellValue::number(3.0)),
        (3, 0, CellValue::number(4.0)),
        (4, 0, CellValue::number(5.0)),
        (0, 1, CellValue::Text("yes".into())),
        (1, 1, CellValue::Text("no".into())),
        (2, 1, CellValue::Text("yes".into())),
        (3, 1, CellValue::Text("no".into())),
        (4, 1, CellValue::Text("yes".into())),
    ];
    // COUNTIFS(A:A,">=2",B:B,"yes") => rows where A>=2 AND B="yes": rows 2,4 => 2
    let formulas = vec![(6, 2, r#"COUNTIFS(A:A,">=2",B:B,"yes")"#)];
    let snapshot = build_snapshot_with_formulas(data, formulas, 10, 3);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let val = find_formula_value(&result, 0);
    assert_number(&val, 2.0, "COUNTIFS full-column");
}

// ---------------------------------------------------------------------------
// Test 2: SUMIFS with full-column ranges
// ---------------------------------------------------------------------------
#[test]
fn sumifs_full_column_no_overflow() {
    // Col A: categories, Col B: values to sum
    let data = vec![
        (0, 0, CellValue::Text("x".into())),
        (1, 0, CellValue::Text("y".into())),
        (2, 0, CellValue::Text("x".into())),
        (3, 0, CellValue::Text("y".into())),
        (4, 0, CellValue::Text("x".into())),
        (0, 1, CellValue::number(10.0)),
        (1, 1, CellValue::number(20.0)),
        (2, 1, CellValue::number(30.0)),
        (3, 1, CellValue::number(40.0)),
        (4, 1, CellValue::number(50.0)),
    ];
    // SUMIFS(B:B,A:A,"x") => 10+30+50 = 90
    let formulas = vec![(6, 2, r#"SUMIFS(B:B,A:A,"x")"#)];
    let snapshot = build_snapshot_with_formulas(data, formulas, 10, 3);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let val = find_formula_value(&result, 0);
    assert_number(&val, 90.0, "SUMIFS full-column");
}

// ---------------------------------------------------------------------------
// Test 3: COUNTIF (single-criteria) with full-column range
// ---------------------------------------------------------------------------
#[test]
fn countif_full_column_no_overflow() {
    let data = vec![
        (0, 0, CellValue::Text("apple".into())),
        (1, 0, CellValue::Text("banana".into())),
        (2, 0, CellValue::Text("apple".into())),
        (3, 0, CellValue::Text("cherry".into())),
        (4, 0, CellValue::Text("apple".into())),
    ];
    // COUNTIF(A:A,"apple") => 3
    let formulas = vec![(6, 1, r#"COUNTIF(A:A,"apple")"#)];
    let snapshot = build_snapshot_with_formulas(data, formulas, 10, 2);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let val = find_formula_value(&result, 0);
    assert_number(&val, 3.0, "COUNTIF full-column");
}

// ---------------------------------------------------------------------------
// Test 4: SUMIF (single-criteria) with full-column range
// ---------------------------------------------------------------------------
#[test]
fn sumif_full_column_no_overflow() {
    let data = vec![
        (0, 0, CellValue::Text("a".into())),
        (1, 0, CellValue::Text("b".into())),
        (2, 0, CellValue::Text("a".into())),
        (0, 1, CellValue::number(100.0)),
        (1, 1, CellValue::number(200.0)),
        (2, 1, CellValue::number(300.0)),
    ];
    // SUMIF(A:A,"a",B:B) => 100+300 = 400
    let formulas = vec![(4, 2, r#"SUMIF(A:A,"a",B:B)"#)];
    let snapshot = build_snapshot_with_formulas(data, formulas, 8, 3);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let val = find_formula_value(&result, 0);
    assert_number(&val, 400.0, "SUMIF full-column");
}

// ---------------------------------------------------------------------------
// Test 5: Edge case — column range on a sheet with 0 data rows
// ---------------------------------------------------------------------------
#[test]
fn countifs_empty_sheet_no_overflow() {
    // No data cells, just a formula
    let formulas = vec![(0, 1, r#"COUNTIFS(A:A,">=1")"#)];
    let snapshot = build_snapshot_with_formulas(vec![], formulas, 1, 2);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let val = find_formula_value(&result, 0);
    assert_number(&val, 0.0, "COUNTIFS empty sheet");
}

// ---------------------------------------------------------------------------
// Test 6: AVERAGEIFS with full-column ranges
// ---------------------------------------------------------------------------
#[test]
fn averageifs_full_column_no_overflow() {
    let data = vec![
        (0, 0, CellValue::Text("x".into())),
        (1, 0, CellValue::Text("y".into())),
        (2, 0, CellValue::Text("x".into())),
        (3, 0, CellValue::Text("y".into())),
        (0, 1, CellValue::number(10.0)),
        (1, 1, CellValue::number(20.0)),
        (2, 1, CellValue::number(30.0)),
        (3, 1, CellValue::number(40.0)),
    ];
    // AVERAGEIFS(B:B,A:A,"x") => (10+30)/2 = 20
    let formulas = vec![(5, 2, r#"AVERAGEIFS(B:B,A:A,"x")"#)];
    let snapshot = build_snapshot_with_formulas(data, formulas, 8, 3);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let val = find_formula_value(&result, 0);
    assert_number(&val, 20.0, "AVERAGEIFS full-column");
}
