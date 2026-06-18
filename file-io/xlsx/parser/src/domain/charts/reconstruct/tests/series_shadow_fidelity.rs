use domain_types::chart::ChartType as DomainChartType;

use super::{chart_group_xml, chart_xml, minimal_chart_spec, modeled_series};

#[test]
fn series_show_shadow_reconstructs_to_shape_effects() {
    let mut spec = minimal_chart_spec(DomainChartType::Area, None);
    let mut series = modeled_series(0, None, "North", "Data!$B$2:$B$4");
    series.show_shadow = Some(true);
    spec.series = vec![series];

    let xml = chart_xml(&spec);
    let area_xml = chart_group_xml(&xml, "<c:areaChart>", "</c:areaChart>");
    let series_xml = chart_group_xml(area_xml, "<c:ser>", "</c:ser>");

    assert!(series_xml.contains("<c:spPr>"), "{series_xml}");
    assert!(series_xml.contains("<a:effectLst>"), "{series_xml}");
    assert!(series_xml.contains("<a:outerShdw"), "{series_xml}");
}
