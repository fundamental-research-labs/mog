use compute_layout_index::LayoutIndex;
use domain_types::units::Pixels;

/// Verify the position-dimension invariant for all rows in [0, count).
/// pos(i+1) == pos(i) + height(i)
pub fn assert_row_position_invariant(li: &LayoutIndex) {
    for i in 0..li.row_count() {
        let lhs = li.get_row_position(i + 1);
        let rhs = Pixels(li.get_row_position(i).0 + li.get_row_height(i).0);
        assert!(
            (lhs.0 - rhs.0).abs() < 1e-9,
            "Row position invariant violated at i={}: pos({})={:?} != pos({}) + height({}) = {:?}",
            i,
            i + 1,
            lhs,
            i,
            i,
            rhs
        );
    }
}

/// Verify the position-dimension invariant for all cols in [0, count).
pub fn assert_col_position_invariant(li: &LayoutIndex) {
    for j in 0..li.col_count() {
        let lhs = li.get_col_position(j + 1);
        let rhs = Pixels(li.get_col_position(j).0 + li.get_col_width(j).0);
        assert!(
            (lhs.0 - rhs.0).abs() < 1e-9,
            "Col position invariant violated at j={}: pos({})={:?} != pos({}) + width({}) = {:?}",
            j,
            j + 1,
            lhs,
            j,
            j,
            rhs
        );
    }
}
