use super::*;
use ooxml_types::charts::{
    BarChartConfig, ChartGroup, ChartType as OoxmlChartType, ChartTypeConfig,
};

#[test]
fn stale_imported_chart_group_series_ids_fall_back_to_modeled_series() {
    let mut spec = minimal_chart_spec(DomainChartType::Column, None);
    spec.definition = Some(ChartDefinition::Chart(ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![ChartGroup {
                    chart_type: OoxmlChartType::Bar,
                    config: ChartTypeConfig::Bar(BarChartConfig::default()),
                    series: vec![ooxml_types::charts::ChartSeries {
                        idx: 5,
                        order: 5,
                        ..Default::default()
                    }],
                    d_lbls: None,
                    ax_id: vec![111111111, 222222222],
                    raw_chart_type_attr: None,
                    raw_chart_element_name: None,
                    raw_chart_group_xml: None,
                }],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    }));
    spec.series = vec![modeled_series(0, None, "North", "Data!$B$2:$B$4")];

    let xml = chart_xml(&spec);

    assert_eq!(xml.matches("<c:ser>").count(), 1, "{xml}");
    assert!(xml.contains("<c:f>Data!$B$2:$B$4</c:f>"), "{xml}");
    assert!(!xml.contains("<c:idx val=\"5\"/>"), "{xml}");
}
