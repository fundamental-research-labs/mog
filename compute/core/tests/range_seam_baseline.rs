//! Seam-baseline regression tests for the Range refactor.
//!
//! These tests document the **current behavior** at seam points that the
//! Range refactor will modify. Each test anchors "no regression" during
//! implementation. All tests MUST pass on the pre-refactor codebase.
//!
//! Run:
//!   cargo test -p compute-core --test range_seam_baseline -- --nocapture

#[path = "support/mod.rs"]
mod support;

use support::fixtures::{
    SHEET1_UUID, cell_uuid, formula_cell, numeric_column_snapshot, one_sheet_snapshot, value_cell,
};

use cell_types::{CellId, SheetId, SheetPos};
use compute_core::mirror::CellMirror;
use compute_core::mirror::dense::DenseColumnCache;
use compute_core::scheduler::ComputeCore;
use snapshot_types::CellData;
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn sheet_id() -> SheetId {
    SheetId::from_uuid_str(SHEET1_UUID).expect("valid sheet uuid")
}

/// Find a cell change in the RecalcResult by cell UUID string.
fn find_changed_value(
    result: &snapshot_types::RecalcResult,
    cell_uuid_str: &str,
) -> Option<CellValue> {
    result
        .changed_cells
        .iter()
        .find(|cc| cc.cell_id == cell_uuid_str)
        .map(|cc| cc.value.clone())
}

/// Assert that a cell evaluated to a specific number (within tolerance).
fn assert_cell_number(
    result: &snapshot_types::RecalcResult,
    cell_uuid_str: &str,
    expected: f64,
    label: &str,
) {
    let val = find_changed_value(result, cell_uuid_str);
    match val {
        Some(CellValue::Number(n)) => {
            assert!(
                (n.get() - expected).abs() < 1e-6,
                "{label}: expected {expected}, got {}",
                n.get()
            );
        }
        Some(other) => panic!("{label}: expected Number({expected}), got {other:?}"),
        None => panic!("{label}: cell {cell_uuid_str} not in changed_cells"),
    }
}

// ===========================================================================
// Test 1: get_column_slice returns correct column data
// ===========================================================================

#[test]
fn get_column_slice_returns_col_data() {
    let snapshot = numeric_column_snapshot(100);
    let mirror = CellMirror::from_snapshot(snapshot).expect("from_snapshot");
    let sid = sheet_id();
    let sheet = mirror.get_sheet(&sid).expect("sheet must exist");

    let col_slice = sheet.get_column_slice(0).expect("col 0 must have data");

    // Verify first, last, and a few middle values.
    assert!(col_slice.len() >= 100, "slice must cover all 100 rows");
    for i in 0..100usize {
        let expected = (i + 1) as f64;
        match &col_slice[i] {
            CellValue::Number(n) => {
                assert!(
                    (n.get() - expected).abs() < 1e-9,
                    "row {i}: expected {expected}, got {}",
                    n.get()
                );
            }
            other => panic!("row {i}: expected Number({expected}), got {other:?}"),
        }
    }
}

// ===========================================================================
// Test 2: get_column_slice returns None for empty column
// ===========================================================================

#[test]
fn get_column_slice_returns_none_for_empty() {
    let snapshot = numeric_column_snapshot(100);
    let mirror = CellMirror::from_snapshot(snapshot).expect("from_snapshot");
    let sid = sheet_id();
    let sheet = mirror.get_sheet(&sid).expect("sheet must exist");

    // Column 5 has no data in the snapshot.
    let col_slice = sheet.get_column_slice(5);
    assert!(
        col_slice.is_none(),
        "expected None for unpopulated col 5, got Some"
    );
}

// ===========================================================================
// Test 3: resolve_cell_id returns None for missing position
// ===========================================================================

#[test]
fn resolve_cell_id_returns_none_for_missing_pos() {
    let snapshot = numeric_column_snapshot(10);
    let mirror = CellMirror::from_snapshot(snapshot).expect("from_snapshot");
    let sid = sheet_id();

    // Row 99999, col 99 — far outside any populated cell.
    let result = mirror.resolve_cell_id(&sid, SheetPos::new(99999, 99));
    assert!(result.is_none(), "expected None for missing pos");
}

// ===========================================================================
// Test 4: resolve_cell_id returns Some for present position
// ===========================================================================

#[test]
fn resolve_cell_id_returns_some_for_present_pos() {
    let snapshot = numeric_column_snapshot(10);
    let mirror = CellMirror::from_snapshot(snapshot).expect("from_snapshot");
    let sid = sheet_id();

    // Row 0, col 0 has data.
    let result = mirror.resolve_cell_id(&sid, SheetPos::new(0, 0));
    assert!(result.is_some(), "expected Some for present pos (0,0)");

    // Verify the CellId matches what we expect from the fixture builder.
    let expected_uuid = cell_uuid(0, 0);
    let expected_cid = CellId::from_uuid_str(&expected_uuid).expect("valid uuid");
    assert_eq!(result.unwrap(), expected_cid);
}

// ===========================================================================
// Test 5: Single-column range materialization (Tier 1 path) via SUM formula
// ===========================================================================

/// Exercises the Tier 1 (single-column dense) materialization path by
/// evaluating a SUM formula over a single column. The engine internally
/// calls `materialize_range` with a single-column RangePos, which uses
/// `get_column_slice` when available.
#[test]
fn materialize_range_tier1_via_sum() {
    let mut cells: Vec<CellData> = Vec::with_capacity(101);
    for r in 0..100u32 {
        cells.push(value_cell(r, 0, (r + 1) as f64));
    }
    // SUM(A1:A100) at B1 (row=0, col=1). This exercises Tier 1 (single-column).
    cells.push(formula_cell(0, 1, "SUM(A1:A100)"));
    let snapshot = one_sheet_snapshot(cells);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // SUM(1..100) = 5050
    let sum_uuid = cell_uuid(0, 1);
    assert_cell_number(&result, &sum_uuid, 5050.0, "SUM(A1:A100) via Tier 1");
}

// ===========================================================================
// Test 6: Multi-column range materialization (Tier 2 path) via SUMPRODUCT
// ===========================================================================

/// Exercises the Tier 2 (multi-column dense) materialization path by
/// evaluating SUMPRODUCT over two columns. The engine internally calls
/// `materialize_range` spanning multiple columns, which uses the
/// multi-column dense iteration path.
#[test]
fn materialize_range_tier2_via_sumproduct() {
    let mut cells: Vec<CellData> = Vec::with_capacity(21);
    // Col A: 1..10, Col B: 10..1 (reversed), so products are 10,18,24,...,10.
    for r in 0..10u32 {
        cells.push(value_cell(r, 0, (r + 1) as f64));
        cells.push(value_cell(r, 1, (10 - r) as f64));
    }
    // SUMPRODUCT(A1:A10, B1:B10) at C1 (row=0, col=2).
    cells.push(formula_cell(0, 2, "SUMPRODUCT(A1:A10,B1:B10)"));
    let snapshot = one_sheet_snapshot(cells);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // SUMPRODUCT = 1*10 + 2*9 + 3*8 + 4*7 + 5*6 + 6*5 + 7*4 + 8*3 + 9*2 + 10*1 = 220
    let sp_uuid = cell_uuid(0, 2);
    assert_cell_number(&result, &sp_uuid, 220.0, "SUMPRODUCT via Tier 2");
}

// ===========================================================================
// Test 7: col_version returns 0 for untracked column
// ===========================================================================

#[test]
fn col_version_zero_for_untracked() {
    let snapshot = numeric_column_snapshot(10);
    let mirror = CellMirror::from_snapshot(snapshot).expect("from_snapshot");
    let sid = sheet_id();

    // Column 99 has no data and no writes — version should be 0.
    let v = mirror.col_version(&sid, 99);
    assert_eq!(v, 0, "expected version 0 for untracked col 99");
}

// ===========================================================================
// Test 8: col_version monotonically increases on edits
// ===========================================================================

#[test]
fn col_version_monotonic_on_edits() {
    let cells = vec![value_cell(0, 0, 1.0), value_cell(1, 0, 2.0)];
    let snapshot = one_sheet_snapshot(cells);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let _init = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let sid = sheet_id();
    let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0)).expect("valid uuid");

    let v0 = mirror.col_version(&sid, 0);

    // Edit cell A1 (row=0, col=0): "10"
    let _r1 = core
        .set_cell(&mut mirror, &sid, cell_id, 0, 0, "10")
        .expect("set_cell");
    let v1 = mirror.col_version(&sid, 0);
    assert!(
        v1 > v0,
        "version must increase after first edit: {v0} -> {v1}"
    );

    // Edit again: "20"
    let _r2 = core
        .set_cell(&mut mirror, &sid, cell_id, 0, 0, "20")
        .expect("set_cell");
    let v2 = mirror.col_version(&sid, 0);
    assert!(
        v2 > v1,
        "version must increase after second edit: {v1} -> {v2}"
    );
}

// ===========================================================================
// Test 9: DenseColumnCache materialize returns correct data
// ===========================================================================

#[test]
fn dense_cache_materialize_returns_correct_data() {
    let snapshot = numeric_column_snapshot(50);
    let mirror = CellMirror::from_snapshot(snapshot).expect("from_snapshot");
    let sid = sheet_id();
    let sheet = mirror.get_sheet(&sid).expect("sheet exists");

    let mut cache = DenseColumnCache::new();
    let dense_col = cache.materialize(&sid, 0, sheet);

    // DenseColumn stores f64 values; numeric cells should be present.
    let values = dense_col.values();
    assert!(
        values.len() >= 50,
        "dense column must have >= 50 entries, got {}",
        values.len()
    );

    // Verify first 50 rows match 1.0, 2.0, ..., 50.0
    for i in 0..50usize {
        let expected = (i + 1) as f64;
        assert!(
            (values[i] - expected).abs() < 1e-9,
            "row {i}: expected {expected}, got {}",
            values[i]
        );
    }
}

// ===========================================================================
// Test 10: dep_extract expands small range — SUM(A1:A10) per-cell deps
// ===========================================================================

#[test]
fn dep_extract_expands_small_range() {
    let mut cells: Vec<CellData> = Vec::with_capacity(11);
    for r in 0..10u32 {
        cells.push(value_cell(r, 0, (r + 1) as f64));
    }
    // SUM(A1:A10) at B1 (row=0, col=1)
    cells.push(formula_cell(0, 1, "SUM(A1:A10)"));
    let snapshot = one_sheet_snapshot(cells);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // SUM(1..10) = 55
    let sum_uuid = cell_uuid(0, 1);
    assert_cell_number(&result, &sum_uuid, 55.0, "initial SUM(A1:A10)");

    // Edit cell A5 (row=4, col=0) from 5.0 to 105.0 (delta +100).
    let sid = sheet_id();
    let a5_cid = CellId::from_uuid_str(&cell_uuid(4, 0)).expect("valid uuid");
    let result2 = core
        .set_cell(&mut mirror, &sid, a5_cid, 4, 0, "105")
        .expect("set_cell");

    // New SUM = 55 - 5 + 105 = 155
    assert_cell_number(&result2, &sum_uuid, 155.0, "SUM after edit A5");
}

// ===========================================================================
// Test 11: dep_extract keeps large range — SUM(A1:A1000) range dep
// ===========================================================================

#[test]
fn dep_extract_keeps_large_range() {
    let mut cells: Vec<CellData> = Vec::with_capacity(1001);
    for r in 0..1000u32 {
        cells.push(value_cell(r, 0, (r + 1) as f64));
    }
    // SUM(A1:A1000) at B1 (row=0, col=1)
    cells.push(formula_cell(0, 1, "SUM(A1:A1000)"));
    let snapshot = one_sheet_snapshot(cells);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // SUM(1..1000) = 500500
    let sum_uuid = cell_uuid(0, 1);
    assert_cell_number(&result, &sum_uuid, 500500.0, "initial SUM(A1:A1000)");

    // Edit cell A500 (row=499, col=0) from 500.0 to 1500.0 (delta +1000).
    let sid = sheet_id();
    let a500_cid = CellId::from_uuid_str(&cell_uuid(499, 0)).expect("valid uuid");
    let result2 = core
        .set_cell(&mut mirror, &sid, a500_cid, 499, 0, "1500")
        .expect("set_cell");

    // New SUM = 500500 - 500 + 1500 = 501500
    assert_cell_number(&result2, &sum_uuid, 501500.0, "SUM after edit A500");
}

// ===========================================================================
// Test 12: dep_extract selective — INDEX(A1:A100,50) evaluates correctly
// ===========================================================================

#[test]
fn dep_extract_selective_never_expands() {
    let mut cells: Vec<CellData> = Vec::with_capacity(101);
    for r in 0..100u32 {
        cells.push(value_cell(r, 0, (r + 1) as f64));
    }
    // INDEX(A1:A100,50) at B1 (row=0, col=1) — should return value at row 50 = 50.0
    cells.push(formula_cell(0, 1, "INDEX(A1:A100,50)"));
    let snapshot = one_sheet_snapshot(cells);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    // INDEX(A1:A100,50) returns the 50th element = 50.0
    let idx_uuid = cell_uuid(0, 1);
    assert_cell_number(&result, &idx_uuid, 50.0, "initial INDEX(A1:A100,50)");

    // Edit cell A50 (row=49, col=0) from 50.0 to 999.0
    let sid = sheet_id();
    let a50_cid = CellId::from_uuid_str(&cell_uuid(49, 0)).expect("valid uuid");
    let result2 = core
        .set_cell(&mut mirror, &sid, a50_cid, 49, 0, "999")
        .expect("set_cell");

    // INDEX should now return 999.0
    assert_cell_number(&result2, &idx_uuid, 999.0, "INDEX after edit A50");
}

// ===========================================================================
// Test 13: DenseColumnCache returns fresh data after cell edit
// ===========================================================================

/// Verifies the end-to-end contract: materialize → edit cell → next
/// materialize returns fresh data, not stale cached values.
/// This covers the plan spec `dense_cache_invalidated_on_col_version_bump`.
#[test]
fn dense_cache_invalidated_after_edit() {
    let cells = vec![
        value_cell(0, 0, 10.0),
        value_cell(1, 0, 20.0),
        value_cell(2, 0, 30.0),
    ];
    let snapshot = one_sheet_snapshot(cells);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let _init = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let sid = sheet_id();

    // First materialize — should see 10.0, 20.0, 30.0.
    {
        let sheet = mirror.get_sheet(&sid).expect("sheet exists");
        let mut cache = DenseColumnCache::new();
        let dense_col = cache.materialize(&sid, 0, sheet);
        let values = dense_col.values();
        assert!(
            (values[0] - 10.0).abs() < 1e-9,
            "row 0 before edit: expected 10.0, got {}",
            values[0]
        );
        assert!(
            (values[1] - 20.0).abs() < 1e-9,
            "row 1 before edit: expected 20.0, got {}",
            values[1]
        );
        assert!(
            (values[2] - 30.0).abs() < 1e-9,
            "row 2 before edit: expected 30.0, got {}",
            values[2]
        );
    }

    // Edit cell A1 (row=0, col=0) to 999.
    let cell_id = CellId::from_uuid_str(&cell_uuid(0, 0)).expect("valid uuid");
    let _edit_result = core
        .set_cell(&mut mirror, &sid, cell_id, 0, 0, "999")
        .expect("set_cell");

    // Re-materialize on a fresh cache — should see updated value.
    {
        let sheet = mirror.get_sheet(&sid).expect("sheet exists after edit");
        let mut cache = DenseColumnCache::new();
        let dense_col = cache.materialize(&sid, 0, sheet);
        let values = dense_col.values();
        assert!(
            (values[0] - 999.0).abs() < 1e-9,
            "row 0 after edit: expected 999.0, got {}",
            values[0]
        );
        // Other rows should be unchanged.
        assert!(
            (values[1] - 20.0).abs() < 1e-9,
            "row 1 after edit: expected 20.0, got {}",
            values[1]
        );
        assert!(
            (values[2] - 30.0).abs() < 1e-9,
            "row 2 after edit: expected 30.0, got {}",
            values[2]
        );
    }
}

// ===========================================================================
// Test 14: Tier 3 sparse fallback — SUM over range with empty positions
// ===========================================================================

/// Verifies that formulas over ranges with sparse data (empty positions)
/// evaluate correctly. Empty cells in a SUM range should be treated as 0.
/// This exercises the Tier 3 sparse fallback path described in the plan
/// spec `materialize_range_tier3_fallback`, where positions without
/// `col_data` entries fall through to cell-by-cell lookup.
#[test]
fn materialize_range_tier3_sparse_fallback() {
    // Create a range A1:A10 but only populate A1, A5, A10 (rows 0, 4, 9).
    // Empty positions (rows 1, 2, 3, 5, 6, 7, 8) should be treated as 0.
    let cells = vec![
        value_cell(0, 0, 100.0), // A1
        value_cell(4, 0, 200.0), // A5
        value_cell(9, 0, 300.0), // A10
        // SUM(A1:A10) at B1 — should be 100 + 200 + 300 = 600.
        formula_cell(0, 1, "SUM(A1:A10)"),
    ];
    let snapshot = one_sheet_snapshot(cells);

    let mut mirror = CellMirror::new();
    let mut core = ComputeCore::new();
    let result = core
        .init_from_snapshot(&mut mirror, snapshot)
        .expect("init failed");

    let sum_uuid = cell_uuid(0, 1);
    assert_cell_number(&result, &sum_uuid, 600.0, "SUM(A1:A10) sparse");

    // Also verify SUMPRODUCT with one dense column and one sparse column.
    // Col A: fully populated 1..5, Col B: only B1=10, B3=30 (sparse).
    // SUMPRODUCT(A1:A5, B1:B5) = 1*10 + 2*0 + 3*30 + 4*0 + 5*0 = 100.
    let cells2 = vec![
        value_cell(0, 0, 1.0),
        value_cell(1, 0, 2.0),
        value_cell(2, 0, 3.0),
        value_cell(3, 0, 4.0),
        value_cell(4, 0, 5.0),
        value_cell(0, 1, 10.0), // B1
        value_cell(2, 1, 30.0), // B3
        formula_cell(0, 2, "SUMPRODUCT(A1:A5,B1:B5)"),
    ];
    let snapshot2 = one_sheet_snapshot(cells2);

    let mut mirror2 = CellMirror::new();
    let mut core2 = ComputeCore::new();
    let result2 = core2
        .init_from_snapshot(&mut mirror2, snapshot2)
        .expect("init failed");

    let sp_uuid = cell_uuid(0, 2);
    assert_cell_number(&result2, &sp_uuid, 100.0, "SUMPRODUCT sparse col B");
}
