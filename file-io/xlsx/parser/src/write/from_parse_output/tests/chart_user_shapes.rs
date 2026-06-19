use super::*;

#[test]
fn drawing_family_path_is_reserved_from_worksheet_drawing_allocator() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.definition = Some(domain_types::ChartDefinition::Chart(
        ooxml_types::charts::ChartSpace {
            user_shapes: Some("rIdUserShapes".to_string()),
            ..Default::default()
        },
    ));
    imported_chart.chart_relationships = vec![domain_types::chart::ChartRelationshipData {
        r_id: "rIdUserShapes".to_string(),
        relationship_type: Some(
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartUserShapes"
                .to_string(),
        ),
        target: Some("../drawings/drawing2.xml".to_string()),
        target_mode: None,
    }];
    imported_chart.chart_auxiliary_files = vec![(
        "xl/drawings/drawing2.xml".to_string(),
        br#"<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>"#
            .to_vec(),
    )];

    let output = make_parse_output(vec![
        SheetData {
            name: "Data".to_string(),
            cells: vec![
                make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
                make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
                make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
                make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
            ],
            charts: vec![imported_chart],
            ..Default::default()
        },
        SheetData {
            name: "Other".to_string(),
            cells: vec![
                make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
                make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
                make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
                make_cell(1, 1, DomainValue::Number(FiniteF64::new(200.0).unwrap())),
            ],
            charts: vec![make_chart(ChartType::Line, "Other!A1:B2")],
            ..Default::default()
        },
    ]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_rels = String::from_utf8(
        archive
            .read_file("xl/charts/_rels/chart1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let sheet2_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet2.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(chart_rels.contains(r#"Target="../drawings/drawing2.xml""#));
    assert!(sheet2_rels.contains(r#"Target="../drawings/drawing3.xml""#));
    assert!(!sheet2_rels.contains(r#"Target="../drawings/drawing2.xml""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}
