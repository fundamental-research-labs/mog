use domain_types::chart::ChartType as DomainChartType;

use super::{chart_group_xml, chart_xml, minimal_chart_spec, modeled_series};

#[test]
fn chart_level_smooth_scatter_reconstructs_smooth_style() {
    let mut spec = minimal_chart_spec(DomainChartType::Scatter, None);
    spec.show_lines = Some(true);
    spec.smooth_lines = Some(true);

    let xml = chart_xml(&spec);
    let scatter_xml = chart_group_xml(&xml, "<c:scatterChart>", "</c:scatterChart>");

    assert!(
        scatter_xml.contains("<c:scatterStyle val=\"smooth\"/>"),
        "{xml}"
    );
}

#[test]
fn series_show_lines_reconstructs_line_scatter_style() {
    let mut spec = minimal_chart_spec(DomainChartType::Scatter, None);
    let mut series = modeled_series(0, None, "Points", "Data!$B$2:$B$4");
    series.show_lines = Some(true);
    spec.series = vec![series];

    let xml = chart_xml(&spec);
    let scatter_xml = chart_group_xml(&xml, "<c:scatterChart>", "</c:scatterChart>");

    assert!(
        scatter_xml.contains("<c:scatterStyle val=\"line\"/>"),
        "{xml}"
    );
}
