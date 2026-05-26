//! Regression test for issue #11: ROWS(UNIQUE(FILTER(C:C, ...))) off-by-one.
//!
//! Encodes the CORRECT Excel behavior: a full-column reference like `C:C` in
//! a cross-sheet context must span every row of the grid (1..=1,048,576),
//! not just `sheet.rows` as stored in the snapshot. When the predicate
//! `C:C <> "header"` accepts blanks, UNIQUE(FILTER(...)) must produce one
//! additional group for the trailing blank tail beyond the data.
//!
//! Root cause:
//!   compute/core/src/eval/cache/range_store.rs:274-297
//!   `resolve_range_to_key` clamps `RangeType::ColumnRange` to `sheet.rows - 1`,
//!   dropping the ~1M trailing blank rows.
//!
//! Today (pre-fix): this test FAILS — engine returns `distinct_count`
//! instead of `distinct_count + 1` because the blank tail is never
//! materialized as input to FILTER/UNIQUE.
//!
//! After the fix (virtual blank tail / ColumnRange-aware FILTER/UNIQUE):
//! this test will PASS.
//! Run:
//!   cd compute/core && cargo test -p compute-core \
//!     --test filter_unique_column_range_blank_tail \
//!     -- --ignored --nocapture

use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Helpers (pattern copied from sumif_cross_sheet_spill.rs)
// ---------------------------------------------------------------------------

fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

fn build_multi_sheet_snapshot(
    sheets: Vec<(
        &str,
        u32,
        u32,
        Vec<(u32, u32, CellValue)>,
        Vec<(u32, u32, &str, Option<&str>)>,
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

// ---------------------------------------------------------------------------
// The failing test: minimum repro of the corpus off-by-one.
//
// Layout (matches the minimum repro in the plan):
//   Raw Data: column C has 5 populated rows
//     C1 = "header"
//     C2 = "x"
//     C3 = "x"
//     C4 = "y"
//     C5 = "y"
//   Raw Data's sheet dimensions: rows=100 (so `C:C` is clamped to C1:C100)
//   Summary!A1 = ROWS(UNIQUE(FILTER('Raw Data'!C:C, 'Raw Data'!C:C<>"header")))
//
// Distinct non-header values in the populated region: {"x", "y"} -> 2 groups.
// The trailing blank cells (C6..C100) are non-header, so FILTER must let
// them through; UNIQUE then collapses them to 1 "blank" group.
// Excel-correct answer: 2 + 1 = 3.
//
// Today the engine returns 2 (the blank tail is dropped at
// resolve_range_to_key -> clamp to sheet.rows).
// ---------------------------------------------------------------------------

#[test]
fn rows_unique_filter_column_range_counts_blank_tail_group() {
    // Column C on "Raw Data": 1 header row + 4 data rows (2 distinct values).
    let data_cells = vec![
        (0, 2, CellValue::from("header")),
        (1, 2, CellValue::from("x")),
        (2, 2, CellValue::from("x")),
        (3, 2, CellValue::from("y")),
        (4, 2, CellValue::from("y")),
    ];

    // Cross-sheet formula: the repro requires evaluation from a different sheet.
    let summary_formulas = vec![(
        0,
        0,
        "ROWS(UNIQUE(FILTER('Raw Data'!C:C,'Raw Data'!C:C<>\"header\")))",
        None,
    )];

    // Raw Data has rows=100 > last populated row (5). The ~95 blank rows
    // between C6 and C100 are the "blank tail" that FILTER must include
    // for Excel-compat.
    let snapshot = build_multi_sheet_snapshot(vec![
        ("Raw Data", 100, 5, data_cells, vec![]),
        ("Summary", 10, 5, vec![], summary_formulas),
    ]);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // Summary is sheet index 1. Formula is at (0, 0).
    // Expected: 2 distinct data values ("x", "y") + 1 blank group = 3.
    let v = find_value(&result, 1, 0, 0);
    assert_number(
        &v,
        3.0,
        "ROWS(UNIQUE(FILTER(C:C, C:C<>\"header\"))) must include \
         the blank-tail group beyond the last populated row \
         (Excel-correct = distinct_non_header + 1)",
    );
}
