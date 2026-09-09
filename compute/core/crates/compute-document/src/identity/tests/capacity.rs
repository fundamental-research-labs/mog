use super::fixtures::{assert_invariants, make_grid};

#[test]
fn growth_fills_intermediate_axes_and_retains_original_identities() {
    let mut grid = make_grid(1, 1);
    let row = grid.row_id(0).unwrap();
    let col = grid.col_id(0).unwrap();
    grid.ensure_capacity(5, 7);
    assert_eq!(grid.row_count(), 6);
    assert_eq!(grid.col_count(), 8);
    assert_eq!(grid.row_id(0), Some(row));
    assert_eq!(grid.col_id(0), Some(col));
    assert_invariants(&grid);
}
