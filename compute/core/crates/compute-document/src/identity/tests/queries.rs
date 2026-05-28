use super::fixtures::{assert_invariants, make_grid};
use crate::identity::GridIndex;
use cell_types::{
    AxisIdentityRun, AxisIdentitySeed, AxisIdentityStore, AxisRunId, CellId, ColId, IdAllocator,
    RowId, SheetId,
};
use std::collections::HashSet;
use std::sync::Arc;

// -----------------------------------------------------------------------
// 12. Query methods
// -----------------------------------------------------------------------

#[test]
fn cells_in_range_inclusive_bounds() {
    let mut grid = make_grid(5, 5);
    let c00 = grid.ensure_cell_id(0, 0);
    let c11 = grid.ensure_cell_id(1, 1);
    let c22 = grid.ensure_cell_id(2, 2);
    let _c33 = grid.ensure_cell_id(3, 3);

    let result: HashSet<CellId> = grid
        .cells_in_range(0, 0, 2, 2)
        .map(|(id, _, _)| id)
        .collect();
    assert!(result.contains(&c00));
    assert!(result.contains(&c11));
    assert!(result.contains(&c22));
    assert_eq!(result.len(), 3);
}

#[test]
fn cells_in_range_single_cell() {
    let mut grid = make_grid(5, 5);
    let c = grid.ensure_cell_id(2, 3);

    let result: Vec<_> = grid.cells_in_range(2, 3, 2, 3).collect();
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].0, c);
}

#[test]
fn cells_in_range_empty_when_no_cells() {
    let grid = make_grid(5, 5);
    let result: Vec<_> = grid.cells_in_range(0, 0, 4, 4).collect();
    assert!(result.is_empty());
}

#[test]
fn cells_at_or_after_row() {
    let mut grid = make_grid(5, 3);
    let _c0 = grid.ensure_cell_id(0, 0);
    let c2 = grid.ensure_cell_id(2, 1);
    let c4 = grid.ensure_cell_id(4, 2);

    let result: HashSet<CellId> = grid
        .cells_at_or_after_row(2)
        .into_iter()
        .map(|(id, _, _)| id)
        .collect();
    assert!(result.contains(&c2));
    assert!(result.contains(&c4));
    assert_eq!(result.len(), 2);
}

#[test]
fn cells_at_or_after_col() {
    let mut grid = make_grid(3, 5);
    let _c0 = grid.ensure_cell_id(0, 0);
    let c3 = grid.ensure_cell_id(1, 3);
    let c4 = grid.ensure_cell_id(2, 4);

    let result: HashSet<CellId> = grid
        .cells_at_or_after_col(3)
        .into_iter()
        .map(|(id, _, _)| id)
        .collect();
    assert!(result.contains(&c3));
    assert!(result.contains(&c4));
    assert_eq!(result.len(), 2);
}

#[test]
fn cells_in_row_range_exclusive_end() {
    let mut grid = make_grid(5, 3);
    let c1 = grid.ensure_cell_id(1, 0);
    let c2 = grid.ensure_cell_id(2, 0);
    let _c3 = grid.ensure_cell_id(3, 0); // should NOT be included

    // [1, 1+2) = [1, 3)
    let result: HashSet<CellId> = grid
        .cells_in_row_range(1, 2)
        .into_iter()
        .map(|(id, _, _)| id)
        .collect();
    assert!(result.contains(&c1));
    assert!(result.contains(&c2));
    assert_eq!(result.len(), 2);
}

#[test]
fn cells_in_col_range_exclusive_end() {
    let mut grid = make_grid(3, 5);
    let c1 = grid.ensure_cell_id(0, 1);
    let c2 = grid.ensure_cell_id(0, 2);
    let _c3 = grid.ensure_cell_id(0, 3); // should NOT be included

    let result: HashSet<CellId> = grid
        .cells_in_col_range(1, 2)
        .into_iter()
        .map(|(id, _, _)| id)
        .collect();
    assert!(result.contains(&c1));
    assert!(result.contains(&c2));
    assert_eq!(result.len(), 2);
}
