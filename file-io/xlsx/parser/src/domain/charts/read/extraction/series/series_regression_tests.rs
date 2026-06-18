use super::extract_series_from_chart_space;
use ooxml_types::charts::{
    AxisType, Chart, ChartAxis, ChartAxisPosition, ChartGroup, ChartSpace, ChartType,
    ChartTypeConfig, Line3DChartConfig, LineChartConfig, PlotArea, RadarChartConfig, Scaling,
    ScatterChartConfig, ScatterStyle, StockChartConfig,
};

fn axis(axis_type: AxisType, ax_id: u32, cross_ax: u32, ax_pos: ChartAxisPosition) -> ChartAxis {
    ChartAxis {
        axis_type,
        ax_id,
        cross_ax,
        ax_pos,
        scaling: Scaling::default(),
        ..Default::default()
    }
}

fn scatter_group(series_smooth: Option<bool>) -> ChartGroup {
    ChartGroup {
        chart_type: ChartType::Scatter,
        config: ChartTypeConfig::Scatter(ScatterChartConfig {
            scatter_style: ScatterStyle::Line,
            ..Default::default()
        }),
        series: vec![ooxml_types::charts::ChartSeries {
            idx: 0,
            order: 0,
            smooth: series_smooth,
            ..Default::default()
        }],
        d_lbls: None,
        ax_id: vec![10, 20],
        raw_chart_type_attr: None,
        raw_chart_element_name: None,
        raw_chart_group_xml: None,
    }
}

fn scatter_chart_space(series_smooth: Option<bool>) -> ChartSpace {
    ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![scatter_group(series_smooth)],
                axes: vec![
                    axis(AxisType::Value, 10, 20, ChartAxisPosition::Bottom),
                    axis(AxisType::Value, 20, 10, ChartAxisPosition::Left),
                ],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    }
}

fn colored_line_group(chart_type: ChartType, config: ChartTypeConfig) -> ChartGroup {
    ChartGroup {
        chart_type,
        config,
        series: vec![ooxml_types::charts::ChartSeries {
            idx: 0,
            order: 0,
            sp_pr: Some(crate::domain::charts::parse_shape_properties(
                br#"<c:spPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                           xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                    <a:ln><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></a:ln>
                </c:spPr>"#,
            )),
            ..Default::default()
        }],
        d_lbls: None,
        ax_id: vec![],
        raw_chart_type_attr: None,
        raw_chart_element_name: None,
        raw_chart_group_xml: None,
    }
}

#[test]
fn line_family_legacy_series_color_comes_from_line_format() {
    for (chart_type, config) in [
        (
            ChartType::Line,
            ChartTypeConfig::Line(LineChartConfig::default()),
        ),
        (
            ChartType::Line3D,
            ChartTypeConfig::Line3D(Line3DChartConfig::default()),
        ),
        (
            ChartType::Radar,
            ChartTypeConfig::Radar(RadarChartConfig::default()),
        ),
        (
            ChartType::Stock,
            ChartTypeConfig::Stock(StockChartConfig::default()),
        ),
    ] {
        let extracted = extract_series_from_chart_space(&ChartSpace {
            chart: Chart {
                plot_area: PlotArea {
                    chart_groups: vec![colored_line_group(chart_type, config)],
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        });

        assert_eq!(extracted[0].color.as_deref(), Some("4472C4"));
    }
}

#[test]
fn scatter_style_does_not_materialize_absent_series_smooth() {
    let extracted = extract_series_from_chart_space(&scatter_chart_space(None));

    assert_eq!(extracted.len(), 1);
    assert_eq!(extracted[0].smooth, None);
    assert_eq!(extracted[0].show_lines, Some(true));
    assert_eq!(extracted[0].show_markers, Some(false));
}

#[test]
fn preserves_explicit_series_smooth_for_scatter() {
    let extracted = extract_series_from_chart_space(&scatter_chart_space(Some(false)));

    assert_eq!(extracted.len(), 1);
    assert_eq!(extracted[0].smooth, Some(false));
}
