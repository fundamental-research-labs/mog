use super::AxisIndex;

pub(super) fn assert_position_dimension_invariant(axis: &AxisIndex, label: &str) {
    for i in 0..axis.count() {
        let pos_i = axis.get_position(i);
        let dim_i = axis.get_dimension(i);
        let pos_next = axis.get_position(i + 1);
        assert!(
            (pos_next.0 - (pos_i.0 + dim_i.0)).abs() < 1e-9,
            "{label}: pos({}) + dim({}) = {} + {} = {}, but pos({}) = {}",
            i,
            i,
            pos_i.0,
            dim_i.0,
            pos_i.0 + dim_i.0,
            i + 1,
            pos_next.0,
        );
    }
}

pub(super) fn assert_total_size_is_sum(axis: &AxisIndex, label: &str) {
    let sum: f64 = (0..axis.count()).map(|i| axis.get_dimension(i).0).sum();
    assert!(
        (axis.total_size().0 - sum).abs() < 1e-9,
        "{label}: total_size={} but sum of dims={}",
        axis.total_size().0,
        sum,
    );
}
