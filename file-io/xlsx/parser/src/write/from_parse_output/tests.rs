use super::styles::hex_to_color_def;
use super::*;
use crate::domain::content_types::write::{CT_PIVOT_CACHE, CT_PIVOT_TABLE};
use crate::domain::styles::write::ColorDef;
use crate::infra::package_integrity::validate_archive_package_integrity;
use crate::write::REL_PIVOT_TABLE;
use domain_types::{
    AlignmentFormat, AnchorPosition, AuthoredStyleRun, BorderFormat,
    BorderSide as DomainBorderSide, CellData as DomainCellData, CellValue as DomainValue,
    ChartSpec, ChartType, ColDimension, ColStyleEntry, DataTableOoxmlFlags, DataTableRegion,
    DocumentFormat, FillFormat, FontFormat, FrozenPane, MergeRegion, NamedRange, ObjectSize,
    ParseOutput, RowDimension, SheetData, SheetDimensions,
};
use formula_types::CellRef;
use std::sync::Arc;
use value_types::{CellError, FiniteF64};

const CT_PIVOT_CACHE_RECORDS: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml";

fn make_parse_output(sheets: Vec<SheetData>) -> ParseOutput {
    ParseOutput {
        sheets,
        ..Default::default()
    }
}

#[test]
fn workbook_with_preserved_sheet_drawing_relationship_must_emit_target_part() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: REL_DRAWING.to_string(),
                target: "../drawings/drawing1.xml".to_string(),
                target_mode: None,
            }],
            original_drawing_path: Some("xl/drawings/drawing1.xml".to_string()),
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let rels_xml = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    assert!(
        rels_xml.contains("Target=\"../drawings/drawing1.xml\""),
        "test precondition: writer should preserve the original sheet drawing relationship"
    );

    let drawing_path =
        crate::infra::opc::opc_target_to_zip_path("../drawings/drawing1.xml", "xl/worksheets");
    assert!(
        archive.contains(&drawing_path),
        "worksheet drawing relationship points at missing ZIP part {drawing_path}; sheet rels:\n{rels_xml}"
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn test_api_created_data_range_chart_exports_valid_chart_xml() {
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
            make_cell(2, 0, DomainValue::Text(Arc::from("Q2"))),
            make_cell(2, 1, DomainValue::Number(FiniteF64::new(200.0).unwrap())),
            make_cell(3, 0, DomainValue::Text(Arc::from("Q3"))),
            make_cell(3, 1, DomainValue::Number(FiniteF64::new(300.0).unwrap())),
        ],
        charts: vec![make_chart(ChartType::Column, "Data!A1:B4")],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(chart_xml.contains("<c:barChart>"));
    assert_eq!(chart_xml.matches("<c:ser>").count(), 1);
    assert!(chart_xml.contains("<c:f>Data!A2:A4</c:f>"));
    assert!(chart_xml.contains("<c:f>Data!B2:B4</c:f>"));
    assert!(chart_xml.contains("<c:catAx>"));
    assert!(chart_xml.contains("<c:valAx>"));
    assert_eq!(
        content_types
            .matches("PartName=\"/xl/drawings/drawing1.xml\"")
            .count(),
        1
    );
    assert_eq!(
        content_types
            .matches("PartName=\"/xl/charts/chart1.xml\"")
            .count(),
        1
    );
}

fn make_cell(row: u32, col: u32, value: DomainValue) -> DomainCellData {
    DomainCellData {
        row,
        col,
        value,
        ..Default::default()
    }
}

#[test]
fn authored_non_finite_numeric_lexeme_roundtrips_through_domain_cell_metadata() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![DomainCellData {
            row: 0,
            col: 0,
            value: DomainValue::Error(CellError::Num, None),
            original_value: Some("NaN".to_string()),
            ..Default::default()
        }],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(
        sheet_xml.contains(r#"<c r="A1"><v>NaN</v></c>"#),
        "authored numeric lexeme must be emitted as an untyped numeric cell:\n{sheet_xml}"
    );
    assert!(
        !sheet_xml.contains(r#"<c r="A1" t="e"><v>#NUM!</v></c>"#),
        "authored numeric lexeme must not be rewritten as an OOXML error cell:\n{sheet_xml}"
    );
}

#[test]
fn authored_style_runs_stream_blank_cells_and_style_overlapping_values() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        rows: 2,
        cols: 2,
        cells: vec![make_cell(
            0,
            1,
            DomainValue::Number(FiniteF64::new(42.0).unwrap()),
        )],
        authored_style_runs: vec![AuthoredStyleRun {
            start_row: 0,
            start_col: 0,
            end_row: 1,
            end_col: 1,
            style_id: 2,
        }],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert_eq!(sheet_xml.matches(r#"r="A1""#).count(), 1);
    assert_eq!(sheet_xml.matches(r#"r="B1""#).count(), 1);
    assert_eq!(sheet_xml.matches(r#"r="A2""#).count(), 1);
    assert_eq!(sheet_xml.matches(r#"r="B2""#).count(), 1);
    assert!(sheet_xml.contains(r#"<c r="A1" s="3"/>"#));
    assert!(sheet_xml.contains(r#"<c r="B1" s="3"><v>42</v></c>"#));
    assert!(sheet_xml.contains(r#"<c r="A2" s="3"/>"#));
    assert!(sheet_xml.contains(r#"<c r="B2" s="3"/>"#));
}

#[test]
fn center_continuous_style_run_exports_styled_blanks_without_merges() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 1,
            cols: 4,
            cells: vec![make_cell(
                0,
                0,
                DomainValue::Text(Arc::from("CENTERED HEADER")),
            )],
            authored_style_runs: vec![AuthoredStyleRun {
                start_row: 0,
                start_col: 0,
                end_row: 0,
                end_col: 3,
                style_id: 0,
            }],
            ..Default::default()
        }],
        style_palette: vec![DocumentFormat {
            alignment: Some(AlignmentFormat {
                horizontal: Some("centerContinuous".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let styles_xml = String::from_utf8(archive.read_file("xl/styles.xml").unwrap()).unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(
        styles_xml.contains(r#"horizontal="centerContinuous""#),
        "styles.xml should contain the centerContinuous alignment:\n{styles_xml}"
    );
    assert!(
        styles_xml.contains(r#"applyAlignment="1""#),
        "generated centerContinuous styles must set applyAlignment:\n{styles_xml}"
    );
    assert!(
        sheet_xml.contains(r#"<c r="A1" s="1""#),
        "sheet XML should apply the centered style to A1:\n{sheet_xml}"
    );
    assert!(
        sheet_xml.contains(r#"<c r="B1" s="1"/>"#),
        "sheet XML should apply the centered style to B1:\n{sheet_xml}"
    );
    assert!(
        sheet_xml.contains(r#"<c r="C1" s="1"/>"#),
        "sheet XML should apply the centered style to C1:\n{sheet_xml}"
    );
    assert!(
        sheet_xml.contains(r#"<c r="D1" s="1"/>"#),
        "sheet XML should apply the centered style to D1:\n{sheet_xml}"
    );
    assert!(!sheet_xml.contains("<mergeCells"));
    assert!(!sheet_xml.contains("<mergeCell"));
}

#[test]
fn stale_calc_chain_round_trip_metadata_is_not_exported_without_calc_chain_part() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheet_workbook_r_ids: vec!["rId1".to_string()],
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_CALC_CHAIN.to_string(),
                target: "calcChain.xml".to_string(),
                target_mode: None,
            },
        ],
        content_type_overrides: vec![(
            "/xl/calcChain.xml".to_string(),
            crate::write::CT_CALC_CHAIN.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/calcChain.xml"));
    assert!(!workbook_rels.contains("relationships/calcChain"));
    assert!(!content_types.contains("/xl/calcChain.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_workbook_rels_without_shared_strings_are_repaired_when_text_cells_emit_sst() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(0, 0, DomainValue::Text(Arc::from("hello")))],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheet_workbook_r_ids: vec!["rId1".to_string()],
        workbook_relationships: vec![domain_types::OpcRelationship {
            id: "rId1".to_string(),
            rel_type: crate::write::REL_WORKSHEET.to_string(),
            target: "worksheets/sheet1.xml".to_string(),
            target_mode: None,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(archive.contains("xl/sharedStrings.xml"));
    assert!(workbook_rels.contains(crate::write::REL_SHARED_STRINGS));
    assert!(workbook_rels.contains("Target=\"sharedStrings.xml\""));
    assert!(content_types.contains("PartName=\"/xl/sharedStrings.xml\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_content_type_override_for_missing_part_is_not_exported() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        content_type_overrides: vec![(
            "/xl/missingModeledPart.xml".to_string(),
            crate::write::CT_WORKSHEET.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/missingModeledPart.xml"));
    assert!(!content_types.contains("missingModeledPart.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_workbook_relationship_to_missing_modeled_part_is_not_exported() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheet_workbook_r_ids: vec!["rId1".to_string()],
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId8".to_string(),
                rel_type: crate::write::REL_SHARED_STRINGS.to_string(),
                target: "sharedStrings.xml".to_string(),
                target_mode: None,
            },
        ],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();

    assert!(!archive.contains("xl/sharedStrings.xml"));
    assert!(!workbook_rels.contains(crate::write::REL_SHARED_STRINGS));
    assert!(!workbook_rels.contains("Target=\"sharedStrings.xml\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_worksheet_relationship_to_missing_modeled_part_is_not_exported_or_referenced() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId4".to_string(),
                rel_type: crate::write::REL_TABLE.to_string(),
                target: "../tables/table9.xml".to_string(),
                target_mode: None,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/tables/table9.xml"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(!sheet_xml.contains("r:id=\"rId4\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn duplicate_original_workbook_relationship_ids_do_not_leak_to_generated_relationships() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(0, 0, DomainValue::Text(Arc::from("hello")))],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheet_workbook_r_ids: vec!["rId1".to_string()],
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_SHARED_STRINGS.to_string(),
                target: "sharedStrings.xml".to_string(),
                target_mode: None,
            },
        ],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels = archive.read_file("xl/_rels/workbook.xml.rels").unwrap();
    let rels = crate::domain::workbook::read::parse_all_rels(&workbook_rels);
    let mut ids = std::collections::HashSet::new();

    for rel in rels {
        assert!(ids.insert(rel.id), "relationship IDs must be unique");
    }
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

fn make_formula_cell(row: u32, col: u32, formula: &str, cached: DomainValue) -> DomainCellData {
    DomainCellData {
        row,
        col,
        value: cached,
        formula: Some(formula.to_string()),
        ..Default::default()
    }
}

fn make_pivot_config(
    id: &str,
    name: &str,
    source_sheet_name: &str,
    source_range: cell_types::SheetRange,
    output_sheet_name: &str,
    cache_id: Option<u32>,
) -> pivot_types::PivotTableConfig {
    pivot_types::PivotTableConfig {
        schema_version: pivot_types::PIVOT_CONFIG_SCHEMA_VERSION,
        id: id.to_string(),
        name: name.to_string(),
        source_sheet_id: None,
        source_sheet_name: source_sheet_name.to_string(),
        source_range,
        output_sheet_name: output_sheet_name.to_string(),
        output_location: pivot_types::OutputLocation { row: 0, col: 0 },
        fields: Vec::new(),
        placements: Vec::new(),
        filters: Vec::new(),
        layout: None,
        style: None,
        data_options: None,
        created_at: None,
        updated_at: None,
        calculated_fields: None,
        allow_multiple_filters_per_field: None,
        auto_format: None,
        preserve_formatting: None,
        cache_id,
        ref_range: None,
        first_data_row: None,
        first_data_col: None,
        row_items: Vec::new(),
        col_items: Vec::new(),
    }
}

fn pivot_package_output(pivots: Vec<pivot_types::PivotTableConfig>) -> ParseOutput {
    let mut output = make_parse_output(vec![
        SheetData {
            name: "Data".to_string(),
            cells: vec![
                make_cell(0, 0, DomainValue::Text(Arc::from("Category"))),
                make_cell(0, 1, DomainValue::Text(Arc::from("Amount"))),
                make_cell(1, 0, DomainValue::Text(Arc::from("A"))),
                make_cell(1, 1, DomainValue::Number(FiniteF64::new(10.0).unwrap())),
                make_cell(2, 0, DomainValue::Text(Arc::from("B"))),
                make_cell(2, 1, DomainValue::Number(FiniteF64::new(20.0).unwrap())),
                make_cell(4, 0, DomainValue::Text(Arc::from("Category"))),
                make_cell(4, 1, DomainValue::Text(Arc::from("Amount"))),
                make_cell(5, 0, DomainValue::Text(Arc::from("C"))),
                make_cell(5, 1, DomainValue::Number(FiniteF64::new(30.0).unwrap())),
            ],
            ..Default::default()
        },
        SheetData {
            name: "Pivot".to_string(),
            ..Default::default()
        },
    ]);
    output.pivot_tables = pivots
        .into_iter()
        .map(|config| domain_types::domain::pivot::ParsedPivotTable {
            config,
            initial_expansion_state: None,
        })
        .collect();
    output
}

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
    let mut ctx = domain_types::RoundTripContext {
        sheets: vec![
            domain_types::SheetRoundTripContext::default(),
            domain_types::SheetRoundTripContext::default(),
        ],
        content_type_overrides: vec![
            (
                "/xl/pivotTables/pivotTable7.xml".to_string(),
                CT_PIVOT_TABLE.to_string(),
            ),
            (
                "/xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                CT_PIVOT_CACHE.to_string(),
            ),
            (
                "/xl/pivotCache/pivotCacheRecords7.xml".to_string(),
                CT_PIVOT_CACHE_RECORDS.to_string(),
            ),
        ],
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId2".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet2.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId99".to_string(),
                rel_type: REL_PIVOT_CACHE.to_string(),
                target: "pivotCache/pivotCacheDefinition7.xml".to_string(),
                target_mode: None,
            },
        ],
        sheet_workbook_r_ids: vec!["rId1".to_string(), "rId2".to_string()],
        binary_blobs: vec![
            domain_types::BlobPart {
                path: "xl/pivotTables/pivotTable7.xml".to_string(),
                data: b"stale pivot table".to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                data: b"stale cache".to_vec(),
            },
        ],
        ..Default::default()
    };
    ctx.sheets[1].sheet_opc_rels = vec![
        domain_types::OpcRelationship {
            id: "rId1".to_string(),
            rel_type: REL_HYPERLINK.to_string(),
            target: "https://example.com".to_string(),
            target_mode: Some("External".to_string()),
        },
        domain_types::OpcRelationship {
            id: "rId7".to_string(),
            rel_type: REL_PIVOT_TABLE.to_string(),
            target: "../pivotTables/pivotTable7.xml".to_string(),
            target_mode: None,
        },
    ];
    ctx.sheets[1].sheet_preserved_elements = vec![(
        "worksheet\0after\0sheetData\0pivotTableDefinition".to_string(),
        r#"<pivotTableDefinition r:id="rId7"/>"#.to_string(),
    )];

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
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
fn workbook_pivot_caches_are_not_replayed_twice() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext::default()],
        workbook_preserved_elements: vec![(
            "workbook\0after\0calcPr\0pivotCaches".to_string(),
            r#"<pivotCaches><pivotCache cacheId="999" r:id="rIdOld"/></pivotCaches>"#.to_string(),
        )],
        pivot_package: domain_types::PivotPackageRoundTrip {
            workbook_cache_entries: vec![domain_types::PivotWorkbookCacheEntry {
                cache_id: 77,
                relationship_id: "rId99".to_string(),
                relationship_target: "pivotCache/pivotCacheDefinition7.xml".to_string(),
                definition_path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                order: 0,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            cache_definitions: vec![domain_types::PivotCacheDefinitionPackage {
                cache_id: 77,
                definition_path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                definition_rels_path: None,
                source_kind: domain_types::PivotCacheSourceKind::Worksheet,
                raw_definition_xml: br#"<pivotCacheDefinition cacheId="77"/>"#.to_vec(),
                raw_relationships: Vec::new(),
                records_relationship_id: None,
                records_relationship_target: None,
                records_path: None,
                raw_records_xml: None,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            content_type_overrides: vec![domain_types::PivotPackageContentType {
                part_name: "/xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                content_type: CT_PIVOT_CACHE.to_string(),
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            ..Default::default()
        },
        binary_blobs: vec![domain_types::BlobPart {
            path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
            data: br#"<pivotCacheDefinition cacheId="77"/>"#.to_vec(),
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();

    assert_eq!(workbook_xml.matches("<pivotCaches>").count(), 1);
    assert!(workbook_xml.contains("cacheId=\"77\" r:id=\"rId99\""));
    assert!(!workbook_xml.contains("cacheId=\"999\""));
}

#[test]
fn pivot_package_preserves_orphan_workbook_cache_relationships_for_clean_parts() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext::default()],
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId40".to_string(),
                rel_type: REL_PIVOT_CACHE.to_string(),
                target: "pivotCache/pivotCacheDefinition5.xml".to_string(),
                target_mode: None,
            },
        ],
        sheet_workbook_r_ids: vec!["rId1".to_string()],
        pivot_package: domain_types::PivotPackageRoundTrip {
            cache_definitions: vec![domain_types::PivotCacheDefinitionPackage {
                cache_id: 999,
                definition_path: "xl/pivotCache/pivotCacheDefinition5.xml".to_string(),
                definition_rels_path: None,
                source_kind: domain_types::PivotCacheSourceKind::Worksheet,
                raw_definition_xml: br#"<pivotCacheDefinition cacheId="999"/>"#.to_vec(),
                raw_relationships: Vec::new(),
                records_relationship_id: None,
                records_relationship_target: None,
                records_path: None,
                raw_records_xml: None,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            content_type_overrides: vec![domain_types::PivotPackageContentType {
                part_name: "/xl/pivotCache/pivotCacheDefinition5.xml".to_string(),
                content_type: CT_PIVOT_CACHE.to_string(),
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            ..Default::default()
        },
        binary_blobs: vec![domain_types::BlobPart {
            path: "xl/pivotCache/pivotCacheDefinition5.xml".to_string(),
            data: br#"<pivotCacheDefinition cacheId="999"/>"#.to_vec(),
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();

    assert!(workbook_rels.contains("Id=\"rId40\""));
    assert!(workbook_rels.contains("pivotCache/pivotCacheDefinition5.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition5.xml"));
}

#[test]
fn generated_pivot_preserves_clean_imported_pivot_package_contract() {
    let output = pivot_package_output(vec![make_pivot_config(
        "pivot-generated",
        "GeneratedPivot",
        "Data",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Pivot",
        Some(11),
    )]);
    let imported_content_types = vec![
        (
            "/xl/pivotTables/pivotTable7.xml".to_string(),
            CT_PIVOT_TABLE.to_string(),
        ),
        (
            "/xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
            CT_PIVOT_CACHE.to_string(),
        ),
        (
            "/xl/pivotCache/pivotCacheRecords7.xml".to_string(),
            CT_PIVOT_CACHE_RECORDS.to_string(),
        ),
    ];
    let mut ctx = domain_types::RoundTripContext {
        sheets: vec![
            domain_types::SheetRoundTripContext::default(),
            domain_types::SheetRoundTripContext::default(),
        ],
        content_type_overrides: imported_content_types.clone(),
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId2".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet2.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId99".to_string(),
                rel_type: REL_PIVOT_CACHE.to_string(),
                target: "pivotCache/pivotCacheDefinition7.xml".to_string(),
                target_mode: None,
            },
        ],
        sheet_workbook_r_ids: vec!["rId1".to_string(), "rId2".to_string()],
        binary_blobs: vec![
            domain_types::BlobPart {
                path: "xl/pivotTables/pivotTable7.xml".to_string(),
                data: br#"<pivotTableDefinition name="ImportedPivot" cacheId="77"/>"#.to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotTables/_rels/pivotTable7.xml.rels".to_string(),
                data: b"imported pivot table rels".to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                data: b"imported cache definition".to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotCache/_rels/pivotCacheDefinition7.xml.rels".to_string(),
                data: b"imported cache rels".to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotCache/pivotCacheRecords7.xml".to_string(),
                data: b"imported cache records".to_vec(),
            },
        ],
        pivot_package: domain_types::PivotPackageRoundTrip {
            workbook_cache_entries: vec![domain_types::PivotWorkbookCacheEntry {
                cache_id: 77,
                relationship_id: "rId99".to_string(),
                relationship_target: "pivotCache/pivotCacheDefinition7.xml".to_string(),
                definition_path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                order: 0,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            cache_definitions: vec![domain_types::PivotCacheDefinitionPackage {
                cache_id: 77,
                definition_path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                definition_rels_path: Some(
                    "xl/pivotCache/_rels/pivotCacheDefinition7.xml.rels".to_string(),
                ),
                source_kind: domain_types::PivotCacheSourceKind::External,
                raw_definition_xml: b"imported cache definition".to_vec(),
                raw_relationships: vec![domain_types::OpcRelationship {
                    id: "rId1".to_string(),
                    rel_type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords".to_string(),
                    target: "pivotCacheRecords7.xml".to_string(),
                    target_mode: None,
                }],
                records_relationship_id: Some("rId1".to_string()),
                records_relationship_target: Some("pivotCacheRecords7.xml".to_string()),
                records_path: Some("xl/pivotCache/pivotCacheRecords7.xml".to_string()),
                raw_records_xml: Some(b"imported cache records".to_vec()),
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            pivot_tables: vec![domain_types::PivotTablePackage {
                sheet_index: 1,
                sheet_name: "Pivot".to_string(),
                sheet_relationship_id: "rId7".to_string(),
                sheet_relationship_target: "../pivotTables/pivotTable7.xml".to_string(),
                table_path: "xl/pivotTables/pivotTable7.xml".to_string(),
                table_rels_path: Some("xl/pivotTables/_rels/pivotTable7.xml.rels".to_string()),
                pivot_name: Some("ImportedPivot".to_string()),
                raw_table_xml: br#"<pivotTableDefinition name="ImportedPivot" cacheId="77"/>"#
                    .to_vec(),
                raw_relationships: vec![domain_types::OpcRelationship {
                    id: "rId1".to_string(),
                    rel_type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition".to_string(),
                    target: "../pivotCache/pivotCacheDefinition7.xml".to_string(),
                    target_mode: None,
                }],
                referenced_cache_id: 77,
                order: 0,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            content_type_overrides: imported_content_types
                .iter()
                .map(|(part_name, content_type)| domain_types::PivotPackageContentType {
                    part_name: part_name.clone(),
                    content_type: content_type.clone(),
                    ownership: domain_types::PivotPackageOwnership::CleanImported,
                })
                .collect(),
            orphan_parts: Vec::new(),
        },
        ..Default::default()
    };
    ctx.sheets[1].sheet_opc_rels = vec![
        domain_types::OpcRelationship {
            id: "rId1".to_string(),
            rel_type: REL_HYPERLINK.to_string(),
            target: "https://example.com".to_string(),
            target_mode: Some("External".to_string()),
        },
        domain_types::OpcRelationship {
            id: "rId7".to_string(),
            rel_type: REL_PIVOT_TABLE.to_string(),
            target: "../pivotTables/pivotTable7.xml".to_string(),
            target_mode: None,
        },
    ];
    ctx.sheets[1].sheet_preserved_elements = vec![(
        "worksheet\0after\0sheetData\0pivotTableDefinition".to_string(),
        r#"<pivotTableDefinition r:id="rId7"/>"#.to_string(),
    )];

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
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

    assert!(workbook_xml.contains("cacheId=\"77\" r:id=\"rId99\""));
    assert!(workbook_xml.contains("cacheId=\"11\""));
    assert!(workbook_rels.contains("pivotCache/pivotCacheDefinition7.xml"));
    assert!(workbook_rels.contains("pivotCache/pivotCacheDefinition1.xml"));
    assert!(sheet_rels.contains("../pivotTables/pivotTable7.xml"));
    assert!(sheet_rels.contains("../pivotTables/pivotTable1.xml"));
    assert!(sheet_xml.contains("<pivotTableDefinition r:id=\"rId7\"/>"));
    let generated_pivot_r_id = sheet_rels
        .split("<Relationship ")
        .find(|rel| rel.contains("../pivotTables/pivotTable1.xml"))
        .and_then(|rel| rel.split("Id=\"").nth(1))
        .and_then(|rel| rel.split('"').next())
        .expect("generated pivot relationship should have an r:id");
    assert!(sheet_xml.contains(&format!(
        "<pivotTableDefinition r:id=\"{generated_pivot_r_id}\"/>"
    )));
    assert!(content_types.contains("PartName=\"/xl/pivotTables/pivotTable7.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheDefinition7.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheRecords7.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotTables/pivotTable1.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheDefinition1.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheRecords1.xml\""));
    assert!(archive.contains("xl/pivotTables/pivotTable7.xml"));
    assert!(archive.contains("xl/pivotTables/_rels/pivotTable7.xml.rels"));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition7.xml"));
    assert!(archive.contains("xl/pivotCache/_rels/pivotCacheDefinition7.xml.rels"));
    assert!(archive.contains("xl/pivotCache/pivotCacheRecords7.xml"));
    assert!(archive.contains("xl/pivotTables/pivotTable1.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition1.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheRecords1.xml"));
}

#[test]
fn skipped_generated_pivot_preserves_original_pivot_package_passthrough() {
    let output = pivot_package_output(vec![make_pivot_config(
        "pivot-1",
        "PivotTable1",
        "Data",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Missing Pivot Sheet",
        Some(11),
    )]);
    let mut ctx = domain_types::RoundTripContext {
        sheets: vec![
            domain_types::SheetRoundTripContext::default(),
            domain_types::SheetRoundTripContext::default(),
        ],
        content_type_overrides: vec![
            (
                "/xl/pivotTables/pivotTable7.xml".to_string(),
                CT_PIVOT_TABLE.to_string(),
            ),
            (
                "/xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                CT_PIVOT_CACHE.to_string(),
            ),
            (
                "/xl/pivotCache/pivotCacheRecords7.xml".to_string(),
                CT_PIVOT_CACHE_RECORDS.to_string(),
            ),
        ],
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId2".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet2.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId99".to_string(),
                rel_type: REL_PIVOT_CACHE.to_string(),
                target: "pivotCache/pivotCacheDefinition7.xml".to_string(),
                target_mode: None,
            },
        ],
        sheet_workbook_r_ids: vec!["rId1".to_string(), "rId2".to_string()],
        binary_blobs: vec![
            domain_types::BlobPart {
                path: "xl/pivotTables/pivotTable7.xml".to_string(),
                data: b"original pivot table".to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                data: b"original cache definition".to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotCache/pivotCacheRecords7.xml".to_string(),
                data: b"original cache records".to_vec(),
            },
        ],
        ..Default::default()
    };
    ctx.sheets[1].sheet_opc_rels = vec![domain_types::OpcRelationship {
        id: "rId7".to_string(),
        rel_type: REL_PIVOT_TABLE.to_string(),
        target: "../pivotTables/pivotTable7.xml".to_string(),
        target_mode: None,
    }];

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet2.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(workbook_rels.contains("pivotCache/pivotCacheDefinition7.xml"));
    assert!(sheet_rels.contains("../pivotTables/pivotTable7.xml"));
    assert!(content_types.contains("PartName=\"/xl/pivotTables/pivotTable7.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheDefinition7.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheRecords7.xml\""));
    assert!(archive.contains("xl/pivotTables/pivotTable7.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition7.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheRecords7.xml"));
    assert!(!archive.contains("xl/pivotTables/pivotTable1.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheDefinition1.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheRecords1.xml"));
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

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
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
fn data_table_regions_drive_ooxml_formula_export_with_flags() {
    let mut output = make_parse_output(vec![SheetData {
        name: "DataTable".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Number(FiniteF64::new(1.0).unwrap())),
            make_cell(0, 1, DomainValue::Number(FiniteF64::new(2.0).unwrap())),
            make_formula_cell(
                1,
                1,
                "TABLE($A$1,$B$1)",
                DomainValue::Number(FiniteF64::new(3.0).unwrap()),
            ),
            make_formula_cell(
                1,
                2,
                "TABLE($A$1,$B$1)",
                DomainValue::Number(FiniteF64::new(4.0).unwrap()),
            ),
        ],
        ..Default::default()
    }]);
    output.data_table_regions.push(DataTableRegion {
        sheet_index: 0,
        start_row: 1,
        start_col: 1,
        end_row: 1,
        end_col: 2,
        row_input_ref: Some(CellRef::Positional {
            sheet: cell_types::SheetId::from_raw(0),
            row: 0,
            col: 1,
        }),
        col_input_ref: Some(CellRef::Positional {
            sheet: cell_types::SheetId::from_raw(0),
            row: 0,
            col: 0,
        }),
        ooxml_flags: Some(DataTableOoxmlFlags {
            r1: None,
            r2: None,
            aca: true,
            ca: true,
            bx: true,
            dt2d: true,
            dtr: true,
            del1: true,
            del2: true,
        }),
    });

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<f t=\"dataTable\""));
    assert!(sheet_xml.contains("ref=\"B2:C2\""));
    assert!(sheet_xml.contains("r1=\"$A$1\""));
    assert!(sheet_xml.contains("r2=\"$B$1\""));
    assert!(sheet_xml.contains("aca=\"1\""));
    assert!(sheet_xml.contains("ca=\"1\""));
    assert!(sheet_xml.contains("bx=\"1\""));
    assert!(sheet_xml.contains("dt2D=\"1\""));
    assert!(sheet_xml.contains("dtr=\"1\""));
    assert!(sheet_xml.contains("del1=\"1\""));
    assert!(sheet_xml.contains("del2=\"1\""));
}

#[test]
fn data_table_regions_preserve_authored_r1_r2_spelling_when_present() {
    let mut output = make_parse_output(vec![SheetData {
        name: "DataTable".to_string(),
        cells: vec![make_formula_cell(
            6,
            7,
            "TABLE($C$21,$C$8)",
            DomainValue::Number(FiniteF64::new(3.0).unwrap()),
        )],
        ..Default::default()
    }]);
    output.data_table_regions.push(DataTableRegion {
        sheet_index: 0,
        start_row: 6,
        start_col: 7,
        end_row: 10,
        end_col: 11,
        row_input_ref: Some(CellRef::Positional {
            sheet: cell_types::SheetId::from_raw(0),
            row: 20,
            col: 2,
        }),
        col_input_ref: Some(CellRef::Positional {
            sheet: cell_types::SheetId::from_raw(0),
            row: 7,
            col: 2,
        }),
        ooxml_flags: Some(DataTableOoxmlFlags {
            r1: Some("C8".to_string()),
            r2: Some("C21".to_string()),
            dt2d: true,
            dtr: true,
            ca: true,
            ..Default::default()
        }),
    });

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<f t=\"dataTable\""));
    assert!(sheet_xml.contains("ref=\"H7:L11\""));
    assert!(sheet_xml.contains("r1=\"C8\""));
    assert!(sheet_xml.contains("r2=\"C21\""));
    assert!(!sheet_xml.contains("r1=\"$C$8\""));
    assert!(!sheet_xml.contains("r2=\"$C$21\""));
}

#[test]
fn table_formula_body_cells_export_as_cached_values_only() {
    let output = make_parse_output(vec![SheetData {
        name: "DataTable".to_string(),
        cells: vec![make_formula_cell(
            6,
            8,
            "TABLE($C$21,$C$8)",
            DomainValue::Number(FiniteF64::new(3.0).unwrap()),
        )],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<c r=\"I7\""));
    assert!(sheet_xml.contains("<v>3</v>"));
    assert!(!sheet_xml.contains("<f>TABLE("));
}

fn make_chart(chart_type: ChartType, data_range: &str) -> ChartSpec {
    ChartSpec {
        chart_type,
        title: Some("Revenue".to_string()),
        position: AnchorPosition {
            anchor_row: 0,
            anchor_col: 0,
            anchor_row_offset: 0,
            anchor_col_offset: 0,
            end_row: Some(15),
            end_col: Some(8),
            end_row_offset: Some(0),
            end_col_offset: Some(0),
            extent_cx: None,
            extent_cy: None,
        },
        size: ObjectSize {
            width: 640.0,
            height: 300.0,
            height_pt: None,
            width_pt: None,
            left_pt: None,
            top_pt: None,
        },
        z_index: 0,
        definition: None,
        preserved_chart_xml: None,
        series: Vec::new(),
        sub_type: None,
        legend: None,
        axes: None,
        data_labels: None,
        data_range: Some(data_range.to_string()),
        style: None,
        rounded_corners: None,
        auto_title_deleted: None,
        show_data_labels_over_max: None,
        chart_format: None,
        plot_format: None,
        title_format: None,
        title_rich_text: None,
        title_formula: None,
        data_table: None,
        display_blanks_as: None,
        plot_visible_only: None,
        gap_width: None,
        overlap: None,
        doughnut_hole_size: None,
        first_slice_angle: None,
        bubble_scale: None,
        split_type: None,
        split_value: None,
        bar_shape: None,
        bubble_3d_effect: None,
        wireframe: None,
        surface_top_view: None,
        color_scheme: None,
        category_label_level: None,
        series_name_level: None,
        show_all_field_buttons: None,
        second_plot_size: None,
        vary_by_categories: None,
        title_h_align: None,
        title_v_align: None,
        title_show_shadow: None,
        pivot_options: None,
        view_3d: None,
        floor_format: None,
        side_wall_format: None,
        back_wall_format: None,
        rt: None,
        chart_frame: None,
        is_chart_ex: false,
        cnv_pr_name: Some("Revenue Chart".to_string()),
        cnv_pr_id: Some(2),
        cnv_pr_descr: None,
        cnv_pr_title: None,
        cnv_pr_hidden: false,
        no_change_aspect: None,
        has_graphic_frame_locks: false,
        xfrm_off_x: 0,
        xfrm_off_y: 0,
        xfrm_ext_cx: 0,
        xfrm_ext_cy: 0,
        cnv_pr_ext_lst: None,
        anchor_edit_as: None,
        macro_name: None,
        client_data_locks_with_sheet: None,
        client_data_prints_with_sheet: None,
        anchor_index: None,
        import_status: None,
    }
}

#[test]
fn test_empty_workbook() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_number_cells() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Number(FiniteF64::new(42.0).unwrap())),
            make_cell(0, 1, DomainValue::Number(FiniteF64::new(3.14).unwrap())),
        ],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_string_cells() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(0, 0, DomainValue::Text(Arc::from("hello world")))],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_formula_cells() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_formula_cell(
            0,
            0,
            "SUM(A2:A10)",
            DomainValue::Number(FiniteF64::new(100.0).unwrap()),
        )],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_mixed_cell_types() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Number(FiniteF64::new(1.0).unwrap())),
            make_cell(0, 1, DomainValue::Text(Arc::from("text"))),
            make_cell(1, 0, DomainValue::Boolean(true)),
            make_cell(1, 1, DomainValue::Error(value_types::CellError::Ref, None)),
            make_cell(2, 0, DomainValue::Null),
        ],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_merges() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(0, 0, DomainValue::Text(Arc::from("merged")))],
        merges: vec![MergeRegion {
            start_row: 0,
            start_col: 0,
            end_row: 1,
            end_col: 2,
        }],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_col_widths_and_row_heights() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        dimensions: SheetDimensions {
            col_widths: vec![ColDimension {
                col: 0,
                width: 20.0,
                custom_width: true,
                hidden: false,
                best_fit: false,
                collapsed: false,
            }],
            row_heights: vec![RowDimension {
                row: 0,
                height: 25.0,
                custom_height: true,
                hidden: false,
                ..Default::default()
            }],
            ..Default::default()
        },
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_frozen_pane() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        frozen_pane: Some(FrozenPane {
            rows: 1,
            cols: 0,
            top_left_cell: None,
        }),
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_multiple_sheets() {
    let output = make_parse_output(vec![
        SheetData {
            name: "Sheet1".to_string(),
            cells: vec![make_cell(
                0,
                0,
                DomainValue::Number(FiniteF64::new(1.0).unwrap()),
            )],
            ..Default::default()
        },
        SheetData {
            name: "Sheet2".to_string(),
            cells: vec![make_cell(0, 0, DomainValue::Text(Arc::from("sheet2")))],
            ..Default::default()
        },
    ]);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_styled_cells() {
    let palette = vec![
        DocumentFormat {
            font: Some(FontFormat {
                bold: Some(true),
                size: Some(14_000), // 14pt in millipoints
                color: Some("#FF0000".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        },
        DocumentFormat {
            fill: Some(FillFormat {
                background_color: Some("#00FF00".to_string()),
                pattern_type: Some("solid".to_string()),
                ..Default::default()
            }),
            number_format: Some("#,##0.00".to_string()),
            ..Default::default()
        },
    ];

    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![
                {
                    let mut c = make_cell(0, 0, DomainValue::Number(FiniteF64::new(42.0).unwrap()));
                    c.style_id = Some(0); // palette[0] -> cellXfs[1]
                    c
                },
                {
                    let mut c =
                        make_cell(0, 1, DomainValue::Number(FiniteF64::new(1234.56).unwrap()));
                    c.style_id = Some(1); // palette[1] -> cellXfs[2]
                    c
                },
            ],
            ..Default::default()
        }],
        style_palette: palette,
        ..Default::default()
    };
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_hex_to_color_def() {
    let c = hex_to_color_def("#FF0000");
    assert_eq!(
        c,
        ColorDef::Rgb {
            val: "FFFF0000".to_string(),
            tint: None,
        }
    );
}

#[test]
fn test_hex_to_color_def_no_hash() {
    let c = hex_to_color_def("FFFF0000");
    assert_eq!(
        c,
        ColorDef::Rgb {
            val: "FFFF0000".to_string(),
            tint: None,
        }
    );
}

#[test]
fn test_style_mapping_font() {
    let palette = vec![DocumentFormat {
        font: Some(FontFormat {
            name: Some("Arial".to_string()),
            size: Some(12_000),
            bold: Some(true),
            italic: Some(true),
            underline: Some("single".to_string()),
            strikethrough: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    }];
    let writer = build_styles(&palette);
    // Default font + our font = 2 fonts
    assert_eq!(writer.fonts.len(), 2);
    assert_eq!(writer.fonts[1].name.as_deref(), Some("Arial"));
    assert_eq!(writer.fonts[1].size, Some(12.0));
    assert_eq!(writer.fonts[1].bold, Some(true));
    assert_eq!(writer.fonts[1].italic, Some(true));
    assert_eq!(writer.fonts[1].strikethrough, Some(true));
}

#[test]
fn test_style_mapping_border() {
    let palette = vec![DocumentFormat {
        border: Some(BorderFormat {
            top: Some(DomainBorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            ..Default::default()
        }),
        ..Default::default()
    }];
    let writer = build_styles(&palette);
    // Default border + our border = 2 borders
    assert_eq!(writer.borders.len(), 2);
}

#[test]
fn test_named_ranges() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            ..Default::default()
        }],
        named_ranges: vec![NamedRange {
            name: "MyRange".to_string(),
            refers_to: "Sheet1!$A$1:$B$10".to_string(),
            local_sheet_id: None,
            hidden: false,
            comment: Some("comment text".to_string()),
            custom_menu: Some("menu text".to_string()),
            description: Some("description text".to_string()),
            help: Some("help text".to_string()),
            status_bar: Some("status text".to_string()),
            xlm: true,
            function: true,
            vb_procedure: true,
            publish_to_server: true,
            workbook_parameter: true,
            ..Default::default()
        }],
        ..Default::default()
    };
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    assert!(workbook_xml.contains("comment=\"comment text\""));
    assert!(workbook_xml.contains("customMenu=\"menu text\""));
    assert!(workbook_xml.contains("description=\"description text\""));
    assert!(workbook_xml.contains("help=\"help text\""));
    assert!(workbook_xml.contains("statusBar=\"status text\""));
    assert!(workbook_xml.contains("function=\"1\""));
    assert!(workbook_xml.contains("vbProcedure=\"1\""));
    assert!(workbook_xml.contains("xlm=\"1\""));
    assert!(workbook_xml.contains("publishToServer=\"1\""));
    assert!(workbook_xml.contains("workbookParameter=\"1\""));
}

#[test]
fn test_col_styles_roundtrip() {
    // Test that col_styles are preserved through the write pipeline.
    // Use build_sheet directly to inspect the ColWidth output.
    use super::sheet_builder::build_sheet;
    use crate::write::SharedStringsWriter;

    let sheet_data = SheetData {
        name: "Sheet1".to_string(),
        dimensions: SheetDimensions {
            col_widths: vec![ColDimension {
                col: 0,
                width: 9.0,
                custom_width: false,
                hidden: false,
                best_fit: false,
                collapsed: false,
            }],
            ..Default::default()
        },
        col_styles: vec![ColStyleEntry {
            col: 0,
            style_id: 15,
        }],
        cells: vec![make_cell(
            0,
            0,
            DomainValue::Number(FiniteF64::new(1.0).unwrap()),
        )],
        ..Default::default()
    };

    let mut shared_strings = SharedStringsWriter::new();
    let no_dt_bodies: std::collections::HashSet<(u32, u32)> = std::collections::HashSet::new();
    let no_dt_regions = Vec::new();
    // Test with lossless_styles=true (style_id is raw cellXfs index)
    let writer = build_sheet(
        &sheet_data,
        &mut shared_strings,
        true,
        None,
        &no_dt_bodies,
        &no_dt_regions,
    );
    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(
        xml.contains("style=\"15\""),
        "Expected style=\"15\" on <col> element (lossless path), but got: {}",
        &xml[..xml.len().min(2000)]
    );

    // Test with lossless_styles=false (palette index N → cellXfs[N+1])
    let mut shared_strings2 = SharedStringsWriter::new();
    let writer2 = build_sheet(
        &sheet_data,
        &mut shared_strings2,
        false,
        None,
        &no_dt_bodies,
        &no_dt_regions,
    );
    let xml2 = String::from_utf8(writer2.to_xml()).unwrap();
    // In lossy path, palette index 15 should become cellXfs index 16
    assert!(
        xml2.contains("style=\"16\""),
        "Expected style=\"16\" on <col> element (lossy path), but got: {}",
        &xml2[..xml2.len().min(2000)]
    );
}
