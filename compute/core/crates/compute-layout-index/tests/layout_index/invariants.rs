use crate::helpers::{assert_col_position_invariant, assert_row_position_invariant};
use compute_layout_index::LayoutIndex;
use domain_types::units::Pixels;

#[test]
fn fp_position_dimension_invariant_defaults() {
    let li = LayoutIndex::with_defaults(20, 15, Pixels(20.0), Pixels(64.0));
    assert_row_position_invariant(&li);
    assert_col_position_invariant(&li);
}

#[test]
fn fp_position_dimension_invariant_after_mutations() {
    let mut li = LayoutIndex::with_defaults(10, 10, Pixels(20.0), Pixels(64.0));
    li.set_row_height(0, Pixels(5.0));
    li.set_row_height(5, Pixels(100.0));
    li.hide_row(3);
    li.set_col_width(0, Pixels(10.0));
    li.set_col_width(9, Pixels(200.0));
    li.hide_col(7);
    assert_row_position_invariant(&li);
    assert_col_position_invariant(&li);
}

#[test]
fn fp_position_dimension_invariant_from_sparse() {
    let li = LayoutIndex::from_sparse(
        10,
        8,
        Pixels(20.0),
        Pixels(64.0),
        vec![(0, Pixels(5.0)), (3, Pixels(50.0)), (9, Pixels(100.0))],
        vec![(1, Pixels(30.0)), (7, Pixels(200.0))],
        vec![2, 6],
        vec![0, 5],
    );
    assert_row_position_invariant(&li);
    assert_col_position_invariant(&li);
}

#[test]
fn fp_total_row_size_equals_sum_of_heights() {
    let li = LayoutIndex::from_sparse(
        10,
        5,
        Pixels(20.0),
        Pixels(64.0),
        vec![(2, Pixels(50.0)), (7, Pixels(10.0))],
        vec![],
        vec![4],
        vec![],
    );
    let manual_sum: f64 = (0..10).map(|i| li.get_row_height(i).0).sum();
    assert!(
        (li.total_row_size().0 - manual_sum).abs() < 1e-9,
        "total_row_size {:?} != sum of heights {}",
        li.total_row_size(),
        manual_sum
    );
}

#[test]
fn fp_total_col_size_equals_sum_of_widths() {
    let li = LayoutIndex::from_sparse(
        5,
        10,
        Pixels(20.0),
        Pixels(64.0),
        vec![],
        vec![(0, Pixels(100.0)), (5, Pixels(30.0))],
        vec![],
        vec![3, 8],
    );
    let manual_sum: f64 = (0..10).map(|j| li.get_col_width(j).0).sum();
    assert!(
        (li.total_col_size().0 - manual_sum).abs() < 1e-9,
        "total_col_size {:?} != sum of widths {}",
        li.total_col_size(),
        manual_sum
    );
}

#[test]
fn fp_total_size_equals_last_position() {
    let li = LayoutIndex::from_sparse(
        10,
        8,
        Pixels(20.0),
        Pixels(64.0),
        vec![(3, Pixels(50.0))],
        vec![(2, Pixels(100.0))],
        vec![1],
        vec![5],
    );
    assert_eq!(li.total_row_size(), li.get_row_position(li.row_count()));
    assert_eq!(li.total_col_size(), li.get_col_position(li.col_count()));
}

#[test]
fn fp_multiple_mutations_position_invariant() {
    let mut li = LayoutIndex::with_defaults(15, 12, Pixels(20.0), Pixels(64.0));
    li.set_row_height(0, Pixels(1.0));
    assert_row_position_invariant(&li);
    li.hide_row(5);
    assert_row_position_invariant(&li);
    li.set_row_height(5, Pixels(100.0));
    assert_row_position_invariant(&li);
    li.unhide_row(5);
    assert_row_position_invariant(&li);
    li.set_row_height(14, Pixels(200.0));
    assert_row_position_invariant(&li);
    li.hide_row(0);
    assert_row_position_invariant(&li);
    li.set_col_width(0, Pixels(1.0));
    assert_col_position_invariant(&li);
    li.hide_col(11);
    assert_col_position_invariant(&li);
    li.set_col_width(6, Pixels(300.0));
    assert_col_position_invariant(&li);
}
