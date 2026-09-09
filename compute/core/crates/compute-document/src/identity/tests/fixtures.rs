use crate::identity::GridIndex;
use cell_types::{IdAllocator, SheetId};
use std::sync::Arc;

pub(super) fn make_grid(rows: u32, cols: u32) -> GridIndex {
    let alloc = Arc::new(IdAllocator::new());
    GridIndex::new(SheetId::from_raw(1), rows, cols, alloc)
}

/// Assert the bidirectional mapping invariant holds for all rows and columns.
pub(super) fn assert_invariants(grid: &GridIndex) {
    // Row invariant: row_id(i) == Some(rid) iff row_index(rid) == Some(i)
    for i in 0..grid.row_count() {
        let rid = grid.row_id(i).expect("row_id should exist for valid index");
        assert_eq!(
            grid.row_index(&rid),
            Some(i),
            "row_index(row_id({i})) should be {i}"
        );
    }
    // Col invariant
    for i in 0..grid.col_count() {
        let cid = grid.col_id(i).expect("col_id should exist for valid index");
        assert_eq!(
            grid.col_index(&cid),
            Some(i),
            "col_index(col_id({i})) should be {i}"
        );
    }
}
