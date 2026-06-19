use domain_types::chart::ChartType as DomainChartType;

use super::{chart_xml, minimal_chart_spec};

#[test]
fn surface_top_view_selects_ooxml_surface_chart_element() {
    let mut spec = minimal_chart_spec(DomainChartType::Surface3D, Some("Data!A1:B3"));
    spec.surface_top_view = Some(true);
    spec.wireframe = Some(true);

    let xml = chart_xml(&spec);

    assert!(xml.contains("<c:surfaceChart>"), "{xml}");
    assert!(!xml.contains("<c:surface3DChart>"), "{xml}");
    assert!(xml.contains("<c:wireframe val=\"1\"/>"), "{xml}");
}

#[test]
fn explicit_non_top_view_selects_ooxml_surface_3d_chart_element() {
    let mut spec = minimal_chart_spec(DomainChartType::Surface, Some("Data!A1:B3"));
    spec.surface_top_view = Some(false);

    let xml = chart_xml(&spec);

    assert!(xml.contains("<c:surface3DChart>"), "{xml}");
    assert!(!xml.contains("<c:surfaceChart>"), "{xml}");
}
