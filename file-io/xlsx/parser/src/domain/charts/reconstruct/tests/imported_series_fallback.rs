use super::*;
use domain_types::ChartDefinition;
use ooxml_types::charts::{
    BarChartConfig, ChartGroup, ChartType as OoxmlChartType, ChartTypeConfig,
};

#[test]
fn stale_imported_chart_group_series_ids_fall_back_to_modeled_series() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, None);
    spec.definition = Some(ChartDefinition::Chart(ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![ChartGroup {
                    chart_type: OoxmlChartType::Bar,
                    config: ChartTypeConfig::Bar(BarChartConfig::default()),
                    series: vec![ooxml_types::charts::ChartSeries {
                        idx: 5,
                        order: 5,
                        ..Default::default()
                    }],
                    d_lbls: None,
                    ax_id: vec![111111111, 222222222],
                    raw_chart_type_attr: None,
                    raw_chart_element_name: None,
                    raw_chart_group_xml: None,
                }],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    }));
    spec.series = vec![modeled_series(0, None, "North", "Data!$B$2:$B$4")];

    let xml = chart_xml(&spec);

    assert_eq!(xml.matches("<c:ser>").count(), 1, "{xml}");
    assert!(xml.contains("<c:f>Data!$B$2:$B$4</c:f>"), "{xml}");
    assert!(!xml.contains("<c:idx val=\"5\"/>"), "{xml}");
}

#[test]
fn fallback_group_axis_ids_follow_imported_axis_definitions() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, None);
    spec.axes = Some(AxisData {
        category_axis: Some(SingleAxisData {
            visible: true,
            ..Default::default()
        }),
        value_axis: Some(SingleAxisData {
            visible: true,
            ..Default::default()
        }),
        secondary_category_axis: None,
        secondary_value_axis: None,
        series_axis: None,
    });
    spec.definition = Some(ChartDefinition::Chart(ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![ChartGroup {
                    chart_type: OoxmlChartType::Bar,
                    config: ChartTypeConfig::Bar(BarChartConfig::default()),
                    series: vec![ooxml_types::charts::ChartSeries {
                        idx: 5,
                        order: 5,
                        ..Default::default()
                    }],
                    d_lbls: None,
                    ax_id: vec![111111111, 222222222],
                    raw_chart_type_attr: None,
                    raw_chart_element_name: None,
                    raw_chart_group_xml: None,
                }],
                axes: vec![
                    ChartAxis {
                        axis_type: AxisType::Category,
                        ax_id: 10,
                        cross_ax: 20,
                        ax_pos: ChartAxisPosition::Bottom,
                        ..Default::default()
                    },
                    ChartAxis {
                        axis_type: AxisType::Value,
                        ax_id: 20,
                        cross_ax: 10,
                        ax_pos: ChartAxisPosition::Left,
                        ..Default::default()
                    },
                ],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    }));
    spec.series = vec![modeled_series(0, None, "North", "Data!$B$2:$B$4")];

    let xml = chart_xml(&spec);
    let bar_xml = chart_group_xml(&xml, "<c:barChart>", "</c:barChart>");

    assert!(bar_xml.contains("<c:axId val=\"10\"/>"), "{xml}");
    assert!(bar_xml.contains("<c:axId val=\"20\"/>"), "{xml}");
    assert!(!bar_xml.contains("111111111"), "{xml}");
    assert!(!bar_xml.contains("222222222"), "{xml}");
}

#[test]
fn modeled_combo_groups_follow_imported_primary_and_secondary_axes() {
    let mut spec = minimal_chart_spec(DomainChartType::Combo, None);
    spec.axes = Some(AxisData {
        category_axis: Some(SingleAxisData {
            visible: true,
            ..Default::default()
        }),
        value_axis: Some(SingleAxisData {
            visible: true,
            ..Default::default()
        }),
        secondary_category_axis: Some(SingleAxisData {
            visible: true,
            ..Default::default()
        }),
        secondary_value_axis: Some(SingleAxisData {
            visible: true,
            ..Default::default()
        }),
        series_axis: None,
    });
    spec.definition = Some(ChartDefinition::Chart(ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                axes: vec![
                    ChartAxis {
                        axis_type: AxisType::Category,
                        ax_id: 10,
                        cross_ax: 20,
                        ax_pos: ChartAxisPosition::Bottom,
                        ..Default::default()
                    },
                    ChartAxis {
                        axis_type: AxisType::Value,
                        ax_id: 20,
                        cross_ax: 10,
                        ax_pos: ChartAxisPosition::Left,
                        ..Default::default()
                    },
                    ChartAxis {
                        axis_type: AxisType::Category,
                        ax_id: 30,
                        cross_ax: 40,
                        ax_pos: ChartAxisPosition::Top,
                        ..Default::default()
                    },
                    ChartAxis {
                        axis_type: AxisType::Value,
                        ax_id: 40,
                        cross_ax: 30,
                        ax_pos: ChartAxisPosition::Right,
                        ..Default::default()
                    },
                ],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    }));
    spec.series = vec![
        modeled_series(0, Some(DomainChartType::Column), "North", "Data!$B$2:$B$4"),
        modeled_series(1, Some(DomainChartType::Line), "South", "Data!$C$2:$C$4"),
    ];
    spec.series[1].y_axis_index = Some(1);

    let xml = chart_xml(&spec);
    let bar_xml = chart_group_xml(&xml, "<c:barChart>", "</c:barChart>");
    let line_xml = chart_group_xml(&xml, "<c:lineChart>", "</c:lineChart>");

    assert!(bar_xml.contains("<c:axId val=\"10\"/>"), "{xml}");
    assert!(bar_xml.contains("<c:axId val=\"20\"/>"), "{xml}");
    assert!(line_xml.contains("<c:axId val=\"30\"/>"), "{xml}");
    assert!(line_xml.contains("<c:axId val=\"40\"/>"), "{xml}");
}
