use super::fixtures::{assert_invariants, make_grid};

#[test]
fn insert_cols_increases_col_count() {
    let mut grid = make_grid(3, 3);
    let new_ids = grid.insert_cols(1, 2);
    assert_eq!(grid.col_count(), 5);
    assert_eq!(new_ids.len(), 2);
    assert_invariants(&grid);
}

#[test]
fn insert_cols_existing_col_ids_shift() {
    let mut grid = make_grid(2, 3);
    let cid0 = grid.col_id(0).unwrap();
    let cid1 = grid.col_id(1).unwrap();
    let cid2 = grid.col_id(2).unwrap();

    grid.insert_cols(1, 2);

    assert_eq!(grid.col_index(&cid0), Some(0));
    assert_eq!(grid.col_index(&cid1), Some(3));
    assert_eq!(grid.col_index(&cid2), Some(4));
    assert_invariants(&grid);
}

// -----------------------------------------------------------------------
// 7. Delete cols
// -----------------------------------------------------------------------

#[test]
fn delete_cols_decreases_col_count() {
    let mut grid = make_grid(3, 5);
    grid.delete_cols(1, 2);
    assert_eq!(grid.col_count(), 3);
    assert_invariants(&grid);
}
