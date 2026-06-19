use super::{chart_xml, minimal_chart_spec};
use domain_types::chart::{ChartSubType, ChartType as DomainChartType};

#[test]
fn vary_by_categories_reconstructs_for_standard_chart_groups() {
    for chart_type in [
        DomainChartType::Area,
        DomainChartType::Area3D,
        DomainChartType::Bar,
        DomainChartType::Bar3D,
        DomainChartType::Bubble,
        DomainChartType::Column,
        DomainChartType::Column3D,
        DomainChartType::Line,
        DomainChartType::Line3D,
        DomainChartType::Radar,
        DomainChartType::Scatter,
    ] {
        let mut spec = minimal_chart_spec(chart_type.clone(), None);
        spec.vary_by_categories = Some(true);

        let xml = chart_xml(&spec);

        assert!(
            xml.contains(r#"<c:varyColors val="1"/>"#),
            "missing varyColors for {chart_type:?}\n{xml}"
        );
    }
}

#[test]
fn line_marker_subtypes_reconstruct_marker_grouping_and_vary_colors() {
    for (sub_type, grouping) in [
        (ChartSubType::Markers, "standard"),
        (ChartSubType::MarkersStacked, "stacked"),
        (ChartSubType::MarkersPercentStacked, "percentStacked"),
    ] {
        let mut spec = minimal_chart_spec(DomainChartType::Line, None);
        spec.sub_type = Some(sub_type);
        spec.vary_by_categories = Some(true);

        let xml = chart_xml(&spec);

        assert!(
            xml.contains(&format!(r#"<c:grouping val="{grouping}"/>"#)),
            "{xml}"
        );
        assert!(xml.contains(r#"<c:varyColors val="1"/>"#), "{xml}");
        assert!(xml.contains(r#"<c:marker val="1"/>"#), "{xml}");
    }
}
