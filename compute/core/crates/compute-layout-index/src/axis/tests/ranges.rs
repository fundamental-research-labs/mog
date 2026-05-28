use super::{
    AxisIndex, Pixels,
    helpers::{assert_position_dimension_invariant, assert_total_size_is_sum},
};

#[test]
fn build_position_array_basic() {
    let axis = AxisIndex::from_sparse(10, Pixels(20.0), vec![(3, Pixels(50.0))], vec![]);
    let positions = axis.build_position_array(2, 6);
    assert_eq!(positions, vec![40.0, 60.0, 110.0, 130.0, 150.0]);
}

#[test]
fn build_position_array_sentinel_lets_caller_derive_last_height() {
    let axis = AxisIndex::from_sparse(10, Pixels(20.0), vec![(5, Pixels(50.0))], vec![]);
    let positions = axis.build_position_array(2, 6);
    assert_eq!(positions.len(), 5);
    assert_eq!(positions[4] - positions[3], 50.0);
}

#[test]
fn build_dimension_array_basic() {
    let axis = AxisIndex::from_sparse(10, Pixels(20.0), vec![(3, Pixels(50.0))], vec![2]);
    let dims = axis.build_dimension_array(1, 5);
    assert_eq!(dims, vec![20.0, 0.0, 50.0, 20.0]);
}

#[test]
fn visible_range() {
    let axis = AxisIndex::new(100, Pixels(20.0));
    let (start, end) = axis.get_visible_range(Pixels(50.0), Pixels(150.0));
    assert_eq!(start, 2);
    assert_eq!(end, 8);
}

#[test]
fn fp_total_size_equals_position_at_count() {
    let configs: Vec<AxisIndex> = vec![
        AxisIndex::new(0, Pixels(20.0)),
        AxisIndex::new(1, Pixels(20.0)),
        AxisIndex::new(100, Pixels(20.0)),
        AxisIndex::from_sparse(10, Pixels(20.0), vec![(3, Pixels(50.0))], vec![]),
        AxisIndex::from_sparse(10, Pixels(20.0), vec![], vec![2, 5]),
        AxisIndex::from_sparse(
            10,
            Pixels(20.0),
            vec![(2, Pixels(50.0)), (5, Pixels(80.0))],
            vec![2, 7],
        ),
    ];
    for axis in configs {
        assert_eq!(axis.total_size(), axis.get_position(axis.count()));
    }
}

#[test]
fn fp_total_size_equals_sum_of_dimensions() {
    let axis = AxisIndex::from_sparse(
        20,
        Pixels(15.0),
        vec![(0, Pixels(30.0)), (10, Pixels(5.0)), (19, Pixels(100.0))],
        vec![3, 10, 15],
    );
    assert_total_size_is_sum(&axis, "mixed");
}

#[test]
fn fp_build_position_array_matches_get_position() {
    let axis = AxisIndex::from_sparse(
        15,
        Pixels(20.0),
        vec![(3, Pixels(50.0)), (10, Pixels(5.0))],
        vec![7],
    );
    let arr = axis.build_position_array(2, 13);
    assert_eq!(arr.len(), 12);
    for (j, i) in (2..=13).enumerate() {
        assert!((arr[j] - axis.get_position(i).0).abs() < 1e-9);
    }
}

#[test]
fn fp_build_dimension_array_matches_get_dimension() {
    let axis = AxisIndex::from_sparse(
        15,
        Pixels(20.0),
        vec![(3, Pixels(50.0)), (10, Pixels(5.0))],
        vec![7],
    );
    let arr = axis.build_dimension_array(0, 15);
    for (i, dim) in arr.iter().enumerate().take(15) {
        assert!((*dim - axis.get_dimension(i).0).abs() < 1e-9);
    }
}

#[test]
fn fp_build_position_array_empty_range() {
    let axis = AxisIndex::new(10, Pixels(20.0));
    assert!(axis.build_position_array(5, 5).is_empty());
    assert!(axis.build_position_array(7, 3).is_empty());
}

#[test]
fn build_position_array_beyond_count_extrapolates() {
    let axis = AxisIndex::from_sparse(3, Pixels(20.0), vec![(1, Pixels(50.0))], vec![]);
    assert_eq!(
        axis.build_position_array(2, 5),
        vec![70.0, 90.0, 110.0, 130.0]
    );
}

#[test]
fn build_dimension_array_clamps_to_count() {
    let axis = AxisIndex::from_sparse(3, Pixels(20.0), vec![(1, Pixels(50.0))], vec![2]);
    assert_eq!(axis.build_dimension_array(0, 10), vec![20.0, 50.0, 0.0]);
    assert!(axis.build_dimension_array(3, 10).is_empty());
    assert!(axis.build_dimension_array(5, 2).is_empty());
}

#[test]
fn fp_visible_range_entries_intersect() {
    let axis = AxisIndex::from_sparse(
        20,
        Pixels(20.0),
        vec![(5, Pixels(100.0)), (15, Pixels(5.0))],
        vec![10],
    );
    let start_px = Pixels(50.0);
    let end_px = Pixels(250.0);
    let (first, last_excl) = axis.get_visible_range(start_px, end_px);

    for i in first..last_excl {
        let pos = axis.get_position(i);
        if axis.get_dimension(i).0 > 0.0 {
            assert!(pos.0 <= end_px.0);
        }
    }

    if first < last_excl {
        let pos_first = axis.get_position(first);
        let end_first = pos_first.0 + axis.get_dimension(first).0;
        assert!(end_first > start_px.0 || axis.get_dimension(first).0 == 0.0);
    }
}

#[test]
fn fp_visible_range_empty_for_negative_end() {
    let axis = AxisIndex::new(10, Pixels(20.0));
    assert_eq!(axis.get_visible_range(Pixels(-100.0), Pixels(0.0)), (0, 0));
    assert_eq!(
        axis.get_visible_range(Pixels(-100.0), Pixels(-50.0)),
        (0, 0)
    );
}

#[test]
fn zero_default_range_contracts() {
    let axis = AxisIndex::from_sparse(
        5,
        Pixels(0.0),
        vec![(1, Pixels(30.0)), (3, Pixels(50.0))],
        vec![],
    );
    assert_eq!(axis.total_size(), Pixels(80.0));
    assert_eq!(
        axis.build_dimension_array(0, 5),
        vec![0.0, 30.0, 0.0, 50.0, 0.0]
    );
    assert_position_dimension_invariant(&axis, "zero_default_range_contracts");
}
