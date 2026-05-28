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
