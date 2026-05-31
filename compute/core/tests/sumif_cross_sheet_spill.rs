//! Integration tests for SUMIF with cross-sheet references and spill targets.
//!
//! Bug: The agg_prepass optimization (scheduler/agg_prepass) groups 8+ similar
//! SUMIF/COUNTIFS formulas and evaluates them via a single hash-map lookup before
//! normal level-based evaluation. But it read dynamic criteria values (e.g., spill
//! targets from UNIQUE) from the mirror BEFORE those criteria cells had been
//! evaluated, causing all SUMIFs to return 0.
//!
//! Fix: Added a guard in `execute_agg_group` to bail when any dynamic criteria
//! column contains dirty formula cells in the output row range.
//!
//! Run:
//!   cd os && cargo test -p compute-core --test sumif_cross_sheet_spill -- --nocapture

use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
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

/// Build a multi-sheet WorkbookSnapshot.
///
/// `sheets`: vec of (name, rows, cols, data_cells, formula_cells)
///   - data_cells: (row, col, CellValue)
///   - formula_cells: (row, col, formula_str, optional array_ref)
fn build_multi_sheet_snapshot(
    sheets: Vec<(
        &str,                                // sheet name
        u32,                                 // rows
        u32,                                 // cols
        Vec<(u32, u32, CellValue)>,          // data cells
        Vec<(u32, u32, &str, Option<&str>)>, // formula cells: (row, col, formula, array_ref)
    )>,
) -> WorkbookSnapshot {
    let sheet_snapshots: Vec<SheetSnapshot> = sheets
        .iter()
        .enumerate()
        .map(|(si, (name, rows, cols, data, formulas))| {
            let si = si as u32;
            let mut cells: Vec<CellData> = data
                .iter()
                .map(|(row, col, value)| CellData {
                    cell_id: cell_uuid(si, *row, *col),
                    row: *row,
                    col: *col,
                    value: value.clone(),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                })
                .collect();

            for (row, col, formula, arr_ref) in formulas {
                cells.push(CellData {
                    cell_id: cell_uuid(si, *row, *col),
                    row: *row,
                    col: *col,
                    value: CellValue::Null,
                    formula: Some(formula.to_string()),
                    identity_formula: None,
                    array_ref: arr_ref.map(|s| s.to_string()),
                });
            }

            SheetSnapshot {
                id: sheet_uuid(si),
                name: name.to_string(),
                rows: *rows,
                cols: *cols,
                cells,
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

fn find_value(
    result: &compute_core::RecalcResult,
    sheet_idx: u32,
    row: u32,
    col: u32,
) -> Option<CellValue> {
    let target = cell_uuid(sheet_idx, row, col);
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

// ===========================================================================
// Basic SUMIF correctness tests (small scale, below agg_prepass threshold)
// ===========================================================================

#[test]
fn sumif_cross_sheet_whole_column_literal_criteria() {
    let data_cells = vec![
        (0, 0, CellValue::number(10.0)),
        (1, 0, CellValue::number(20.0)),
        (2, 0, CellValue::number(30.0)),
        (3, 0, CellValue::number(10.0)),
        (4, 0, CellValue::number(20.0)),
        (5, 0, CellValue::number(30.0)),
        (0, 1, CellValue::number(1.0)),
        (1, 1, CellValue::number(2.0)),
        (2, 1, CellValue::number(3.0)),
        (3, 1, CellValue::number(4.0)),
        (4, 1, CellValue::number(5.0)),
        (5, 1, CellValue::number(6.0)),
    ];

    let report_formulas = vec![(0, 0, "SUMIF(Data!A:A,10,Data!B:B)", None)];

    let snapshot = build_multi_sheet_snapshot(vec![
        ("Data", 10, 3, data_cells, vec![]),
        ("Report", 10, 3, vec![], report_formulas),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let val = find_value(&result, 1, 0, 0);
    assert_number(
        &val,
        5.0,
        "cross-sheet SUMIF with whole-column + literal criteria",
    );
}

#[test]
fn sumif_same_sheet_spill_criteria() {
    let data_cells = vec![
        (0, 0, CellValue::number(10.0)),
        (1, 0, CellValue::number(20.0)),
        (2, 0, CellValue::number(30.0)),
        (3, 0, CellValue::number(10.0)),
        (4, 0, CellValue::number(20.0)),
        (5, 0, CellValue::number(30.0)),
        (0, 1, CellValue::number(1.0)),
        (1, 1, CellValue::number(2.0)),
        (2, 1, CellValue::number(3.0)),
        (3, 1, CellValue::number(4.0)),
        (4, 1, CellValue::number(5.0)),
        (5, 1, CellValue::number(6.0)),
    ];

    let formulas = vec![
        (0, 2, "SEQUENCE(3,1,10,10)", Some("C1:C3")),
        (0, 3, "SUMIF(A:A,C1,B:B)", None),
        (1, 3, "SUMIF(A:A,C2,B:B)", None),
        (2, 3, "SUMIF(A:A,C3,B:B)", None),
    ];

    let snapshot = build_multi_sheet_snapshot(vec![("Sheet1", 10, 5, data_cells, formulas)]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let d1 = find_value(&result, 0, 0, 3);
    assert_number(&d1, 5.0, "spill source criteria (C1=10)");

    let d2 = find_value(&result, 0, 1, 3);
    assert_number(&d2, 7.0, "spill target criteria (C2=20)");

    let d3 = find_value(&result, 0, 2, 3);
    assert_number(&d3, 9.0, "spill target criteria (C3=30)");
}

#[test]
fn sumif_cross_sheet_spill_criteria() {
    let data_cells = vec![
        (0, 0, CellValue::number(10.0)),
        (1, 0, CellValue::number(20.0)),
        (2, 0, CellValue::number(30.0)),
        (3, 0, CellValue::number(10.0)),
        (4, 0, CellValue::number(20.0)),
        (5, 0, CellValue::number(30.0)),
        (0, 1, CellValue::number(1.0)),
        (1, 1, CellValue::number(2.0)),
        (2, 1, CellValue::number(3.0)),
        (3, 1, CellValue::number(4.0)),
        (4, 1, CellValue::number(5.0)),
        (5, 1, CellValue::number(6.0)),
    ];

    let report_formulas = vec![
        (0, 0, "SEQUENCE(3,1,10,10)", Some("A1:A3")),
        (0, 1, "SUMIF(Data!A:A,A1,Data!B:B)", None),
        (1, 1, "SUMIF(Data!A:A,A2,Data!B:B)", None),
        (2, 1, "SUMIF(Data!A:A,A3,Data!B:B)", None),
    ];

    let snapshot = build_multi_sheet_snapshot(vec![
        ("Data", 10, 3, data_cells, vec![]),
        ("Report", 10, 3, vec![], report_formulas),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let b1 = find_value(&result, 1, 0, 1);
    assert_number(&b1, 5.0, "cross-sheet + spill source (A1=10)");

    let b2 = find_value(&result, 1, 1, 1);
    assert_number(&b2, 7.0, "cross-sheet + spill target (A2=20)");

    let b3 = find_value(&result, 1, 2, 1);
    assert_number(&b3, 9.0, "cross-sheet + spill target (A3=30)");
}

#[test]
fn sumif_cross_sheet_bounded_range_spill_criteria() {
    let data_cells = vec![
        (0, 0, CellValue::number(10.0)),
        (1, 0, CellValue::number(20.0)),
        (2, 0, CellValue::number(30.0)),
        (3, 0, CellValue::number(10.0)),
        (4, 0, CellValue::number(20.0)),
        (5, 0, CellValue::number(30.0)),
        (0, 1, CellValue::number(1.0)),
        (1, 1, CellValue::number(2.0)),
        (2, 1, CellValue::number(3.0)),
        (3, 1, CellValue::number(4.0)),
        (4, 1, CellValue::number(5.0)),
        (5, 1, CellValue::number(6.0)),
    ];

    let report_formulas = vec![
        (0, 0, "SEQUENCE(3,1,10,10)", Some("A1:A3")),
        (0, 1, "SUMIF(Data!A1:A6,A1,Data!B1:B6)", None),
        (1, 1, "SUMIF(Data!A1:A6,A2,Data!B1:B6)", None),
        (2, 1, "SUMIF(Data!A1:A6,A3,Data!B1:B6)", None),
    ];

    let snapshot = build_multi_sheet_snapshot(vec![
        ("Data", 10, 3, data_cells, vec![]),
        ("Report", 10, 3, vec![], report_formulas),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let b1 = find_value(&result, 1, 0, 1);
    assert_number(&b1, 5.0, "bounded cross-sheet + spill source (A1=10)");

    let b2 = find_value(&result, 1, 1, 1);
    assert_number(&b2, 7.0, "bounded cross-sheet + spill target (A2=20)");

    let b3 = find_value(&result, 1, 2, 1);
    assert_number(&b3, 9.0, "bounded cross-sheet + spill target (A3=30)");
}

#[test]
fn sumif_spill_criteria_is_scalar_not_array() {
    let data_cells = vec![
        (0, 2, CellValue::number(2.0)),
        (1, 2, CellValue::number(3.0)),
        (2, 2, CellValue::number(2.0)),
        (3, 2, CellValue::number(3.0)),
        (0, 3, CellValue::number(10.0)),
        (1, 3, CellValue::number(20.0)),
        (2, 3, CellValue::number(30.0)),
        (3, 3, CellValue::number(40.0)),
    ];

    let formulas = vec![
        (0, 0, "SEQUENCE(3)", Some("A1:A3")),
        (0, 1, "TYPE(A2)", None),
        (0, 4, "SUMIF(C:C,A2,D:D)", None),
    ];

    let snapshot = build_multi_sheet_snapshot(vec![("Sheet1", 10, 6, data_cells, formulas)]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let type_val = find_value(&result, 0, 0, 1);
    assert_number(&type_val, 1.0, "TYPE(spill_target) should be 1 (number)");

    let sumif_val = find_value(&result, 0, 0, 4);
    assert_number(&sumif_val, 40.0, "SUMIF with spill target criteria (A2=2)");
}

#[test]
fn sumif_cross_sheet_quoted_name_with_spaces() {
    let data_cells = vec![
        (0, 0, CellValue::number(10.0)),
        (1, 0, CellValue::number(20.0)),
        (2, 0, CellValue::number(10.0)),
        (3, 0, CellValue::number(20.0)),
        (0, 1, CellValue::number(1.0)),
        (1, 1, CellValue::number(2.0)),
        (2, 1, CellValue::number(3.0)),
        (3, 1, CellValue::number(4.0)),
    ];

    let report_formulas = vec![(0, 0, "SUMIF('Data Source'!A:A,10,'Data Source'!B:B)", None)];

    let snapshot = build_multi_sheet_snapshot(vec![
        ("Data Source", 10, 3, data_cells, vec![]),
        ("Report", 10, 3, vec![], report_formulas),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let val = find_value(&result, 1, 0, 0);
    assert_number(&val, 4.0, "quoted sheet name with spaces");
}

// ===========================================================================
// Real-world scenario tests (LET/UNIQUE/SORTBY + cross-sheet SUMIF)
// ===========================================================================

#[test]
fn sumif_cross_sheet_let_spill_criteria() {
    let data_cells = vec![
        (0, 0, CellValue::number(1231.0)),
        (1, 0, CellValue::number(1232.0)),
        (2, 0, CellValue::number(1231.0)),
        (3, 0, CellValue::number(1233.0)),
        (4, 0, CellValue::number(1232.0)),
        (5, 0, CellValue::number(1231.0)),
        (0, 1, CellValue::number(1.0)),
        (1, 1, CellValue::number(2.0)),
        (2, 1, CellValue::number(3.0)),
        (3, 1, CellValue::number(4.0)),
        (4, 1, CellValue::number(5.0)),
        (5, 1, CellValue::number(6.0)),
    ];

    let report_formulas = vec![
        (2, 1, "LET(a,UNIQUE('Raw Data'!A1:A6),a)", Some("B3:B5")),
        (3, 11, "SUMIF('Raw Data'!$A:$A,$B4,'Raw Data'!$B:$B)", None),
        (4, 11, "SUMIF('Raw Data'!$A:$A,$B5,'Raw Data'!$B:$B)", None),
        (5, 11, "SUMIF('Raw Data'!$A:$A,$B6,'Raw Data'!$B:$B)", None),
    ];

    let snapshot = build_multi_sheet_snapshot(vec![
        ("Raw Data", 10, 3, data_cells, vec![]),
        ("Summary", 10, 12, vec![], report_formulas),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let l4 = find_value(&result, 1, 3, 11);
    assert_number(&l4, 7.0, "LET/UNIQUE spill + cross-sheet SUMIF (B4=1232)");

    let l5 = find_value(&result, 1, 4, 11);
    assert_number(&l5, 4.0, "LET/UNIQUE spill + cross-sheet SUMIF (B5=1233)");

    let l6 = find_value(&result, 1, 5, 11);
    assert_number(&l6, 0.0, "LET/UNIQUE spill + cross-sheet SUMIF (B6=empty)");
}

/// Synthetic reproduction of the imported workbook pattern that triggered the bug.
#[test]
fn sumif_exact_reproduction_cross_sheet_let_spill_absolute_refs() {
    let mut data_cells = Vec::new();
    let store_ids = [1231.0, 1232.0, 1233.0, 1231.0, 1232.0, 1231.0];
    let values = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
    for (r, (&store, &val)) in store_ids.iter().zip(values.iter()).enumerate() {
        data_cells.push((r as u32, 2, CellValue::number(store)));
        data_cells.push((r as u32, 15, CellValue::number(val)));
    }

    let report_formulas = vec![
        (2, 1, "LET(a,UNIQUE('Data Source'!C1:C6),a)", Some("B3:B5")),
        (3, 11, "SUMIF('Data Source'!$C:$C,$B4,'Data Source'!P:P)", None),
        (4, 11, "SUMIF('Data Source'!$C:$C,$B5,'Data Source'!P:P)", None),
        (5, 11, "SUMIF('Data Source'!$C:$C,$B6,'Data Source'!P:P)", None),
    ];

    let snapshot = build_multi_sheet_snapshot(vec![
        ("Data Source", 10, 16, data_cells, vec![]),
        ("Summary", 10, 12, vec![], report_formulas),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let l4 = find_value(&result, 1, 3, 11);
    assert_number(&l4, 7.0, "exact repro L4 (B4=1232)");

    let l5 = find_value(&result, 1, 4, 11);
    assert_number(&l5, 3.0, "exact repro L5 (B5=1233)");

    let l6 = find_value(&result, 1, 5, 11);
    assert_number(&l6, 0.0, "exact repro L6 (B6=empty)");
}

#[test]
fn sumif_cross_sheet_let_sortby_spill_criteria() {
    let mut data_cells = Vec::new();
    let store_ids = [1231.0, 1232.0, 1233.0, 1231.0, 1232.0, 1231.0];
    let values = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
    for (r, (&store, &val)) in store_ids.iter().zip(values.iter()).enumerate() {
        data_cells.push((r as u32, 2, CellValue::number(store)));
        data_cells.push((r as u32, 15, CellValue::number(val)));
    }

    let report_formulas = vec![
        (
            2,
            1,
            "LET(a,UNIQUE('Data Source'!C1:C6),SORTBY(a,a))",
            Some("B3:B5"),
        ),
        (3, 11, "SUMIF('Data Source'!$C:$C,$B4,'Data Source'!P:P)", None),
        (4, 11, "SUMIF('Data Source'!$C:$C,$B5,'Data Source'!P:P)", None),
    ];

    let snapshot = build_multi_sheet_snapshot(vec![
        ("Data Source", 10, 16, data_cells, vec![]),
        ("Summary", 10, 12, vec![], report_formulas),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let l4 = find_value(&result, 1, 3, 11);
    assert_number(&l4, 7.0, "SORTBY spill + cross-sheet SUMIF (B4=1232)");

    let l5 = find_value(&result, 1, 4, 11);
    assert_number(&l5, 3.0, "SORTBY spill + cross-sheet SUMIF (B5=1233)");
}

// ===========================================================================
// Agg prepass regression tests (8+ SUMIF formulas trigger the prepass)
// The bug: agg_prepass read dynamic criteria from mirror before the spill
// source formula was evaluated, getting Null instead of actual values.
// ===========================================================================

/// 8 SUMIF formulas = exact threshold for AGG_MIN_GROUP_SIZE.
/// Regression test for the agg_prepass criteria formula guard.
#[test]
fn sumif_agg_prepass_threshold_8_formulas() {
    let mut data_cells = Vec::new();
    for r in 0u32..16 {
        let store = 100.0 + (r % 8) as f64;
        let value = (r + 1) as f64;
        data_cells.push((r, 0, CellValue::number(store)));
        data_cells.push((r, 1, CellValue::number(value)));
    }
    let mut report_formulas: Vec<(u32, u32, &str, Option<&str>)> =
        vec![(0, 0, "UNIQUE(Data!A1:A16)", Some("A1:A8"))];
    for i in 0..8 {
        let f: &str = match i {
            0 => "SUMIF(Data!A:A,A1,Data!B:B)",
            1 => "SUMIF(Data!A:A,A2,Data!B:B)",
            2 => "SUMIF(Data!A:A,A3,Data!B:B)",
            3 => "SUMIF(Data!A:A,A4,Data!B:B)",
            4 => "SUMIF(Data!A:A,A5,Data!B:B)",
            5 => "SUMIF(Data!A:A,A6,Data!B:B)",
            6 => "SUMIF(Data!A:A,A7,Data!B:B)",
            7 => "SUMIF(Data!A:A,A8,Data!B:B)",
            _ => unreachable!(),
        };
        report_formulas.push((i as u32, 1, f, None));
    }
    let snapshot = build_multi_sheet_snapshot(vec![
        ("Data", 20, 3, data_cells, vec![]),
        ("Report", 20, 3, vec![], report_formulas),
    ]);
    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");
    for i in 0..8 {
        let expected = (i + 1) as f64 + (i + 9) as f64;
        let val = find_value(&result, 1, i as u32, 1);
        assert_number(
            &val,
            expected,
            &format!("8-formula threshold, store {} (row {})", 100 + i, i),
        );
    }
}

/// 10 SUMIF formulas + 200 data rows — above agg_prepass threshold.
#[test]
fn sumif_agg_prepass_10_formulas_200_rows() {
    let mut data_cells = Vec::new();
    for r in 0u32..200 {
        let store = 100.0 + (r % 10) as f64;
        let value = (r + 1) as f64;
        data_cells.push((r, 0, CellValue::number(store)));
        data_cells.push((r, 1, CellValue::number(value)));
    }

    let mut report_formulas: Vec<(u32, u32, &str, Option<&str>)> =
        vec![(0, 0, "UNIQUE(Data!A1:A200)", Some("A1:A10"))];
    let sumif_formulas = [
        "SUMIF(Data!A:A,A1,Data!B:B)",
        "SUMIF(Data!A:A,A2,Data!B:B)",
        "SUMIF(Data!A:A,A3,Data!B:B)",
        "SUMIF(Data!A:A,A4,Data!B:B)",
        "SUMIF(Data!A:A,A5,Data!B:B)",
        "SUMIF(Data!A:A,A6,Data!B:B)",
        "SUMIF(Data!A:A,A7,Data!B:B)",
        "SUMIF(Data!A:A,A8,Data!B:B)",
        "SUMIF(Data!A:A,A9,Data!B:B)",
        "SUMIF(Data!A:A,A10,Data!B:B)",
    ];
    for (i, f) in sumif_formulas.iter().enumerate() {
        report_formulas.push((i as u32, 1, f, None));
    }

    let snapshot = build_multi_sheet_snapshot(vec![
        ("Data", 210, 3, data_cells, vec![]),
        ("Report", 20, 3, vec![], report_formulas),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    for i in 0..10 {
        let first = (i + 1) as f64;
        let last = (190 + i + 1) as f64;
        let expected = 20.0 * (first + last) / 2.0;
        let val = find_value(&result, 1, i as u32, 1);
        assert_number(
            &val,
            expected,
            &format!("10 formulas 200 rows, store {} (row {})", 100 + i, i),
        );
    }
}

/// 10 SUMIF + 500 data rows to exercise the aggregate prepass path.
#[test]
fn sumif_agg_prepass_10_formulas_500_rows() {
    let mut data_cells = Vec::new();
    for r in 0u32..500 {
        let store = 100.0 + (r % 10) as f64;
        let value = (r + 1) as f64;
        data_cells.push((r, 0, CellValue::number(store)));
        data_cells.push((r, 1, CellValue::number(value)));
    }

    let mut report_formulas: Vec<(u32, u32, &str, Option<&str>)> =
        vec![(0, 0, "UNIQUE(Data!A1:A500)", Some("A1:A10"))];
    let sumif_formulas = [
        "SUMIF(Data!A:A,A1,Data!B:B)",
        "SUMIF(Data!A:A,A2,Data!B:B)",
        "SUMIF(Data!A:A,A3,Data!B:B)",
        "SUMIF(Data!A:A,A4,Data!B:B)",
        "SUMIF(Data!A:A,A5,Data!B:B)",
        "SUMIF(Data!A:A,A6,Data!B:B)",
        "SUMIF(Data!A:A,A7,Data!B:B)",
        "SUMIF(Data!A:A,A8,Data!B:B)",
        "SUMIF(Data!A:A,A9,Data!B:B)",
        "SUMIF(Data!A:A,A10,Data!B:B)",
    ];
    for (i, f) in sumif_formulas.iter().enumerate() {
        report_formulas.push((i as u32, 1, f, None));
    }

    let snapshot = build_multi_sheet_snapshot(vec![
        ("Data", 510, 3, data_cells, vec![]),
        ("Report", 20, 3, vec![], report_formulas),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    for i in 0..10 {
        let first = (i + 1) as f64;
        let last = (490 + i + 1) as f64;
        let expected = 50.0 * (first + last) / 2.0;
        let val = find_value(&result, 1, i as u32, 1);
        assert_number(
            &val,
            expected,
            &format!("10 formulas 500 rows, store {} (row {})", 100 + i, i),
        );
    }
}

/// Literal criteria SUMIF at scale — no spill involved, should always work.
#[test]
fn sumif_cross_sheet_literal_large_data() {
    let mut data_cells = Vec::new();
    for r in 0u32..500 {
        let store = 100.0 + (r % 10) as f64;
        let value = (r + 1) as f64;
        data_cells.push((r, 0, CellValue::number(store)));
        data_cells.push((r, 1, CellValue::number(value)));
    }

    let report_formulas = vec![
        (0, 0, "SUMIF(Data!A:A,100,Data!B:B)", None),
        (1, 0, "SUMIF(Data!A:A,101,Data!B:B)", None),
    ];

    let snapshot = build_multi_sheet_snapshot(vec![
        ("Data", 510, 3, data_cells, vec![]),
        ("Report", 10, 3, vec![], report_formulas),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let v0 = find_value(&result, 1, 0, 0);
    assert_number(&v0, 12300.0, "literal SUMIF large data, store 100");

    let v1 = find_value(&result, 1, 1, 0);
    assert_number(&v1, 12350.0, "literal SUMIF large data, store 101");
}

// ===========================================================================
// ===========================================================================

#[test]
fn sumif_large_scale_no_array_ref() {
    let mut data_cells = Vec::new();
    for r in 0u32..500 {
        let store = 100.0 + (r % 10) as f64;
        let value = (r + 1) as f64;
        data_cells.push((r, 0, CellValue::number(store)));
        data_cells.push((r, 1, CellValue::number(value)));
    }

    let mut report_formulas: Vec<(u32, u32, &str, Option<&str>)> =
        vec![(0, 0, "UNIQUE(Data!A1:A500)", None)];
    let sumif_formulas = [
        "SUMIF(Data!A:A,A1,Data!B:B)",
        "SUMIF(Data!A:A,A2,Data!B:B)",
        "SUMIF(Data!A:A,A3,Data!B:B)",
        "SUMIF(Data!A:A,A4,Data!B:B)",
        "SUMIF(Data!A:A,A5,Data!B:B)",
        "SUMIF(Data!A:A,A6,Data!B:B)",
        "SUMIF(Data!A:A,A7,Data!B:B)",
        "SUMIF(Data!A:A,A8,Data!B:B)",
        "SUMIF(Data!A:A,A9,Data!B:B)",
        "SUMIF(Data!A:A,A10,Data!B:B)",
    ];
    for (i, f) in sumif_formulas.iter().enumerate() {
        report_formulas.push((i as u32, 1, f, None));
    }

    let snapshot = build_multi_sheet_snapshot(vec![
        ("Data", 510, 3, data_cells, vec![]),
        ("Report", 20, 3, vec![], report_formulas),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    for i in 0..10 {
        let first = (i + 1) as f64;
        let last = (490 + i + 1) as f64;
        let expected = 50.0 * (first + last) / 2.0;
        let val = find_value(&result, 1, i as u32, 1);
        assert_number(
            &val,
            expected,
            &format!("large-scale no array_ref, store {} (row {})", 100 + i, i),
        );
    }
}
