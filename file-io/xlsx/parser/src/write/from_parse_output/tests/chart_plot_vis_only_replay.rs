use super::*;

fn plot_vis_only_current_imported_chart(plot_vis_only: Option<bool>) -> ChartSpec {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.plot_visible_only = plot_vis_only;
    imported_chart.definition = Some(domain_types::ChartDefinition::Chart(
        ooxml_types::charts::ChartSpace {
            chart: ooxml_types::charts::Chart {
                plot_vis_only,
                ..Default::default()
            },
            ..Default::default()
        },
    ));
    with_current_standard_chart_authority(imported_chart)
}

fn write_single_chart_xml(chart: ChartSpec) -> String {
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![chart],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
    String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap()
}

#[test]
fn current_imported_standard_chart_preserves_absent_plot_vis_only() {
    let chart_xml = write_single_chart_xml(plot_vis_only_current_imported_chart(None));

    assert!(!chart_xml.contains("<c:plotVisOnly"));
}

#[test]
fn current_imported_standard_chart_preserves_explicit_false_plot_vis_only() {
    let chart_xml = write_single_chart_xml(plot_vis_only_current_imported_chart(Some(false)));

    assert!(chart_xml.contains(r#"<c:plotVisOnly val="0"/>"#));
}
