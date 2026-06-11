use crate::charts::*;

#[test]
fn chart_axis_default() {
    let a = ChartAxis::default();
    assert_eq!(a.axis_type, AxisType::Category);
    assert_eq!(a.ax_id, 0);
    assert!(!a.delete);
    assert!(!a.delete_explicit);
    assert_eq!(a.ax_pos, ChartAxisPosition::Bottom);
    assert!(!a.major_tick_mark_explicit);
    assert!(!a.minor_tick_mark_explicit);
    assert!(!a.tick_lbl_pos_explicit);
    assert_eq!(a.crosses, AxisCrosses::AutoZero);
    assert!(!a.crosses_explicit);
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
