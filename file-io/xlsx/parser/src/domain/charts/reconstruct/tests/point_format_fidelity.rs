use domain_types::chart::{
    ChartBorderData, ChartColorData, ChartDashStyle, ChartLineData, ChartType as DomainChartType,
    PointFormatData,
};

use super::{chart_group_xml, chart_xml, minimal_chart_spec, modeled_series};

fn point_format(idx: u32) -> PointFormatData {
    PointFormatData {
        idx,
        invert_if_negative: None,
        explosion: None,
        bubble_3d: None,
        fill: None,
        border: None,
        line_format: None,
        data_label: None,
        visual_format: None,
        marker_background_color: None,
        marker_foreground_color: None,
        marker_size: None,
        marker_style: None,
    }
}

#[test]
fn point_fill_and_border_aliases_reconstruct_to_single_shape_properties() {
    let mut spec = minimal_chart_spec(DomainChartType::Area, None);
    let mut series = modeled_series(0, None, "North", "Data!$B$2:$B$4");
    let mut point = point_format(0);
    point.fill = Some("#ED7D31".to_string());
    point.border = Some(ChartBorderData {
        color: Some("#A5A5A5".to_string()),
        width: Some(2.0),
        style: Some("dash".to_string()),
    });
    series.points = Some(vec![point]);
    spec.series = vec![series];

    let xml = chart_xml(&spec);
    let area_xml = chart_group_xml(&xml, "<c:areaChart>", "</c:areaChart>");
    let series_xml = chart_group_xml(area_xml, "<c:ser>", "</c:ser>");
    let point_xml = chart_group_xml(series_xml, "<c:dPt>", "</c:dPt>");

    assert_eq!(point_xml.matches("<c:spPr>").count(), 1, "{point_xml}");
    assert!(
        point_xml.contains(r#"<a:srgbClr val="ED7D31"/>"#),
        "{point_xml}"
    );
    assert!(point_xml.contains(r#"<a:ln w="25400">"#), "{point_xml}");
    assert!(
        point_xml.contains(r#"<a:srgbClr val="A5A5A5"/>"#),
        "{point_xml}"
    );
    assert!(
        point_xml.contains(r#"<a:prstDash val="dash"/>"#),
        "{point_xml}"
    );
}

#[test]
fn point_legacy_fill_merges_with_line_format() {
    let mut spec = minimal_chart_spec(DomainChartType::Area, None);
    let mut series = modeled_series(0, None, "North", "Data!$B$2:$B$4");
    let mut point = point_format(0);
    point.fill = Some("ED7D31".to_string());
    point.line_format = Some(ChartLineData {
        color: Some(ChartColorData::Hex("A5A5A5".to_string())),
        width: Some(2.0),
        dash_style: Some(ChartDashStyle::Dash),
        transparency: None,
        no_fill: None,
    });
    series.points = Some(vec![point]);
    spec.series = vec![series];

    let xml = chart_xml(&spec);
    let area_xml = chart_group_xml(&xml, "<c:areaChart>", "</c:areaChart>");
    let series_xml = chart_group_xml(area_xml, "<c:ser>", "</c:ser>");
    let point_xml = chart_group_xml(series_xml, "<c:dPt>", "</c:dPt>");

    assert!(
        point_xml.contains(r#"<a:srgbClr val="ED7D31"/>"#),
        "{point_xml}"
    );
    assert!(point_xml.contains(r#"<a:ln w="25400">"#), "{point_xml}");
    assert!(
        point_xml.contains(r#"<a:srgbClr val="A5A5A5"/>"#),
        "{point_xml}"
    );
    assert!(
        point_xml.contains(r#"<a:prstDash val="dash"/>"#),
        "{point_xml}"
    );
}
