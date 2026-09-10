use super::fixtures::{assert_invariants, make_grid};
use cell_types::RowId;
use std::collections::HashSet;

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
fn delete_rows_removes_deleted_row_ids() {
    let mut grid = make_grid(4, 2);
    let rid1 = grid.row_id(1).unwrap();
    let rid2 = grid.row_id(2).unwrap();

    grid.delete_rows(1, 2);

    assert_eq!(grid.row_index(&rid1), None);
    assert_eq!(grid.row_index(&rid2), None);
    assert_invariants(&grid);
}
