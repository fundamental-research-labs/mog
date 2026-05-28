use super::fixtures::{assert_invariants, make_grid};
use crate::identity::GridIndex;
use cell_types::{
    AxisIdentityRun, AxisIdentitySeed, AxisIdentityStore, AxisRunId, CellId, ColId, IdAllocator,
    RowId, SheetId,
};
use std::collections::HashSet;
use std::sync::Arc;

// -----------------------------------------------------------------------
// 4. Insert rows
// -----------------------------------------------------------------------

#[test]
fn insert_rows_increases_row_count() {
    let mut grid = make_grid(3, 3);
    let new_ids = grid.insert_rows(1, 2);
    assert_eq!(grid.row_count(), 5);
    assert_eq!(new_ids.len(), 2);
    assert_invariants(&grid);
}

#[test]
fn insert_rows_new_ids_are_unique() {
    let mut grid = make_grid(3, 3);
    let original_ids: Vec<RowId> = (0..3).map(|i| grid.row_id(i).unwrap()).collect();
    let new_ids = grid.insert_rows(1, 2);

    let all_ids: HashSet<u128> = original_ids
        .iter()
        .chain(new_ids.iter())
        .map(|r| r.as_u128())
        .collect();
    assert_eq!(all_ids.len(), 5);
}

#[test]
fn insert_rows_shifts_cells_down() {
    let mut grid = make_grid(4, 3);
    let cell_a = grid.ensure_cell_id(0, 0); // above insertion - should stay
    let cell_b = grid.ensure_cell_id(2, 1); // at insertion point - should shift
    let cell_c = grid.ensure_cell_id(3, 2); // below insertion - should shift

    grid.insert_rows(2, 2); // insert 2 rows at index 2

    // cell_a at row 0 should be unchanged
    assert_eq!(grid.cell_position(&cell_a), Some((0, 0)));
    // cell_b was at row 2, should now be at row 4
    assert_eq!(grid.cell_position(&cell_b), Some((4, 1)));
    // cell_c was at row 3, should now be at row 5
    assert_eq!(grid.cell_position(&cell_c), Some((5, 2)));
    assert_invariants(&grid);
}

#[test]
fn insert_rows_preserves_cell_ids() {
    let mut grid = make_grid(3, 3);
    let id = grid.ensure_cell_id(1, 1);
    grid.insert_rows(0, 5);
    // The cell ID should be the same, just at a new position
    assert_eq!(grid.cell_position(&id), Some((6, 1)));
    assert_eq!(grid.cell_id_at(6, 1), Some(id));
    assert_invariants(&grid);
}

#[test]
fn insert_rows_existing_row_ids_shift() {
    let mut grid = make_grid(3, 3);
    let rid0 = grid.row_id(0).unwrap();
    let rid1 = grid.row_id(1).unwrap();
    let rid2 = grid.row_id(2).unwrap();

    grid.insert_rows(1, 2); // insert 2 rows at index 1

    // Row 0 stays at 0
    assert_eq!(grid.row_index(&rid0), Some(0));
    // Row 1 shifts to 3
    assert_eq!(grid.row_index(&rid1), Some(3));
    // Row 2 shifts to 4
    assert_eq!(grid.row_index(&rid2), Some(4));
    assert_invariants(&grid);
}

// -----------------------------------------------------------------------
// 5. Delete rows
// -----------------------------------------------------------------------

#[test]
fn delete_rows_decreases_row_count() {
    let mut grid = make_grid(5, 3);
    grid.delete_rows(1, 2);
    assert_eq!(grid.row_count(), 3);
    assert_invariants(&grid);
}

#[test]
fn delete_rows_returns_deleted_cell_ids() {
    let mut grid = make_grid(5, 3);
    let c1 = grid.ensure_cell_id(1, 0);
    let c2 = grid.ensure_cell_id(2, 1);
    grid.ensure_cell_id(3, 2); // should not be deleted

    let deleted = grid.delete_rows(1, 2);
    let deleted_set: HashSet<CellId> = deleted.into_iter().collect();
    assert!(deleted_set.contains(&c1));
    assert!(deleted_set.contains(&c2));
    assert_eq!(deleted_set.len(), 2);
}

#[test]
fn delete_rows_shifts_remaining_up() {
    let mut grid = make_grid(5, 3);
    let cell_above = grid.ensure_cell_id(0, 0);
    let cell_below = grid.ensure_cell_id(4, 2);

    grid.delete_rows(1, 3); // delete rows 1, 2, 3

    assert_eq!(grid.cell_position(&cell_above), Some((0, 0)));
    // row 4 shifts up by 3 to row 1
    assert_eq!(grid.cell_position(&cell_below), Some((1, 2)));
    assert_eq!(grid.row_count(), 2);
    assert_invariants(&grid);
}

#[test]
fn delete_rows_removes_deleted_row_ids() {
    let mut grid = make_grid(4, 2);
    let rid1 = grid.row_id(1).unwrap();
    let rid2 = grid.row_id(2).unwrap();

    grid.delete_rows(1, 2);

    assert_eq!(grid.row_index(&rid1), None);
    assert_eq!(grid.row_index(&rid2), None);
    assert_invariants(&grid);
}
