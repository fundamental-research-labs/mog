use super::extract_series_from_chart_space;
use ooxml_types::charts::{
    AxisType, Chart, ChartAxis, ChartAxisPosition, ChartGroup, ChartSpace, ChartType,
    ChartTypeConfig, PlotArea, Scaling, ScatterChartConfig, ScatterStyle,
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
