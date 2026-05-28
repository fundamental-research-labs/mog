use super::fixtures::{assert_invariants, make_grid};
use crate::identity::GridIndex;
use cell_types::{
    AxisIdentityRun, AxisIdentitySeed, AxisIdentityStore, AxisRunId, CellId, ColId, IdAllocator,
    RowId, SheetId,
};
use std::collections::HashSet;
use std::sync::Arc;

// -----------------------------------------------------------------------
// 13. Bidirectional invariant after mutations
// -----------------------------------------------------------------------

#[test]
fn invariant_after_mixed_mutations() {
    let mut grid = make_grid(5, 5);
    grid.ensure_cell_id(0, 0);
    grid.ensure_cell_id(1, 1);
    grid.ensure_cell_id(2, 2);
    grid.ensure_cell_id(3, 3);
    grid.ensure_cell_id(4, 4);
    assert_invariants(&grid);

    grid.insert_rows(2, 3);
    assert_invariants(&grid);

    grid.delete_rows(0, 2);
    assert_invariants(&grid);

    grid.insert_cols(1, 2);
    assert_invariants(&grid);

    grid.delete_cols(3, 1);
    assert_invariants(&grid);

    grid.sort_rows(&[(0, 1), (1, 0)]);
    assert_invariants(&grid);
}
