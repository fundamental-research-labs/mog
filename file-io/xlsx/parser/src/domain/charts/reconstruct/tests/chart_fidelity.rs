use super::*;
use domain_types::ChartDefinition;
use domain_types::chart::{DataLabelData, LegendData};
use domain_types::domain::drawings::{LayoutMode, LayoutTarget, ManualLayout};
use ooxml_types::charts::{Chart, ChartSpace};

#[test]
fn manual_layouts_reconstruct_for_chart_level_surfaces() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, Some("Data!A1:B3"));
    spec.plot_layout = Some(ManualLayout {
        layout_target: Some(LayoutTarget::Inner),
        x: Some(0.125),
        y: Some(0.25),
        w: Some(0.75),
        h: Some(0.5),
        ..Default::default()
    });
    spec.title_layout = Some(ManualLayout {
        x_mode: Some(LayoutMode::Edge),
        x: Some(0.375),
        y: Some(0.0625),
        ..Default::default()
    });
    spec.legend = Some(LegendData {
        show: true,
        position: "right".to_string(),
        visible: true,
        overlay: None,
        format: None,
        entries: None,
        custom_x: None,
        custom_y: None,
        layout: Some(ManualLayout {
            layout_target: Some(LayoutTarget::Outer),
            x: Some(0.875),
            y: Some(0.125),
            ..Default::default()
        }),
        shadow: None,
        show_shadow: None,
    });
    spec.data_labels = Some(DataLabelData {
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
        layout: Some(ManualLayout {
            y_mode: Some(LayoutMode::Edge),
            x: Some(0.3125),
            y: Some(0.4375),
            ..Default::default()
        }),
    });

    let xml = chart_xml(&spec);

    assert_eq!(xml.matches("<c:layout>").count(), 4);
    assert!(xml.contains("<c:layoutTarget val=\"inner\"/>"));
    assert!(xml.contains("<c:layoutTarget val=\"outer\"/>"));
    assert!(xml.contains("<c:xMode val=\"edge\"/>"));
    assert!(xml.contains("<c:yMode val=\"edge\"/>"));
    assert!(xml.contains("<c:x val=\"0.125\"/>"));
    assert!(xml.contains("<c:x val=\"0.375\"/>"));
    assert!(xml.contains("<c:x val=\"0.3125\"/>"));
    assert!(xml.contains("<c:x val=\"0.875\"/>"));
    assert!(xml.contains("<c:showVal val=\"1\"/>"));
}

#[test]
fn imported_legend_text_properties_preserve_unmodeled_run_properties() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, Some("Data!A1:B3"));
    spec.legend = Some(LegendData {
        show: true,
        position: "right".to_string(),
        visible: true,
        overlay: None,
        format: None,
        entries: None,
        custom_x: None,
        custom_y: None,
        layout: None,
        shadow: None,
        show_shadow: None,
    });
    spec.definition = Some(ChartDefinition::Chart(ChartSpace {
        chart: Chart {
            legend: Some(ooxml_types::charts::Legend {
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
            }),
            ..Default::default()
        },
        ..Default::default()
    }));

    let xml = chart_xml(&spec);

    assert!(xml.contains("baseline=\"0\""), "{xml}");
    assert!(xml.contains("lang=\"en-US\""), "{xml}");
}
