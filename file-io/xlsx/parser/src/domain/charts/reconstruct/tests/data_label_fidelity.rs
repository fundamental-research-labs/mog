use super::*;
use domain_types::chart::{
    ChartColorData, ChartDashStyle, ChartFormatData, ChartLineData, DataLabelData,
};
use ooxml_types::charts::{
    ChartGroup, ChartSeries, ChartType as OoxmlChartType, ChartTypeConfig, DataLabelOptions,
    PieChartConfig,
};

#[test]
fn imported_series_data_label_text_properties_preserve_unmodeled_run_properties() {
    let mut spec = minimal_chart_spec(DomainChartType::Pie, None);
    let mut series = modeled_series(0, None, "Composition", "Data!$B$2:$B$4");
    series.data_labels = Some(data_label_data());
    spec.series = vec![series];
    spec.definition = Some(ChartDefinition::Chart(ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![ChartGroup {
                    chart_type: OoxmlChartType::Pie,
                    config: ChartTypeConfig::Pie(PieChartConfig::default()),
                    series: vec![ChartSeries {
                        idx: 0,
                        order: 0,
                        d_lbls: Some(imported_data_label_options()),
                        ..Default::default()
                    }],
                    d_lbls: None,
                    ax_id: Vec::new(),
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

    let xml = chart_xml(&spec);

    assert!(xml.contains("<c:ser>"), "{xml}");
    assert!(xml.contains("baseline=\"0\""), "{xml}");
    assert!(xml.contains("lang=\"en-US\""), "{xml}");
}

#[test]
fn imported_group_data_label_text_properties_preserve_unmodeled_run_properties() {
    let mut spec = minimal_chart_spec(DomainChartType::Pie, None);
    spec.series = vec![modeled_series(0, None, "Composition", "Data!$B$2:$B$4")];
    spec.data_labels = Some(data_label_data());
    spec.definition = Some(ChartDefinition::Chart(ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![ChartGroup {
                    chart_type: OoxmlChartType::Pie,
                    config: ChartTypeConfig::Pie(PieChartConfig::default()),
                    series: vec![ChartSeries {
                        idx: 0,
                        order: 0,
                        ..Default::default()
                    }],
                    d_lbls: Some(imported_data_label_options()),
                    ax_id: Vec::new(),
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

    let xml = chart_xml(&spec);

    assert!(xml.contains("<c:pieChart>"), "{xml}");
    assert!(xml.contains("baseline=\"0\""), "{xml}");
    assert!(xml.contains("lang=\"en-US\""), "{xml}");
}

#[test]
fn series_leader_line_alias_reconstructs_data_label_leader_lines() {
    let mut spec = minimal_chart_spec(DomainChartType::Pie, None);
    let mut series = modeled_series(0, None, "Composition", "Data!$B$2:$B$4");
    series.show_leader_lines = Some(true);
    series.leader_line_format = Some(ChartFormatData {
        fill: None,
        line: Some(ChartLineData {
            color: Some(ChartColorData::Hex("FF0000".to_string())),
            width: Some(2.0),
            dash_style: Some(ChartDashStyle::Dash),
            transparency: None,
            no_fill: None,
        }),
        font: None,
        text_rotation: None,
        text_vertical_type: None,
        shadow: None,
    });
    spec.series = vec![series];

    let xml = chart_xml(&spec);

    assert!(xml.contains("<c:dLbls>"), "{xml}");
    assert!(xml.contains("<c:showLeaderLines val=\"1\"/>"), "{xml}");
    assert!(xml.contains("<c:leaderLines>"), "{xml}");
    assert!(xml.contains("<a:ln w=\"25400\">"), "{xml}");
    assert!(xml.contains("<a:srgbClr val=\"FF0000\"/>"), "{xml}");
    assert!(xml.contains("<a:prstDash val=\"dash\"/>"), "{xml}");
}

fn imported_data_label_options() -> DataLabelOptions {
    DataLabelOptions {
        show_value: true,
        show_value_present: true,
        tx_pr: Some(crate::domain::charts::parse_text_body(
            br#"<c:txPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:bodyPr/>
                <a:p>
                    <a:pPr>
                        <a:defRPr baseline="0"/>
                    </a:pPr>
                    <a:endParaRPr lang="en-US"/>
                </a:p>
            </c:txPr>"#,
        )),
        ..Default::default()
    }
}

fn data_label_data() -> DataLabelData {
    DataLabelData {
        show: true,
        delete: None,
        position: None,
        format: None,
        show_value: Some(true),
        show_category_name: None,
        show_series_name: None,
        show_percentage: None,
        show_bubble_size: None,
        show_legend_key: None,
        separator: None,
        show_leader_lines: None,
        text: None,
        visual_format: None,
        number_format: None,
        text_orientation: None,
        rich_text: None,
        auto_text: None,
        horizontal_alignment: None,
        vertical_alignment: None,
        link_number_format: None,
        geometric_shape_type: None,
        formula: None,
        height: None,
        width: None,
        leader_lines_format: None,
        layout: None,
    }
}
