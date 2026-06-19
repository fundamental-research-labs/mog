use domain_types::chart::ChartType as DomainChartType;

use super::{chart_group_xml, chart_xml, minimal_chart_spec, modeled_series};

#[test]
fn bubble_scalars_reconstruct_into_modeled_chart_group() {
    let mut spec = minimal_chart_spec(DomainChartType::Bubble, None);
    spec.bubble_scale = Some(175);
    spec.show_neg_bubbles = Some(true);
    spec.size_represents = Some("w".to_string());
    spec.bubble_3d_effect = Some(true);

    let xml = chart_xml(&spec);

    assert!(xml.contains("<c:bubbleChart>"), "{xml}");
    assert!(xml.contains("<c:bubbleScale val=\"175\"/>"), "{xml}");
    assert!(xml.contains("<c:showNegBubbles val=\"1\"/>"), "{xml}");
    assert!(xml.contains("<c:sizeRepresents val=\"w\"/>"), "{xml}");
    assert!(xml.contains("<c:bubble3D val=\"1\"/>"), "{xml}");
}

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
