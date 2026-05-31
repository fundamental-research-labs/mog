use super::*;

#[test]
fn pivot_package_generation_filters_stale_original_parts_and_rels() {
    let output = pivot_package_output(vec![make_pivot_config(
        "pivot-1",
        "PivotTable1",
        "Data",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Pivot",
        Some(11),
    )]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet2.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet2.xml").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(workbook_xml.contains("<pivotCaches>"));
    assert!(workbook_xml.contains("cacheId=\"11\""));
    assert!(workbook_rels.contains("pivotCache/pivotCacheDefinition1.xml"));
    assert!(!workbook_rels.contains("pivotCacheDefinition7.xml"));
    assert!(sheet_rels.contains("../pivotTables/pivotTable1.xml"));
    assert!(!sheet_rels.contains("../pivotTables/pivotTable7.xml"));
    let pivot_r_id = sheet_rels
        .split("<Relationship ")
        .find(|rel| rel.contains("../pivotTables/pivotTable1.xml"))
        .and_then(|rel| rel.split("Id=\"").nth(1))
        .and_then(|rel| rel.split('"').next())
        .expect("generated pivot relationship should have an r:id");
    assert!(sheet_xml.contains(&format!("<pivotTableDefinition r:id=\"{pivot_r_id}\"/>")));
    assert!(content_types.contains("PartName=\"/xl/pivotTables/pivotTable1.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheDefinition1.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheRecords1.xml\""));
    assert!(!content_types.contains("pivotTable7.xml"));
    assert!(!archive.contains("xl/pivotTables/pivotTable7.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheDefinition7.xml"));
    assert!(archive.contains("xl/pivotTables/pivotTable1.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition1.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheRecords1.xml"));
}

#[test]
fn pivot_cache_definition_r_id_matches_generated_records_relationship() {
    let mut output = pivot_package_output(vec![make_pivot_config(
        "pivot-1",
        "PivotTable1",
        "Data",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Pivot",
        Some(11),
    )]);
    output.package_fidelity = Some(domain_types::PackageFidelityMetadata {
        pivot_cache_packages: vec![domain_types::PivotCachePackageFidelity {
            cache_id: 11,
            definition_path: "xl/pivotCache/pivotCacheDefinition11.xml".to_string(),
            records_path: Some("xl/pivotCache/pivotCacheRecords11.xml".to_string()),
            workbook_relationship_id: "rIdPivotCache11".to_string(),
            workbook_relationship_type:
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition"
                    .to_string(),
            workbook_relationship_target: "pivotCache/pivotCacheDefinition11.xml".to_string(),
            records_relationship_id: Some("rIdImportedRecords".to_string()),
            records_relationship_type: Some(
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords"
                    .to_string(),
            ),
            records_relationship_target: Some("pivotCacheRecords11.xml".to_string()),
            source_sheet: Some("Data".to_string()),
            source_range: Some("A1:B3".to_string()),
            ..Default::default()
        }],
        ..Default::default()
    });

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let definition_xml = String::from_utf8(
        archive
            .read_file("xl/pivotCache/pivotCacheDefinition11.xml")
            .unwrap(),
    )
    .unwrap();
    let definition_rels = String::from_utf8(
        archive
            .read_file("xl/pivotCache/_rels/pivotCacheDefinition11.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(definition_xml.contains(r#"r:id="rIdImportedRecords""#));
    assert!(definition_rels.contains(r#"Id="rIdImportedRecords""#));
    assert!(definition_rels.contains("pivotCacheRecords11.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn external_worksheet_pivot_cache_exports_snapshot_and_relationship() {
    let mut output = pivot_package_output(vec![make_pivot_config(
        "pivot-1",
        "PivotTable1",
        "MissingLocalSource",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Pivot",
        Some(11),
    )]);
    output.pivot_cache_sources.clear();
    output
        .pivot_cache_sources
        .push(domain_types::PivotCacheSourceDef {
            cache_id: 11,
            workbook_ref_scope: Default::default(),
            source_kind: domain_types::domain::pivot::PivotCacheSourceKind::ExternalWorksheet,
            source_name: None,
            source_sheet: Some("External Data".to_string()),
            source_range: Some("A1:B3".to_string()),
            external_worksheet: Some(
                domain_types::domain::pivot::PivotExternalWorksheetSourceDef {
                    relationship_id_hint: Some("rIdExternalSource".to_string()),
                    relationship_type: crate::infra::opc::REL_EXTERNAL_LINK_PATH.to_string(),
                    target: "file:///tmp/source.xlsx".to_string(),
                    target_mode: Some("External".to_string()),
                },
            ),
            field_names: vec!["Category".to_string(), "Amount".to_string()],
            shared_items: vec![
                vec![
                    DomainValue::Text(Arc::from("B")),
                    DomainValue::Text(Arc::from("A")),
                ],
                vec![],
            ],
        });
    output.pivot_cache_records.insert(
        11,
        vec![
            vec![
                DomainValue::Text(Arc::from("A")),
                DomainValue::Number(FiniteF64::new(10.0).unwrap()),
            ],
            vec![
                DomainValue::Text(Arc::from("B")),
                DomainValue::Number(FiniteF64::new(20.0).unwrap()),
            ],
        ],
    );

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let definition_xml = String::from_utf8(
        archive
            .read_file("xl/pivotCache/pivotCacheDefinition1.xml")
            .unwrap(),
    )
    .unwrap();
    let records_xml = String::from_utf8(
        archive
            .read_file("xl/pivotCache/pivotCacheRecords1.xml")
            .unwrap(),
    )
    .unwrap();
    let definition_rels = String::from_utf8(
        archive
            .read_file("xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(
        definition_xml.contains(
            r#"worksheetSource ref="A1:B3" sheet="External Data" r:id="rIdExternalSource""#
        )
    );
    assert!(definition_xml.contains(r#"<s v="B"/><s v="A"/>"#));
    assert!(records_xml.contains(r#"<x v="1"/>"#));
    assert!(records_xml.contains(r#"<n v="10"/>"#));
    assert!(definition_rels.contains(r#"Id="rIdExternalSource""#));
    assert!(definition_rels.contains(r#"Target="file:///tmp/source.xlsx""#));
    assert!(definition_rels.contains(r#"TargetMode="External""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn skipped_generated_pivot_does_not_emit_stale_pivot_package_metadata() {
    let output = pivot_package_output(vec![make_pivot_config(
        "pivot-1",
        "PivotTable1",
        "Data",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Missing Pivot Sheet",
        Some(11),
    )]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!workbook_rels.contains("pivotCache/pivotCacheDefinition7.xml"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet2.xml.rels"));
    assert!(!content_types.contains("PartName=\"/xl/pivotTables/pivotTable7.xml\""));
    assert!(!content_types.contains("PartName=\"/xl/pivotCache/pivotCacheDefinition7.xml\""));
    assert!(!content_types.contains("PartName=\"/xl/pivotCache/pivotCacheRecords7.xml\""));
    assert!(!archive.contains("xl/pivotTables/pivotTable7.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheDefinition7.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheRecords7.xml"));
    assert!(!archive.contains("xl/pivotTables/pivotTable1.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheDefinition1.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheRecords1.xml"));
}

#[test]
fn worksheet_pivot_marker_without_modeled_pivot_is_not_emitted() {
    for position in ["after", "before"] {
        let output = make_parse_output(vec![
            SheetData {
                name: "Data".to_string(),
                ..Default::default()
            },
            SheetData {
                name: "Pivot".to_string(),
                ..Default::default()
            },
        ]);
        let bytes = write_xlsx_from_parse_output(&output).unwrap();
        let archive = crate::XlsxArchive::new(&bytes).unwrap();
        let sheet_xml =
            String::from_utf8(archive.read_file("xl/worksheets/sheet2.xml").unwrap()).unwrap();

        assert!(!sheet_xml.contains("pivotTableDefinition"));
        assert!(!archive.contains("xl/worksheets/_rels/sheet2.xml.rels"));
        validate_archive_package_integrity(&archive).expect("exported package should be valid");
    }
}

#[test]
fn missing_pivot_cache_ids_are_grouped_by_source_contract() {
    let output = pivot_package_output(vec![
        make_pivot_config(
            "pivot-1",
            "PivotTable1",
            "Data",
            cell_types::SheetRange::new(0, 0, 2, 1),
            "Pivot",
            None,
        ),
        make_pivot_config(
            "pivot-2",
            "PivotTable2",
            "Data",
            cell_types::SheetRange::new(4, 0, 5, 1),
            "Pivot",
            None,
        ),
    ]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let pivot_table_1 =
        String::from_utf8(archive.read_file("xl/pivotTables/pivotTable1.xml").unwrap()).unwrap();
    let pivot_table_2 =
        String::from_utf8(archive.read_file("xl/pivotTables/pivotTable2.xml").unwrap()).unwrap();
    let pivot_table_1_rels = String::from_utf8(
        archive
            .read_file("xl/pivotTables/_rels/pivotTable1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let pivot_table_2_rels = String::from_utf8(
        archive
            .read_file("xl/pivotTables/_rels/pivotTable2.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert_eq!(workbook_xml.matches("<pivotCache ").count(), 2);
    assert!(workbook_xml.contains("cacheId=\"1\""));
    assert!(workbook_xml.contains("cacheId=\"2\""));
    assert!(pivot_table_1.contains("cacheId=\"1\""));
    assert!(pivot_table_2.contains("cacheId=\"2\""));
    assert!(pivot_table_1_rels.contains("../pivotCache/pivotCacheDefinition1.xml"));
    assert!(pivot_table_2_rels.contains("../pivotCache/pivotCacheDefinition2.xml"));
    assert!(archive.contains("xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels"));
    assert!(archive.contains("xl/pivotCache/_rels/pivotCacheDefinition2.xml.rels"));
}

#[test]
fn pivot_cache_records_xml_uses_typed_records_when_source_matches() {
    let mut output = pivot_package_output(vec![make_pivot_config(
        "pivot-1",
        "PivotTable1",
        "Data",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Pivot",
        Some(11),
    )]);
    output.pivot_cache_records.insert(
        11,
        vec![
            vec![
                DomainValue::Text(Arc::from("A")),
                DomainValue::Number(FiniteF64::new(10.0).unwrap()),
            ],
            vec![
                DomainValue::Text(Arc::from("B")),
                DomainValue::Number(FiniteF64::new(20.0).unwrap()),
            ],
        ],
    );

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let records_xml = String::from_utf8(
        archive
            .read_file("xl/pivotCache/pivotCacheRecords1.xml")
            .unwrap(),
    )
    .unwrap();

    assert!(records_xml.contains("count=\"2\""));
    assert!(records_xml.contains("<x v=\"0\"/>"));
    assert!(records_xml.contains("<n v=\"10\"/>"));
}

#[test]
fn stale_pivot_cache_records_are_recomputed_when_source_changes() {
    let mut output = pivot_package_output(vec![make_pivot_config(
        "pivot-1",
        "PivotTable1",
        "Data",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Pivot",
        Some(11),
    )]);
    output.pivot_cache_records.insert(
        11,
        vec![
            vec![
                DomainValue::Text(Arc::from("A")),
                DomainValue::Number(FiniteF64::new(999.0).unwrap()),
            ],
            vec![
                DomainValue::Text(Arc::from("B")),
                DomainValue::Number(FiniteF64::new(20.0).unwrap()),
            ],
        ],
    );

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let records_xml = String::from_utf8(
        archive
            .read_file("xl/pivotCache/pivotCacheRecords1.xml")
            .unwrap(),
    )
    .unwrap();

    assert!(records_xml.contains("<n v=\"10\"/>"));
    assert!(!records_xml.contains("<n v=\"999\"/>"));
}

#[test]
fn live_pivot_cache_source_schema_is_not_truncated_to_source_range_width() {
    let mut output = pivot_package_output(vec![make_pivot_config(
        "pivot-1",
        "PivotTable1",
        "Data",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Pivot",
        Some(11),
    )]);
    output
        .pivot_cache_sources
        .push(domain_types::PivotCacheSourceDef {
            cache_id: 11,
            workbook_ref_scope: Default::default(),
            source_kind: domain_types::domain::pivot::PivotCacheSourceKind::LocalWorksheet,
            source_name: None,
            source_sheet: Some("Data".to_string()),
            source_range: Some("A1:B3".to_string()),
            external_worksheet: None,
            field_names: vec![
                "Category".to_string(),
                "Amount".to_string(),
                "ImportedOnly".to_string(),
            ],
            shared_items: vec![
                vec![
                    DomainValue::Text(Arc::from("A")),
                    DomainValue::Text(Arc::from("B")),
                ],
                vec![],
                vec![DomainValue::Text(Arc::from("Legacy"))],
            ],
        });

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let definition_xml = String::from_utf8(
        archive
            .read_file("xl/pivotCache/pivotCacheDefinition1.xml")
            .unwrap(),
    )
    .unwrap();
    let records_xml = String::from_utf8(
        archive
            .read_file("xl/pivotCache/pivotCacheRecords1.xml")
            .unwrap(),
    )
    .unwrap();

    assert!(definition_xml.contains(r#"<cacheFields count="3">"#));
    assert!(definition_xml.contains(r#"name="ImportedOnly""#));
    assert!(definition_xml.contains(r#"<s v="Legacy"/>"#));
    assert!(records_xml.contains(r#"<x v="0"/><n v="10"/><m/>"#));
}

#[test]
fn named_table_pivot_cache_source_regenerates_from_live_table_and_keeps_shared_item_order() {
    let mut output = pivot_package_output(vec![make_pivot_config(
        "pivot-1",
        "PivotTable1",
        "xlsx-source-sheet",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Pivot",
        Some(11),
    )]);
    output.sheets[0].tables.push(domain_types::TableSpec {
        name: "tbl_units".to_string(),
        display_name: "tbl_units".to_string(),
        range_ref: "A1:B3".to_string(),
        ..Default::default()
    });
    output.pivot_tables[0].ooxml_preservation.cache_source_name = Some("tbl_units".to_string());
    output.pivot_tables[0].ooxml_preservation.cache_shared_items = vec![
        vec![
            DomainValue::Text(Arc::from("B")),
            DomainValue::Text(Arc::from("A")),
        ],
        vec![
            DomainValue::Number(FiniteF64::new(10.0).unwrap()),
            DomainValue::Number(FiniteF64::new(20.0).unwrap()),
        ],
    ];

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let definition_xml = String::from_utf8(
        archive
            .read_file("xl/pivotCache/pivotCacheDefinition1.xml")
            .unwrap(),
    )
    .unwrap();
    let records_xml = String::from_utf8(
        archive
            .read_file("xl/pivotCache/pivotCacheRecords1.xml")
            .unwrap(),
    )
    .unwrap();

    assert!(definition_xml.contains("<worksheetSource name=\"tbl_units\"/>"));
    assert!(
        definition_xml.contains("<sharedItems count=\"2\"><s v=\"B\"/><s v=\"A\"/></sharedItems>")
    );
    assert!(records_xml.contains("count=\"2\""));
    assert!(records_xml.contains("<x v=\"1\"/><n v=\"10\"/>"));
    assert!(records_xml.contains("<x v=\"0\"/><n v=\"20\"/>"));
}

#[test]
fn named_table_pivot_cache_source_resolves_unique_live_table_prefix() {
    let mut output = pivot_package_output(vec![make_pivot_config(
        "pivot-1",
        "PivotTable1",
        "xlsx-source-sheet",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Pivot",
        Some(11),
    )]);
    output.sheets[0].tables.push(domain_types::TableSpec {
        name: "Table714212835453111929384756311412233173177".to_string(),
        display_name: "Table714212835453111929384756311412233173177".to_string(),
        range_ref: "A1:C3".to_string(),
        ..Default::default()
    });
    output.pivot_tables[0].ooxml_preservation.cache_source_name = Some("Table7142128".to_string());
    output
        .pivot_cache_sources
        .push(domain_types::PivotCacheSourceDef {
            cache_id: 11,
            workbook_ref_scope: Default::default(),
            source_kind: domain_types::domain::pivot::PivotCacheSourceKind::LocalTableOrName,
            source_name: Some("Table7142128".to_string()),
            source_sheet: None,
            source_range: None,
            external_worksheet: None,
            field_names: vec!["Category".to_string(), "Amount".to_string()],
            shared_items: vec![
                vec![
                    DomainValue::Text(Arc::from("B")),
                    DomainValue::Text(Arc::from("A")),
                ],
                vec![
                    DomainValue::Number(FiniteF64::new(10.0).unwrap()),
                    DomainValue::Number(FiniteF64::new(20.0).unwrap()),
                ],
            ],
        });

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let definition_xml = String::from_utf8(
        archive
            .read_file("xl/pivotCache/pivotCacheDefinition1.xml")
            .unwrap(),
    )
    .unwrap();
    let records_xml = String::from_utf8(
        archive
            .read_file("xl/pivotCache/pivotCacheRecords1.xml")
            .unwrap(),
    )
    .unwrap();

    assert!(definition_xml.contains("<worksheetSource name=\"Table7142128\"/>"));
    assert!(definition_xml.contains("<cacheFields count=\"2\">"));
    assert!(
        definition_xml.contains("<sharedItems count=\"2\"><s v=\"B\"/><s v=\"A\"/></sharedItems>")
    );
    assert!(records_xml.contains("count=\"2\""));
    assert!(records_xml.contains("<x v=\"1\"/><n v=\"10\"/>"));
    assert!(records_xml.contains("<x v=\"0\"/><n v=\"20\"/>"));
}

#[test]
fn named_table_pivot_cache_source_does_not_guess_ambiguous_live_table_prefix() {
    let mut output = pivot_package_output(vec![make_pivot_config(
        "pivot-1",
        "PivotTable1",
        "xlsx-source-sheet",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Pivot",
        Some(11),
    )]);
    output.sheets[0].tables.push(domain_types::TableSpec {
        name: "Table7142128Alpha".to_string(),
        display_name: "Table7142128Alpha".to_string(),
        range_ref: "A1:B3".to_string(),
        ..Default::default()
    });
    output.sheets[0].tables.push(domain_types::TableSpec {
        name: "Table7142128Beta".to_string(),
        display_name: "Table7142128Beta".to_string(),
        range_ref: "A5:B7".to_string(),
        ..Default::default()
    });
    output.pivot_tables[0].ooxml_preservation.cache_source_name = Some("Table7142128".to_string());

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();

    assert!(!archive.contains("xl/pivotTables/pivotTable1.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheDefinition1.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheRecords1.xml"));
}

#[test]
fn pivot_table_xml_uses_modeled_layout_style_location_and_items() {
    let mut config = make_pivot_config(
        "pivot-1",
        "PivotTable1",
        "Data",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Pivot",
        Some(11),
    );
    config.layout = Some(pivot_types::PivotTableLayout {
        show_row_grand_totals: Some(false),
        show_column_grand_totals: Some(false),
        data_caption: Some("Modeled Values".to_string()),
        grid_drop_zones: Some(true),
        grand_total_caption: Some("Modeled Total".to_string()),
        row_header_caption: Some("Modeled Rows".to_string()),
        col_header_caption: Some("Modeled Cols".to_string()),
        error_caption: Some("Modeled Error".to_string()),
        show_error: Some(true),
        missing_caption: Some("Modeled Missing".to_string()),
        show_missing: Some(false),
        ..Default::default()
    });
    config.style = Some(pivot_types::PivotTableStyle {
        style_name: Some("PivotStyleMedium4".to_string()),
        show_row_headers: Some(false),
        show_column_headers: Some(false),
        show_row_stripes: Some(true),
        show_column_stripes: Some(true),
        show_last_column: Some(true),
    });
    config.ref_range = Some("C5:F9".to_string());
    config.first_header_row = Some(2);
    config.first_data_row = Some(3);
    config.first_data_col = Some(4);
    config.rows_per_page = Some(5);
    config.cols_per_page = Some(6);
    config.row_items = vec![domain_types::PivotRowColItem {
        item_type: Some(domain_types::PivotItemType::Grand),
        x_values: vec![None, Some(1)],
    }];

    let output = pivot_package_output(vec![config]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let pivot_xml =
        String::from_utf8(archive.read_file("xl/pivotTables/pivotTable1.xml").unwrap()).unwrap();

    assert!(pivot_xml.contains("dataCaption=\"Modeled Values\""));
    assert!(pivot_xml.contains("rowGrandTotals=\"0\""));
    assert!(pivot_xml.contains("colGrandTotals=\"0\""));
    assert!(pivot_xml.contains("gridDropZones=\"1\""));
    assert!(pivot_xml.contains("grandTotalCaption=\"Modeled Total\""));
    assert!(pivot_xml.contains("rowHeaderCaption=\"Modeled Rows\""));
    assert!(pivot_xml.contains("colHeaderCaption=\"Modeled Cols\""));
    assert!(pivot_xml.contains("errorCaption=\"Modeled Error\""));
    assert!(pivot_xml.contains("showError=\"1\""));
    assert!(pivot_xml.contains("missingCaption=\"Modeled Missing\""));
    assert!(pivot_xml.contains("showMissing=\"0\""));
    assert!(pivot_xml.contains("ref=\"C5:F9\""));
    assert!(pivot_xml.contains("firstHeaderRow=\"2\""));
    assert!(pivot_xml.contains("firstDataRow=\"3\""));
    assert!(pivot_xml.contains("firstDataCol=\"4\""));
    assert!(pivot_xml.contains("rowPageCount=\"5\""));
    assert!(pivot_xml.contains("colPageCount=\"6\""));
    assert!(pivot_xml.contains("name=\"PivotStyleMedium4\""));
    assert!(pivot_xml.contains("showRowHeaders=\"0\""));
    assert!(pivot_xml.contains("showColHeaders=\"0\""));
    assert!(pivot_xml.contains("showLastColumn=\"1\""));
    assert!(
        pivot_xml.contains("<rowItems count=\"1\"><i t=\"grand\"><x/><x v=\"1\"/></i></rowItems>")
    );
}
