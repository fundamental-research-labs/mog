use crate::helpers::{assert_col_position_invariant, assert_row_position_invariant};
use compute_layout_index::LayoutIndex;
use domain_types::units::Pixels;

#[test]
fn fp_from_sparse_custom_heights_and_widths() {
    let li = LayoutIndex::from_sparse(
        5,
        5,
        Pixels(20.0),
        Pixels(64.0),
        vec![(0, Pixels(10.0)), (4, Pixels(50.0))],
        vec![(0, Pixels(30.0)), (4, Pixels(100.0))],
        vec![],
        vec![],
    );
    assert_eq!(li.get_row_height(0), Pixels(10.0));
    assert_eq!(li.get_row_height(4), Pixels(50.0));
    assert_eq!(li.get_row_height(2), Pixels(20.0));
    assert_eq!(li.get_col_width(0), Pixels(30.0));
    assert_eq!(li.get_col_width(4), Pixels(100.0));
    assert_eq!(li.get_col_width(2), Pixels(64.0));
    assert_row_position_invariant(&li);
    assert_col_position_invariant(&li);
}

#[test]
fn fp_from_sparse_hidden_rows_and_cols() {
    let li = LayoutIndex::from_sparse(
        5,
        5,
        Pixels(20.0),
        Pixels(64.0),
        vec![],
        vec![],
        vec![1, 3],
        vec![0, 4],
    );
    assert!(li.is_row_hidden(1));
    assert!(li.is_row_hidden(3));
    assert!(!li.is_row_hidden(0));
    assert!(li.is_col_hidden(0));
    assert!(li.is_col_hidden(4));
    assert!(!li.is_col_hidden(2));
    assert_row_position_invariant(&li);
    assert_col_position_invariant(&li);
}

#[test]
fn fp_from_sparse_hidden_overrides_custom() {
    let mut li = LayoutIndex::from_sparse(
        5,
        5,
        Pixels(20.0),
        Pixels(64.0),
        vec![],
        vec![(2, Pixels(200.0))],
        vec![],
        vec![2],
    );
    assert_eq!(li.get_col_width(2), Pixels(0.0));
    assert!(li.is_col_hidden(2));
    li.unhide_col(2);
    assert_eq!(li.get_col_width(2), Pixels(200.0));
    assert_col_position_invariant(&li);
}

#[test]
fn fp_zero_rows_zero_cols() {
    let li = LayoutIndex::with_defaults(0, 0, Pixels(20.0), Pixels(64.0));
    assert_eq!(li.row_count(), 0);
    assert_eq!(li.col_count(), 0);
    assert_eq!(li.total_row_size(), Pixels(0.0));
    assert_eq!(li.total_col_size(), Pixels(0.0));
    assert_eq!(li.get_row_position(0), Pixels(0.0));
    assert_eq!(li.get_col_position(0), Pixels(0.0));
    assert!(li.build_row_positions(0, 0).is_empty());
    assert!(li.build_col_positions(0, 0).is_empty());
    assert!(li.build_row_dimensions(0, 0).is_empty());
    assert!(li.build_col_dimensions(0, 0).is_empty());
}

#[test]
fn fp_single_row_single_col() {
    let li = LayoutIndex::with_defaults(1, 1, Pixels(20.0), Pixels(64.0));
    assert_eq!(li.row_count(), 1);
    assert_eq!(li.col_count(), 1);
    assert_eq!(li.get_row_position(0), Pixels(0.0));
    assert_eq!(li.get_row_position(1), Pixels(20.0));
    assert_eq!(li.get_col_position(0), Pixels(0.0));
    assert_eq!(li.get_col_position(1), Pixels(64.0));
    assert_eq!(li.get_row_height(0), Pixels(20.0));
    assert_eq!(li.get_col_width(0), Pixels(64.0));
    assert_eq!(li.total_row_size(), Pixels(20.0));
    assert_eq!(li.total_col_size(), Pixels(64.0));
    assert_eq!(li.get_row_at_pixel(Pixels(0.0)), 0);
    assert_eq!(li.get_col_at_pixel(Pixels(0.0)), 0);
    assert_row_position_invariant(&li);
    assert_col_position_invariant(&li);
}

#[test]
fn fp_all_rows_hidden() {
    let hidden_rows: Vec<usize> = (0..5).collect();
    let li = LayoutIndex::from_sparse(
        5,
        3,
        Pixels(20.0),
        Pixels(64.0),
        vec![],
        vec![],
        hidden_rows,
        vec![],
    );
    assert_eq!(li.total_row_size(), Pixels(0.0));
    for i in 0..5 {
        assert_eq!(li.get_row_height(i), Pixels(0.0));
        assert_eq!(li.get_row_position(i), Pixels(0.0));
    }
    assert_eq!(li.total_col_size(), Pixels(192.0));
    assert_col_position_invariant(&li);
}

#[test]
fn fp_all_cols_hidden() {
    let hidden_cols: Vec<usize> = (0..4).collect();
    let li = LayoutIndex::from_sparse(
        3,
        4,
        Pixels(20.0),
        Pixels(64.0),
        vec![],
        vec![],
        vec![],
        hidden_cols,
    );
    assert_eq!(li.total_col_size(), Pixels(0.0));
    for j in 0..4 {
        assert_eq!(li.get_col_width(j), Pixels(0.0));
        assert_eq!(li.get_col_position(j), Pixels(0.0));
    }
    assert_eq!(li.total_row_size(), Pixels(60.0));
    assert_row_position_invariant(&li);
}

#[test]
fn fp_very_large_custom_dimension() {
    let mut li = LayoutIndex::with_defaults(5, 5, Pixels(20.0), Pixels(64.0));
    li.set_row_height(2, Pixels(1_000_000.0));
    li.set_col_width(0, Pixels(1_000_000.0));
    assert_eq!(li.get_row_height(2), Pixels(1_000_000.0));
    assert_eq!(li.get_col_width(0), Pixels(1_000_000.0));
    assert_row_position_invariant(&li);
    assert_col_position_invariant(&li);
    assert_eq!(li.get_row_position(3), Pixels(1_000_040.0));
}

#[test]
fn fp_set_dimension_while_hidden_takes_effect_on_unhide() {
    let mut li = LayoutIndex::with_defaults(5, 5, Pixels(20.0), Pixels(64.0));
    li.hide_row(2);
    li.set_row_height(2, Pixels(80.0));
    assert_eq!(li.get_row_height(2), Pixels(0.0));
    li.unhide_row(2);
    assert_eq!(li.get_row_height(2), Pixels(80.0));
    assert_row_position_invariant(&li);
}
