use super::fixtures::{assert_invariants, make_grid};
use crate::identity::GridIndex;
use cell_types::{
    AxisIdentityRun, AxisIdentitySeed, AxisIdentityStore, AxisRunId, CellId, ColId, IdAllocator,
    RowId, SheetId,
};
use std::collections::HashSet;
use std::sync::Arc;

// -----------------------------------------------------------------------
// 3. Register cell
// -----------------------------------------------------------------------

#[test]
fn register_cell_basic() {
    let mut grid = make_grid(3, 3);
    let alloc = Arc::new(IdAllocator::with_seed(5000));
    let ext_id = alloc.next_cell_id();
    grid.register_cell(ext_id, 1, 1);
    assert_eq!(grid.cell_id_at(1, 1), Some(ext_id));
    assert_eq!(grid.cell_position(&ext_id), Some((1, 1)));
    assert_invariants(&grid);
}

#[test]
fn register_cell_replaces_old_cell_at_same_position() {
    let mut grid = make_grid(3, 3);
    let old_id = grid.ensure_cell_id(1, 1);
    let alloc = Arc::new(IdAllocator::with_seed(5000));
    let new_id = alloc.next_cell_id();
    grid.register_cell(new_id, 1, 1);

    assert_eq!(grid.cell_id_at(1, 1), Some(new_id));
    assert_eq!(grid.cell_position(&new_id), Some((1, 1)));
    // Old cell should be cleaned up from reverse map
    assert_eq!(grid.cell_position(&old_id), None);
    assert_eq!(grid.cell_count(), 1);
    assert_invariants(&grid);
}

#[test]
fn register_cell_moves_existing_cell_to_new_position() {
    let mut grid = make_grid(3, 3);
    let id = grid.ensure_cell_id(0, 0);
    grid.register_cell(id, 2, 2);

    assert_eq!(grid.cell_position(&id), Some((2, 2)));
    assert_eq!(grid.cell_id_at(2, 2), Some(id));
    // Old position should be cleaned up
    assert_eq!(grid.cell_id_at(0, 0), None);
    assert_eq!(grid.cell_count(), 1);
    assert_invariants(&grid);
}

#[test]
fn register_cell_same_position_is_noop() {
    let mut grid = make_grid(3, 3);
    let id = grid.ensure_cell_id(1, 1);
    grid.register_cell(id, 1, 1);
    assert_eq!(grid.cell_id_at(1, 1), Some(id));
    assert_eq!(grid.cell_count(), 1);
    assert_invariants(&grid);
}
