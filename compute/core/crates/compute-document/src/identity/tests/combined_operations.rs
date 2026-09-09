use super::fixtures::{assert_invariants, make_grid};

#[test]
fn insert_then_delete_restores_row_count() {
    let mut grid = make_grid(5, 3);
    grid.insert_rows(2, 3);
    assert_eq!(grid.row_count(), 8);
    grid.delete_rows(2, 3);
    assert_eq!(grid.row_count(), 5);
    assert_invariants(&grid);
}

#[test]
fn reorder_row_ids_simple_swap() {
    let mut grid = make_grid(3, 1);
    let r0 = grid.row_id(0).unwrap();
    let r2 = grid.row_id(2).unwrap();

    grid.reorder_row_ids(&[(0, 2), (2, 0)]);

    assert_eq!(grid.row_id(0), Some(r2));
    assert_eq!(grid.row_id(2), Some(r0));
    assert_eq!(grid.row_index(&r0), Some(2));
    assert_eq!(grid.row_index(&r2), Some(0));
}

#[test]
fn reorder_row_ids_three_way_rotation() {
    let mut grid = make_grid(4, 1);
    let r0 = grid.row_id(0).unwrap();
    let r1 = grid.row_id(1).unwrap();
    let r2 = grid.row_id(2).unwrap();
    let r3 = grid.row_id(3).unwrap();

    grid.reorder_row_ids(&[(0, 1), (1, 2), (2, 0)]);

    assert_eq!(grid.row_id(0), Some(r2));
    assert_eq!(grid.row_id(1), Some(r0));
    assert_eq!(grid.row_id(2), Some(r1));
    assert_eq!(grid.row_id(3), Some(r3));
}

#[test]
fn reorder_row_ids_empty_is_noop() {
    let mut grid = make_grid(3, 1);
    let r0 = grid.row_id(0).unwrap();
    let r1 = grid.row_id(1).unwrap();
    let r2 = grid.row_id(2).unwrap();

    grid.reorder_row_ids(&[]);

    assert_eq!(grid.row_id(0), Some(r0));
    assert_eq!(grid.row_id(1), Some(r1));
    assert_eq!(grid.row_id(2), Some(r2));
}
