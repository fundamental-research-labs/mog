use super::{
    AxisIndex, Pixels,
    helpers::{assert_position_dimension_invariant, assert_total_size_is_sum},
};

#[test]
fn get_index_at_default() {
    let axis = AxisIndex::new(100, Pixels(20.0));
    assert_eq!(axis.get_index_at(Pixels(0.0)), 0);
    assert_eq!(axis.get_index_at(Pixels(10.0)), 0);
    assert_eq!(axis.get_index_at(Pixels(19.9)), 0);
    assert_eq!(axis.get_index_at(Pixels(20.0)), 1);
    assert_eq!(axis.get_index_at(Pixels(39.9)), 1);
    assert_eq!(axis.get_index_at(Pixels(40.0)), 2);
    assert_eq!(axis.get_index_at(Pixels(1999.0)), 99);
    assert_eq!(axis.get_index_at(Pixels(5000.0)), 99);
}

#[test]
fn get_index_at_custom() {
    let axis = AxisIndex::from_sparse(10, Pixels(20.0), vec![(3, Pixels(50.0))], vec![]);
    assert_eq!(axis.get_index_at(Pixels(0.0)), 0);
    assert_eq!(axis.get_index_at(Pixels(59.9)), 2);
    assert_eq!(axis.get_index_at(Pixels(60.0)), 3);
    assert_eq!(axis.get_index_at(Pixels(109.9)), 3);
    assert_eq!(axis.get_index_at(Pixels(110.0)), 4);
}

#[test]
fn get_index_at_hidden() {
    let axis = AxisIndex::from_sparse(5, Pixels(20.0), vec![], vec![2]);
    assert_eq!(axis.get_index_at(Pixels(39.9)), 1);
    assert_eq!(axis.get_index_at(Pixels(40.0)), 3);
}

#[test]
fn out_of_range_position() {
    let axis = AxisIndex::new(10, Pixels(20.0));
    assert_eq!(axis.get_position(10), Pixels(200.0));
    assert_eq!(axis.get_position(11), Pixels(220.0));
}

#[test]
fn fp_pos_dim_all_defaults() {
    let axis = AxisIndex::new(50, Pixels(25.0));
    assert_position_dimension_invariant(&axis, "all_defaults");
}

#[test]
fn fp_pos_dim_scattered_customs() {
    let customs = vec![
        (0, Pixels(10.0)),
        (5, Pixels(100.0)),
        (9, Pixels(1.0)),
        (15, Pixels(50.0)),
        (19, Pixels(0.5)),
    ];
    let axis = AxisIndex::from_sparse(20, Pixels(20.0), customs, vec![]);
    assert_position_dimension_invariant(&axis, "scattered_customs");
}

#[test]
fn fp_pos_dim_with_hidden() {
    let axis = AxisIndex::from_sparse(10, Pixels(20.0), vec![], vec![0, 3, 7, 9]);
    assert_position_dimension_invariant(&axis, "with_hidden");
}

#[test]
fn fp_pos_dim_custom_and_hidden() {
    let customs = vec![(2, Pixels(50.0)), (5, Pixels(80.0)), (7, Pixels(10.0))];
    let hidden = vec![1, 5, 8];
    let axis = AxisIndex::from_sparse(10, Pixels(20.0), customs, hidden);
    assert_position_dimension_invariant(&axis, "custom_and_hidden");
}

#[test]
fn fp_pos_dim_after_mutations() {
    let mut axis = AxisIndex::new(15, Pixels(20.0));
    axis.set_dimension(3, Pixels(50.0));
    assert_position_dimension_invariant(&axis, "after set_dim");

    axis.hide(7);
    assert_position_dimension_invariant(&axis, "after hide");

    axis.set_dimension(7, Pixels(100.0));
    assert_position_dimension_invariant(&axis, "after set_dim on hidden");

    axis.unhide(7);
    assert_position_dimension_invariant(&axis, "after unhide");

    axis.hide(0);
    axis.hide(14);
    assert_position_dimension_invariant(&axis, "after hide first and last");

    axis.set_dimension(0, Pixels(5.0));
    axis.unhide(0);
    assert_position_dimension_invariant(&axis, "after unhide with custom dim");
}

#[test]
fn fp_index_at_roundtrip_defaults() {
    let axis = AxisIndex::new(50, Pixels(20.0));
    for i in 0..50 {
        let pos = axis.get_position(i);
        assert_eq!(axis.get_index_at(pos), i);
    }
}

#[test]
fn fp_index_at_roundtrip_customs() {
    let customs = vec![
        (0, Pixels(10.0)),
        (3, Pixels(100.0)),
        (7, Pixels(5.0)),
        (9, Pixels(50.0)),
    ];
    let axis = AxisIndex::from_sparse(10, Pixels(20.0), customs, vec![]);
    for i in 0..10 {
        let pos = axis.get_position(i);
        let dim = axis.get_dimension(i);
        if dim.0 > 0.0 {
            assert_eq!(axis.get_index_at(pos), i);
            if dim.0 > 1.0 {
                assert_eq!(axis.get_index_at(Pixels(pos.0 + dim.0 / 2.0)), i);
            }
            assert_eq!(axis.get_index_at(Pixels(pos.0 + dim.0 - 0.001)), i);
        }
    }
}

#[test]
fn fp_index_at_roundtrip_with_hidden() {
    let axis = AxisIndex::from_sparse(10, Pixels(20.0), vec![], vec![2, 5]);
    for i in 0..10 {
        let dim = axis.get_dimension(i);
        if dim.0 > 0.0 {
            assert_eq!(axis.get_index_at(axis.get_position(i)), i);
        }
    }
}

#[test]
fn fp_index_at_epsilon_inside_entry() {
    let axis = AxisIndex::from_sparse(10, Pixels(20.0), vec![(3, Pixels(50.0))], vec![]);
    for i in 0..10 {
        let pos = axis.get_position(i);
        let dim = axis.get_dimension(i);
        if dim.0 > 0.0 {
            let eps = dim.0.min(0.01);
            assert_eq!(axis.get_index_at(Pixels(pos.0 + eps)), i);
        }
    }
}

#[test]
fn fp_index_at_monotonic_defaults() {
    let axis = AxisIndex::new(100, Pixels(20.0));
    let mut prev = 0;
    for px in (0..2100).step_by(3) {
        let idx = axis.get_index_at(Pixels(px as f64));
        assert!(idx >= prev);
        prev = idx;
    }
}

#[test]
fn fp_index_at_monotonic_mixed() {
    let customs = vec![(2, Pixels(100.0)), (5, Pixels(1.0)), (8, Pixels(50.0))];
    let hidden = vec![3, 6];
    let axis = AxisIndex::from_sparse(10, Pixels(20.0), customs, hidden);
    let total = axis.total_size().0 as i64 + 50;
    let mut prev = 0;
    for px in (0..total).step_by(1) {
        let idx = axis.get_index_at(Pixels(px as f64));
        assert!(idx >= prev);
        prev = idx;
    }
}

#[test]
fn fp_hidden_adjacent_positions() {
    let mut axis = AxisIndex::new(10, Pixels(20.0));
    axis.hide(5);
    assert_eq!(axis.get_position(5), axis.get_position(6));
    let pos4_end = axis.get_position(4).0 + axis.get_dimension(4).0;
    assert!((pos4_end - axis.get_position(6).0).abs() < 1e-9);
}

#[test]
fn fp_hide_all_total_zero() {
    let mut axis = AxisIndex::new(20, Pixels(30.0));
    for i in 0..20 {
        axis.hide(i);
    }
    assert_eq!(axis.total_size(), Pixels(0.0));
    for i in 0..=20 {
        assert_eq!(axis.get_position(i), Pixels(0.0));
    }
}

#[test]
fn fp_count_zero() {
    let axis = AxisIndex::new(0, Pixels(20.0));
    assert_eq!(axis.count(), 0);
    assert_eq!(axis.total_size(), Pixels(0.0));
    assert_eq!(axis.get_position(0), Pixels(0.0));
    assert_eq!(axis.get_position(3), Pixels(60.0));
    assert_eq!(axis.get_index_at(Pixels(0.0)), 0);
    assert_eq!(axis.get_index_at(Pixels(100.0)), 0);
    assert!(axis.build_position_array(0, 0).is_empty());
    assert!(axis.build_dimension_array(0, 0).is_empty());
    assert_eq!(axis.get_visible_range(Pixels(0.0), Pixels(100.0)), (0, 0));
}

#[test]
fn fp_count_one() {
    let axis = AxisIndex::new(1, Pixels(20.0));
    assert_eq!(axis.get_position(0), Pixels(0.0));
    assert_eq!(axis.get_position(1), Pixels(20.0));
    assert_eq!(axis.get_dimension(0), Pixels(20.0));
    assert_eq!(axis.total_size(), Pixels(20.0));
    assert_eq!(axis.get_index_at(Pixels(0.0)), 0);
    assert_eq!(axis.get_index_at(Pixels(10.0)), 0);
    assert_eq!(axis.get_index_at(Pixels(19.99)), 0);
    assert_eq!(axis.get_index_at(Pixels(100.0)), 0);
    assert_position_dimension_invariant(&axis, "count_one");
}

#[test]
fn fp_position_beyond_count_extrapolates() {
    let axis = AxisIndex::from_sparse(5, Pixels(20.0), vec![(2, Pixels(50.0))], vec![]);
    let pos_at_count = axis.get_position(5);
    assert_eq!(axis.get_position(6), Pixels(pos_at_count.0 + 20.0));
    assert_eq!(axis.get_position(10), Pixels(pos_at_count.0 + 5.0 * 20.0));
}

#[test]
fn fp_negative_pixel_returns_zero() {
    let axis = AxisIndex::new(10, Pixels(20.0));
    assert_eq!(axis.get_index_at(Pixels(-1.0)), 0);
    assert_eq!(axis.get_index_at(Pixels(-1000.0)), 0);
    assert_eq!(axis.get_index_at(Pixels(-0.001)), 0);
}

#[test]
fn fp_stress_invariant_many_mutations() {
    let mut axis = AxisIndex::new(30, Pixels(20.0));
    axis.set_dimension(0, Pixels(5.0));
    axis.set_dimension(10, Pixels(100.0));
    axis.set_dimension(20, Pixels(1.0));
    axis.hide(5);
    axis.hide(15);
    axis.hide(25);
    axis.set_dimension(5, Pixels(50.0));
    axis.set_dimension(15, Pixels(0.5));
    axis.unhide(5);
    axis.set_dimension(10, Pixels(20.0));
    axis.hide(0);
    axis.unhide(0);

    assert_position_dimension_invariant(&axis, "stress_mutations");
    assert_total_size_is_sum(&axis, "stress_mutations");

    for i in 0..30 {
        if axis.get_dimension(i).0 > 0.0 {
            assert_eq!(axis.get_index_at(axis.get_position(i)), i);
        }
    }
}

#[test]
fn fp_position_starts_at_zero() {
    let configs: Vec<AxisIndex> = vec![
        AxisIndex::new(0, Pixels(20.0)),
        AxisIndex::new(1, Pixels(0.0)),
        AxisIndex::new(100, Pixels(20.0)),
        AxisIndex::from_sparse(10, Pixels(20.0), vec![(0, Pixels(100.0))], vec![]),
        AxisIndex::from_sparse(10, Pixels(20.0), vec![], vec![0]),
    ];
    for axis in configs {
        assert_eq!(axis.get_position(0), Pixels(0.0));
    }
}

#[test]
fn fp_positions_nondecreasing() {
    let axis = AxisIndex::from_sparse(
        20,
        Pixels(20.0),
        vec![(3, Pixels(0.0)), (7, Pixels(100.0)), (15, Pixels(0.5))],
        vec![5, 10, 11, 12],
    );
    let mut prev = 0.0f64;
    for i in 0..=20 {
        let pos = axis.get_position(i).0;
        assert!(pos >= prev - 1e-9);
        prev = pos;
    }
}

#[test]
fn fp_zero_default_size() {
    let axis = AxisIndex::new(10, Pixels(0.0));
    assert_eq!(axis.total_size(), Pixels(0.0));
    for i in 0..=10 {
        assert_eq!(axis.get_position(i), Pixels(0.0));
    }
    assert_position_dimension_invariant(&axis, "zero_default");
}

#[test]
fn fp_consecutive_hidden_entries() {
    let axis = AxisIndex::from_sparse(10, Pixels(20.0), vec![], vec![3, 4, 5, 6]);
    let pos3 = axis.get_position(3).0;
    assert_eq!(axis.get_position(4).0, pos3);
    assert_eq!(axis.get_position(5).0, pos3);
    assert_eq!(axis.get_position(6).0, pos3);
    assert_eq!(axis.get_position(7).0, pos3);
    assert_position_dimension_invariant(&axis, "consecutive_hidden");
}
