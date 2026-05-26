//! Integration tests for cross-sheet formula behavior.
//!
//! Run:
//!   cargo test -p compute-core --test cross_sheet_tests -- --nocapture

use cell_types::{CellId, SheetId};
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, RecalcResult, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellError, CellValue};

// ---------------------------------------------------------------------------
// Helper utilities (same pattern as formula_accuracy_null_mismatch.rs)
// ---------------------------------------------------------------------------

/// Deterministic UUID-like string from sheet index.
fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

/// Deterministic UUID-like string from (sheet_idx, row, col).
fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

/// Build a minimal `WorkbookSnapshot` from a description of sheets.
/// Each sheet description is `(name, rows, cols, cells)` where `cells` is a vec
/// of `(row, col, value, formula)`.
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

/// Find the evaluated value for a specific (sheet_index, row, col) in the RecalcResult.
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

/// Assert that a cell evaluated to a specific number (within tolerance).
fn assert_num(result: &RecalcResult, sheet_idx: u32, row: u32, col: u32, expected: f64) {
    let val = find_changed_value(result, sheet_idx, row, col);
    match val {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - expected).abs() < 1e-6,
                "Cell ({},{},{}) expected {}, got {}",
                sheet_idx,
                row,
                col,
                expected,
                n.get()
            );
        }
        Some(other) => panic!(
            "Cell ({},{},{}) expected Number({}), got {:?}",
            sheet_idx, row, col, expected, other
        ),
        None => panic!(
            "Cell ({},{},{}) not in changed_cells (expected Number({}))",
            sheet_idx, row, col, expected
        ),
    }
}

/// Check whether any error info mentions "Circular reference" for a given cell.
fn has_circular_error(result: &RecalcResult, sheet_idx: u32, row: u32, col: u32) -> bool {
    let target_cell_id = cell_uuid(sheet_idx, row, col);
    result
        .errors
        .iter()
        .any(|e| e.cell_id == target_cell_id && e.error.contains("Circular"))
}

fn assert_cell_error(
    result: &RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
    expected_error: CellError,
) {
    let val = find_changed_value(result, sheet_idx, row, col);
    match val {
        Some(CellValue::Error(e, _msg)) => {
            assert_eq!(
                e, expected_error,
                "Cell ({},{},{}) expected error {:?}, got {:?}",
                sheet_idx, row, col, expected_error, e
            );
        }
        Some(other) => panic!(
            "Cell ({},{},{}) expected Error({:?}), got {:?}",
            sheet_idx, row, col, expected_error, other
        ),
        None => panic!(
            "Cell ({},{},{}) not in changed_cells (expected Error({:?}))",
            sheet_idx, row, col, expected_error
        ),
    }
}

fn cell_is_error(
    result: &compute_core::snapshot::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
) -> bool {
    let val = find_changed_value(result, sheet_idx, row, col);
    matches!(val, Some(CellValue::Error(..)))
}

#[test]
fn test_cross_sheet_circular_ref_two_sheets() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("Sheet2!A1"))],
        ),
        (
            "Sheet2",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("Sheet1!A1"))],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert!(cell_is_error(&result, 0, 0, 0) || has_circular_error(&result, 0, 0, 0));
    assert!(cell_is_error(&result, 1, 0, 0) || has_circular_error(&result, 1, 0, 0));
}

/// Regression test: cycle seeding must reset cached Text/Bool values to 0.
///
/// Bug: `handle_cycles_and_recalc` pass-2 seeding only reset `Null` and
/// `CellError::Circ` to 0. When a cycle cell held a previously-cached text
/// value (e.g. "Sheet2Data"), that value propagated through the circular
/// evaluation unchanged, making the cell display the old text instead of 0
/// or `#CIRC!`.
///
/// Fix (cycles.rs): extend the seed-reset condition to also cover
/// `CellValue::Text(_)` and `CellValue::Bool(_)`.
#[test]
fn test_cross_sheet_circular_ref_text_cached_value_reset() {
    // Both cells carry a stale "Sheet2Data" text value from a prior save.
    // After cycle evaluation, neither cell should still show text.
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![(
                0,
                0,
                CellValue::Text("Sheet2Data".into()),
                Some("Sheet2!A1"),
            )],
        ),
        (
            "Sheet2",
            10,
            10,
            vec![(
                0,
                0,
                CellValue::Text("Sheet2Data".into()),
                Some("Sheet1!A1"),
            )],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // The cells must NOT propagate the stale text value through the cycle.
    // Acceptable outcomes are: error (#CIRC!, #REF!, etc.), Number(0), or
    // absent from changed_cells (meaning unchanged from seed value 0).
    for sheet_idx in [0u32, 1u32] {
        let val = find_changed_value(&result, sheet_idx, 0, 0);
        match &val {
            Some(CellValue::Text(t)) => panic!(
                "Sheet{}!A1 must not show stale text after cycle resolution, got {:?}",
                sheet_idx + 1,
                t
            ),
            Some(CellValue::Boolean(b)) => panic!(
                "Sheet{}!A1 must not show stale bool after cycle resolution, got {:?}",
                sheet_idx + 1,
                b
            ),
            // Number(0), any error, or absent — all acceptable
            _ => {}
        }
    }
}

#[test]
fn test_cross_sheet_circular_ref_three_sheets() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("Sheet2!A1"))],
        ),
        (
            "Sheet2",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("Sheet3!A1"))],
        ),
        (
            "Sheet3",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("Sheet1!A1"))],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert!(cell_is_error(&result, 0, 0, 0) || has_circular_error(&result, 0, 0, 0));
    assert!(cell_is_error(&result, 1, 0, 0) || has_circular_error(&result, 1, 0, 0));
    assert!(cell_is_error(&result, 2, 0, 0) || has_circular_error(&result, 2, 0, 0));
}

#[test]
fn test_delete_referenced_sheet() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("Sheet2!A1+10"))],
        ),
        (
            "Sheet2",
            10,
            10,
            vec![(0, 0, CellValue::number(42.0), None)],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let init_result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_num(&init_result, 0, 0, 0, 52.0);
    let sheet2_id = SheetId::from_uuid_str(&sheet_uuid(1)).unwrap();
    core.remove_sheet(&mut mirror, &sheet2_id)
        .expect("remove_sheet failed");
    let a1_cell_id = CellId::from_uuid_str(&cell_uuid(0, 0, 0)).unwrap();
    let val = mirror.get_cell_value(&a1_cell_id);
    println!("After sheet deletion, Sheet1!A1 = {:?}", val);
}

#[test]
fn test_error_propagation_div0() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("Sheet2!A1+10"))],
        ),
        ("Sheet2", 10, 10, vec![(0, 0, CellValue::Null, Some("1/0"))]),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_cell_error(&result, 1, 0, 0, CellError::Div0);
    assert_cell_error(&result, 0, 0, 0, CellError::Div0);
}

#[test]
fn test_error_propagation_value() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("Sheet2!A1*2"))],
        ),
        (
            "Sheet2",
            10,
            10,
            vec![
                (0, 0, CellValue::Text("hello".into()), None),
                (0, 1, CellValue::Null, Some("A1+1")),
            ],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_cell_error(&result, 1, 0, 1, CellError::Value);
}

#[test]
fn test_ref_error_missing_sheet() {
    let snapshot = build_snapshot(vec![(
        "Sheet1",
        10,
        10,
        vec![(0, 0, CellValue::Null, Some("NonExistent!A1"))],
    )]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_cell_error(&result, 0, 0, 0, CellError::Ref);
}

#[test]
fn test_multi_level_indirection() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("Sheet2!A1*2"))],
        ),
        (
            "Sheet2",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("Sheet3!A1+5"))],
        ),
        (
            "Sheet3",
            10,
            10,
            vec![(0, 0, CellValue::number(100.0), None)],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_num(&result, 1, 0, 0, 105.0);
    assert_num(&result, 0, 0, 0, 210.0);
}

#[test]
fn test_four_level_chain() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("Sheet2!A1+1"))],
        ),
        (
            "Sheet2",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("Sheet3!A1+1"))],
        ),
        (
            "Sheet3",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("Sheet4!A1+1"))],
        ),
        (
            "Sheet4",
            10,
            10,
            vec![(0, 0, CellValue::number(10.0), None)],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_num(&result, 2, 0, 0, 11.0);
    assert_num(&result, 1, 0, 0, 12.0);
    assert_num(&result, 0, 0, 0, 13.0);
}

#[test]
fn test_quoted_sheet_spaces() {
    let snapshot = build_snapshot(vec![
        (
            "Summary",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("'My Sheet'!A1+100"))],
        ),
        (
            "My Sheet",
            10,
            10,
            vec![(0, 0, CellValue::number(50.0), None)],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_num(&result, 0, 0, 0, 150.0);
}

#[test]
fn test_quoted_sheet_special_chars() {
    let snapshot = build_snapshot(vec![
        (
            "Summary",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("'Q1-2025 (Data)'!A1"))],
        ),
        (
            "Q1-2025 (Data)",
            10,
            10,
            vec![(0, 0, CellValue::number(999.0), None)],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_num(&result, 0, 0, 0, 999.0);
}

#[test]
fn test_cross_sheet_sum() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("SUM(Sheet2!A1:A5)"))],
        ),
        (
            "Sheet2",
            10,
            10,
            vec![
                (0, 0, CellValue::number(10.0), None),
                (1, 0, CellValue::Null, None),
                (2, 0, CellValue::number(20.0), None),
                (3, 0, CellValue::Null, None),
                (4, 0, CellValue::number(30.0), None),
            ],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_num(&result, 0, 0, 0, 60.0);
}

#[test]
fn test_cross_sheet_average() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("AVERAGE(Sheet2!A1:A4)"))],
        ),
        (
            "Sheet2",
            10,
            10,
            vec![
                (0, 0, CellValue::number(10.0), None),
                (1, 0, CellValue::number(20.0), None),
                (2, 0, CellValue::number(30.0), None),
                (3, 0, CellValue::number(40.0), None),
            ],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_num(&result, 0, 0, 0, 25.0);
}

#[test]
fn test_cross_sheet_recalc() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("Sheet2!A1*3"))],
        ),
        ("Sheet2", 10, 10, vec![(0, 0, CellValue::number(7.0), None)]),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let ir = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_num(&ir, 0, 0, 0, 21.0);
    let sid = SheetId::from_uuid_str(&sheet_uuid(1)).unwrap();
    let cid = CellId::from_uuid_str(&cell_uuid(1, 0, 0)).unwrap();
    let r = core.set_cell(&mut mirror, &sid, cid, 0, 0, "10").unwrap();
    let a1 = cell_uuid(0, 0, 0);
    let ch = r.changed_cells.iter().find(|cc| cc.cell_id == a1);
    assert!(ch.is_some(), "Sheet1 A1 should recalc");
    if let Some(cc) = ch {
        match &cc.value {
            CellValue::Number(n) => assert!((n.get() - 30.0).abs() < 1e-6),
            o => panic!("expected Number(30), got {:?}", o),
        }
    }
}

#[test]
fn test_3d_reference_evaluates_and_recalculates_each_sheet_in_span() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![
                (0, 0, CellValue::number(10.0), None),
                (0, 1, CellValue::Null, Some("SUM(Sheet1:Sheet3!A1)")),
            ],
        ),
        (
            "Sheet2",
            10,
            10,
            vec![(0, 0, CellValue::number(20.0), None)],
        ),
        (
            "Sheet3",
            10,
            10,
            vec![(0, 0, CellValue::number(30.0), None)],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let init = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_num(&init, 0, 0, 1, 60.0);

    let sheet2 = SheetId::from_uuid_str(&sheet_uuid(1)).unwrap();
    let sheet2_a1 = CellId::from_uuid_str(&cell_uuid(1, 0, 0)).unwrap();
    let result = core
        .set_cell(&mut mirror, &sheet2, sheet2_a1, 0, 0, "50")
        .unwrap();
    assert_num(&result, 0, 0, 1, 90.0);
}

#[test]
fn test_cross_sheet_recalc_chain() {
    let snapshot = build_snapshot(vec![
        (
            "Sheet1",
            10,
            10,
            vec![(0, 0, CellValue::Null, Some("Sheet2!B1+100"))],
        ),
        (
            "Sheet2",
            10,
            10,
            vec![
                (0, 0, CellValue::number(5.0), None),
                (0, 1, CellValue::Null, Some("A1*2")),
            ],
        ),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let ir = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    assert_num(&ir, 1, 0, 1, 10.0);
    assert_num(&ir, 0, 0, 0, 110.0);
    let sid = SheetId::from_uuid_str(&sheet_uuid(1)).unwrap();
    let cid = CellId::from_uuid_str(&cell_uuid(1, 0, 0)).unwrap();
    let r = core.set_cell(&mut mirror, &sid, cid, 0, 0, "20").unwrap();
    if let Some(cc) = r
        .changed_cells
        .iter()
        .find(|cc| cc.cell_id == cell_uuid(1, 0, 1))
    {
        match &cc.value {
            CellValue::Number(n) => assert!((n.get() - 40.0).abs() < 1e-6),
            o => panic!("B1 expected 40, got {:?}", o),
        }
    }
    let ch = r
        .changed_cells
        .iter()
        .find(|cc| cc.cell_id == cell_uuid(0, 0, 0));
    assert!(ch.is_some(), "Sheet1 A1 should recalc");
    if let Some(cc) = ch {
        match &cc.value {
            CellValue::Number(n) => assert!((n.get() - 140.0).abs() < 1e-6),
            o => panic!("A1 expected 140, got {:?}", o),
        }
    }
}

/// Test MAXIFS with cross-sheet full-column references and ">0" criteria.
///
/// Reproduces the bug where MAXIFS returns 0 instead of the correct value when
/// using full-column ranges ($I:$I, $D:$D, $J:$J) on a different sheet.
///
/// Layout:
///   Sheet 0 ("Summary"):
///     Col A (0): criteria values ("Alpha", "Beta", "Alpha", ...)
///     Col B (1): MAXIFS formulas referencing Transactions sheet
///     Col C (2): MINIFS formulas referencing Transactions sheet
///
///   Sheet 1 ("Transactions"):
///     Col A (0): category  ("Alpha", "Beta", "Alpha", "Beta", "Alpha")
///     Col B (1): amount    (100, 200, 300, 400, 500)
///     Col C (2): positive  (10, -5, 20, 0, 30)
#[test]
fn test_cross_sheet_maxifs_full_column_gt_zero() {
    let mut txn_cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    // Transactions data (sheet 1)
    let categories = ["Alpha", "Beta", "Alpha", "Beta", "Alpha"];
    let amounts = [100.0, 200.0, 300.0, 400.0, 500.0];
    let positives = [10.0, -5.0, 20.0, 0.0, 30.0];

    for (i, cat) in categories.iter().enumerate() {
        let row = i as u32;
        txn_cells.push((row, 0, CellValue::Text((*cat).into()), None)); // col A: category
        txn_cells.push((row, 1, CellValue::number(amounts[i]), None)); // col B: amount
        txn_cells.push((row, 2, CellValue::number(positives[i]), None)); // col C: positive
    }

    // Summary formulas (sheet 0)
    // Each row looks up against Transactions using full-column refs
    let mut summary_cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();
    let criteria_vals = ["Alpha", "Beta", "Alpha"];
    let maxifs_formulas: Vec<String> = (0..3)
        .map(|row| {
            format!(
                "=MAXIFS(Transactions!B:B,Transactions!A:A,A{},Transactions!C:C,\">0\")",
                row + 1
            )
        })
        .collect();
    let minifs_formulas: Vec<String> = (0..3)
        .map(|row| {
            format!(
                "=MINIFS(Transactions!B:B,Transactions!A:A,A{},Transactions!C:C,\">0\")",
                row + 1
            )
        })
        .collect();
    for (i, crit) in criteria_vals.iter().enumerate() {
        let row = i as u32;
        summary_cells.push((row, 0, CellValue::Text((*crit).into()), None));
        summary_cells.push((
            row,
            1,
            CellValue::number(0.0),
            Some(maxifs_formulas[i].as_str()),
        ));
        summary_cells.push((
            row,
            2,
            CellValue::number(0.0),
            Some(minifs_formulas[i].as_str()),
        ));
    }

    let snapshot = build_snapshot(vec![
        ("Summary", 10, 10, summary_cells),
        ("Transactions", 10, 10, txn_cells),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // Alpha rows with C > 0: row 0 (amount=100, C=10), row 2 (amount=300, C=20), row 4 (amount=500, C=30)
    // MAXIFS for "Alpha": max of {100, 300, 500} = 500
    // MINIFS for "Alpha": min of {100, 300, 500} = 100
    assert_num(&result, 0, 0, 1, 500.0); // MAXIFS row 0 (Alpha)
    assert_num(&result, 0, 0, 2, 100.0); // MINIFS row 0 (Alpha)

    // Beta rows with C > 0: row 1 (amount=200, C=-5) NO, row 3 (amount=400, C=0) NO
    // No Beta rows have C > 0, so MAXIFS = 0, MINIFS = 0
    // Value may not appear in changed_cells if it equals the initial value (0.0)
    let beta_max = find_changed_value(&result, 0, 1, 1);
    match beta_max {
        Some(CellValue::Number(n)) => assert!(
            (n.get() - 0.0).abs() < 1e-6,
            "Beta MAXIFS expected 0, got {}",
            n.get()
        ),
        None => {} // unchanged from initial 0.0 — correct
        other => panic!("Beta MAXIFS expected 0 or unchanged, got {:?}", other),
    }
    let beta_min = find_changed_value(&result, 0, 1, 2);
    match beta_min {
        Some(CellValue::Number(n)) => assert!(
            (n.get() - 0.0).abs() < 1e-6,
            "Beta MINIFS expected 0, got {}",
            n.get()
        ),
        None => {} // unchanged from initial 0.0 — correct
        other => panic!("Beta MINIFS expected 0 or unchanged, got {:?}", other),
    }

    // Alpha again (same as row 0)
    assert_num(&result, 0, 2, 1, 500.0); // MAXIFS row 2 (Alpha)
    assert_num(&result, 0, 2, 2, 100.0); // MINIFS row 2 (Alpha)
}

/// Test MAXIFS with cross-sheet full-column refs and large formula group (triggers agg_prepass).
///
/// Uses 20+ formula rows to exceed AGG_MIN_GROUP_SIZE (8) so the aggregation
/// prepass is triggered instead of the normal eval path.
#[test]
fn test_cross_sheet_maxifs_full_column_agg_prepass() {
    let mut txn_cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();

    // 20 transaction rows
    let categories = ["Alpha", "Beta", "Gamma", "Delta"];
    let n_txn = 20u32;
    for i in 0..n_txn {
        let row = i;
        let cat = categories[(i as usize) % categories.len()];
        txn_cells.push((row, 0, CellValue::Text(cat.into()), None)); // col A: category
        txn_cells.push((row, 1, CellValue::number((i + 1) as f64 * 10.0), None)); // col B: amount (10,20,...,200)
        let pos_val = if i % 3 == 0 { -1.0 } else { (i + 1) as f64 }; // col C: some positive, some negative
        txn_cells.push((row, 2, CellValue::number(pos_val), None));
    }

    // 20 formula rows on Summary sheet (exceeds AGG_MIN_GROUP_SIZE=8)
    let mut summary_cells: Vec<(u32, u32, CellValue, Option<&str>)> = Vec::new();
    let n_formulas = 20u32;
    let maxifs_formulas: Vec<String> = (0..n_formulas)
        .map(|row| {
            format!(
                "=MAXIFS(Transactions!B:B,Transactions!A:A,A{},Transactions!C:C,\">0\")",
                row + 1
            )
        })
        .collect();

    for i in 0..n_formulas {
        let row = i;
        let cat = categories[(i as usize) % categories.len()];
        summary_cells.push((row, 0, CellValue::Text(cat.into()), None));
        summary_cells.push((
            row,
            1,
            CellValue::number(0.0),
            Some(maxifs_formulas[i as usize].as_str()),
        ));
    }

    let snapshot = build_snapshot(vec![
        ("Summary", 30, 10, summary_cells),
        ("Transactions", 30, 10, txn_cells),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // Verify specific expected results.
    // Transaction data layout:
    //   Row 0: Alpha, 10, -1 (C<0, excluded by ">0")
    //   Row 1: Beta,  20,  2 (included)
    //   Row 2: Gamma, 30,  3 (included)
    //   Row 3: Delta, 40, -1 (C<0, excluded)
    //   Row 4: Alpha, 50,  5 (included)
    //   Row 5: Beta,  60,  6 (included)
    //   Row 6: Gamma, 70, -1 (C<0, excluded)
    //   Row 7: Delta, 80,  8 (included)
    //   Row 8: Alpha, 90,  9 (included)
    //   Row 9: Beta, 100, -1 (C<0, excluded)
    //   Row10: Gamma,110, 11 (included)
    //   Row11: Delta,120, 12 (included)
    //   Row12: Alpha,130, -1 (C<0, excluded)
    //   Row13: Beta, 140, 14 (included)
    //   Row14: Gamma,150, 15 (included)
    //   Row15: Delta,160, -1 (C<0, excluded)
    //   Row16: Alpha,170, 17 (included)
    //   Row17: Beta, 180, 18 (included)
    //   Row18: Gamma,190, -1 (C<0, excluded)
    //   Row19: Delta,200, 20 (included)

    // Alpha with C>0: rows 4(50), 8(90), 16(170) → max=170
    // Beta with C>0:  rows 1(20), 5(60), 13(140), 17(180) → max=180
    // Gamma with C>0: rows 2(30), 10(110), 14(150) → max=150
    // Delta with C>0: rows 7(80), 11(120), 19(200) → max=200

    // Formula row 0 criteria = "Alpha" → 170
    assert_num(&result, 0, 0, 1, 170.0);
    // Formula row 1 criteria = "Beta" → 180
    assert_num(&result, 0, 1, 1, 180.0);
    // Formula row 2 criteria = "Gamma" → 150
    assert_num(&result, 0, 2, 1, 150.0);
    // Formula row 3 criteria = "Delta" → 200
    assert_num(&result, 0, 3, 1, 200.0);
}
