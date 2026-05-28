use super::fixtures::{assert_invariants, make_grid};
use crate::identity::GridIndex;
use cell_types::{
    AxisIdentityRun, AxisIdentitySeed, AxisIdentityStore, AxisRunId, CellId, ColId, IdAllocator,
    RowId, SheetId,
};
use std::collections::HashSet;
use std::sync::Arc;

// -----------------------------------------------------------------------
// 6. Insert cols
// -----------------------------------------------------------------------

#[test]
fn insert_cols_increases_col_count() {
    let mut grid = make_grid(3, 3);
    let new_ids = grid.insert_cols(1, 2);
    assert_eq!(grid.col_count(), 5);
    assert_eq!(new_ids.len(), 2);
    assert_invariants(&grid);
}

#[test]
fn insert_cols_shifts_cells_right() {
    let mut grid = make_grid(3, 4);
    let cell_left = grid.ensure_cell_id(0, 0);
    let cell_at = grid.ensure_cell_id(1, 2);
    let cell_right = grid.ensure_cell_id(2, 3);

    grid.insert_cols(2, 3);

    assert_eq!(grid.cell_position(&cell_left), Some((0, 0)));
    assert_eq!(grid.cell_position(&cell_at), Some((1, 5)));
    assert_eq!(grid.cell_position(&cell_right), Some((2, 6)));
    assert_invariants(&grid);
}

#[test]
fn insert_cols_existing_col_ids_shift() {
    let mut grid = make_grid(2, 3);
    let cid0 = grid.col_id(0).unwrap();
    let cid1 = grid.col_id(1).unwrap();
    let cid2 = grid.col_id(2).unwrap();

    grid.insert_cols(1, 2);

    assert_eq!(grid.col_index(&cid0), Some(0));
    assert_eq!(grid.col_index(&cid1), Some(3));
    assert_eq!(grid.col_index(&cid2), Some(4));
    assert_invariants(&grid);
}

// -----------------------------------------------------------------------
// 7. Delete cols
// -----------------------------------------------------------------------

#[test]
fn delete_cols_decreases_col_count() {
    let mut grid = make_grid(3, 5);
    grid.delete_cols(1, 2);
    assert_eq!(grid.col_count(), 3);
    assert_invariants(&grid);
}

#[test]
fn delete_cols_returns_deleted_cell_ids() {
    let mut grid = make_grid(3, 5);
    let c1 = grid.ensure_cell_id(0, 1);
    let c2 = grid.ensure_cell_id(1, 2);
    grid.ensure_cell_id(2, 3); // not deleted

    let deleted = grid.delete_cols(1, 2);
    let deleted_set: HashSet<CellId> = deleted.into_iter().collect();
    assert!(deleted_set.contains(&c1));
    assert!(deleted_set.contains(&c2));
    assert_eq!(deleted_set.len(), 2);
}

#[test]
fn delete_cols_shifts_remaining_left() {
    let mut grid = make_grid(3, 5);
    let cell_left = grid.ensure_cell_id(0, 0);
    let cell_right = grid.ensure_cell_id(1, 4);

    grid.delete_cols(1, 3);

    assert_eq!(grid.cell_position(&cell_left), Some((0, 0)));
    assert_eq!(grid.cell_position(&cell_right), Some((1, 1)));
    assert_eq!(grid.col_count(), 2);
    assert_invariants(&grid);
}
