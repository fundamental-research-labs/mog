use super::*;

#[test]
fn generated_chart_does_not_inherit_stale_auxiliary_parts_by_local_index() {
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![make_chart(ChartType::Column, "Data!A1:B2")],
        ..Default::default()
    }]);
    let ctx = chart_auxiliary_roundtrip_context();

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(archive.contains("xl/charts/chart1.xml"));
    assert!(!archive.contains("xl/charts/chart9.xml"));
    assert!(!archive.contains("xl/charts/style9.xml"));
    assert!(!archive.contains("xl/charts/_rels/chart1.xml.rels"));
    assert!(!content_types.contains("/xl/charts/style9.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_chart_with_modeled_state_does_not_replay_stale_raw_chart_xml() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.title = Some("Modeled Revenue".to_string());
    imported_chart.definition = Some(domain_types::ChartDefinition::Chart(
        ooxml_types::charts::ChartSpace::default(),
    ));
    imported_chart.preserved_chart_xml = Some(
        r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:title><c:tx><c:rich><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>Stale Revenue</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea/></c:chart></c:chartSpace>"#
            .to_string(),
    );
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![imported_chart],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();

    assert!(chart_xml.contains("Modeled Revenue"));
    assert!(!chart_xml.contains("Stale Revenue"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn modeled_chart_ignores_stale_chart_frame_relationship_target() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.title = Some("Modeled Revenue".to_string());
    imported_chart.definition = Some(domain_types::ChartDefinition::Chart(
        ooxml_types::charts::ChartSpace::default(),
    ));
    imported_chart.preserved_chart_xml = Some(
        r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:title><c:tx><c:rich><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>Stale Revenue</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea/></c:chart></c:chartSpace>"#
            .to_string(),
    );
    let imported_chart = with_chart_identity(imported_chart, "../charts/chart9.xml");
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![imported_chart],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_rels_bytes = archive
        .read_file("xl/drawings/_rels/drawing1.xml.rels")
        .unwrap();
    let drawing_rels = crate::domain::workbook::read::parse_all_rels(&drawing_rels_bytes);
    let drawing_rel = drawing_rels
        .iter()
        .find(|rel| rel.rel_type == REL_CHART)
        .expect("modeled chart should have a drawing relationship");

    assert!(archive.contains("xl/charts/chart1.xml"));
    assert!(!archive.contains("xl/charts/chart9.xml"));
    assert_eq!(drawing_rel.target, "../charts/chart1.xml");
    assert_ne!(drawing_rel.id, "rId9");
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_chart_with_modeled_chart_property_does_not_replay_stale_raw_chart_xml() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.title = None;
    imported_chart.data_range = None;
    imported_chart.gap_width = Some(75);
    imported_chart.definition = Some(domain_types::ChartDefinition::Chart(
        ooxml_types::charts::ChartSpace::default(),
    ));
    imported_chart.preserved_chart_xml = Some(
        r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:gapWidth val="222"/></c:barChart></c:plotArea></c:chart></c:chartSpace>"#
            .to_string(),
    );
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![imported_chart],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();

    assert!(chart_xml.contains(r#"<c:gapWidth val="75"/>"#));
    assert!(!chart_xml.contains(r#"<c:gapWidth val="222"/>"#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_chart_auxiliary_parts_replay_only_with_imported_chart_identity() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.title = None;
    imported_chart.data_range = None;
    imported_chart.preserved_chart_xml = Some(
        r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea/></c:chart></c:chartSpace>"#
            .to_string(),
    );
    let imported_chart = with_chart_identity(imported_chart, "../charts/chart9.xml");
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![imported_chart],
        ..Default::default()
    }]);
    let ctx = chart_auxiliary_roundtrip_context();

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    let chart_rels = String::from_utf8(
        archive
            .read_file("xl/charts/_rels/chart9.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(archive.contains("xl/charts/chart9.xml"));
    assert!(archive.contains("xl/charts/style9.xml"));
    assert!(!archive.contains("xl/charts/vendor9.xml"));
    assert!(content_types.contains("/xl/charts/style9.xml"));
    assert!(!content_types.contains("/xl/charts/vendor9.xml"));
    assert!(chart_rels.contains(r#"Id="rId9""#));
    assert!(chart_rels.contains(r#"Target="style9.xml""#));
    assert!(!chart_rels.contains("vendor9.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_chart_auxiliary_parts_follow_original_chart_identity_after_deleting_prior_chart() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.title = None;
    imported_chart.data_range = None;
    imported_chart.preserved_chart_xml = Some(
        r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea/></c:chart></c:chartSpace>"#
            .to_string(),
    );
    let imported_chart = with_chart_identity(imported_chart, "../charts/chart9.xml");
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![imported_chart],
        ..Default::default()
    }]);
    let ctx = chart_auxiliary_roundtrip_context_with_charts(&[5, 9]);

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    let chart_rels = String::from_utf8(
        archive
            .read_file("xl/charts/_rels/chart9.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(archive.contains("xl/charts/chart9.xml"));
    assert!(archive.contains("xl/charts/style9.xml"));
    assert!(!archive.contains("xl/charts/chart5.xml"));
    assert!(!archive.contains("xl/charts/style5.xml"));
    assert!(content_types.contains("/xl/charts/style9.xml"));
    assert!(!content_types.contains("/xl/charts/style5.xml"));
    assert!(chart_rels.contains(r#"Target="style9.xml""#));
    assert!(!chart_rels.contains("style5.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}
