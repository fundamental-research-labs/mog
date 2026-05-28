use crate::charts::*;

#[test]
fn chart_axis_default() {
    let a = ChartAxis::default();
    assert_eq!(a.axis_type, AxisType::Category);
    assert_eq!(a.ax_id, 0);
    assert!(!a.delete);
    assert_eq!(a.ax_pos, ChartAxisPosition::Bottom);
    assert_eq!(a.crosses, AxisCrosses::AutoZero);
}
#[test]
fn scaling_default() {
    let s = Scaling::default();
    assert_eq!(s.orientation, Orientation::MinMax);
    assert!(s.min.is_none());
    assert!(s.max.is_none());
    assert!(s.log_base.is_none());
}

// --------------------------------------------------
// Document model
// --------------------------------------------------
