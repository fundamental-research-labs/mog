use super::*;

fn authored_chart_ex(chart_type: ChartType) -> ChartSpec {
    let mut chart = make_chart(chart_type, "");
    chart.definition = Some(domain_types::ChartDefinition::ChartEx(
        ooxml_types::chart_ex::ChartExSpace::default(),
    ));
    chart.is_chart_ex = true;
    chart
}

#[test]
fn sdk_authored_chart_ex_serializes_modeled_family_state() {
    let mut waterfall = authored_chart_ex(ChartType::Waterfall);
    waterfall.waterfall = Some(domain_types::chart::WaterfallOptions {
        subtotal_indices: vec![2],
        show_connector_lines: Some(true),
    });

    let mut histogram = authored_chart_ex(ChartType::Histogram);
    histogram.histogram = Some(domain_types::chart::HistogramConfigData {
        bin_count: Some(8),
        bin_width: Some(2.5),
        underflow_bin: Some(true),
        underflow_bin_value: Some(1.0),
        overflow_bin: Some(false),
        overflow_bin_value: None,
        cumulative: Some(true),
    });

    let mut boxplot = authored_chart_ex(ChartType::Boxplot);
    boxplot.boxplot = Some(domain_types::chart::BoxplotConfigData {
        show_outliers: Some(false),
        show_outlier_points: Some(false),
        show_mean: Some(true),
        show_mean_markers: Some(true),
        show_mean_line: Some(true),
        quartile_method: Some("exclusive".to_string()),
        whisker_type: Some("tukey".to_string()),
    });

    let mut treemap = authored_chart_ex(ChartType::Treemap);
    treemap.hierarchy = Some(domain_types::chart::HierarchyChartConfigData {
        category_formulas: vec!["=Data!$A$1:$A$2".to_string()],
        value_formula: Some("=Data!$B$1:$B$2".to_string()),
        parent_label_layout: Some("banner".to_string()),
        ..Default::default()
    });

    let mut region_map = authored_chart_ex(ChartType::RegionMap);
    region_map.region_map = Some(domain_types::chart::RegionMapConfigData {
        region_formula: Some("=Data!$A$1:$A$2".to_string()),
        value_formula: Some("=Data!$B$1:$B$2".to_string()),
    });

    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        charts: vec![waterfall, histogram, boxplot, treemap, region_map],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let waterfall_xml =
        String::from_utf8(archive.read_file("xl/charts/chartEx1.xml").unwrap()).unwrap();
    let histogram_xml =
        String::from_utf8(archive.read_file("xl/charts/chartEx2.xml").unwrap()).unwrap();
    let boxplot_xml =
        String::from_utf8(archive.read_file("xl/charts/chartEx3.xml").unwrap()).unwrap();
    let treemap_xml =
        String::from_utf8(archive.read_file("xl/charts/chartEx4.xml").unwrap()).unwrap();
    let region_map_xml =
        String::from_utf8(archive.read_file("xl/charts/chartEx5.xml").unwrap()).unwrap();

    assert!(waterfall_xml.contains(r#"layoutId="waterfall""#));
    assert!(waterfall_xml.contains(r#"connectorLines="1""#));
    assert!(waterfall_xml.contains(r#"<cx:idx val="2"/>"#));

    assert!(histogram_xml.contains(r#"layoutId="histogram""#));
    assert!(histogram_xml.contains(r#"underflow="1""#));
    assert!(histogram_xml.contains(r#"overflow="auto""#));
    assert!(histogram_xml.contains(r#"<cx:binSize val="2.5"/>"#));
    assert!(histogram_xml.contains(r#"<cx:binCount val="8"/>"#));

    assert!(boxplot_xml.contains(r#"layoutId="boxWhisker""#));
    assert!(boxplot_xml.contains(r#"meanLine="1""#));
    assert!(boxplot_xml.contains(r#"meanMarker="1""#));
    assert!(boxplot_xml.contains(r#"outlierPoints="0""#));
    assert!(boxplot_xml.contains(r#"<cx:statistics quartileMethod="exclusive"/>"#));

    assert!(treemap_xml.contains(r#"layoutId="treemap""#));
    assert!(treemap_xml.contains(r#"<cx:parentLabelLayout val="banner"/>"#));
    assert!(treemap_xml.contains(r#"<cx:strDim type="cat">"#));
    assert!(treemap_xml.contains(r#"<cx:numDim type="size">"#));
    assert!(treemap_xml.contains("Data!$A$1:$A$2"));
    assert!(treemap_xml.contains("Data!$B$1:$B$2"));

    assert!(region_map_xml.contains(r#"layoutId="regionMap""#));
    assert!(region_map_xml.contains(r#"<cx:strDim type="cat">"#));
    assert!(region_map_xml.contains(r#"<cx:numDim type="val">"#));
    assert!(region_map_xml.contains("Data!$A$1:$A$2"));
    assert!(region_map_xml.contains("Data!$B$1:$B$2"));

    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}
