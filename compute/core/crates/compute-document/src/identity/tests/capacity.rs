use super::fixtures::{assert_invariants, make_grid};
use crate::identity::GridIndex;
use cell_types::{
    AxisIdentityRun, AxisIdentitySeed, AxisIdentityStore, AxisRunId, CellId, ColId, IdAllocator,
    RowId, SheetId,
};
use std::collections::HashSet;
use std::sync::Arc;

// -----------------------------------------------------------------------
// 11. Auto-expansion
// -----------------------------------------------------------------------

#[test]
fn ensure_cell_id_beyond_bounds_grows_grid() {
    let mut grid = make_grid(2, 2);
    let id = grid.ensure_cell_id(5, 7);

    assert!(grid.row_count() >= 6);
    assert!(grid.col_count() >= 8);
    assert_eq!(grid.cell_position(&id), Some((5, 7)));
    assert_invariants(&grid);
}

#[test]
fn register_cell_beyond_bounds_grows_grid() {
    let mut grid = make_grid(1, 1);
    let alloc = Arc::new(IdAllocator::with_seed(9000));
    let ext_id = alloc.next_cell_id();
    grid.register_cell(ext_id, 10, 20);

    assert!(grid.row_count() >= 11);
    assert!(grid.col_count() >= 21);
    assert_eq!(grid.cell_id_at(10, 20), Some(ext_id));
    assert_invariants(&grid);
}

#[test]
fn auto_expansion_fills_intermediate_row_col_ids() {
    let mut grid = make_grid(1, 1);
    grid.ensure_cell_id(3, 4);

    // All intermediate indices should have valid IDs
    for r in 0..grid.row_count() {
        assert!(grid.row_id(r).is_some());
    }
    for c in 0..grid.col_count() {
        assert!(grid.col_id(c).is_some());
    }
    assert_invariants(&grid);
}
