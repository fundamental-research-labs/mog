use crate::charts::*;

#[test]
fn chart_type_config_chart_type() {
    assert_eq!(
        ChartTypeConfig::Bar(BarChartConfig::default()).chart_type(),
        ChartType::Bar
    );
    assert_eq!(
        ChartTypeConfig::Bar3D(Bar3DChartConfig::default()).chart_type(),
        ChartType::Bar3D
    );
    assert_eq!(
        ChartTypeConfig::Line(LineChartConfig::default()).chart_type(),
        ChartType::Line
    );
    assert_eq!(
        ChartTypeConfig::Line3D(Line3DChartConfig::default()).chart_type(),
        ChartType::Line3D
    );
    assert_eq!(
        ChartTypeConfig::Pie(PieChartConfig::default()).chart_type(),
        ChartType::Pie
    );
    assert_eq!(
        ChartTypeConfig::Pie3D(Pie3DChartConfig::default()).chart_type(),
        ChartType::Pie3D
    );
    assert_eq!(
        ChartTypeConfig::Doughnut(DoughnutChartConfig::default()).chart_type(),
        ChartType::Doughnut
    );
    assert_eq!(
        ChartTypeConfig::Area(AreaChartConfig::default()).chart_type(),
        ChartType::Area
    );
    assert_eq!(
        ChartTypeConfig::Area3D(Area3DChartConfig::default()).chart_type(),
        ChartType::Area3D
    );
    assert_eq!(
        ChartTypeConfig::Scatter(ScatterChartConfig::default()).chart_type(),
        ChartType::Scatter
    );
    assert_eq!(
        ChartTypeConfig::Bubble(BubbleChartConfig::default()).chart_type(),
        ChartType::Bubble
    );
    assert_eq!(
        ChartTypeConfig::Radar(RadarChartConfig::default()).chart_type(),
        ChartType::Radar
    );
    assert_eq!(
        ChartTypeConfig::Surface(SurfaceChartConfig::default()).chart_type(),
        ChartType::Surface
    );
    assert_eq!(
        ChartTypeConfig::Surface3D(SurfaceChartConfig::default()).chart_type(),
        ChartType::Surface3D
    );
    assert_eq!(
        ChartTypeConfig::Stock(StockChartConfig::default()).chart_type(),
        ChartType::Stock
    );
    assert_eq!(
        ChartTypeConfig::OfPie(OfPieChartConfig::default()).chart_type(),
        ChartType::OfPie
    );
    assert_eq!(ChartTypeConfig::Combo.chart_type(), ChartType::Combo);
}

// --------------------------------------------------
// BubbleChartConfig default
// --------------------------------------------------
#[test]
fn bubble_chart_config_default() {
    let cfg = BubbleChartConfig::default();
    assert_eq!(cfg.bubble_scale, Some(100));
    assert!(cfg.vary_colors.is_none());
}

// --------------------------------------------------
// OfPieChartConfig default
// --------------------------------------------------
#[test]
fn of_pie_chart_config_default() {
    let cfg = OfPieChartConfig::default();
    assert_eq!(cfg.of_pie_type, OfPieType::Pie);
    assert_eq!(cfg.second_pie_size, Some(75));
    assert!(cfg.ser_lines.is_empty());
}

// --------------------------------------------------
// ChartProtection default
// --------------------------------------------------
#[test]
fn bar_3d_chart_config_no_overlap() {
    // Bar3DChartConfig should NOT have overlap or ser_lines fields
    // (removed per ECMA-376: CT_Bar3DChart does not include these)
    let cfg = Bar3DChartConfig::default();
    // Just verify it has the correct fields and defaults
    assert_eq!(cfg.bar_dir, BarDirection::Column);
    assert!(cfg.grouping.is_none());
    assert!(cfg.vary_colors.is_none());
    assert!(cfg.gap_width.is_none());
    assert!(cfg.gap_depth.is_none());
    assert!(cfg.shape.is_none());
}
