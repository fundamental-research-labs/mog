use crate::charts::*;

#[test]
fn chart_series_default() {
    let s = ChartSeries::default();
    assert_eq!(s.idx, 0);
    assert_eq!(s.order, 0);
    assert!(s.tx.is_none());
    assert!(s.sp_pr.is_none());
    assert!(s.cat.is_none());
    assert!(s.val.is_none());
    assert!(s.trendline.is_empty());
    assert!(s.err_bars.is_empty());
}
#[test]
fn marker_default() {
    let m = Marker::default();
    assert!(m.symbol.is_none());
    assert!(m.size.is_none());
    assert!(m.sp_pr.is_none());
}
#[test]
fn error_bars_default() {
    let eb = ErrorBars::default();
    assert_eq!(eb.err_dir, None);
    assert_eq!(eb.err_bar_type, ErrorBarType::Both);
    assert_eq!(eb.err_val_type, ErrorValueType::FixedVal);
}

// --------------------------------------------------
// Axis type
// --------------------------------------------------
#[test]
fn chart_series_with_bar_shape() {
    let s = ChartSeries {
        shape: Some(BarShape::Cylinder),
        ..Default::default()
    };
    assert_eq!(s.shape, Some(BarShape::Cylinder));
}
#[test]
fn chart_series_shape_defaults_to_none() {
    let s = ChartSeries::default();
    assert!(s.shape.is_none());
}

// --------------------------------------------------
// DataLabel.num_fmt
// --------------------------------------------------
