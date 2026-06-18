use domain_types::chart::ChartType as DomainChartType;

use super::{chart_group_xml, chart_xml, minimal_chart_spec, modeled_series};

#[test]
fn series_bubble_3d_reconstructs_into_bubble_series() {
    let mut spec = minimal_chart_spec(DomainChartType::Bubble, None);
    let mut series = modeled_series(0, None, "Bubbles", "Data!$B$2:$B$4");
    series.categories = Some("Data!$A$2:$A$4".to_string());
    series.bubble_size = Some("Data!$C$2:$C$4".to_string());
    series.bubble_3d = Some(true);
    spec.series = vec![series];

    let xml = chart_xml(&spec);
    let bubble_xml = chart_group_xml(&xml, "<c:bubbleChart>", "</c:bubbleChart>");
    let series_xml = chart_group_xml(bubble_xml, "<c:ser>", "</c:ser>");

    assert!(series_xml.contains("<c:bubble3D val=\"1\"/>"), "{xml}");
}
