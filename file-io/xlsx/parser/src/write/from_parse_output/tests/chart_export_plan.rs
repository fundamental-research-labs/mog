use super::*;

#[test]
fn current_imported_chart_with_formula_refs_without_caches_replays_original_chart_space() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B3");
    imported_chart.data_range = None;
    imported_chart.series = vec![domain_types::chart::ChartSeriesData {
        name: Some("Revenue".to_string()),
        values: Some("Data!B2:B3".to_string()),
        value_source_kind: Some(domain_types::chart::ChartSeriesDimensionSourceKindData::Ref),
        categories: Some("Data!A2:A3".to_string()),
        category_source_kind: Some(domain_types::chart::ChartSeriesDimensionSourceKindData::Ref),
        category_source_type: Some(domain_types::chart::ChartSeriesCategorySourceTypeData::String),
        idx: Some(0),
        order: Some(0),
        ..Default::default()
    }];
    imported_chart.definition = Some(domain_types::ChartDefinition::Chart(
        crate::domain::charts::reconstruct::reconstruct_chart_space_for_sheet(
            &imported_chart,
            "Data",
        ),
    ));
    let imported_chart = with_current_standard_chart_authority(imported_chart);

    assert_eq!(
        chart_replay::standard_chart_export_plan(&imported_chart),
        chart_replay::StandardChartExportPlan::ReplayImportedChartSpace
    );

    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
            make_cell(2, 0, DomainValue::Text(Arc::from("Q2"))),
            make_cell(2, 1, DomainValue::Number(FiniteF64::new(200.0).unwrap())),
        ],
        charts: vec![imported_chart],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();

    assert!(chart_xml.contains("<c:f>Data!A2:A3</c:f>"), "{chart_xml}");
    assert!(chart_xml.contains("<c:f>Data!B2:B3</c:f>"), "{chart_xml}");
    assert!(!chart_xml.contains("<c:strCache>"), "{chart_xml}");
    assert!(!chart_xml.contains("<c:numCache>"), "{chart_xml}");
    assert!(!chart_xml.contains("<c:v>Q1</c:v>"), "{chart_xml}");
    assert!(!chart_xml.contains("<c:v>100</c:v>"), "{chart_xml}");
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}
