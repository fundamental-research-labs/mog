use super::*;

fn assert_export_report_contains(report: &ExportReport, code: ExportDiagnosticCode, message: &str) {
    assert!(
        report
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == code && diagnostic.message.contains(message)),
        "missing export diagnostic {:?} containing {:?}; report diagnostics: {:?}",
        code,
        message,
        report.diagnostics
    );
}

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

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
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

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();

    assert!(chart_xml.contains("Modeled Revenue"));
    assert!(!chart_xml.contains("Stale Revenue"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn reconstructed_chart_drops_unresolved_chart_owned_relationship_ids() {
    let imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
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

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();

    assert!(!chart_xml.contains("<c:externalData"));
    assert!(!chart_xml.contains("<c:userShapes"));
    assert!(!chart_xml.contains("rIdStaleExternalData"));
    assert!(!chart_xml.contains("rIdStaleUserShapes"));
    assert!(!archive.contains("xl/charts/_rels/chart1.xml.rels"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_chart_definition_exports_chart_owned_relationships_without_rt_xml_authority() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.definition = Some(domain_types::ChartDefinition::Chart(
        ooxml_types::charts::ChartSpace {
            lang: Some("en-US".to_string()),
            external_data: Some(ooxml_types::charts::ExternalData {
                r_id: "rIdExternalData".to_string(),
                auto_update: Some(false),
            }),
            user_shapes: Some("rIdUserShapes".to_string()),
            ..Default::default()
        },
    ));
    imported_chart.chart_relationships = vec![
        domain_types::chart::ChartRelationshipData {
            r_id: "rIdExternalData".to_string(),
            relationship_type: Some(
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink"
                    .to_string(),
            ),
            target: Some("externalLinks/externalLink1.xml".to_string()),
            target_mode: Some("External".to_string()),
        },
        domain_types::chart::ChartRelationshipData {
            r_id: "rIdUserShapes".to_string(),
            relationship_type: Some(
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartUserShapes"
                    .to_string(),
            ),
            target: Some("../drawings/userShapeDrawing1.xml".to_string()),
            target_mode: None,
        },
    ];
    imported_chart.chart_auxiliary_files = vec![(
        "xl/drawings/userShapeDrawing1.xml".to_string(),
        br#"<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>"#
            .to_vec(),
    )];

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

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();
    let chart_rels = String::from_utf8(
        archive
            .read_file("xl/charts/_rels/chart1.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(chart_xml.contains(r#"<c:externalData r:id="rIdExternalData">"#));
    assert!(chart_xml.contains(r#"<c:autoUpdate val="0"/>"#));
    assert!(chart_xml.contains(r#"<c:userShapes r:id="rIdUserShapes"/>"#));
    assert!(chart_rels.contains(r#"Id="rIdExternalData""#));
    assert!(chart_rels.contains(r#"TargetMode="External""#));
    assert!(chart_rels.contains(r#"Id="rIdUserShapes""#));
    assert!(archive.contains("xl/drawings/userShapeDrawing1.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn reconstructed_external_data_requires_supported_relationship_policy() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.definition = Some(domain_types::ChartDefinition::Chart(
        ooxml_types::charts::ChartSpace {
            external_data: Some(ooxml_types::charts::ExternalData {
                r_id: "rIdExternalData".to_string(),
                auto_update: Some(false),
            }),
            ..Default::default()
        },
    ));
    imported_chart.chart_relationships = vec![domain_types::chart::ChartRelationshipData {
        r_id: "rIdExternalData".to_string(),
        relationship_type: Some("http://example.com/notExternalLink".to_string()),
        target: Some("externalLinks/externalLink1.xml".to_string()),
        target_mode: Some("External".to_string()),
    }];

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

    let (bytes, report) = write_xlsx_from_parse_output_with_report(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();

    assert!(!chart_xml.contains("<c:externalData"));
    assert!(!chart_xml.contains("rIdExternalData"));
    assert!(!archive.contains("xl/charts/_rels/chart1.xml.rels"));
    assert_export_report_contains(
        &report,
        ExportDiagnosticCode::ChartExternalDataRelationshipDropped,
        "externalData relationship `rIdExternalData`",
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn reconstructed_user_shapes_requires_supported_auxiliary_target() {
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
        target: Some("../drawings/userShapeDrawing1.xml".to_string()),
        target_mode: None,
    }];

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

    let (bytes, report) = write_xlsx_from_parse_output_with_report(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();

    assert!(!chart_xml.contains("<c:userShapes"));
    assert!(!chart_xml.contains("rIdUserShapes"));
    assert!(!archive.contains("xl/charts/_rels/chart1.xml.rels"));
    assert_export_report_contains(
        &report,
        ExportDiagnosticCode::ChartUserShapesRelationshipDropped,
        "userShapes relationship `rIdUserShapes`",
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn reconstructed_chart_drops_relationship_bearing_raw_extensions() {
    let clean_chart_space_extension = ooxml_types::charts::ExtensionEntry {
        uri: "{clean-chart-space}".to_string(),
        xml: "<cleanChartSpaceExtension/>".to_string(),
    };
    let stale_chart_space_extension = ooxml_types::charts::ExtensionEntry {
        uri: "{stale-chart-space}".to_string(),
        xml: r#"<staleChartSpaceExtension xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdStaleChartSpace"/>"#.to_string(),
    };
    let clean_chart_extension = ooxml_types::charts::ExtensionEntry {
        uri: "{clean-chart}".to_string(),
        xml: "<cleanChartExtension/>".to_string(),
    };
    let stale_chart_extension = ooxml_types::charts::ExtensionEntry {
        uri: "{stale-chart}".to_string(),
        xml: r#"<staleChartExtension xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdStaleEmbed"/>"#.to_string(),
    };
    let stale_plot_area_extension = ooxml_types::charts::ExtensionEntry {
        uri: "{stale-plot-area}".to_string(),
        xml: r#"<stalePlotAreaExtension xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:link="rIdStaleLink"/>"#.to_string(),
    };
    let stale_relid_plot_area_extension = ooxml_types::charts::ExtensionEntry {
        uri: "{stale-relid-plot-area}".to_string(),
        xml: r#"<staleRelIdPlotAreaExtension xmlns:o="urn:schemas-microsoft-com:office:office" o:relid="rIdStaleRelId"/>"#.to_string(),
    };

    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    if let Some(domain_types::ChartDefinition::Chart(chart_space)) =
        imported_chart.definition.as_mut()
    {
        chart_space.extensions = vec![clean_chart_space_extension, stale_chart_space_extension];
        chart_space.chart.extensions = vec![clean_chart_extension, stale_chart_extension];
        chart_space.chart.plot_area.extensions =
            vec![stale_plot_area_extension, stale_relid_plot_area_extension];
    }
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

    let (bytes, report) = write_xlsx_from_parse_output_with_report(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();

    assert!(chart_xml.contains("cleanChartSpaceExtension"));
    assert!(chart_xml.contains("cleanChartExtension"));
    assert!(!chart_xml.contains("staleChartSpaceExtension"));
    assert!(!chart_xml.contains("staleChartExtension"));
    assert!(!chart_xml.contains("stalePlotAreaExtension"));
    assert!(!chart_xml.contains("staleRelIdPlotAreaExtension"));
    assert!(!chart_xml.contains("rIdStaleChartSpace"));
    assert!(!chart_xml.contains("rIdStaleEmbed"));
    assert!(!chart_xml.contains("rIdStaleLink"));
    assert!(!chart_xml.contains("rIdStaleRelId"));
    assert_export_report_contains(
        &report,
        ExportDiagnosticCode::ChartRelationshipRawXmlDropped,
        "raw extension XML containing relationship attributes",
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn chart_ex_print_settings_drop_unresolved_relationship_attrs() {
    let mut chart_ex_space = ooxml_types::chart_ex::ChartExSpace::default();
    chart_ex_space.print_settings = Some(ooxml_types::chart_ex::ChartExPrintSettings {
        raw_xml: Some(
            r#"<cx:printSettings xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex" xmlns:o="urn:schemas-microsoft-com:office:office"><cx:pageSetup o:relid="rIdStalePrintSettings"/></cx:printSettings>"#
                .to_string(),
        ),
    });
    let mut chart_ex = make_chart(ChartType::Waterfall, "Data!A1:B2");
    chart_ex.is_chart_ex = true;
    chart_ex.definition = Some(domain_types::ChartDefinition::ChartEx(chart_ex_space));

    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![chart_ex],
        ..Default::default()
    }]);

    let (bytes, report) = write_xlsx_from_parse_output_with_report(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_ex_xml =
        String::from_utf8(archive.read_file("xl/charts/chartEx1.xml").unwrap()).unwrap();

    assert!(!chart_ex_xml.contains("rIdStalePrintSettings"));
    assert!(!chart_ex_xml.contains("<cx:printSettings"));
    assert_export_report_contains(
        &report,
        ExportDiagnosticCode::ChartPrintSettingsDropped,
        "printSettings XML",
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn chart_ex_print_settings_preserve_clean_raw_xml() {
    let mut chart_ex_space = ooxml_types::chart_ex::ChartExSpace::default();
    chart_ex_space.print_settings = Some(ooxml_types::chart_ex::ChartExPrintSettings {
        raw_xml: Some(
            r#"<cx:printSettings xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:pageMargins l="0.7" r="0.7"/></cx:printSettings>"#
                .to_string(),
        ),
    });
    let mut chart_ex = make_chart(ChartType::Waterfall, "Data!A1:B2");
    chart_ex.is_chart_ex = true;
    chart_ex.definition = Some(domain_types::ChartDefinition::ChartEx(chart_ex_space));

    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![chart_ex],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_ex_xml =
        String::from_utf8(archive.read_file("xl/charts/chartEx1.xml").unwrap()).unwrap();

    assert!(chart_ex_xml.contains("<cx:printSettings"));
    assert!(chart_ex_xml.contains("<cx:pageMargins"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn modeled_chart_ignores_stale_chart_frame_relationship_target() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.title = Some("Modeled Revenue".to_string());
    imported_chart.definition = Some(domain_types::ChartDefinition::Chart(
        ooxml_types::charts::ChartSpace::default(),
    ));
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

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
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
fn imported_chart_allocates_new_relationship_id_when_preferred_id_is_taken() {
    let mut imported_chart = with_chart_auxiliary(make_chart(ChartType::Column, "Data!A1:B2"), 2);
    imported_chart.chart_frame = Some(
        domain_types::domain::floating_object::ChartDrawingFrameOoxmlProps {
            relationship_id: Some("rId2".to_string()),
            relationship_target: Some("../charts/chart2.xml".to_string()),
            ..Default::default()
        },
    );
    let imported_chart = with_current_standard_chart_authority(imported_chart);

    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        floating_objects: vec![
            imported_picture_with_media("p1", "../media/image1.png"),
            imported_picture_with_media("p2", "../media/image2.png"),
        ],
        charts: vec![imported_chart],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_rels_bytes = archive
        .read_file("xl/drawings/_rels/drawing1.xml.rels")
        .unwrap();
    let drawing_rels = crate::domain::workbook::read::parse_all_rels(&drawing_rels_bytes);
    let chart_rel = drawing_rels
        .iter()
        .find(|rel| rel.rel_type == REL_CHART && rel.target == "../charts/chart2.xml")
        .expect("chart2 should have a chart relationship");

    assert_ne!(chart_rel.id, "rId2");
    assert_eq!(
        drawing_rels
            .iter()
            .find(|rel| rel.id == "rId2")
            .map(|rel| rel.rel_type.as_str()),
        Some(crate::infra::opc::REL_IMAGE)
    );
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

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
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
    let imported_chart = with_current_standard_chart_authority(with_chart_auxiliary(
        with_chart_identity(imported_chart, "../charts/chart9.xml"),
        9,
    ));
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

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
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
fn stale_standard_chart_authority_suppresses_auxiliary_numbering_and_relationship_identity() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.title = None;
    imported_chart.data_range = None;
    let mut imported_chart = with_current_standard_chart_authority(with_chart_auxiliary(
        with_chart_identity(imported_chart, "../charts/chart9.xml"),
        9,
    ));
    let authority = imported_chart
        .standard_chart_export_authority
        .as_mut()
        .expect("test helper should grant authority");
    authority.validity = domain_types::chart::StandardChartAuthorityValidity::Stale;
    authority.stale_reason = Some("modeled chart changed".to_string());

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

    let (bytes, report) = write_xlsx_from_parse_output_with_report(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_rels_bytes = archive
        .read_file("xl/drawings/_rels/drawing1.xml.rels")
        .unwrap();
    let drawing_rels = crate::domain::workbook::read::parse_all_rels(&drawing_rels_bytes);
    let chart_rel = drawing_rels
        .iter()
        .find(|rel| rel.rel_type == REL_CHART)
        .expect("chart relationship should be present");

    assert!(archive.contains("xl/charts/chart1.xml"));
    assert!(!archive.contains("xl/charts/chart9.xml"));
    assert!(!archive.contains("xl/charts/style9.xml"));
    assert!(!archive.contains("xl/charts/_rels/chart9.xml.rels"));
    assert_eq!(chart_rel.target, "../charts/chart1.xml");
    assert_ne!(chart_rel.id, "rId9");
    assert_export_report_contains(
        &report,
        ExportDiagnosticCode::ChartSpaceReplaySuppressed,
        "modeled chart changed",
    );
    assert_export_report_contains(
        &report,
        ExportDiagnosticCode::ChartAuxiliaryReplaySuppressed,
        "auxiliary package replay was suppressed",
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn reconstructed_imported_chart_suppresses_stale_auxiliary_parts() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.title = Some("Modeled Revenue".to_string());
    imported_chart.definition = Some(domain_types::ChartDefinition::Chart(
        ooxml_types::charts::ChartSpace::default(),
    ));
    let imported_chart = with_chart_auxiliary(
        with_chart_identity(imported_chart, "../charts/chart9.xml"),
        9,
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

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();

    assert!(chart_xml.contains("Modeled Revenue"));
    assert!(!chart_xml.contains("Stale Revenue"));
    assert!(!archive.contains("xl/charts/chart9.xml"));
    assert!(!archive.contains("xl/charts/style9.xml"));
    assert!(!archive.contains("xl/charts/_rels/chart9.xml.rels"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_chart_auxiliary_part_requires_supported_relationship_type() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.title = None;
    imported_chart.data_range = None;
    let mut imported_chart = with_chart_auxiliary(
        with_chart_identity(imported_chart, "../charts/chart9.xml"),
        9,
    );
    imported_chart.chart_relationships[0].relationship_type =
        Some("http://example.com/notChartStyle".to_string());
    let imported_chart = with_current_standard_chart_authority(imported_chart);
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
    let (bytes, report) = write_xlsx_from_parse_output_with_report(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(archive.contains("xl/charts/chart9.xml"));
    assert!(!archive.contains("xl/charts/style9.xml"));
    assert!(!archive.contains("xl/charts/_rels/chart9.xml.rels"));
    assert!(!content_types.contains("/xl/charts/style9.xml"));
    assert_export_report_contains(
        &report,
        ExportDiagnosticCode::ChartAuxiliaryPartDropped,
        "chart auxiliary part `xl/charts/style9.xml`",
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_chart_auxiliary_part_requires_chart_auxiliary_path() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.title = None;
    imported_chart.data_range = None;
    let mut imported_chart = with_chart_auxiliary(
        with_chart_identity(imported_chart, "../charts/chart9.xml"),
        9,
    );
    imported_chart.chart_auxiliary_files = vec![(
        "xl/worksheets/style9.xml".to_string(),
        b"<c:styleSheet/>".to_vec(),
    )];
    imported_chart.chart_relationships[0].target = Some("../worksheets/style9.xml".to_string());
    let imported_chart = with_current_standard_chart_authority(imported_chart);
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
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(archive.contains("xl/charts/chart9.xml"));
    assert!(!archive.contains("xl/worksheets/style9.xml"));
    assert!(!archive.contains("xl/charts/_rels/chart9.xml.rels"));
    assert!(!content_types.contains("/xl/worksheets/style9.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_chart_auxiliary_parts_follow_original_chart_identity_after_deleting_prior_chart() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.title = None;
    imported_chart.data_range = None;
    let imported_chart = with_current_standard_chart_authority(with_chart_auxiliary(
        with_chart_identity(imported_chart, "../charts/chart9.xml"),
        9,
    ));
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
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
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

fn chart_ex_with_raw_anchor(original_number: usize) -> ChartSpec {
    let mut chart_ex = make_chart(ChartType::Waterfall, "");
    chart_ex.title = None;
    chart_ex.data_range = None;
    chart_ex.is_chart_ex = true;
    chart_ex.definition = Some(domain_types::ChartDefinition::ChartEx(
        ooxml_types::chart_ex::ChartExSpace::default(),
    ));
    chart_ex.position = domain_types::AnchorPosition {
        anchor_row: 1,
        anchor_col: 2,
        anchor_row_offset: 0,
        anchor_col_offset: 0,
        absolute_x: None,
        absolute_y: None,
        end_row: Some(12),
        end_col: Some(8),
        end_row_offset: Some(0),
        end_col_offset: Some(0),
        extent_cx: None,
        extent_cy: None,
    };
    chart_ex.cnv_pr_name = Some("ChartEx Raw".to_string());
    chart_ex.cnv_pr_id = Some(77);
    chart_ex.anchor_edit_as = Some("twoCell".to_string());

    let mut graphic_frame = ooxml_types::drawings::SpreadsheetGraphicFrame::default();
    graphic_frame.nv_graphic_frame_pr.c_nv_pr.id =
        ooxml_types::drawings::StDrawingElementId::new(77);
    graphic_frame.nv_graphic_frame_pr.c_nv_pr.name = "ChartEx Raw".to_string();
    graphic_frame.xfrm = ooxml_types::drawings::Transform2D {
        offset: Some((0, 0)),
        extent: Some((0, 0)),
        rotation: None,
        flip_h: None,
        flip_v: None,
    };
    let relationship_id = "rId1".to_string();
    let relationship_target = format!("../charts/chartEx{original_number}.xml");
    let original_path = format!("xl/charts/chartEx{original_number}.xml");
    let raw_anchor = format!(
        r#"<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><!--RAW-CHARTEX-ANCHOR--><mc:Choice Requires="cx1"><xdr:twoCellAnchor editAs="twoCell"><xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>12</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="77" name="ChartEx Raw"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:chart r:id="{relationship_id}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></mc:Choice></mc:AlternateContent>"#
    );

    chart_ex.chart_frame = Some(
        domain_types::domain::floating_object::ChartDrawingFrameOoxmlProps {
            graphic_frame,
            anchor_index: Some(0),
            edit_as: Some("twoCell".to_string()),
            relationship_id: Some(relationship_id),
            relationship_target: Some(relationship_target),
            raw_alternate_content: Some(raw_anchor),
            ..Default::default()
        },
    );
    chart_ex.chart_ex_replay = Some(domain_types::chart::ChartExReplayData {
        original_path,
        original_xml: br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cx:chartSpace xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:chart><cx:plotArea><cx:plotAreaRegion/></cx:plotArea></cx:chart></cx:chartSpace>"#
            .to_vec(),
        original_position: chart_ex.position.clone(),
        projection_fingerprint: None,
        rels_path: None,
        rels_xml: None,
        relationships: Vec::new(),
        auxiliary_files: Vec::new(),
    });
    refresh_chart_ex_replay_projection_fingerprint(&mut chart_ex);
    chart_ex
}

fn chart_ex_family_with_replay(
    chart_type: ChartType,
    family_marker: &str,
    original_number: usize,
) -> ChartSpec {
    let mut chart_ex = make_chart(chart_type, "");
    chart_ex.title = None;
    chart_ex.data_range = None;
    chart_ex.is_chart_ex = true;
    chart_ex.definition = Some(domain_types::ChartDefinition::ChartEx(
        ooxml_types::chart_ex::ChartExSpace::default(),
    ));
    chart_ex.position.anchor_row = original_number as u32;
    chart_ex.position.anchor_col = 2;
    chart_ex.position.end_row = Some(original_number as u32 + 12);
    chart_ex.position.end_col = Some(8);
    chart_ex.cnv_pr_name = Some(format!("{family_marker} ChartEx"));
    chart_ex.cnv_pr_id = Some(original_number as u32);

    let relationship_id = format!("rIdChart{original_number}");
    let relationship_target = format!("../charts/chartEx{original_number}.xml");
    chart_ex.chart_frame = Some(
        domain_types::domain::floating_object::ChartDrawingFrameOoxmlProps {
            relationship_id: Some(relationship_id),
            relationship_target: Some(relationship_target),
            ..Default::default()
        },
    );

    let style_rel_id = format!("rIdStyle{original_number}");
    let color_rel_id = format!("rIdColor{original_number}");
    let style_target = format!("style{original_number}.xml");
    let color_target = format!("color{original_number}.xml");
    let style_path = format!("xl/charts/{style_target}");
    let color_path = format!("xl/charts/{color_target}");
    let relationships = vec![
        domain_types::chart::ChartRelationshipData {
            r_id: style_rel_id.clone(),
            relationship_type: Some(crate::infra::opc::REL_CHART_STYLE.to_string()),
            target: Some(style_target.clone()),
            target_mode: None,
        },
        domain_types::chart::ChartRelationshipData {
            r_id: color_rel_id.clone(),
            relationship_type: Some(crate::infra::opc::REL_CHART_COLOR_STYLE.to_string()),
            target: Some(color_target.clone()),
            target_mode: None,
        },
    ];
    let auxiliary_files = vec![
        (
            style_path,
            format!(
                r#"<c:styleSheet xmlns:c="http://schemas.microsoft.com/office/drawing/2012/chartStyle"><!--STYLE-{family_marker}--></c:styleSheet>"#
            )
            .into_bytes(),
        ),
        (
            color_path,
            format!(
                r#"<cs:colorStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle"><!--COLOR-{family_marker}--></cs:colorStyle>"#
            )
            .into_bytes(),
        ),
    ];
    chart_ex.chart_relationships = relationships.clone();
    chart_ex.chart_auxiliary_files = auxiliary_files.clone();

    let original_path = format!("xl/charts/chartEx{original_number}.xml");
    chart_ex.chart_ex_replay = Some(domain_types::chart::ChartExReplayData {
        original_path: original_path.clone(),
        original_xml: format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cx:chartSpace xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"><!--CHARTEX-FAMILY-{family_marker}--><cx:chart><cx:plotArea><cx:plotAreaRegion/></cx:plotArea></cx:chart><cx:printSettings><!--PRINT-{family_marker}--><cx:pageMargins l="0.7" r="0.7"/></cx:printSettings></cx:chartSpace>"#
        )
        .into_bytes(),
        original_position: chart_ex.position.clone(),
        projection_fingerprint: None,
        rels_path: Some(format!(
            "xl/charts/_rels/chartEx{original_number}.xml.rels"
        )),
        rels_xml: Some(
            format!(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="{style_rel_id}" Type="{}" Target="{style_target}"/><Relationship Id="{color_rel_id}" Type="{}" Target="{color_target}"/></Relationships>"#,
                crate::infra::opc::REL_CHART_STYLE,
                crate::infra::opc::REL_CHART_COLOR_STYLE
            )
            .into_bytes(),
        ),
        relationships,
        auxiliary_files,
    });
    refresh_chart_ex_replay_projection_fingerprint(&mut chart_ex);

    chart_ex
}

fn refresh_chart_ex_replay_projection_fingerprint(chart_ex: &mut ChartSpec) {
    let projection_fingerprint = chart_replay::standard_chart_projection_fingerprint(chart_ex);
    if let Some(replay) = chart_ex.chart_ex_replay.as_mut() {
        replay.projection_fingerprint = Some(projection_fingerprint);
    }
}

#[test]
fn chart_ex_no_edit_round_trip_preserves_all_family_replay_parts() {
    let families = [
        (ChartType::Waterfall, "waterfall", 31),
        (ChartType::Treemap, "treemap", 32),
        (ChartType::Sunburst, "sunburst", 33),
        (ChartType::Funnel, "funnel", 34),
        (ChartType::Histogram, "histogram", 35),
        (ChartType::Pareto, "pareto", 36),
        (ChartType::Boxplot, "boxplot", 37),
        (ChartType::RegionMap, "regionMap", 38),
    ];
    let charts = families
        .iter()
        .map(|(chart_type, family_marker, original_number)| {
            chart_ex_family_with_replay(chart_type.clone(), family_marker, *original_number)
        })
        .collect();
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        charts,
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");

    for (_, family_marker, original_number) in families {
        let chart_path = format!("xl/charts/chartEx{original_number}.xml");
        let rels_path = format!("xl/charts/_rels/chartEx{original_number}.xml.rels");
        let style_path = format!("xl/charts/style{original_number}.xml");
        let color_path = format!("xl/charts/color{original_number}.xml");

        assert!(archive.contains(&chart_path), "missing {chart_path}");
        assert!(archive.contains(&rels_path), "missing {rels_path}");
        assert!(archive.contains(&style_path), "missing {style_path}");
        assert!(archive.contains(&color_path), "missing {color_path}");

        let chart_xml = String::from_utf8(archive.read_file(&chart_path).unwrap()).unwrap();
        let rels_xml = String::from_utf8(archive.read_file(&rels_path).unwrap()).unwrap();
        let style_xml = String::from_utf8(archive.read_file(&style_path).unwrap()).unwrap();
        let color_xml = String::from_utf8(archive.read_file(&color_path).unwrap()).unwrap();

        assert!(chart_xml.contains(&format!("CHARTEX-FAMILY-{family_marker}")));
        assert!(chart_xml.contains(&format!("PRINT-{family_marker}")));
        assert!(rels_xml.contains(&format!(r#"Id="rIdStyle{original_number}""#)));
        assert!(rels_xml.contains(&format!(r#"Target="style{original_number}.xml""#)));
        assert!(rels_xml.contains(&format!(r#"Id="rIdColor{original_number}""#)));
        assert!(rels_xml.contains(&format!(r#"Target="color{original_number}.xml""#)));
        assert!(style_xml.contains(&format!("STYLE-{family_marker}")));
        assert!(color_xml.contains(&format!("COLOR-{family_marker}")));
    }
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

const IMPORTED_CHART_EX_TITLE: &str = "Imported ChartEx Title";

fn chart_ex_with_imported_title(original_number: usize, family_marker: &str) -> ChartSpec {
    let mut chart_ex =
        chart_ex_family_with_replay(ChartType::Waterfall, family_marker, original_number);
    if let Some(domain_types::ChartDefinition::ChartEx(chart_space)) = chart_ex.definition.as_mut()
    {
        chart_space.chart.title = Some(ooxml_types::chart_ex::ChartExTitle {
            tx: Some(ooxml_types::chart_ex::ChartExText {
                tx_data: Some(ooxml_types::chart_ex::ChartExTxData {
                    value: Some(IMPORTED_CHART_EX_TITLE.to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            ..Default::default()
        });
    }
    chart_ex.title = Some(IMPORTED_CHART_EX_TITLE.to_string());
    refresh_chart_ex_replay_projection_fingerprint(&mut chart_ex);
    chart_ex
}

fn chart_ex_projected_series() -> domain_types::chart::ChartSeriesData {
    domain_types::chart::ChartSeriesData {
        name: Some("Revenue".to_string()),
        r#type: Some(ChartType::Waterfall),
        color: None,
        values: Some("Data!B2:B3".to_string()),
        value_cache: None,
        value_source_kind: Some(domain_types::chart::ChartSeriesDimensionSourceKindData::Ref),
        categories: Some("Data!A2:A3".to_string()),
        x_role: Some(domain_types::chart::ChartSeriesXRoleData::Category),
        category_cache: None,
        category_source_kind: Some(domain_types::chart::ChartSeriesDimensionSourceKindData::Ref),
        category_levels: None,
        category_label_format: None,
        bubble_size: None,
        bubble_size_cache: None,
        bubble_size_source_kind: None,
        smooth: None,
        show_lines: None,
        explosion: None,
        invert_if_negative: None,
        y_axis_index: None,
        show_markers: None,
        marker_size: None,
        marker_style: None,
        line_width: None,
        points: None,
        data_labels: None,
        trendlines: None,
        error_bars: None,
        x_error_bars: None,
        y_error_bars: None,
        idx: Some(0),
        order: Some(0),
        format: None,
        bar_shape: None,
        invert_color: None,
        marker_background_color: None,
        marker_foreground_color: None,
        filtered: None,
        show_shadow: None,
        show_connector_lines: None,
        leader_line_format: None,
        show_leader_lines: None,
    }
}

#[test]
fn chart_ex_import_projected_series_keeps_opaque_replay_current() {
    let mut chart_ex = chart_ex_with_imported_title(43, "projected-import");
    chart_ex.series = vec![chart_ex_projected_series()];
    chart_ex.data_range = Some("Data!A2:B3".to_string());
    refresh_chart_ex_replay_projection_fingerprint(&mut chart_ex);
    assert!(chart_replay::chart_ex_allows_opaque_replay(
        &chart_ex,
        "xl/charts/chartEx43.xml"
    ));
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
            make_cell(2, 0, DomainValue::Text(Arc::from("Q2"))),
            make_cell(2, 1, DomainValue::Number(FiniteF64::new(120.0).unwrap())),
        ],
        charts: vec![chart_ex],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml =
        String::from_utf8(archive.read_file("xl/charts/chartEx43.xml").unwrap()).unwrap();

    assert!(chart_xml.contains("CHARTEX-FAMILY-projected-import"));
    assert!(chart_xml.contains("PRINT-projected-import"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

fn chart_ex_test_legend(position: &str, overlay: Option<bool>) -> domain_types::chart::LegendData {
    domain_types::chart::LegendData {
        show: true,
        position: position.to_string(),
        visible: true,
        overlay,
        format: None,
        entries: None,
        custom_x: None,
        custom_y: None,
        layout: None,
        shadow: None,
        show_shadow: None,
    }
}

#[test]
fn chart_ex_title_only_edit_disables_replay_and_serializes_modeled_title() {
    let mut chart_ex = chart_ex_with_imported_title(41, "title-edit");
    chart_ex.title = Some("Edited ChartEx Title".to_string());
    assert!(!chart_replay::chart_ex_allows_opaque_replay(
        &chart_ex,
        "xl/charts/chartEx41.xml"
    ));
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        charts: vec![chart_ex],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml =
        String::from_utf8(archive.read_file("xl/charts/chartEx1.xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/charts/chartEx41.xml"));
    assert!(!chart_xml.contains("CHARTEX-FAMILY-title-edit"));
    assert!(!chart_xml.contains("PRINT-title-edit"));
    assert!(chart_xml.contains("Edited ChartEx Title"));
    assert!(!chart_xml.contains(IMPORTED_CHART_EX_TITLE));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn chart_ex_legend_only_edit_disables_replay_and_serializes_modeled_legend() {
    let mut chart_ex = chart_ex_with_imported_title(42, "legend-edit");
    if let Some(domain_types::ChartDefinition::ChartEx(chart_space)) = chart_ex.definition.as_mut()
    {
        chart_space.chart.legend = Some(ooxml_types::chart_ex::ChartExLegend {
            pos: Some("r".to_string()),
            overlay: Some(false),
            ..Default::default()
        });
    }
    chart_ex.legend = Some(chart_ex_test_legend("bottom", Some(true)));
    assert!(!chart_replay::chart_ex_allows_opaque_replay(
        &chart_ex,
        "xl/charts/chartEx42.xml"
    ));
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        charts: vec![chart_ex],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml =
        String::from_utf8(archive.read_file("xl/charts/chartEx1.xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/charts/chartEx42.xml"));
    assert!(!chart_xml.contains("CHARTEX-FAMILY-legend-edit"));
    assert!(!chart_xml.contains("PRINT-legend-edit"));
    assert!(chart_xml.contains(IMPORTED_CHART_EX_TITLE));
    assert!(chart_xml.contains(r#"<cx:legend pos="b" overlay="1"/>"#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn chart_ex_raw_anchor_replays_only_when_frame_is_current() {
    let chart_ex = chart_ex_with_raw_anchor(7);
    assert!(chart_replay::chart_ex_allows_opaque_replay(
        &chart_ex,
        "xl/charts/chartEx7.xml"
    ));
    assert!(chart_replay::chart_ex_allows_raw_anchor_replay(
        &chart_ex,
        "xl/charts/chartEx7.xml",
        "rId1"
    ));
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        charts: vec![chart_ex],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();

    assert!(archive.contains("xl/charts/chartEx7.xml"));
    assert!(drawing_xml.contains("RAW-CHARTEX-ANCHOR"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn chart_ex_raw_anchor_export_report_names_suppressed_stale_anchor_replay() {
    let mut chart_ex = chart_ex_with_raw_anchor(7);
    chart_ex.title = Some("Edited ChartEx".to_string());
    chart_ex
        .chart_frame
        .as_mut()
        .expect("test fixture has chart frame")
        .relationship_id = Some("rIdStale".to_string());

    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        charts: vec![chart_ex],
        ..Default::default()
    }]);

    let (bytes, report) = write_xlsx_from_parse_output_with_report(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();

    assert!(!drawing_xml.contains("RAW-CHARTEX-ANCHOR"));
    assert_export_report_contains(
        &report,
        ExportDiagnosticCode::ChartExRawAnchorReplaySuppressed,
        "raw drawing anchor replay was suppressed",
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn edited_chart_ex_frame_suppresses_raw_anchor_replay_and_exports_current_transform() {
    let chart_ex = chart_ex_with_raw_anchor(7);
    let mut floating = chart_ex.to_floating_object("sheet-1", 0);
    floating.common.rotation = 45.0;
    floating.common.flip_h = true;
    floating.common.flip_v = true;
    floating.common.visible = false;
    floating.common.printable = false;
    let edited_chart =
        ChartSpec::from_floating_object(&floating).expect("chart spec from edited object");

    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        charts: vec![edited_chart],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();

    assert!(archive.contains("xl/charts/chartEx7.xml"));
    assert!(!drawing_xml.contains("RAW-CHARTEX-ANCHOR"));
    assert!(drawing_xml.contains(r#"<xdr:cNvPr id="77" name="ChartEx Raw" hidden="1"/>"#));
    assert!(drawing_xml.contains(r#"<xdr:xfrm rot="2700000" flipH="1" flipV="1">"#));
    assert!(drawing_xml.contains(r#"<xdr:clientData fPrintsWithSheet="0"/>"#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}
