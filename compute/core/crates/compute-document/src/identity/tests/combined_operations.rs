use super::fixtures::{assert_invariants, make_grid};
use crate::identity::GridIndex;
use cell_types::{
    AxisIdentityRun, AxisIdentitySeed, AxisIdentityStore, AxisRunId, CellId, ColId, IdAllocator,
    RowId, SheetId,
};
use std::collections::HashSet;
use std::sync::Arc;

// -----------------------------------------------------------------------
// 14. Combined operations
// -----------------------------------------------------------------------

#[test]
fn insert_then_delete_restores_row_count() {
    let mut grid = make_grid(5, 3);
    grid.insert_rows(2, 3);
    assert_eq!(grid.row_count(), 8);
    grid.delete_rows(2, 3);
    assert_eq!(grid.row_count(), 5);
    assert_invariants(&grid);
}

#[test]
fn delete_then_insert_at_same_spot() {
    let mut grid = make_grid(5, 3);
    let cell = grid.ensure_cell_id(4, 2);

    grid.delete_rows(1, 2); // removes rows 1,2 -> row count 3, cell shifts to row 2
    assert_eq!(grid.cell_position(&cell), Some((2, 2)));

    grid.insert_rows(1, 2); // re-insert 2 rows -> row count 5, cell shifts to row 4
    assert_eq!(grid.cell_position(&cell), Some((4, 2)));
    assert_eq!(grid.row_count(), 5);
    assert_invariants(&grid);
}

#[test]
fn multiple_sequential_inserts() {
    let mut grid = make_grid(2, 2);
    let cell = grid.ensure_cell_id(0, 0);

    grid.insert_rows(0, 1); // cell moves to row 1
    grid.insert_rows(0, 1); // cell moves to row 2
    grid.insert_rows(0, 1); // cell moves to row 3

    assert_eq!(grid.cell_position(&cell), Some((3, 0)));
    assert_eq!(grid.row_count(), 5);
    assert_invariants(&grid);
}

#[test]
fn insert_cols_then_delete_cols() {
    let mut grid = make_grid(3, 3);
    let cell = grid.ensure_cell_id(1, 2);

    grid.insert_cols(0, 2); // cell shifts right to col 4
    assert_eq!(grid.cell_position(&cell), Some((1, 4)));

    grid.delete_cols(0, 2); // cell shifts left back to col 2
    assert_eq!(grid.cell_position(&cell), Some((1, 2)));
    assert_eq!(grid.col_count(), 3);
    assert_invariants(&grid);
}

#[test]
fn delete_row_with_multiple_cells_in_same_row() {
    let mut grid = make_grid(3, 5);
    let c0 = grid.ensure_cell_id(1, 0);
    let c1 = grid.ensure_cell_id(1, 1);
    let c2 = grid.ensure_cell_id(1, 2);

    let deleted = grid.delete_rows(1, 1);
    let deleted_set: HashSet<CellId> = deleted.into_iter().collect();
    assert!(deleted_set.contains(&c0));
    assert!(deleted_set.contains(&c1));
    assert!(deleted_set.contains(&c2));
    assert_eq!(grid.cell_count(), 0);
    assert_invariants(&grid);
}

#[test]
fn sort_rows_with_cells_in_multiple_cols() {
    let mut grid = make_grid(3, 3);
    let c00 = grid.ensure_cell_id(0, 0);
    let c01 = grid.ensure_cell_id(0, 1);
    let c10 = grid.ensure_cell_id(1, 0);
    let c11 = grid.ensure_cell_id(1, 1);

    grid.sort_rows(&[(0, 1), (1, 0)]);

    // Row 0 cells -> row 1, row 1 cells -> row 0
    assert_eq!(grid.cell_position(&c00), Some((1, 0)));
    assert_eq!(grid.cell_position(&c01), Some((1, 1)));
    assert_eq!(grid.cell_position(&c10), Some((0, 0)));
    assert_eq!(grid.cell_position(&c11), Some((0, 1)));
    assert_invariants(&grid);
}

#[test]
fn reorder_row_ids_simple_swap() {
    let mut grid = make_grid(3, 1);
    let r0 = grid.row_id(0).unwrap();
    let r2 = grid.row_id(2).unwrap();

    grid.reorder_row_ids(&[(0, 2), (2, 0)]);

    assert_eq!(grid.row_id(0), Some(r2));
    assert_eq!(grid.row_id(2), Some(r0));
    assert_eq!(grid.row_index(&r0), Some(2));
    assert_eq!(grid.row_index(&r2), Some(0));
}

#[test]
fn reorder_row_ids_three_way_rotation() {
    let mut grid = make_grid(4, 1);
    let r0 = grid.row_id(0).unwrap();
    let r1 = grid.row_id(1).unwrap();
    let r2 = grid.row_id(2).unwrap();
    let r3 = grid.row_id(3).unwrap();

    grid.reorder_row_ids(&[(0, 1), (1, 2), (2, 0)]);

    assert_eq!(grid.row_id(0), Some(r2));
    assert_eq!(grid.row_id(1), Some(r0));
    assert_eq!(grid.row_id(2), Some(r1));
    assert_eq!(grid.row_id(3), Some(r3));
}

#[test]
fn reorder_row_ids_empty_is_noop() {
    let mut grid = make_grid(3, 1);
    let r0 = grid.row_id(0).unwrap();
    let r1 = grid.row_id(1).unwrap();
    let r2 = grid.row_id(2).unwrap();

    grid.reorder_row_ids(&[]);

    assert_eq!(grid.row_id(0), Some(r0));
    assert_eq!(grid.row_id(1), Some(r1));
    assert_eq!(grid.row_id(2), Some(r2));
}

#[test]
fn insert_rows_between_cells_preserves_relative_order() {
    let mut grid = make_grid(4, 1);
    let c0 = grid.ensure_cell_id(0, 0);
    let c1 = grid.ensure_cell_id(1, 0);
    let c2 = grid.ensure_cell_id(2, 0);
    let c3 = grid.ensure_cell_id(3, 0);

    grid.insert_rows(2, 5);

    // Cells before insertion point unchanged
    assert_eq!(grid.cell_position(&c0), Some((0, 0)));
    assert_eq!(grid.cell_position(&c1), Some((1, 0)));
    // Cells at or after insertion point shifted down by 5
    assert_eq!(grid.cell_position(&c2), Some((7, 0)));
    assert_eq!(grid.cell_position(&c3), Some((8, 0)));
    assert_invariants(&grid);
}
