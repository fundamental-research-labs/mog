use crate::charts::*;

#[test]
fn chart_space_default() {
    let cs = ChartSpace::default();
    assert!(cs.date1904.is_none());
    assert!(cs.lang.is_none());
    assert!(cs.protection.is_none());
}
#[test]
fn chart_default() {
    let c = Chart::default();
    assert!(c.title.is_none());
    assert!(c.legend.is_none());
    assert!(c.view_3d.is_none());
}
#[test]
fn plot_area_default() {
    let pa = PlotArea::default();
    assert!(pa.layout.is_none());
    assert!(pa.chart_groups.is_empty());
    assert!(pa.axes.is_empty());
}
#[test]
fn chart_group_basic() {
    let cg = ChartGroup {
        chart_type: ChartType::Bar,
        config: ChartTypeConfig::Bar(BarChartConfig::default()),
        series: vec![],
        d_lbls: None,
        ax_id: vec![1, 2],
        raw_chart_type_attr: None,
    };
    assert_eq!(cg.chart_type, ChartType::Bar);
    assert_eq!(cg.ax_id, vec![1, 2]);
}

// --------------------------------------------------
// ChartText enum
// --------------------------------------------------
#[test]
fn legend_entry_mutual_exclusivity() {
    // Valid: delete only
    let entry_delete = LegendEntry {
        idx: 0,
        delete: Some(true),
        tx_pr: None,
        extensions: vec![],
    };
    #[cfg(debug_assertions)]
    assert!(entry_delete.is_valid());
    let _ = entry_delete;

    // Valid: tx_pr only
    use crate::drawings::TextBody;
    let entry_styled = LegendEntry {
        idx: 0,
        delete: None,
        tx_pr: Some(TextBody::default()),
        extensions: vec![],
    };
    #[cfg(debug_assertions)]
    assert!(entry_styled.is_valid());
    let _ = entry_styled;

    // Invalid: both set
    let entry_invalid = LegendEntry {
        idx: 0,
        delete: Some(true),
        tx_pr: Some(TextBody::default()),
        extensions: vec![],
    };
    #[cfg(debug_assertions)]
    assert!(!entry_invalid.is_valid());
    let _ = entry_invalid;
}

// --------------------------------------------------
// Bar3DChartConfig no overlap
// --------------------------------------------------
