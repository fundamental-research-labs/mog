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

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
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
fn reconstructed_chart_drops_unresolved_chart_owned_relationship_ids() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.rt = Some(domain_types::chart::ChartRoundTripData {
        chart_groups_meta: Vec::new(),
        axes_ordered: Vec::new(),
        protection: None,
        print_settings: None,
        pivot_source: None,
        external_data: None,
        user_shapes: None,
        pivot_fmts: Vec::new(),
        clr_map_ovr: None,
        date1904: None,
        lang: None,
        chart_space_extensions: Vec::new(),
        chart_extensions: Vec::new(),
        plot_area_extensions: Vec::new(),
        plot_area_layout: None,
        style_alternate_content: None,
        style_after_chart: false,
        auxiliary_files: Vec::new(),
        chart_rels_bytes: None,
    });
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

    assert!(!chart_xml.contains("<c:externalData"));
    assert!(!chart_xml.contains("<c:userShapes"));
    assert!(!chart_xml.contains("rIdStaleExternalData"));
    assert!(!chart_xml.contains("rIdStaleUserShapes"));
    assert!(!archive.contains("xl/charts/_rels/chart1.xml.rels"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn reconstructed_chart_exports_typed_chart_owned_relationships() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.definition = Some(domain_types::ChartDefinition::Chart(
        ooxml_types::charts::ChartSpace::default(),
    ));
    imported_chart.rt = Some(domain_types::chart::ChartRoundTripData {
        external_data: Some(domain_types::chart::ChartExternalData {
            relationship: domain_types::chart::ChartRelationshipData {
                r_id: "rIdExternalData".to_string(),
                relationship_type: Some(
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink"
                        .to_string(),
                ),
                target: Some("externalLinks/externalLink1.xml".to_string()),
                target_mode: Some("External".to_string()),
            },
            auto_update: Some(false),
        }),
        user_shapes: Some(domain_types::chart::ChartRelationshipData {
            r_id: "rIdUserShapes".to_string(),
            relationship_type: Some(
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartUserShapes"
                    .to_string(),
            ),
            target: Some("../drawings/userShapeDrawing1.xml".to_string()),
            target_mode: None,
        }),
        auxiliary_files: vec![(
            "xl/drawings/userShapeDrawing1.xml".to_string(),
            br#"<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>"#
                .to_vec(),
        )],
        chart_rels_bytes: Some((
            "xl/charts/_rels/chart1.xml.rels".to_string(),
            br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdUserShapes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartUserShapes" Target="../drawings/userShapeDrawing1.xml"/></Relationships>"#
                .to_vec(),
        )),
        ..Default::default()
    });

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
    let chart_rels =
        String::from_utf8(archive.read_file("xl/charts/_rels/chart1.xml.rels").unwrap()).unwrap();

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
    imported_chart.rt = Some(domain_types::chart::ChartRoundTripData {
        chart_groups_meta: Vec::new(),
        axes_ordered: Vec::new(),
        protection: None,
        print_settings: None,
        pivot_source: None,
        external_data: None,
        user_shapes: None,
        pivot_fmts: Vec::new(),
        clr_map_ovr: None,
        date1904: None,
        lang: None,
        chart_space_extensions: vec![clean_chart_space_extension, stale_chart_space_extension],
        chart_extensions: vec![clean_chart_extension, stale_chart_extension],
        plot_area_extensions: vec![stale_plot_area_extension, stale_relid_plot_area_extension],
        plot_area_layout: None,
        style_alternate_content: None,
        style_after_chart: false,
        auxiliary_files: Vec::new(),
        chart_rels_bytes: None,
    });
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

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_ex_xml =
        String::from_utf8(archive.read_file("xl/charts/chartEx1.xml").unwrap()).unwrap();

    assert!(!chart_ex_xml.contains("rIdStalePrintSettings"));
    assert!(!chart_ex_xml.contains("<cx:printSettings"));
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

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
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

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
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
fn reconstructed_imported_chart_replays_stored_auxiliary_parts() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.title = Some("Modeled Revenue".to_string());
    imported_chart.definition = Some(domain_types::ChartDefinition::Chart(
        ooxml_types::charts::ChartSpace::default(),
    ));
    imported_chart.preserved_chart_xml = Some(
        r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:title><c:tx><c:rich><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>Stale Revenue</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea/></c:chart></c:chartSpace>"#
            .to_string(),
    );
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

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart9.xml").unwrap()).unwrap();
    let chart_rels = String::from_utf8(
        archive
            .read_file("xl/charts/_rels/chart9.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(chart_xml.contains("Modeled Revenue"));
    assert!(!chart_xml.contains("Stale Revenue"));
    assert!(archive.contains("xl/charts/style9.xml"));
    assert!(chart_rels.contains(r#"Target="style9.xml""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_chart_auxiliary_part_requires_supported_relationship_type() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.title = None;
    imported_chart.data_range = None;
    imported_chart.preserved_chart_xml = Some(
        r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea/></c:chart></c:chartSpace>"#
            .to_string(),
    );
    let mut imported_chart = with_chart_auxiliary(
        with_chart_identity(imported_chart, "../charts/chart9.xml"),
        9,
    );
    imported_chart.rt.as_mut().unwrap().chart_rels_bytes = Some((
        "xl/charts/_rels/chart9.xml.rels".to_string(),
        r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://example.com/notChartStyle" Target="style9.xml"/></Relationships>"#
            .as_bytes()
            .to_vec(),
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
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(archive.contains("xl/charts/chart9.xml"));
    assert!(!archive.contains("xl/charts/style9.xml"));
    assert!(!archive.contains("xl/charts/_rels/chart9.xml.rels"));
    assert!(!content_types.contains("/xl/charts/style9.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_chart_auxiliary_part_requires_chart_auxiliary_path() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.title = None;
    imported_chart.data_range = None;
    imported_chart.preserved_chart_xml = Some(
        r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea/></c:chart></c:chartSpace>"#
            .to_string(),
    );
    let mut imported_chart = with_chart_auxiliary(
        with_chart_identity(imported_chart, "../charts/chart9.xml"),
        9,
    );
    imported_chart.rt.as_mut().unwrap().auxiliary_files = vec![(
        "xl/worksheets/style9.xml".to_string(),
        b"<c:styleSheet/>".to_vec(),
    )];
    imported_chart.rt.as_mut().unwrap().chart_rels_bytes = Some((
        "xl/charts/_rels/chart9.xml.rels".to_string(),
        r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.microsoft.com/office/2011/relationships/chartStyle" Target="../worksheets/style9.xml"/></Relationships>"#
            .as_bytes()
            .to_vec(),
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
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
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
    imported_chart.preserved_chart_xml = Some(
        r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea/></c:chart></c:chartSpace>"#
            .to_string(),
    );
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
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
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
