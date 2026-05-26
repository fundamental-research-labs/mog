use compute_layout_index::AxisIndex;
use domain_types::units::Pixels;
use proptest::prelude::*;

/// Strategy: generate an AxisIndex with random set_dimension operations applied.
/// Returns (axis, count) so tests can query valid indices.
fn arb_axis_index() -> impl Strategy<Value = (AxisIndex, usize)> {
    // count in 1..=200, default_size in 1.0..=100.0
    (1usize..=200, 1.0f64..=100.0)
        .prop_flat_map(|(count, default_size)| {
            // Generate up to `count` random set_dimension ops
            let ops = prop::collection::vec((0..count, 1.0f64..=200.0), 0..=count);
            (Just(count), Just(default_size), ops)
        })
        .prop_map(|(count, default_size, ops)| {
            let mut axis = AxisIndex::new(count, Pixels(default_size));
            for (i, size) in &ops {
                axis.set_dimension(*i, Pixels(*size));
            }
            (axis, count)
        })
}

proptest! {
    /// position(i) + dimension(i) == position(i+1) for all valid i.
    #[test]
    fn position_dimension_consistency((ref axis, count) in arb_axis_index()) {
        for i in 0..count {
            let pos_i = axis.get_position(i).0;
            let dim_i = axis.get_dimension(i).0;
            let pos_next = axis.get_position(i + 1).0;
            let diff = (pos_i + dim_i - pos_next).abs();
            prop_assert!(
                diff < 1e-9,
                "position({}) + dimension({}) = {} + {} = {}, but position({}) = {}",
                i, i, pos_i, dim_i, pos_i + dim_i, i + 1, pos_next
            );
        }
    }

    /// Positions are monotonically non-decreasing (all dimensions are positive).
    #[test]
    fn prefix_sum_monotonic((ref axis, count) in arb_axis_index()) {
        for i in 1..=count {
            let prev = axis.get_position(i - 1).0;
            let curr = axis.get_position(i).0;
            prop_assert!(
                curr >= prev - 1e-9,
                "position({}) = {} < position({}) = {}",
                i, curr, i - 1, prev
            );
        }
    }

    /// total_size == position(last) + dimension(last).
    #[test]
    fn total_size_consistency((ref axis, count) in arb_axis_index()) {
        let total = axis.total_size().0;
        if count > 0 {
            let last = count - 1;
            let expected = axis.get_position(last).0 + axis.get_dimension(last).0;
            let diff = (total - expected).abs();
            prop_assert!(
                diff < 1e-9,
                "total_size = {}, but position({}) + dimension({}) = {}",
                total, last, last, expected
            );
        }
    }
}
