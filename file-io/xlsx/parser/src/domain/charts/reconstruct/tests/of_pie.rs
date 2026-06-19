use domain_types::chart::ChartType as DomainChartType;

use super::{chart_xml, minimal_chart_spec};

#[test]
fn public_of_pie_scalars_reconstruct_to_ooxml_config() {
    let mut spec = minimal_chart_spec(DomainChartType::OfPie, None);
    spec.split_type = Some("custom".to_string());
    spec.split_value = Some(42.0);
    spec.second_plot_size = Some(42);

    let xml = chart_xml(&spec);

    assert!(xml.contains("<c:ofPieChart>"), "{xml}");
    assert!(xml.contains("<c:splitType val=\"cust\"/>"), "{xml}");
    assert!(xml.contains("<c:splitPos val=\"42\"/>"), "{xml}");
    assert!(xml.contains("<c:secondPieSize val=\"42\"/>"), "{xml}");
}
