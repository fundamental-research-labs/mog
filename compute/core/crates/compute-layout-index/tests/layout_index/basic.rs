use compute_layout_index::{DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT, LayoutIndex};
use domain_types::units::Pixels;

#[test]
fn layout_index_default() {
    let li = LayoutIndex::with_defaults(100, 50, DEFAULT_ROW_HEIGHT, DEFAULT_COL_WIDTH);
    assert_eq!(li.get_row_position(0), Pixels(0.0));
    assert_eq!(li.get_row_position(1), DEFAULT_ROW_HEIGHT);
    assert_eq!(li.get_col_position(0), Pixels(0.0));
    assert_eq!(li.get_col_position(1), DEFAULT_COL_WIDTH);
    assert_eq!(li.get_row_height(0), DEFAULT_ROW_HEIGHT);
    assert_eq!(li.get_col_width(0), DEFAULT_COL_WIDTH);
}

#[test]
fn layout_index_from_sparse() {
    let li = LayoutIndex::from_sparse(
        100,
        50,
        DEFAULT_ROW_HEIGHT,
        DEFAULT_COL_WIDTH,
        vec![(5, Pixels(40.0))],
        vec![(2, Pixels(120.0))],
        vec![10],
        vec![],
    );
    assert_eq!(li.get_row_height(5), Pixels(40.0));
    assert_eq!(li.get_col_width(2), Pixels(120.0));
    assert!(li.is_row_hidden(10));
    assert_eq!(li.get_row_height(10), Pixels(0.0));
}

#[test]
fn layout_index_mutations() {
    let mut li = LayoutIndex::new(100, 50);
    li.set_row_height(5, Pixels(40.0));
    assert_eq!(li.get_row_height(5), Pixels(40.0));
    assert_eq!(
        li.get_row_position(6),
        DEFAULT_ROW_HEIGHT * 5.0 + Pixels(40.0)
    );

    li.hide_row(3);
    assert!(li.is_row_hidden(3));
    assert_eq!(li.get_row_height(3), Pixels(0.0));

    li.unhide_row(3);
    assert!(!li.is_row_hidden(3));
    assert_eq!(li.get_row_height(3), DEFAULT_ROW_HEIGHT);
}

#[test]
fn layout_index_inverse_queries() {
    let li = LayoutIndex::with_defaults(100, 50, DEFAULT_ROW_HEIGHT, DEFAULT_COL_WIDTH);
    assert_eq!(li.get_row_at_pixel(Pixels(0.0)), 0);
    assert_eq!(li.get_row_at_pixel(DEFAULT_ROW_HEIGHT), 1);
    assert_eq!(li.get_col_at_pixel(Pixels(0.0)), 0);
    assert_eq!(li.get_col_at_pixel(DEFAULT_COL_WIDTH), 1);
}

#[test]
fn build_row_positions_empty_range() {
    let li = LayoutIndex::with_defaults(10, 5, DEFAULT_ROW_HEIGHT, DEFAULT_COL_WIDTH);
    assert!(li.build_row_positions(5, 5).is_empty());
    assert!(li.build_row_positions(7, 3).is_empty());
    assert!(li.build_col_positions(2, 2).is_empty());
}

#[test]
fn build_row_positions_single_row_range() {
    let li = LayoutIndex::with_defaults(10, 5, Pixels(20.0), Pixels(64.0));
    let pos = li.build_row_positions(3, 4);
    assert_eq!(pos.len(), 2);
    assert_eq!(pos[0], 60.0);
    assert_eq!(pos[1], 80.0);
}

#[test]
fn fp_row_col_count() {
    let li = LayoutIndex::with_defaults(42, 17, Pixels(20.0), Pixels(64.0));
    assert_eq!(li.row_count(), 42);
    assert_eq!(li.col_count(), 17);
}

#[test]
fn fp_default_sizes_returned() {
    let li = LayoutIndex::with_defaults(10, 10, Pixels(25.0), Pixels(80.0));
    assert_eq!(li.default_row_height(), Pixels(25.0));
    assert_eq!(li.default_col_width(), Pixels(80.0));
}
