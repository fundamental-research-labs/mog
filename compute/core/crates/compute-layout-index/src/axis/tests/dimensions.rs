use super::{AxisIndex, Pixels, helpers::assert_position_dimension_invariant};

#[test]
fn default_only() {
    let axis = AxisIndex::new(100, Pixels(20.0));
    assert_eq!(axis.count(), 100);
    assert_eq!(axis.default_size(), Pixels(20.0));
    assert_eq!(axis.get_dimension(0), Pixels(20.0));
    assert_eq!(axis.get_dimension(99), Pixels(20.0));
    assert_eq!(axis.get_position(0), Pixels(0.0));
    assert_eq!(axis.get_position(1), Pixels(20.0));
    assert_eq!(axis.get_position(50), Pixels(1000.0));
    assert_eq!(axis.get_position(100), Pixels(2000.0));
    assert_eq!(axis.total_size(), Pixels(2000.0));
}

#[test]
fn custom_dimensions() {
    let axis = AxisIndex::from_sparse(10, Pixels(20.0), vec![(3, Pixels(50.0))], vec![]);
    assert_eq!(axis.get_dimension(3), Pixels(50.0));
    assert_eq!(axis.get_dimension(0), Pixels(20.0));
    assert_eq!(axis.get_position(3), Pixels(60.0));
    assert_eq!(axis.get_position(4), Pixels(110.0));
    assert_eq!(axis.get_position(5), Pixels(130.0));
}

#[test]
fn hidden_entries() {
    let axis = AxisIndex::from_sparse(5, Pixels(20.0), vec![], vec![2]);
    assert_eq!(axis.get_dimension(2), Pixels(0.0));
    assert!(axis.is_hidden(2));
    assert_eq!(axis.get_position(0), Pixels(0.0));
    assert_eq!(axis.get_position(1), Pixels(20.0));
    assert_eq!(axis.get_position(2), Pixels(40.0));
    assert_eq!(axis.get_position(3), Pixels(40.0));
    assert_eq!(axis.get_position(4), Pixels(60.0));
    assert_eq!(axis.total_size(), Pixels(80.0));
}

#[test]
fn hidden_custom_entry() {
    let axis = AxisIndex::from_sparse(5, Pixels(20.0), vec![(1, Pixels(50.0))], vec![1]);
    assert_eq!(axis.get_dimension(1), Pixels(0.0));
    assert!(axis.is_hidden(1));
    assert_eq!(axis.get_position(2), Pixels(20.0));
}

#[test]
fn set_dimension() {
    let mut axis = AxisIndex::new(5, Pixels(20.0));
    axis.set_dimension(2, Pixels(40.0));
    assert_eq!(axis.get_dimension(2), Pixels(40.0));
    assert_eq!(axis.get_position(3), Pixels(80.0));
    axis.set_dimension(2, Pixels(20.0));
    assert_eq!(axis.get_dimension(2), Pixels(20.0));
    assert_eq!(axis.get_position(3), Pixels(60.0));
}

#[test]
fn hide_unhide() {
    let mut axis = AxisIndex::new(5, Pixels(20.0));
    axis.hide(2);
    assert!(axis.is_hidden(2));
    assert_eq!(axis.get_dimension(2), Pixels(0.0));
    assert_eq!(axis.get_position(3), Pixels(40.0));

    axis.unhide(2);
    assert!(!axis.is_hidden(2));
    assert_eq!(axis.get_dimension(2), Pixels(20.0));
    assert_eq!(axis.get_position(3), Pixels(60.0));
}

#[test]
fn all_hidden() {
    let hidden: Vec<usize> = (0..5).collect();
    let axis = AxisIndex::from_sparse(5, Pixels(20.0), vec![], hidden);
    assert_eq!(axis.total_size(), Pixels(0.0));
    for i in 0..5 {
        assert_eq!(axis.get_position(i), Pixels(0.0));
        assert_eq!(axis.get_dimension(i), Pixels(0.0));
    }
}

#[test]
fn single_custom_in_large_sheet() {
    let axis = AxisIndex::from_sparse(
        1_000_000,
        Pixels(20.0),
        vec![(500_000, Pixels(100.0))],
        vec![],
    );
    assert_eq!(axis.get_dimension(500_000), Pixels(100.0));
    assert_eq!(axis.get_position(500_000), Pixels(500_000.0 * 20.0));
    assert_eq!(axis.get_position(500_001), Pixels(500_000.0 * 20.0 + 100.0));
    assert_eq!(
        axis.get_position(1_000_000),
        Pixels(1_000_000.0 * 20.0 + 80.0)
    );
}

#[test]
fn fp_hidden_dimension_is_zero() {
    let mut axis = AxisIndex::new(10, Pixels(20.0));
    for i in 0..10 {
        axis.hide(i);
        assert_eq!(axis.get_dimension(i), Pixels(0.0));
    }
}

#[test]
fn fp_hide_unhide_restores_default() {
    let mut axis = AxisIndex::new(10, Pixels(25.0));
    for i in 0..10 {
        axis.hide(i);
        axis.unhide(i);
        assert_eq!(axis.get_dimension(i), Pixels(25.0));
    }
    assert_position_dimension_invariant(&axis, "hide_unhide_default");
}

#[test]
fn fp_hide_unhide_restores_custom() {
    let mut axis = AxisIndex::new(10, Pixels(20.0));
    axis.set_dimension(4, Pixels(77.0));
    axis.hide(4);
    assert_eq!(axis.get_dimension(4), Pixels(0.0));
    axis.unhide(4);
    assert_eq!(axis.get_dimension(4), Pixels(77.0));
    assert_position_dimension_invariant(&axis, "hide_unhide_custom");
}

#[test]
fn fp_set_dimension_only_affects_subsequent() {
    let mut axis = AxisIndex::new(10, Pixels(20.0));
    let positions_before: Vec<Pixels> = (0..10).map(|i| axis.get_position(i)).collect();

    axis.set_dimension(5, Pixels(50.0));

    for (i, pos) in positions_before.iter().enumerate().take(6) {
        assert_eq!(axis.get_position(i), *pos);
    }
    for (i, pos) in positions_before.iter().enumerate().take(10).skip(6) {
        assert!((axis.get_position(i).0 - pos.0 - 30.0).abs() < 1e-9);
    }
}

#[test]
fn fp_set_dimension_to_default_clears_custom() {
    let mut axis = AxisIndex::new(10, Pixels(20.0));
    axis.set_dimension(3, Pixels(50.0));
    axis.set_dimension(3, Pixels(20.0));

    let fresh = AxisIndex::new(10, Pixels(20.0));
    for i in 0..=10 {
        assert_eq!(axis.get_position(i), fresh.get_position(i));
    }
}

#[test]
fn fp_set_dimension_on_hidden_remembered() {
    let mut axis = AxisIndex::new(10, Pixels(20.0));
    axis.hide(3);
    axis.set_dimension(3, Pixels(99.0));

    assert_eq!(axis.get_dimension(3), Pixels(0.0));
    assert_position_dimension_invariant(&axis, "set_dim_on_hidden");

    axis.unhide(3);
    assert_eq!(axis.get_dimension(3), Pixels(99.0));
    assert_position_dimension_invariant(&axis, "unhide_after_set_dim_on_hidden");
}

#[test]
fn fp_from_sparse_equals_incremental_custom() {
    let customs = vec![(1, Pixels(30.0)), (4, Pixels(10.0)), (7, Pixels(50.0))];
    let axis_sparse = AxisIndex::from_sparse(10, Pixels(20.0), customs.clone(), vec![]);

    let mut axis_incr = AxisIndex::new(10, Pixels(20.0));
    for (i, size) in &customs {
        axis_incr.set_dimension(*i, *size);
    }

    for i in 0..=10 {
        assert!((axis_sparse.get_position(i).0 - axis_incr.get_position(i).0).abs() < 1e-9);
    }
    for i in 0..10 {
        assert_eq!(axis_sparse.get_dimension(i), axis_incr.get_dimension(i));
    }
}

#[test]
fn fp_from_sparse_equals_incremental_hidden() {
    let hidden = vec![2, 5, 8];
    let axis_sparse = AxisIndex::from_sparse(10, Pixels(20.0), vec![], hidden.clone());

    let mut axis_incr = AxisIndex::new(10, Pixels(20.0));
    for &i in &hidden {
        axis_incr.hide(i);
    }

    for i in 0..=10 {
        assert!((axis_sparse.get_position(i).0 - axis_incr.get_position(i).0).abs() < 1e-9);
    }
    assert!((axis_sparse.total_size().0 - axis_incr.total_size().0).abs() < 1e-9);
}

#[test]
fn fp_from_sparse_equals_incremental_custom_and_hidden() {
    let customs = vec![(2, Pixels(50.0)), (5, Pixels(80.0))];
    let hidden = vec![2, 7];
    let axis_sparse = AxisIndex::from_sparse(10, Pixels(20.0), customs.clone(), hidden.clone());

    let mut axis_incr = AxisIndex::new(10, Pixels(20.0));
    for (i, size) in &customs {
        axis_incr.set_dimension(*i, *size);
    }
    for &i in &hidden {
        axis_incr.hide(i);
    }

    for i in 0..=10 {
        assert!((axis_sparse.get_position(i).0 - axis_incr.get_position(i).0).abs() < 1e-9);
    }
    for i in 0..10 {
        assert_eq!(axis_sparse.get_dimension(i), axis_incr.get_dimension(i));
        assert_eq!(axis_sparse.is_hidden(i), axis_incr.is_hidden(i));
    }
}

#[test]
fn fp_get_dimension_beyond_count_returns_default() {
    let axis = AxisIndex::new(5, Pixels(20.0));
    assert_eq!(axis.get_dimension(5), Pixels(20.0));
    assert_eq!(axis.get_dimension(100), Pixels(20.0));
}

#[test]
fn fp_hide_out_of_range_is_noop() {
    let mut axis = AxisIndex::new(5, Pixels(20.0));
    axis.hide(10);
    assert_eq!(axis.total_size(), Pixels(100.0));
    axis.unhide(10);
    assert_eq!(axis.total_size(), Pixels(100.0));
}

#[test]
fn fp_set_dimension_out_of_range_is_noop() {
    let mut axis = AxisIndex::new(5, Pixels(20.0));
    axis.set_dimension(10, Pixels(99.0));
    assert_eq!(axis.total_size(), Pixels(100.0));
}

#[test]
fn fp_double_hide_is_idempotent() {
    let mut axis = AxisIndex::new(10, Pixels(20.0));
    axis.hide(3);
    let total_after_first = axis.total_size();
    axis.hide(3);
    assert_eq!(axis.total_size(), total_after_first);
    assert_position_dimension_invariant(&axis, "double_hide");
}

#[test]
fn fp_double_unhide_is_idempotent() {
    let mut axis = AxisIndex::new(10, Pixels(20.0));
    axis.hide(3);
    axis.unhide(3);
    let total_after_first = axis.total_size();
    axis.unhide(3);
    assert_eq!(axis.total_size(), total_after_first);
    assert_position_dimension_invariant(&axis, "double_unhide");
}

#[test]
fn fp_zero_default_with_custom() {
    let axis = AxisIndex::from_sparse(
        5,
        Pixels(0.0),
        vec![(1, Pixels(30.0)), (3, Pixels(50.0))],
        vec![],
    );
    assert_eq!(axis.get_dimension(0), Pixels(0.0));
    assert_eq!(axis.get_dimension(1), Pixels(30.0));
    assert_eq!(axis.get_dimension(2), Pixels(0.0));
    assert_eq!(axis.get_dimension(3), Pixels(50.0));
    assert_eq!(axis.total_size(), Pixels(80.0));
    assert_position_dimension_invariant(&axis, "zero_default_with_custom");
}
