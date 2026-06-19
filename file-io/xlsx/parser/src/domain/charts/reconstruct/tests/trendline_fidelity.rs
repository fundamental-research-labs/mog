use domain_types::chart::{ChartType as DomainChartType, TrendlineData};

use super::{chart_group_xml, chart_xml, minimal_chart_spec, modeled_series};

#[test]
fn trendline_public_type_and_line_aliases_reconstruct_to_ooxml() {
    let mut spec = minimal_chart_spec(DomainChartType::Scatter, None);
    let mut series = modeled_series(0, None, "North", "Data!$B$2:$B$4");
    series.trendlines = Some(vec![TrendlineData {
        show: Some(true),
        r#type: Some("exponential".to_string()),
        color: Some("#FFC000".to_string()),
        line_width: Some(3.0),
        order: None,
        period: None,
        forward: None,
        backward: None,
        intercept: None,
        display_equation: None,
        display_r_squared: None,
        name: None,
        line_format: None,
        label: None,
    }]);
    spec.series = vec![series];

    let xml = chart_xml(&spec);
    let scatter_xml = chart_group_xml(&xml, "<c:scatterChart>", "</c:scatterChart>");
    let series_xml = chart_group_xml(scatter_xml, "<c:ser>", "</c:ser>");
    let trendline_xml = chart_group_xml(series_xml, "<c:trendline>", "</c:trendline>");

    assert!(
        trendline_xml.contains(r#"<c:trendlineType val="exp"/>"#),
        "{trendline_xml}"
    );
    assert!(
        trendline_xml.contains(r#"<a:ln w="38100">"#),
        "{trendline_xml}"
    );
    assert!(
        trendline_xml.contains(r#"<a:srgbClr val="FFC000"/>"#),
        "{trendline_xml}"
    );
}
