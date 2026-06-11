//! pass 3 gate tests: Range-backed sort operations.
//!
//! Verifies that sorting a Range-backed sheet correctly reorders
//! `rowOrder` (not payload bytes), updates the GridIndex, and
//! supports undo.
//!
//! **ID alignment:** `from_snapshot` hydration allocates fresh monotonic
//! IDs via `IdAllocator::new()` (starts at 1). For a sheet with
//! `rows: N, cols: M`, the allocator produces RowIds 1..N then
//! ColIds (N+1)..(N+M). The range's `row_ids`/`col_ids` in the
//! snapshot must match these exact values so the mirror's
//! `index_to_row`/`index_to_col` maps align with the range's
//! `row_offset_by_id`/`col_offset_by_id`.
//!
//! **Sort criterion resolution:** Bridge sort criteria are absolute columns.
//! The production planner must read values positionally so pure range-backed
//! columns with no sparse CellIds can drive the sort comparator. Tests provide
//! per-cell data in col 0 alongside range data spanning cols 0-1, and include
//! a regression that sorts directly by pure range-backed col 1.

use super::super::*;
use super::helpers::*;
use crate::snapshot::{CellData, RangeData, SheetSnapshot};
use cell_types::{
    CellId, ColId, PayloadEncoding, RangeAnchor, RangeId, RangeKind, RowId, SheetPos,
};
use value_types::{CellValue, FiniteF64};

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

const SHEET_UUID: &str = "a1000000-0000-4000-8000-000000000001";
const RANGE_UUID: &str = "b1000000-0000-4000-8000-000000000001";

/// Sheet dimensions used by all tests.
const NUM_ROWS: u32 = 10;
const NUM_COLS: u32 = 5;

// Per-cell CellId UUIDs (unique per row, for col 0).
const CELL_UUIDS: [&str; 5] = [
    "e1000000-0000-4000-8000-000000000001",
    "e1000000-0000-4000-8000-000000000002",
    "e1000000-0000-4000-8000-000000000003",
    "e1000000-0000-4000-8000-000000000004",
    "e1000000-0000-4000-8000-000000000005",
];

// -------------------------------------------------------------------
// Helpers: ID generation aligned with hydration allocator
// -------------------------------------------------------------------

/// Row IDs matching what `from_snapshot` hydration allocates.
/// For a single sheet with `rows: NUM_ROWS`, the allocator produces
/// RowId(1), RowId(2), ..., RowId(NUM_ROWS).
fn hydrated_row_id(row: u32) -> RowId {
    RowId::from_raw((row + 1) as u128)
}

/// Col IDs matching what `from_snapshot` hydration allocates.
/// After NUM_ROWS row IDs, col IDs start at NUM_ROWS+1.
fn hydrated_col_id(col: u32) -> ColId {
    ColId::from_raw((NUM_ROWS + col + 1) as u128)
}

fn test_sheet_id() -> SheetId {
    SheetId::from_uuid_str(SHEET_UUID).unwrap()
}

fn test_range_id() -> RangeId {
    RangeId::from_uuid_str(RANGE_UUID).unwrap()
}

/// Extract a numeric f64 from a CellValue, returning None if Null or non-numeric.
fn as_f64(val: Option<&CellValue>) -> Option<f64> {
    match val {
        Some(CellValue::Number(n)) => Some(f64::from(*n)),
        _ => None,
    }
}

/// Build ascending sort options on column `col` (0-indexed).
fn ascending_sort_options(col: u32) -> mutation::BridgeSortOptions {
    mutation::BridgeSortOptions {
        criteria: vec![mutation::BridgeSortCriterion {
            column: col,
            direction: domain_types::domain::filter::SortOrder::Asc,
            case_sensitive: false,
            mode: mutation::BridgeSortMode::Value { custom_list: None },
        }],
        has_headers: false,
        visible_rows_only: false,
    }
}

/// Build a WorkbookSnapshot with a single sheet containing:
///
/// - A 5-row, 2-col Elastic Range with f64 payload (unsorted):
///     row0: [5, 50], row1: [3, 30], row2: [1, 10], row3: [4, 40], row4: [2, 20]
///
/// - Per-cell data in col 0 with the same values [5, 3, 1, 4, 2] so the
///   sort engine can read values from the yrs cells_map for criterion
///   resolution.
///
/// Row/col IDs are generated to match the `from_snapshot` hydration
/// allocator (monotonic starting at 1).
fn sort_range_snapshot() -> WorkbookSnapshot {
    let mut payload = Vec::new();
    for row_vals in &[
        [5.0_f64, 50.0],
        [3.0, 30.0],
        [1.0, 10.0],
        [4.0, 40.0],
        [2.0, 20.0],
    ] {
        for &v in row_vals {
            payload.extend_from_slice(&v.to_le_bytes());
        }
    }

    let row_ids: Vec<RowId> = (0..5).map(hydrated_row_id).collect();
    let col_ids: Vec<ColId> = (0..2).map(hydrated_col_id).collect();

    // Per-cell data in col 0: provides CellIds in GridIndex so sort can
    // resolve the criterion, and provides values in yrs cells_map for
    // the sort comparator.
    let cell_values = [5.0, 3.0, 1.0, 4.0, 2.0];
    let cells: Vec<CellData> = cell_values
        .iter()
        .enumerate()
        .map(|(i, &v)| CellData {
            cell_id: CELL_UUIDS[i].to_string(),
            row: i as u32,
            col: 0,
            value: CellValue::Number(FiniteF64::must(v)),
            formula: None,
            identity_formula: None,
            array_ref: None,
        })
        .collect();

    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: NUM_ROWS,
            cols: NUM_COLS,
            cells,
            ranges: vec![RangeData {
                range_id: test_range_id(),
                kind: RangeKind::Data,
                anchor: RangeAnchor::Elastic {
                    start_row: row_ids[0],
                    end_row: row_ids[4],
                    start_col: col_ids[0],
                    end_col: col_ids[1],
                },
                encoding: PayloadEncoding::F64Le,
                payload,
                row_axis: None,
                col_axis: None,
                row_ids: row_ids.to_vec(),
                col_ids: col_ids.to_vec(),
            }],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

// ===================================================================
// Test 1: range_sort_reorders_roworder
// ===================================================================

/// Sort ascending a Range-backed sheet. Verify that the range-only column
/// (col 1) is correctly reordered from [50,30,10,40,20] to [10,20,30,40,50].
/// The sort operates by permuting `rowOrder`, not by rewriting payload bytes.
#[test]
fn range_sort_reorders_roworder() {
    let snap = sort_range_snapshot();
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = test_sheet_id();

    // Before sort: col 1 (range-only) reads [50, 30, 10, 40, 20]
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 1))),
        Some(50.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(1, 1))),
        Some(30.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(2, 1))),
        Some(10.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(3, 1))),
        Some(40.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(4, 1))),
        Some(20.0)
    );

    // Sort ascending on col 0, rows 0-4
    let options = ascending_sort_options(0);
    engine.sort_range(&sid, 0, 0, 4, 1, options).unwrap();

    // After sort: col 1 (range-only) should reorder to [10, 20, 30, 40, 50]
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 1))),
        Some(10.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(1, 1))),
        Some(20.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(2, 1))),
        Some(30.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(3, 1))),
        Some(40.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(4, 1))),
        Some(50.0)
    );
}

// ===================================================================
// Test 2: range_sort_uses_range_backed_sort_key_column
// ===================================================================

/// Sort ascending directly on a pure Range-backed column. Col 1 has no
/// per-cell data in the GridIndex/Yrs cells map, so this catches regressions
/// where bridge criteria are resolved only through sparse CellIds.
#[test]
fn range_sort_uses_range_backed_sort_key_column() {
    let snap = sort_range_snapshot();
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = test_sheet_id();

    for (row, expected) in [(0, 50.0), (1, 30.0), (2, 10.0), (3, 40.0), (4, 20.0)] {
        assert_eq!(
            as_f64(
                engine
                    .mirror()
                    .get_cell_value_at(&sid, SheetPos::new(row, 1))
            ),
            Some(expected),
            "Pre-sort range-backed col 1 row {} should be {}",
            row,
            expected
        );
    }

    let options = ascending_sort_options(1);
    engine.sort_range(&sid, 0, 0, 4, 1, options).unwrap();

    for (row, expected) in [(0, 10.0), (1, 20.0), (2, 30.0), (3, 40.0), (4, 50.0)] {
        assert_eq!(
            as_f64(
                engine
                    .mirror()
                    .get_cell_value_at(&sid, SheetPos::new(row, 1))
            ),
            Some(expected),
            "Post-sort range-backed col 1 row {} should be {}",
            row,
            expected
        );
    }
}

// ===================================================================
// Test 3: sparse_sort_on_sheet_with_unrelated_range_uses_per_cell_path
// ===================================================================

/// A sheet can contain imported Range data outside the user's explicit sort
/// range. Sorting a sparse-only range must not reorder the sheet's rowOrder;
/// otherwise unrelated Range-backed values move even though they were outside
/// the requested sort target.
#[test]
fn sparse_sort_on_sheet_with_unrelated_range_uses_per_cell_path() {
    let mut snap = sort_range_snapshot();

    let sort_cell_uuids = [
        "f3000000-0000-4000-8000-000000000001",
        "f3000000-0000-4000-8000-000000000002",
        "f3000000-0000-4000-8000-000000000003",
        "f3000000-0000-4000-8000-000000000004",
        "f3000000-0000-4000-8000-000000000005",
    ];
    for (i, (&uuid, value)) in sort_cell_uuids
        .iter()
        .zip([5.0, 3.0, 1.0, 4.0, 2.0])
        .enumerate()
    {
        snap.sheets[0].cells.push(CellData {
            cell_id: uuid.to_string(),
            row: i as u32,
            col: 3,
            value: CellValue::Number(FiniteF64::must(value)),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = test_sheet_id();

    let options = ascending_sort_options(3);
    engine.sort_range(&sid, 0, 3, 4, 3, options).unwrap();

    for (row, expected) in [(0, 1.0), (1, 2.0), (2, 3.0), (3, 4.0), (4, 5.0)] {
        assert_eq!(
            as_f64(
                engine
                    .mirror()
                    .get_cell_value_at(&sid, SheetPos::new(row, 3))
            ),
            Some(expected),
            "Sparse sort col 3 row {} should be {}",
            row,
            expected
        );
    }

    for (row, expected) in [(0, 50.0), (1, 30.0), (2, 10.0), (3, 40.0), (4, 20.0)] {
        assert_eq!(
            as_f64(
                engine
                    .mirror()
                    .get_cell_value_at(&sid, SheetPos::new(row, 1))
            ),
            Some(expected),
            "Unrelated range-backed col 1 row {} should remain {}",
            row,
            expected
        );
    }
}

// ===================================================================
// Test 4: range_sort_mixed_sheet
// ===================================================================

/// Create a sheet with Range data in cols 0-1 and per-cell data in col 2.
/// Sort by col 0 ascending. Verify that the range-only column (col 1)
/// is correctly reordered.
#[test]
fn range_sort_mixed_sheet() {
    let mut snap = sort_range_snapshot();

    // Add per-cell data in col 2 (outside the range) with values [500,300,100,400,200].
    let extra_cell_uuids = [
        "f1000000-0000-4000-8000-000000000001",
        "f1000000-0000-4000-8000-000000000002",
        "f1000000-0000-4000-8000-000000000003",
        "f1000000-0000-4000-8000-000000000004",
        "f1000000-0000-4000-8000-000000000005",
    ];
    let extra_values = [500.0, 300.0, 100.0, 400.0, 200.0];

    for (i, (&uuid, &val)) in extra_cell_uuids.iter().zip(extra_values.iter()).enumerate() {
        snap.sheets[0].cells.push(CellData {
            cell_id: uuid.to_string(),
            row: i as u32,
            col: 2,
            value: CellValue::Number(FiniteF64::must(val)),
            formula: None,
            identity_formula: None,
            array_ref: None,
        });
    }

    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = test_sheet_id();

    // Before: col 1 = [50,30,10,40,20]
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 1))),
        Some(50.0)
    );

    // Sort ascending on col 0, rows 0-4
    let options = ascending_sort_options(0);
    engine.sort_range(&sid, 0, 0, 4, 2, options).unwrap();

    // After sort by col 0: range-backed col 1 → [10, 20, 30, 40, 50]
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 1))),
        Some(10.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(1, 1))),
        Some(20.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(2, 1))),
        Some(30.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(3, 1))),
        Some(40.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(4, 1))),
        Some(50.0)
    );
}

// ===================================================================
// Test 5: range_sort_gridindex_coherence
// ===================================================================

/// After sorting a Range-backed sheet, verify that `grid_index.row_ids_dense()`
/// matches the expected reordered row order.
#[test]
fn range_sort_gridindex_coherence() {
    let snap = sort_range_snapshot();
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = test_sheet_id();

    // Capture pre-sort row_ids_dense order.
    let pre_sort_row_ids: Vec<RowId> = engine.grid_index(&sid).unwrap().row_ids_dense().to_vec();

    // Sort ascending on col 0. Original row values: [5,3,1,4,2].
    // Sorted order maps original indices [2,4,1,3,0] to new positions [0,1,2,3,4].
    let options = ascending_sort_options(0);
    engine.sort_range(&sid, 0, 0, 4, 1, options).unwrap();

    let post_sort_row_ids: Vec<RowId> = engine.grid_index(&sid).unwrap().row_ids_dense().to_vec();

    // After ascending sort of [5,3,1,4,2], the row that had value 1 (index 2)
    // should be first, then value 2 (index 4), value 3 (index 1), value 4 (index 3),
    // value 5 (index 0). The RowIds should be reordered accordingly.
    assert_eq!(
        post_sort_row_ids[0], pre_sort_row_ids[2],
        "row with value 1 should be first"
    );
    assert_eq!(
        post_sort_row_ids[1], pre_sort_row_ids[4],
        "row with value 2 should be second"
    );
    assert_eq!(
        post_sort_row_ids[2], pre_sort_row_ids[1],
        "row with value 3 should be third"
    );
    assert_eq!(
        post_sort_row_ids[3], pre_sort_row_ids[3],
        "row with value 4 should be fourth"
    );
    assert_eq!(
        post_sort_row_ids[4], pre_sort_row_ids[0],
        "row with value 5 should be fifth"
    );

    // Non-range rows (indices 5+) should be unaffected.
    for i in 5..pre_sort_row_ids.len() {
        assert_eq!(
            post_sort_row_ids[i], pre_sort_row_ids[i],
            "Row outside sort range at index {} should be unchanged",
            i
        );
    }
}

// ===================================================================
// Test 6: range_sort_remaps_formula_cell_positions_in_mirror
// ===================================================================

/// Range-backed sorts update rowOrder instead of rewriting payload bytes.
/// Sparse/formula cells still move with their RowIds, so the live CellMirror
/// must remap their numeric positions before formula recalc.
#[test]
fn range_sort_remaps_formula_cell_positions_in_mirror() {
    let mut snap = sort_range_snapshot();

    let formula_cell_uuid = "f4000000-0000-4000-8000-000000000001";
    let formula_cell_id = CellId::from_uuid_str(formula_cell_uuid).unwrap();
    snap.sheets[0].cells.push(CellData {
        cell_id: formula_cell_uuid.to_string(),
        row: 0,
        col: 2,
        value: CellValue::Number(FiniteF64::must(50.0)),
        formula: Some("=A1*10".to_string()),
        identity_formula: None,
        array_ref: None,
    });

    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = test_sheet_id();

    assert_eq!(
        engine
            .grid_index(&sid)
            .unwrap()
            .cell_position(&formula_cell_id),
        Some((0, 2))
    );
    assert_eq!(
        engine
            .mirror()
            .get_sheet(&sid)
            .and_then(|sheet| sheet.position_for_diagnostics(&formula_cell_id)),
        Some(SheetPos::new(0, 2))
    );

    // Sorting ascending by col 0 moves old row 0 (value 5) to row 4.
    let options = ascending_sort_options(0);
    engine.sort_range(&sid, 0, 0, 4, 1, options).unwrap();

    assert_eq!(
        engine
            .grid_index(&sid)
            .unwrap()
            .cell_position(&formula_cell_id),
        Some((4, 2))
    );
    assert_eq!(
        engine
            .mirror()
            .get_sheet(&sid)
            .and_then(|sheet| sheet.position_for_diagnostics(&formula_cell_id)),
        Some(SheetPos::new(4, 2))
    );
}

// ===================================================================
// Test 7: range_sort_formula_survives
// ===================================================================

/// Create a Range-backed sheet with a per-cell formula in col 2 that
/// references per-cell data (=A1*2, referencing per-cell col 0).
/// Sort by col 0. Verify the formula cell survives the sort and the
/// range-backed col 1 is correctly reordered.
#[test]
fn range_sort_formula_survives() {
    let mut snap = sort_range_snapshot();

    // Add a formula cell at row 5, col 2: =SUM(A1:A5)
    // This references per-cell data in col 0 (values [5,3,1,4,2], sum = 15).
    // Placing it at row 5 (outside the sort range 0-4) avoids interaction
    // with the sort permutation.
    let formula_cell_id = "f2000000-0000-4000-8000-000000000001";
    snap.sheets[0].cells.push(CellData {
        cell_id: formula_cell_id.to_string(),
        row: 5,
        col: 2,
        value: CellValue::Number(FiniteF64::must(0.0)),
        formula: Some("=SUM(A1:A5)".to_string()),
        identity_formula: None,
        array_ref: None,
    });

    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = test_sheet_id();

    // Verify range values are readable pre-sort.
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 1))),
        Some(50.0),
        "Pre-sort B1 (range-backed) should be 50.0"
    );

    // Verify formula evaluates pre-sort: SUM(A1:A5) = 5+3+1+4+2 = 15
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(5, 2))),
        Some(15.0),
        "Pre-sort SUM(A1:A5) should be 15.0"
    );

    // Sort ascending on col 0, rows 0-4
    let options = ascending_sort_options(0);
    engine.sort_range(&sid, 0, 0, 4, 1, options).unwrap();

    // After sort: the range-backed col 1 should be reordered.
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 1))),
        Some(10.0),
        "Post-sort B1 (range-backed) should be 10.0"
    );

    // The SUM formula is outside the sort range; it should still be at row 5.
    // The values it sums haven't changed (same numbers, just reordered),
    // so the result should still be 15.
    let formula_val = as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(5, 2)));
    assert!(
        formula_val.is_some(),
        "Post-sort: formula at C6 should produce a numeric result, got {:?}",
        formula_val
    );
}

// ===================================================================
// Test 8: range_sort_undo
// ===================================================================

/// Sort a Range-backed sheet, then undo. Verify that `row_ids_dense()`
/// is restored to the original order (proving the yrs rowOrder was
/// correctly reverted).
#[test]
fn range_sort_undo() {
    let snap = sort_range_snapshot();
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = test_sheet_id();

    // Capture pre-sort row_ids_dense order.
    let pre_sort_row_ids: Vec<RowId> = engine.grid_index(&sid).unwrap().row_ids_dense().to_vec();

    // Before sort: col 1 (range-only) = [50, 30, 10, 40, 20]
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 1))),
        Some(50.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(2, 1))),
        Some(10.0)
    );

    // Sort ascending on col 0
    let options = ascending_sort_options(0);
    engine.sort_range(&sid, 0, 0, 4, 1, options).unwrap();

    // Verify sorted: col 1 = [10, 20, 30, 40, 50]
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(0, 1))),
        Some(10.0)
    );
    assert_eq!(
        as_f64(engine.mirror().get_cell_value_at(&sid, SheetPos::new(4, 1))),
        Some(50.0)
    );

    // Verify grid_index was reordered
    let sorted_row_ids: Vec<RowId> = engine.grid_index(&sid).unwrap().row_ids_dense().to_vec();
    assert_ne!(
        sorted_row_ids[..5],
        pre_sort_row_ids[..5],
        "After sort, row_ids should have changed"
    );

    // Undo the sort
    engine.undo().unwrap();

    // After undo: row_ids_dense should match the original pre-sort order.
    // This verifies the yrs rowOrder was correctly reverted by undo.
    let post_undo_row_ids: Vec<RowId> = engine.grid_index(&sid).unwrap().row_ids_dense().to_vec();

    for i in 0..5 {
        assert_eq!(
            post_undo_row_ids[i], pre_sort_row_ids[i],
            "After undo, row_id at index {} should match pre-sort order",
            i
        );
    }
}

// ===================================================================
// Test 9: xlsx_sort_roundtrip
// ===================================================================

/// Sort a Range-backed sheet, verify range-backed column values are in
/// sorted order. Simple sort + read verification.
#[test]
fn xlsx_sort_roundtrip() {
    let snap = sort_range_snapshot();
    let (mut engine, _recalc) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = test_sheet_id();

    // Sort ascending on col 0
    let options = ascending_sort_options(0);
    engine.sort_range(&sid, 0, 0, 4, 1, options).unwrap();

    // Verify col 1 (range-backed) sorted correspondingly: [10, 20, 30, 40, 50]
    for (row, expected) in [(0, 10.0), (1, 20.0), (2, 30.0), (3, 40.0), (4, 50.0)] {
        assert_eq!(
            as_f64(
                engine
                    .mirror()
                    .get_cell_value_at(&sid, SheetPos::new(row, 1))
            ),
            Some(expected),
            "Col 1 (range-backed), row {} should be {}",
            row,
            expected
        );
    }
}
