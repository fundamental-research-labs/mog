use crate::helpers::assert_col_position_invariant;
use compute_layout_index::LayoutIndex;
use domain_types::units::Pixels;

#[test]
fn fp_col_set_get_width() {
    let mut li = LayoutIndex::with_defaults(10, 10, Pixels(20.0), Pixels(64.0));
    li.set_col_width(3, Pixels(120.0));
    assert_eq!(li.get_col_width(3), Pixels(120.0));
    assert_eq!(li.get_col_width(0), Pixels(64.0));
    assert_eq!(li.get_col_width(4), Pixels(64.0));
}

#[test]
fn fp_col_position_after_set_width() {
    let mut li = LayoutIndex::with_defaults(10, 10, Pixels(20.0), Pixels(64.0));
    li.set_col_width(2, Pixels(100.0));
    assert_eq!(li.get_col_position(3), Pixels(228.0));
    assert_col_position_invariant(&li);
}

#[test]
fn fp_col_hide_unhide_lifecycle() {
    let mut li = LayoutIndex::with_defaults(5, 5, Pixels(20.0), Pixels(64.0));
    assert!(!li.is_col_hidden(2));
    assert_eq!(li.get_col_width(2), Pixels(64.0));

    li.hide_col(2);
    assert!(li.is_col_hidden(2));
    assert_eq!(li.get_col_width(2), Pixels(0.0));

    li.unhide_col(2);
    assert!(!li.is_col_hidden(2));
    assert_eq!(li.get_col_width(2), Pixels(64.0));
}

#[test]
fn fp_col_hide_custom_then_unhide_restores_custom() {
    let mut li = LayoutIndex::with_defaults(5, 5, Pixels(20.0), Pixels(64.0));
    li.set_col_width(1, Pixels(200.0));
    li.hide_col(1);
    assert_eq!(li.get_col_width(1), Pixels(0.0));
    li.unhide_col(1);
    assert_eq!(li.get_col_width(1), Pixels(200.0));
}

#[test]
fn fp_row_mutations_dont_affect_cols() {
    let mut li = LayoutIndex::with_defaults(10, 10, Pixels(20.0), Pixels(64.0));
    let col_positions_before: Vec<Pixels> = (0..=10).map(|j| li.get_col_position(j)).collect();
    let col_widths_before: Vec<Pixels> = (0..10).map(|j| li.get_col_width(j)).collect();

    li.set_row_height(0, Pixels(100.0));
    li.set_row_height(5, Pixels(1.0));
    li.hide_row(3);

    for j in 0..=10 {
        assert_eq!(
            li.get_col_position(j),
            col_positions_before[j],
            "Col position {} changed after row mutation",
            j
        );
    }
    for j in 0..10 {
        assert_eq!(
            li.get_col_width(j),
            col_widths_before[j],
            "Col width {} changed after row mutation",
            j
        );
    }
}

#[test]
fn fp_col_mutations_dont_affect_rows() {
    let mut li = LayoutIndex::with_defaults(10, 10, Pixels(20.0), Pixels(64.0));
    let row_positions_before: Vec<Pixels> = (0..=10).map(|i| li.get_row_position(i)).collect();
    let row_heights_before: Vec<Pixels> = (0..10).map(|i| li.get_row_height(i)).collect();

    li.set_col_width(0, Pixels(500.0));
    li.set_col_width(9, Pixels(1.0));
    li.hide_col(5);

    for i in 0..=10 {
        assert_eq!(
            li.get_row_position(i),
            row_positions_before[i],
            "Row position {} changed after col mutation",
            i
        );
    }
    for i in 0..10 {
        assert_eq!(
            li.get_row_height(i),
            row_heights_before[i],
            "Row height {} changed after col mutation",
            i
        );
    }
}
