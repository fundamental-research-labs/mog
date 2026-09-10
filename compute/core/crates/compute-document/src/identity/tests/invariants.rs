use super::fixtures::{assert_invariants, make_grid};

#[test]
fn invariant_after_mixed_mutations() {
    let mut grid = make_grid(5, 5);
    assert_invariants(&grid);

    grid.insert_rows(2, 3);
    assert_invariants(&grid);

    grid.delete_rows(0, 2);
    assert_invariants(&grid);

    grid.insert_cols(1, 2);
    assert_invariants(&grid);

    grid.delete_cols(3, 1);
    assert_invariants(&grid);

    grid.reorder_row_ids(&[(0, 1), (1, 0)]);
    assert_invariants(&grid);
}
