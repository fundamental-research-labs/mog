use super::*;
use crate::domain::charts::axes::parse_axis;
use domain_types::chart::ChartFormatStringData;
use ooxml_types::charts::{self, AxisCrosses, ChartText, TickLabelPosition, TickMark};

#[test]
fn parse_axis_tracks_optional_shared_element_presence() {
    let explicit_xml = br#"<c:catAx>
        <c:axId val="123456"/>
        <c:delete val="0"/>
        <c:majorTickMark val="out"/>
        <c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/>
        <c:crosses val="autoZero"/>
    </c:catAx>"#;
    let explicit = parse_axis(explicit_xml);
    assert!(explicit.delete_explicit);
    assert!(explicit.major_tick_mark_explicit);
    assert!(explicit.minor_tick_mark_explicit);
    assert!(explicit.tick_lbl_pos_explicit);
    assert!(explicit.crosses_explicit);

    let omitted_xml = br#"<c:catAx>
        <c:axId val="123456"/>
        <c:axPos val="b"/>
        <c:crossAx val="654321"/>
    </c:catAx>"#;
    let omitted = parse_axis(omitted_xml);
    assert!(!omitted.delete_explicit);
    assert!(!omitted.major_tick_mark_explicit);
    assert!(!omitted.minor_tick_mark_explicit);
    assert!(!omitted.tick_lbl_pos_explicit);
    assert!(!omitted.crosses_explicit);
}

#[test]
fn imported_axis_omitted_shared_defaults_remain_omitted() {
    let mut spec = minimal_chart_spec(DomainChartType::Column3D, None);
    spec.axes = Some(AxisData {
        category_axis: Some(SingleAxisData {
            visible: true,
            title: Some("Planet".to_string()),
            tick_marks: Some("none".to_string()),
            minor_tick_marks: Some("none".to_string()),
            ..Default::default()
        }),
        value_axis: Some(SingleAxisData {
            visible: true,
            title: Some("Earth = 1.0".to_string()),
            tick_marks: Some("none".to_string()),
            minor_tick_marks: Some("none".to_string()),
            ..Default::default()
        }),
        series_axis: Some(SingleAxisData {
            visible: true,
            tick_marks: Some("none".to_string()),
            minor_tick_marks: Some("none".to_string()),
            ..Default::default()
        }),
        secondary_category_axis: None,
        secondary_value_axis: None,
    });
    let spec = with_original_axes(
        spec,
        vec![
            imported_left_axis(AxisType::Category, 10, 100),
            imported_left_axis(AxisType::Value, 100, 10),
            imported_left_axis(AxisType::Series, 1000, 10),
        ],
    );

    let xml = chart_xml(&spec);

    assert_eq!(xml.matches("<c:majorTickMark val=\"none\"/>").count(), 3);
    assert_eq!(xml.matches("<c:minorTickMark val=\"none\"/>").count(), 3);
    assert!(!xml.contains("<c:tickLblPos"), "{xml}");
    assert!(!xml.contains("<c:delete val=\"0\"/>"), "{xml}");
    assert!(!xml.contains("<c:crosses val=\"autoZero\"/>"), "{xml}");
}

#[test]
fn imported_explicit_next_to_tick_label_position_is_preserved() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, None);
    spec.axes = Some(AxisData {
        category_axis: Some(SingleAxisData {
            visible: true,
            tick_label_position: Some("nextTo".to_string()),
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

    let spec = with_original_axes(
        spec,
        vec![
            imported_left_axis(AxisType::Category, 10, 100),
            imported_left_axis(AxisType::Value, 100, 10),
        ],
    );

    let xml = chart_xml(&spec);

    assert_eq!(xml.matches("<c:tickLblPos val=\"nextTo\"/>").count(), 1);
    assert!(!xml.contains("<c:delete val=\"0\"/>"), "{xml}");
    assert!(!xml.contains("<c:crosses val=\"autoZero\"/>"), "{xml}");
}

#[test]
fn imported_category_axis_preserves_auto() {
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

    let mut category_axis = imported_left_axis(AxisType::Category, 10, 100);
    category_axis.auto = Some(true);
    let spec = with_original_axes(
        spec,
        vec![category_axis, imported_left_axis(AxisType::Value, 100, 10)],
    );

    let xml = chart_xml(&spec);

    assert!(xml.contains("<c:auto val=\"1\"/>"), "{xml}");
}

#[test]
fn imported_axis_title_preserves_unmodeled_rich_text_properties() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, None);
    spec.axes = Some(AxisData {
        category_axis: Some(SingleAxisData {
            visible: true,
            ..Default::default()
        }),
        value_axis: Some(SingleAxisData {
            visible: true,
            title: Some("Rainfall".to_string()),
            title_rich_text: Some(vec![
                ChartFormatStringData {
                    text: "Rain".to_string(),
                    font: None,
                },
                ChartFormatStringData {
                    text: "fall".to_string(),
                    font: None,
                },
            ]),
            ..Default::default()
        }),
        secondary_category_axis: None,
        secondary_value_axis: None,
        series_axis: None,
    });

    let mut value_axis = imported_left_axis(AxisType::Value, 100, 10);
    value_axis.title = Some(charts::Title {
        tx: Some(ChartText::Rich(crate::domain::charts::parse_text_body(
            br#"<c:rich xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:bodyPr rot="5400000" vert="vert"/>
                <a:p>
                    <a:r>
                        <a:rPr lang="en-US"/>
                        <a:t>Rain</a:t>
                    </a:r>
                    <a:r>
                        <a:rPr lang="en-US"/>
                        <a:t>fall</a:t>
                    </a:r>
                </a:p>
            </c:rich>"#,
        ))),
        ..Default::default()
    });
    let spec = with_original_axes(
        spec,
        vec![imported_left_axis(AxisType::Category, 10, 100), value_axis],
    );

    let xml = chart_xml(&spec);

    assert!(xml.contains("rot=\"5400000\""), "{xml}");
    assert!(xml.contains("vert=\"vert\""), "{xml}");
    assert_eq!(xml.matches("lang=\"en-US\"").count(), 2, "{xml}");
}

#[test]
fn imported_axis_text_properties_preserve_unmodeled_run_properties() {
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

    let mut category_axis = imported_left_axis(AxisType::Category, 10, 100);
    category_axis.tx_pr = Some(crate::domain::charts::parse_text_body(
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
    ));
    let spec = with_original_axes(
        spec,
        vec![category_axis, imported_left_axis(AxisType::Value, 100, 10)],
    );

    let xml = chart_xml(&spec);

    assert!(xml.contains("baseline=\"0\""), "{xml}");
    assert!(xml.contains("lang=\"en-US\""), "{xml}");
}

#[test]
fn imported_explicit_visible_axis_serializes_delete_false_from_domain() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, None);
    spec.axes = Some(AxisData {
        category_axis: Some(SingleAxisData {
            visible: true,
            visible_explicit: true,
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
    let spec = with_original_axes(
        spec,
        vec![
            imported_left_axis(AxisType::Category, 10, 100),
            imported_left_axis(AxisType::Value, 100, 10),
        ],
    );

    let xml = chart_xml(&spec);

    assert_eq!(xml.matches("<c:delete val=\"0\"/>").count(), 1);
}

#[test]
fn imported_hidden_axis_serializes_delete_true() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, None);
    spec.axes = Some(AxisData {
        category_axis: Some(SingleAxisData {
            visible: false,
            position: Some("b".to_string()),
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
    let spec = with_original_axes(
        spec,
        vec![
            imported_left_axis(AxisType::Category, 10, 100),
            imported_left_axis(AxisType::Value, 100, 10),
        ],
    );

    let xml = chart_xml(&spec);

    assert_eq!(xml.matches("<c:delete val=\"1\"/>").count(), 1);
    assert!(!xml.contains("<c:delete val=\"0\"/>"), "{xml}");
}

#[test]
fn authored_axes_still_emit_explicit_shared_defaults() {
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

    let xml = chart_xml(&spec);

    assert_eq!(xml.matches("<c:delete val=\"0\"/>").count(), 2);
    assert_eq!(xml.matches("<c:majorTickMark val=\"cross\"/>").count(), 2);
    assert_eq!(xml.matches("<c:minorTickMark val=\"cross\"/>").count(), 2);
    assert_eq!(xml.matches("<c:tickLblPos val=\"nextTo\"/>").count(), 2);
    assert_eq!(xml.matches("<c:crosses val=\"autoZero\"/>").count(), 2);
}

#[test]
fn authored_bar_axes_without_positions_use_horizontal_bar_axis_sides() {
    let mut spec = minimal_chart_spec(DomainChartType::Bar, None);
    spec.axes = Some(AxisData {
        category_axis: Some(SingleAxisData {
            visible: true,
            tick_label_position: Some("nextTo".to_string()),
            ..Default::default()
        }),
        value_axis: Some(SingleAxisData {
            visible: true,
            tick_label_position: Some("nextTo".to_string()),
            ..Default::default()
        }),
        secondary_category_axis: None,
        secondary_value_axis: None,
        series_axis: None,
    });

    let xml = chart_xml(&spec);

    assert!(xml.contains("<c:barDir val=\"bar\"/>"), "{xml}");
    assert!(xml.contains("<c:catAx><c:axId val=\"111111111\"/><c:scaling><c:orientation val=\"minMax\"/></c:scaling><c:delete val=\"0\"/><c:axPos val=\"l\"/>"), "{xml}");
    assert!(xml.contains("<c:valAx><c:axId val=\"222222222\"/><c:scaling><c:orientation val=\"minMax\"/></c:scaling><c:delete val=\"0\"/><c:axPos val=\"b\"/>"), "{xml}");
    assert_eq!(xml.matches("<c:tickLblPos val=\"nextTo\"/>").count(), 2);
}

fn imported_left_axis(axis_type: AxisType, ax_id: u32, cross_ax: u32) -> ChartAxis {
    ChartAxis {
        axis_type,
        ax_id,
        cross_ax,
        ax_pos: ChartAxisPosition::Left,
        major_tick_mark: TickMark::None,
        major_tick_mark_explicit: false,
        minor_tick_mark: TickMark::None,
        minor_tick_mark_explicit: false,
        tick_lbl_pos: TickLabelPosition::NextTo,
        tick_lbl_pos_explicit: false,
        crosses: AxisCrosses::AutoZero,
        crosses_explicit: false,
        delete: false,
        delete_explicit: false,
        ..Default::default()
    }
}
