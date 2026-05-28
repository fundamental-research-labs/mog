use super::fixtures::{assert_invariants, make_grid};
use crate::identity::GridIndex;
use cell_types::{
    AxisIdentityRun, AxisIdentitySeed, AxisIdentityStore, AxisRunId, CellId, ColId, IdAllocator,
    RowId, SheetId,
};
use std::collections::HashSet;
use std::sync::Arc;

// -----------------------------------------------------------------------
// 2. Cell lifecycle
// -----------------------------------------------------------------------

#[test]
fn cell_id_at_unmaterialized_returns_none() {
    let grid = make_grid(3, 3);
    assert_eq!(grid.cell_id_at(0, 0), None);
    assert_eq!(grid.cell_id_at(2, 2), None);
}

#[test]
fn ensure_cell_id_creates_and_returns_same() {
    let mut grid = make_grid(3, 3);
    let id1 = grid.ensure_cell_id(1, 1);
    let id2 = grid.ensure_cell_id(1, 1);
    assert_eq!(
        id1, id2,
        "ensure_cell_id should return same ID on repeat call"
    );
    assert_eq!(grid.cell_count(), 1);
}

#[test]
fn ensure_cell_id_bidirectional() {
    let mut grid = make_grid(3, 3);
    let id = grid.ensure_cell_id(1, 2);
    assert_eq!(grid.cell_id_at(1, 2), Some(id));
    assert_eq!(grid.cell_position(&id), Some((1, 2)));
    assert_invariants(&grid);
}

#[test]
fn remove_cell_cleans_both_maps() {
    let mut grid = make_grid(3, 3);
    let id = grid.ensure_cell_id(1, 1);
    grid.remove_cell(&id);
    assert_eq!(grid.cell_id_at(1, 1), None);
    assert_eq!(grid.cell_position(&id), None);
    assert_eq!(grid.cell_count(), 0);
    assert_invariants(&grid);
}

#[test]
fn remove_nonexistent_cell_is_noop() {
    let mut grid = make_grid(3, 3);
    let alloc = Arc::new(IdAllocator::with_seed(9999));
    let fake_id = alloc.next_cell_id();
    grid.remove_cell(&fake_id); // should not panic
    assert_eq!(grid.cell_count(), 0);
}

#[test]
fn multiple_cells_independent() {
    let mut grid = make_grid(3, 3);
    let a = grid.ensure_cell_id(0, 0);
    let b = grid.ensure_cell_id(2, 2);
    assert_ne!(a, b);
    assert_eq!(grid.cell_count(), 2);
    grid.remove_cell(&a);
    assert_eq!(grid.cell_count(), 1);
    assert_eq!(grid.cell_id_at(2, 2), Some(b));
    assert_invariants(&grid);
}
