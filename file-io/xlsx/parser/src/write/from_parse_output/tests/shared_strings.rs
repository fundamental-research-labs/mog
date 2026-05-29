use super::*;

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

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
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

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
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

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
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
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert_no_calc_chain_package_parts(&archive, &workbook_rels, &content_types);
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn no_calc_chain_export_policy_preserves_clean_calc_settings() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_formula_cell(
            0,
            0,
            "SUM(B1:C1)",
            DomainValue::Number(FiniteF64::new(3.0).unwrap()),
        )],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert_clean_calc_pr(&workbook_xml);
    assert_no_calc_chain_package_parts(&archive, &workbook_rels, &content_types);
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_calc_chain_is_diagnosed_and_never_replayed() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_formula_cell(
            0,
            0,
            "SUM(B1:C1)",
            DomainValue::Number(FiniteF64::new(3.0).unwrap()),
        )],
        ..Default::default()
    }]);
    let input_bytes = write_xlsx_from_parse_output(&output).unwrap();
    let input_bytes = inject_stale_calc_chain_part(&input_bytes);

    let (parsed, diagnostics) =
        crate::parse_xlsx_to_output(&input_bytes).expect("parse xlsx with calcChain");
    assert!(
        diagnostics.errors.iter().any(|error| {
            error.part.is_none() && error.message.contains("calculation chain cache")
        }),
        "import diagnostics should explain dropped calcChain: {:?}",
        diagnostics.errors
    );

    let exported_bytes = write_xlsx_from_parse_output(&parsed).unwrap();
    let archive =
        crate::XlsxArchive::new(&exported_bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert_clean_calc_pr(&workbook_xml);
    assert_no_calc_chain_package_parts(&archive, &workbook_rels, &content_types);
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_calc_id_is_typed_workbook_state_while_calc_chain_cache_is_dropped() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_formula_cell(
            0,
            0,
            "SUM(B1:C1)",
            DomainValue::Number(FiniteF64::new(3.0).unwrap()),
        )],
        ..Default::default()
    }]);
    let input_bytes = write_xlsx_from_parse_output(&output).unwrap();
    let input_bytes = inject_calc_id(&input_bytes, 191029);
    let input_bytes = inject_stale_calc_chain_part(&input_bytes);

    let (parsed, _diagnostics) =
        crate::parse_xlsx_to_output(&input_bytes).expect("parse xlsx with calcId");
    let exported_bytes = write_xlsx_from_parse_output(&parsed).unwrap();
    let archive =
        crate::XlsxArchive::new(&exported_bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(workbook_xml.contains(r#"calcId="191029""#));
    assert_no_calc_chain_package_parts(&archive, &workbook_rels, &content_types);
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_workbook_rels_without_shared_strings_are_repaired_when_text_cells_emit_sst() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(0, 0, DomainValue::Text(Arc::from("hello")))],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
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

fn assert_no_calc_chain_package_parts(
    archive: &crate::XlsxArchive<'_>,
    workbook_rels: &str,
    content_types: &str,
) {
    assert!(!archive.contains("xl/calcChain.xml"));
    assert!(!workbook_rels.contains("relationships/calcChain"));
    assert!(!content_types.contains("/xl/calcChain.xml"));
}

fn assert_clean_calc_pr(workbook_xml: &str) {
    assert!(workbook_xml.contains(r#"<calcPr "#));
    assert!(workbook_xml.contains(r#"calcId="0""#));
    assert!(!workbook_xml.contains(r#"fullCalcOnLoad="1""#));
    assert!(!workbook_xml.contains(r#"calcCompleted="0""#));
    assert!(!workbook_xml.contains(r#"forceFullCalc="1""#));
}

fn inject_calc_id(bytes: &[u8], calc_id: u32) -> Vec<u8> {
    let archive = crate::XlsxArchive::new(bytes).expect("source XLSX should be readable");
    let mut zip = crate::write::zip_writer::ZipWriter::with_compression(
        crate::write::CompressionMethod::Deflate(1),
    );
    for entry in archive.entries() {
        let data = if entry.name == "xl/workbook.xml" {
            let xml = String::from_utf8(archive.read_file(&entry.name).unwrap()).unwrap();
            xml.replace(r#"calcId="0""#, &format!(r#"calcId="{calc_id}""#))
                .into_bytes()
        } else {
            archive.read_file(&entry.name).unwrap()
        };
        zip.add_file(&entry.name, data);
    }
    zip.finish().expect("zip workbook calcId fixture")
}

fn inject_stale_calc_chain_part(bytes: &[u8]) -> Vec<u8> {
    let archive = crate::XlsxArchive::new(bytes).expect("source XLSX should be readable");
    let mut zip = crate::write::zip_writer::ZipWriter::with_compression(
        crate::write::CompressionMethod::Deflate(1),
    );
    for entry in archive.entries() {
        let data = match entry.name.as_str() {
            "[Content_Types].xml" => {
                let xml = String::from_utf8(archive.read_file(&entry.name).unwrap()).unwrap();
                xml.replace(
                    "</Types>",
                    concat!(
                        r#"<Override PartName="/xl/calcChain.xml" "#,
                        r#"ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/>"#,
                        "</Types>"
                    ),
                )
                .into_bytes()
            }
            "xl/_rels/workbook.xml.rels" => {
                let xml = String::from_utf8(archive.read_file(&entry.name).unwrap()).unwrap();
                xml.replace(
                    "</Relationships>",
                    concat!(
                        r#"<Relationship Id="rId99" "#,
                        r#"Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" "#,
                        r#"Target="calcChain.xml"/>"#,
                        "</Relationships>"
                    ),
                )
                .into_bytes()
            }
            _ => archive.read_file(&entry.name).unwrap(),
        };
        zip.add_file(&entry.name, data);
    }
    zip.add_file(
        "xl/calcChain.xml",
        concat!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
            r#"<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">"#,
            r#"<c r="A1" i="1"/></calcChain>"#
        )
        .as_bytes()
        .to_vec(),
    );
    zip.finish().expect("zip calcChain fixture")
}

#[test]
fn imported_original_sst_count_does_not_override_generated_counts() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![
            make_text_cell_with_original_sst(0, 0, "old", 0),
            make_cell(1, 0, DomainValue::Text(Arc::from("new"))),
        ],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let shared_strings =
        String::from_utf8(archive.read_file("xl/sharedStrings.xml").unwrap()).unwrap();

    assert!(shared_strings.contains("count=\"2\""));
    assert!(shared_strings.contains("uniqueCount=\"2\""));
    assert!(!shared_strings.contains("count=\"99\""));
    assert!(shared_strings.contains("<t>old</t>"));
    assert!(shared_strings.contains("<t>new</t>"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_unused_shared_strings_do_not_force_sst_part_rel_or_content_type() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/sharedStrings.xml"));
    assert!(!workbook_rels.contains(crate::write::REL_SHARED_STRINGS));
    assert!(!content_types.contains("PartName=\"/xl/sharedStrings.xml\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_rich_text_hint_is_not_preserved_from_roundtrip_context() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_text_cell_with_original_sst(0, 0, "Rich", 0)],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let shared_strings =
        String::from_utf8(archive.read_file("xl/sharedStrings.xml").unwrap()).unwrap();

    assert!(shared_strings.contains("<t>Rich</t>"));
    assert!(!shared_strings.contains("<rPr><b/>"));
    assert!(!shared_strings.contains("<rPh"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_rich_text_hint_is_preserved_from_parse_output() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![make_text_cell_with_original_sst(0, 0, "Rich", 0)],
            ..Default::default()
        }],
        shared_string_hints: vec![domain_types::SharedStringHint {
            index: 0,
            text: "Rich".to_string(),
            rich_text: Some(vec![rich_text_run("Rich")]),
            phonetic_xml: None,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let shared_strings =
        String::from_utf8(archive.read_file("xl/sharedStrings.xml").unwrap()).unwrap();

    assert!(shared_strings.contains("<rPr><b/>"));
    assert!(shared_strings.contains("<t>Rich</t>"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn edited_imported_rich_text_cell_has_no_stale_hint() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_text_cell_with_original_sst(0, 0, "Edited", 0)],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let shared_strings =
        String::from_utf8(archive.read_file("xl/sharedStrings.xml").unwrap()).unwrap();

    assert!(shared_strings.contains("<t>Edited</t>"));
    assert!(!shared_strings.contains("<rPr><b/>"));
    assert!(!shared_strings.contains("<rPh"));
    assert!(!shared_strings.contains("phonetic"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}
