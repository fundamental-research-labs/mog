use super::fixtures::{assert_invariants, make_grid};
use crate::identity::GridIndex;
use cell_types::{
    AxisIdentityRun, AxisIdentitySeed, AxisIdentityStore, AxisRunId, CellId, ColId, IdAllocator,
    RowId, SheetId,
};
use std::collections::HashSet;
use std::sync::Arc;

// -----------------------------------------------------------------------
// 8. Insert at boundary
// -----------------------------------------------------------------------

#[test]
fn insert_rows_at_zero() {
    let mut grid = make_grid(3, 2);
    let rid_original_0 = grid.row_id(0).unwrap();
    let cell = grid.ensure_cell_id(0, 0);

    grid.insert_rows(0, 2);

    assert_eq!(grid.row_count(), 5);
    assert_eq!(grid.row_index(&rid_original_0), Some(2));
    assert_eq!(grid.cell_position(&cell), Some((2, 0)));
    assert_invariants(&grid);
}

#[test]
fn insert_rows_at_end() {
    let mut grid = make_grid(3, 2);
    let cell = grid.ensure_cell_id(2, 1);

    grid.insert_rows(3, 2);

    assert_eq!(grid.row_count(), 5);
    // Cell at row 2 should not move
    assert_eq!(grid.cell_position(&cell), Some((2, 1)));
    assert_invariants(&grid);
}

#[test]
fn insert_rows_beyond_bounds_clamps() {
    let mut grid = make_grid(3, 2);
    // at=100 should clamp to row_count()=3 (i.e., insert at end)
    grid.insert_rows(100, 2);
    assert_eq!(grid.row_count(), 5);
    assert_invariants(&grid);
}

#[test]
fn insert_cols_at_zero() {
    let mut grid = make_grid(2, 3);
    let cid0 = grid.col_id(0).unwrap();
    let cell = grid.ensure_cell_id(0, 0);

    grid.insert_cols(0, 2);

    assert_eq!(grid.col_count(), 5);
    assert_eq!(grid.col_index(&cid0), Some(2));
    assert_eq!(grid.cell_position(&cell), Some((0, 2)));
    assert_invariants(&grid);
}

#[test]
fn insert_cols_beyond_bounds_clamps() {
    let mut grid = make_grid(2, 3);
    grid.insert_cols(100, 2);
    assert_eq!(grid.col_count(), 5);
    assert_invariants(&grid);
}

// -----------------------------------------------------------------------
// 9. Delete at boundary
// -----------------------------------------------------------------------

#[test]
fn delete_rows_at_zero() {
    let mut grid = make_grid(5, 2);
    let cell = grid.ensure_cell_id(3, 0);

    grid.delete_rows(0, 2);

    assert_eq!(grid.row_count(), 3);
    assert_eq!(grid.cell_position(&cell), Some((1, 0)));
    assert_invariants(&grid);
}

#[test]
fn delete_rows_clamps_count() {
    let mut grid = make_grid(3, 2);
    grid.ensure_cell_id(0, 0);
    grid.ensure_cell_id(1, 0);
    grid.ensure_cell_id(2, 0);

    // Requesting to delete 10 rows starting at 1 should clamp to 2
    let deleted = grid.delete_rows(1, 10);
    assert_eq!(grid.row_count(), 1);
    assert_eq!(deleted.len(), 2); // cells at rows 1 and 2
    assert_invariants(&grid);
}

#[test]
fn delete_all_rows() {
    let mut grid = make_grid(3, 2);
    grid.ensure_cell_id(0, 0);
    grid.ensure_cell_id(1, 1);
    grid.ensure_cell_id(2, 0);

    let deleted = grid.delete_rows(0, 3);
    assert_eq!(grid.row_count(), 0);
    assert_eq!(deleted.len(), 3);
    assert_eq!(grid.cell_count(), 0);
    assert_invariants(&grid);
}

#[test]
fn delete_cols_clamps_count() {
    let mut grid = make_grid(2, 3);
    grid.ensure_cell_id(0, 1);
    grid.ensure_cell_id(0, 2);

    let deleted = grid.delete_cols(1, 100);
    assert_eq!(grid.col_count(), 1);
    assert_eq!(deleted.len(), 2);
    assert_invariants(&grid);
}
