use super::fixtures::{assert_invariants, make_grid};
use crate::identity::GridIndex;
use cell_types::{
    AxisIdentityRun, AxisIdentitySeed, AxisIdentityStore, AxisRunId, CellId, ColId, IdAllocator,
    RowId, SheetId,
};
use std::collections::HashSet;
use std::sync::Arc;

// -----------------------------------------------------------------------
// 10. Sort rows
// -----------------------------------------------------------------------

#[test]
fn sort_rows_simple_swap() {
    let mut grid = make_grid(3, 2);
    let rid0 = grid.row_id(0).unwrap();
    let rid2 = grid.row_id(2).unwrap();
    let cell_a = grid.ensure_cell_id(0, 0);
    let cell_b = grid.ensure_cell_id(2, 1);

    grid.sort_rows(&[(0, 2), (2, 0)]);

    // RowIds should remain unchanged (Yrs rowOrder is authoritative)
    assert_eq!(grid.row_id(0), Some(rid0));
    assert_eq!(grid.row_id(2), Some(rid2));
    // Cell positions should follow the permutation
    assert_eq!(grid.cell_position(&cell_a), Some((2, 0)));
    assert_eq!(grid.cell_position(&cell_b), Some((0, 1)));
    assert_invariants(&grid);
}

#[test]
fn sort_rows_identity_permutation() {
    let mut grid = make_grid(3, 2);
    let rid0 = grid.row_id(0).unwrap();
    let rid1 = grid.row_id(1).unwrap();
    let rid2 = grid.row_id(2).unwrap();
    let cell = grid.ensure_cell_id(1, 0);

    grid.sort_rows(&[(0, 0), (1, 1), (2, 2)]);

    assert_eq!(grid.row_id(0), Some(rid0));
    assert_eq!(grid.row_id(1), Some(rid1));
    assert_eq!(grid.row_id(2), Some(rid2));
    assert_eq!(grid.cell_position(&cell), Some((1, 0)));
    assert_invariants(&grid);
}

#[test]
fn sort_rows_three_way_rotation() {
    let mut grid = make_grid(4, 2);
    let rid0 = grid.row_id(0).unwrap();
    let rid1 = grid.row_id(1).unwrap();
    let rid2 = grid.row_id(2).unwrap();
    let rid3 = grid.row_id(3).unwrap();
    let c0 = grid.ensure_cell_id(0, 0);
    let c1 = grid.ensure_cell_id(1, 0);
    let c2 = grid.ensure_cell_id(2, 0);

    // Rotate rows 0->1, 1->2, 2->0. Row 3 is not in the permutation.
    grid.sort_rows(&[(0, 1), (1, 2), (2, 0)]);

    // RowIds should remain unchanged (Yrs rowOrder is authoritative)
    assert_eq!(grid.row_id(0), Some(rid0));
    assert_eq!(grid.row_id(1), Some(rid1));
    assert_eq!(grid.row_id(2), Some(rid2));
    assert_eq!(grid.row_id(3), Some(rid3)); // untouched

    assert_eq!(grid.cell_position(&c0), Some((1, 0)));
    assert_eq!(grid.cell_position(&c1), Some((2, 0)));
    assert_eq!(grid.cell_position(&c2), Some((0, 0)));
    assert_invariants(&grid);
}

#[test]
fn sort_rows_empty_permutation_is_noop() {
    let mut grid = make_grid(3, 2);
    let rid0 = grid.row_id(0).unwrap();
    grid.sort_rows(&[]);
    assert_eq!(grid.row_id(0), Some(rid0));
    assert_invariants(&grid);
}
