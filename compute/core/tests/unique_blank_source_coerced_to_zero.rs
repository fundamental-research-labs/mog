//! Regression test: UNIQUE must coerce blank source cells to 0 before dedup.
//!
//! Excel rule: `=UNIQUE(A1:A5)` over a partially-empty source coerces every
//! blank cell to the literal number `0` before computing distinct rows. So
//! for the source [\"alpha\", \"beta\", <blank>, <blank>, <blank>] the three
//! distinct rows are exactly [\"alpha\", \"beta\", 0] — not [\"alpha\",
//! \"beta\", <blank>].
//!
//! Today (pre-fix) the engine renders the third spilled row as `Null`/blank
//! because:
//!   * `hash_cell_value_ci` in
//!     `compute/core/crates/compute-functions/src/lookup/dynamic_arrays.rs:32-34`
//!     hashes `CellValue::Null` under its own tag (`3u8`), and
//!   * `cell_value_cmp` in
//!     `compute/core/crates/compute-functions/src/lookup/helpers.rs:43`
//!     returns `Null != Number(0)`,
//! so a blank source cell never collides with a literal `0` and never gets
//! coerced. `FnUnique::call`
//! (`compute/core/crates/compute-functions/src/lookup/dynamic_arrays.rs:592-748`,
//! root cause around lines 592-598) takes the array straight from
//! `to_array(...)` without normalising blanks, so the deduped output preserves
//! `CellValue::Null` as a first-class distinct row.
//!
//! Scope check vs `tests/filter_unique_column_range_blank_tail.rs`: that test
//! pins `ROWS(UNIQUE(FILTER('Raw Data'!C:C, ...)))` over a full ColumnRange
//! and intentionally counts the trailing blank tail as one distinct group of
//! its own. The two are not in conflict — the fix the plan describes lives
//! inside `FnUnique::call` after `to_array(...)` (i.e. only on values that
//! actually flow into UNIQUE), and pushing coercion into the shared `to_array`
//! helper would break the FILTER blank-tail regression. This test uses a
//! bounded `A1:A5` and asserts the explicit value of the third unique row,
//! so the FILTER blank-tail behavior remains untouched.
//!
//! Run:
//!   cd compute/core && cargo test -p compute-core \
//!     --test unique_blank_source_coerced_to_zero -- --nocapture

use cell_types::SheetPos;
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use compute_core::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Helpers (pattern copied from sumif_cross_sheet_spill.rs / filter_unique_*).
// ---------------------------------------------------------------------------

fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

fn build_single_sheet_snapshot(
    name: &str,
    rows: u32,
    cols: u32,
    data: Vec<(u32, u32, CellValue)>,
    formulas: Vec<(u32, u32, &str, Option<&str>)>,
) -> WorkbookSnapshot {
    let mut cells: Vec<CellData> = data
        .into_iter()
        .map(|(row, col, value)| CellData {
            cell_id: cell_uuid(0, row, col),
            row,
            col,
            value,
            formula: None,
            identity_formula: None,
            array_ref: None,
        })
        .collect();

    for (row, col, formula, arr_ref) in formulas {
        cells.push(CellData {
            cell_id: cell_uuid(0, row, col),
            row,
            col,
            value: CellValue::Null,
            formula: Some(formula.to_string()),
            identity_formula: None,
            array_ref: arr_ref.map(|s| s.to_string()),
        });
    }

    let sheet = SheetSnapshot {
        id: sheet_uuid(0),
        name: name.to_string(),
        rows,
        cols,
        cells,
        ranges: vec![],
    };

    WorkbookSnapshot {
        sheets: vec![sheet],
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

/// Read a spilled cell value from the mirror at `(sheet_name, row, col)`.
///
/// Spill children for a host with no explicit `array_ref` are projected into
/// `col_data` rather than as discrete `changed_cells`, so we read via
/// `CellMirror::get_cell_value_at`, which falls back to the projection.
fn read_mirror(mirror: &CellMirror, sheet_name: &str, row: u32, col: u32) -> Option<CellValue> {
    let sheet_id = mirror
        .sheet_ids()
        .find(|sid| {
            mirror
                .get_sheet(sid)
                .map(|sm| sm.name == sheet_name)
                .unwrap_or(false)
        })
        .copied()?;
    mirror
        .get_cell_value_at(&sheet_id, SheetPos::new(row, col))
        .cloned()
}

// ---------------------------------------------------------------------------
// The failing test.
//
// Layout:
//   A1 = "alpha"
//   A2 = "beta"
//   A3..A5 untouched (CellValue::Null / blank)
//   C1 = =UNIQUE(A1:A5)
//
// Excel-correct spilled output at C1:C3 is ["alpha", "beta", 0].
// Today the engine spills ["alpha", "beta", <blank>] because UNIQUE never
// coerces blanks to 0 before deduplication.
// ---------------------------------------------------------------------------

#[test]
fn unique_coerces_blank_source_cells_to_zero_before_dedup() {
    // A1 = "alpha", A2 = "beta", A3..A5 deliberately omitted (Null/blank).
    let data_cells = vec![
        (0, 0, CellValue::from("alpha")),
        (1, 0, CellValue::from("beta")),
    ];

    // C1 = =UNIQUE(A1:A5) — auto-spills into C1:C3.
    let formulas = vec![(0, 2, "UNIQUE(A1:A5)", None)];

    let snapshot = build_single_sheet_snapshot("Sheet1", 10, 5, data_cells, formulas);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let _result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // C1 (row 0, col 2) — first unique row, "alpha".
    let c1 = read_mirror(&mirror, "Sheet1", 0, 2);
    match &c1 {
        Some(CellValue::Text(s)) => assert_eq!(
            s.as_ref(),
            "alpha",
            "C1 should be the first unique row \"alpha\""
        ),
        other => panic!("C1: expected Text(\"alpha\"), got {:?}", other),
    }

    // C2 (row 1, col 2) — second unique row, "beta".
    let c2 = read_mirror(&mirror, "Sheet1", 1, 2);
    match &c2 {
        Some(CellValue::Text(s)) => assert_eq!(
            s.as_ref(),
            "beta",
            "C2 should be the second unique row \"beta\""
        ),
        other => panic!("C2: expected Text(\"beta\"), got {:?}", other),
    }

    // C3 (row 2, col 2) — third unique row should be `0` (the blanks A3..A5
    // collapse into a single distinct row, coerced from blank to literal zero
    // *before* dedup).
    let c3 = read_mirror(&mirror, "Sheet1", 2, 2);
    // Excel rule: UNIQUE coerces blanks to 0 before dedup. Currently broken: see dynamic_arrays.rs:592-598.
    match &c3 {
        Some(CellValue::Number(n)) => assert!(
            (n.get() - 0.0).abs() < 1e-12,
            "C3: expected Number(0.0), got Number({})",
            n.get()
        ),
        other => panic!(
            "C3: blank source cells must coerce to Number(0.0) before UNIQUE dedup, \
             but got {:?}. This is the Null-vs-Number(0) bug in FnUnique::call \
             (dynamic_arrays.rs:592-598).",
            other
        ),
    }
}
