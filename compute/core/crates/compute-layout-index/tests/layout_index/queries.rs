use compute_layout_index::LayoutIndex;
use domain_types::units::Pixels;

#[test]
fn fp_col_get_col_at_pixel() {
    let li = LayoutIndex::with_defaults(10, 10, Pixels(20.0), Pixels(64.0));
    assert_eq!(li.get_col_at_pixel(Pixels(0.0)), 0);
    assert_eq!(li.get_col_at_pixel(Pixels(63.9)), 0);
    assert_eq!(li.get_col_at_pixel(Pixels(64.0)), 1);
    assert_eq!(li.get_col_at_pixel(Pixels(128.0)), 2);
}

#[test]
fn fp_inverse_row_default() {
    let li = LayoutIndex::with_defaults(50, 10, Pixels(20.0), Pixels(64.0));
    for i in 0..50 {
        let px = li.get_row_position(i);
        assert_eq!(
            li.get_row_at_pixel(px),
            i,
            "get_row_at_pixel(get_row_position({})) should be {}",
            i,
            i
        );
    }
}

#[test]
fn fp_inverse_col_default() {
    let li = LayoutIndex::with_defaults(10, 50, Pixels(20.0), Pixels(64.0));
    for j in 0..50 {
        let px = li.get_col_position(j);
        assert_eq!(
            li.get_col_at_pixel(px),
            j,
            "get_col_at_pixel(get_col_position({})) should be {}",
            j,
            j
        );
    }
}

#[test]
fn fp_inverse_row_with_custom_and_hidden() {
    let mut li = LayoutIndex::with_defaults(20, 5, Pixels(20.0), Pixels(64.0));
    li.set_row_height(3, Pixels(50.0));
    li.set_row_height(10, Pixels(5.0));
    li.hide_row(7);

    for i in 0..20 {
        if li.is_row_hidden(i) {
            continue;
        }
        let px = li.get_row_position(i);
        assert_eq!(
            li.get_row_at_pixel(px),
            i,
            "Inverse failed for row {}: pixel={:?}",
            i,
            px
        );
    }
}

#[test]
fn fp_inverse_col_with_custom_and_hidden() {
    let mut li = LayoutIndex::with_defaults(5, 20, Pixels(20.0), Pixels(64.0));
    li.set_col_width(2, Pixels(150.0));
    li.set_col_width(15, Pixels(10.0));
    li.hide_col(5);

    for j in 0..20 {
        if li.is_col_hidden(j) {
            continue;
        }
        let px = li.get_col_position(j);
        assert_eq!(
            li.get_col_at_pixel(px),
            j,
            "Inverse failed for col {}: pixel={:?}",
            j,
            px
        );
    }
}

#[test]
fn fp_visible_row_range_defaults() {
    let li = LayoutIndex::with_defaults(100, 10, Pixels(20.0), Pixels(64.0));
    let (start, end) = li.get_visible_row_range(Pixels(50.0), Pixels(90.0));
    assert_eq!(start, 2);
    assert_eq!(end, 5);
    for i in start..end {
        let pos = li.get_row_position(i);
        let dim = li.get_row_height(i);
        let entry_end = Pixels(pos.0 + dim.0);
        assert!(
            pos.0 <= 90.0 && entry_end.0 > 50.0,
            "Row {} at pos {:?} with height {:?} does not overlap [50, 90]",
            i,
            pos,
            dim
        );
    }
}

#[test]
fn fp_visible_col_range_defaults() {
    let li = LayoutIndex::with_defaults(10, 100, Pixels(20.0), Pixels(64.0));
    let (start, end) = li.get_visible_col_range(Pixels(100.0), Pixels(300.0));
    assert!(start <= 1, "start should be <= 1, got {}", start);
    assert!(end >= 5, "end should be >= 5, got {}", end);
}

#[test]
fn fp_visible_row_range_with_hidden() {
    let li = LayoutIndex::from_sparse(
        10,
        5,
        Pixels(20.0),
        Pixels(64.0),
        vec![],
        vec![],
        vec![2, 3],
        vec![],
    );
    let (start, end) = li.get_visible_row_range(Pixels(35.0), Pixels(45.0));
    assert!(start <= 4, "start should include row 4 area, got {}", start);
    assert!(end > 4, "end should be past row 4, got {}", end);
}

#[test]
fn fp_visible_col_range_custom_widths() {
    let li = LayoutIndex::from_sparse(
        5,
        10,
        Pixels(20.0),
        Pixels(64.0),
        vec![],
        vec![(0, Pixels(200.0))],
        vec![],
        vec![],
    );
    let (start, end) = li.get_visible_col_range(Pixels(150.0), Pixels(250.0));
    assert!(start == 0, "start should be 0, got {}", start);
    assert!(end >= 2, "end should include col 1, got {}", end);
}

#[test]
fn fp_negative_pixel_returns_zero_index() {
    let li = LayoutIndex::with_defaults(10, 10, Pixels(20.0), Pixels(64.0));
    assert_eq!(li.get_row_at_pixel(Pixels(-100.0)), 0);
    assert_eq!(li.get_col_at_pixel(Pixels(-1.0)), 0);
}

#[test]
fn fp_pixel_beyond_total_clamps() {
    let li = LayoutIndex::with_defaults(10, 10, Pixels(20.0), Pixels(64.0));
    assert_eq!(li.get_row_at_pixel(Pixels(9999.0)), 9);
    assert_eq!(li.get_col_at_pixel(Pixels(9999.0)), 9);
}

#[test]
fn fp_visible_range_empty_on_zero_count() {
    let li = LayoutIndex::with_defaults(0, 0, Pixels(20.0), Pixels(64.0));
    assert_eq!(li.get_visible_row_range(Pixels(0.0), Pixels(100.0)), (0, 0));
    assert_eq!(li.get_visible_col_range(Pixels(0.0), Pixels(100.0)), (0, 0));
}
