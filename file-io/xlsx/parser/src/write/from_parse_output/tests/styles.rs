use super::*;

#[test]
fn unused_imported_stylesheet_is_not_replayed_without_modeled_style_references() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![make_cell(
                0,
                0,
                DomainValue::Number(FiniteF64::new(1.0).unwrap()),
            )],
            ..Default::default()
        }],
        style_palette: Vec::new(),
        ..Default::default()
    };
    let imported_styles = br#"
        <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;STALE&quot;0"/></numFmts>
          <fonts count="2">
            <font><sz val="11"/><name val="Calibri"/></font>
            <font><sz val="12"/><name val="StaleFont"/></font>
          </fonts>
          <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
          <borders count="1"><border/></borders>
          <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
          <cellXfs count="2">
            <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
            <xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
          </cellXfs>
          <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
          <dxfs count="0"/>
          <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
        </styleSheet>
    "#;
    let ctx = domain_types::RoundTripContext {
        parsed_stylesheet: Some(crate::domain::styles::read::parse_styles(imported_styles)),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let styles_xml = String::from_utf8(archive.read_file("xl/styles.xml").unwrap()).unwrap();

    assert!(!styles_xml.contains("StaleFont"));
    assert!(!styles_xml.contains("STALE"));
    assert!(styles_xml.contains(r#"<fills count="2">"#));
    assert!(styles_xml.contains(r#"patternType="gray125""#));
    assert!(styles_xml.contains(r#"<cellXfs count="2">"#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn conditional_format_dxf_reference_keeps_imported_stylesheet() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![make_cell(
                0,
                0,
                DomainValue::Number(FiniteF64::new(10.0).unwrap()),
            )],
            conditional_formats: vec![ConditionalFormat {
                id: "cf1".to_string(),
                sheet_id: "sheet1".to_string(),
                pivot: None,
                ranges: vec![CFCellRange::new(0, 0, 9, 0)],
                range_identities: None,
                rules: vec![CFRule::CellValue {
                    id: "rule1".to_string(),
                    priority: 1,
                    stop_if_true: None,
                    operator: CfOperator::GreaterThan,
                    value1: serde_json::json!(5),
                    value2: None,
                    style: CFStyle {
                        dxf_id: Some(0),
                        ..Default::default()
                    },
                    text: None,
                }],
            }],
            ..Default::default()
        }],
        style_palette: Vec::new(),
        ..Default::default()
    };
    let imported_styles = br#"
        <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
          <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
          <borders count="1"><border/></borders>
          <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
          <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
          <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
          <dxfs count="1"><dxf><font><color rgb="FFFF0000"/></font></dxf></dxfs>
          <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
        </styleSheet>
    "#;
    let ctx = domain_types::RoundTripContext {
        parsed_stylesheet: Some(crate::domain::styles::read::parse_styles(imported_styles)),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let styles_xml = String::from_utf8(archive.read_file("xl/styles.xml").unwrap()).unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(styles_xml.contains(r#"<dxfs count="1">"#));
    assert!(styles_xml.contains(r#"rgb="FFFF0000""#));
    assert!(sheet_xml.contains(r#"dxfId="0""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn builtin_table_style_does_not_replay_unreferenced_custom_table_styles_or_dxfs() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![
                make_cell(0, 0, DomainValue::Text(Arc::from("A"))),
                make_cell(0, 1, DomainValue::Text(Arc::from("B"))),
                make_cell(1, 0, DomainValue::Number(FiniteF64::new(1.0).unwrap())),
                make_cell(1, 1, DomainValue::Number(FiniteF64::new(2.0).unwrap())),
            ],
            tables: vec![TableSpec {
                id: 1,
                name: "Table1".to_string(),
                display_name: "Table1".to_string(),
                range_ref: "A1:B2".to_string(),
                has_headers: true,
                style_name: Some("TableStyleMedium2".to_string()),
                auto_filter_ref: Some("A1:B2".to_string()),
                columns: vec![
                    TableColumnSpec {
                        name: "A".to_string(),
                        ..Default::default()
                    },
                    TableColumnSpec {
                        name: "B".to_string(),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            }],
            ..Default::default()
        }],
        style_palette: Vec::new(),
        ..Default::default()
    };
    let imported_styles = br#"
        <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <fonts count="1"><font><i/><sz val="11"/><name val="StaleImported"/></font></fonts>
          <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
          <borders count="1"><border/></borders>
          <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
          <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
          <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
          <dxfs count="2">
            <dxf><font><color rgb="FFFF0000"/></font></dxf>
            <dxf><fill><patternFill patternType="solid"><fgColor rgb="FF00FF00"/></patternFill></fill></dxf>
          </dxfs>
          <tableStyles count="1" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16">
            <tableStyle name="StaleCustom" pivot="0" table="1" count="1">
              <tableStyleElement type="wholeTable" dxfId="1"/>
            </tableStyle>
          </tableStyles>
        </styleSheet>
    "#;
    let ctx = domain_types::RoundTripContext {
        parsed_stylesheet: Some(crate::domain::styles::read::parse_styles(imported_styles)),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let styles_xml = String::from_utf8(archive.read_file("xl/styles.xml").unwrap()).unwrap();
    let table_xml = String::from_utf8(archive.read_file("xl/tables/table1.xml").unwrap()).unwrap();

    assert!(table_xml.contains(r#"name="TableStyleMedium2""#));
    assert!(!styles_xml.contains("StaleCustom"));
    assert!(!styles_xml.contains("FFFF0000"));
    assert!(!styles_xml.contains("FF00FF00"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn lossless_imported_stylesheet_prunes_unreferenced_cell_xf_components() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![{
                let mut cell = make_cell(0, 0, DomainValue::Number(FiniteF64::new(1.0).unwrap()));
                cell.style_id = Some(2);
                cell
            }],
            ..Default::default()
        }],
        ..Default::default()
    };
    let imported_styles = br#"
        <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <numFmts count="2">
            <numFmt numFmtId="164" formatCode="&quot;STALE&quot;0"/>
            <numFmt numFmtId="165" formatCode="&quot;LIVE&quot;0"/>
          </numFmts>
          <fonts count="3">
            <font><sz val="11"/><name val="Calibri"/></font>
            <font><sz val="12"/><name val="StaleFont"/></font>
            <font><sz val="13"/><name val="LiveFont"/></font>
          </fonts>
          <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
          <borders count="1"><border/></borders>
          <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
          <cellXfs count="3">
            <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
            <xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
            <xf numFmtId="165" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
          </cellXfs>
          <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
          <dxfs count="0"/>
          <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
        </styleSheet>
    "#;
    let ctx = domain_types::RoundTripContext {
        parsed_stylesheet: Some(crate::domain::styles::read::parse_styles(imported_styles)),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let styles_xml = String::from_utf8(archive.read_file("xl/styles.xml").unwrap()).unwrap();

    assert!(styles_xml.contains("LiveFont"));
    assert!(styles_xml.contains("LIVE"));
    assert!(!styles_xml.contains("StaleFont"));
    assert!(!styles_xml.contains("STALE"));
    assert!(styles_xml.contains(r#"<cellXfs count="3""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn clean_imported_stylesheet_ext_lst_is_preserved() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![{
                let mut cell = make_cell(0, 0, DomainValue::Number(FiniteF64::new(1.0).unwrap()));
                cell.style_id = Some(0);
                cell
            }],
            ..Default::default()
        }],
        style_palette: Vec::new(),
        ..Default::default()
    };
    let imported_styles = br#"
        <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
          <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
          <borders count="1"><border/></borders>
          <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
          <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
          <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
          <dxfs count="0"/>
          <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
        </styleSheet>
    "#;
    let ctx = domain_types::RoundTripContext {
        parsed_stylesheet: Some(crate::domain::styles::read::parse_styles(imported_styles)),
        styles_ext_lst_xml: Some(
            br#"<extLst><ext uri="{vendor-style-extension}"><vendor:styleHint value="kept"/></ext></extLst>"#
                .to_vec(),
        ),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let styles_xml = String::from_utf8(archive.read_file("xl/styles.xml").unwrap()).unwrap();

    assert!(styles_xml.contains("vendor-style-extension"));
    assert!(styles_xml.contains("vendor:styleHint"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn mutated_imported_stylesheet_drops_raw_ext_lst() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![{
                let mut cell = make_cell(0, 0, DomainValue::Number(FiniteF64::new(1.0).unwrap()));
                cell.style_id = Some(0);
                cell
            }],
            ..Default::default()
        }],
        style_palette: vec![DocumentFormat {
            font: Some(FontFormat {
                bold: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        }],
        ..Default::default()
    };
    let imported_styles = br#"
        <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
          <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
          <borders count="1"><border/></borders>
          <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
          <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
          <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
          <dxfs count="0"/>
          <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
        </styleSheet>
    "#;
    let ctx = domain_types::RoundTripContext {
        parsed_stylesheet: Some(crate::domain::styles::read::parse_styles(imported_styles)),
        styles_ext_lst_xml: Some(
            br#"<extLst><ext uri="{stale-style-extension}"><vendor:staleStyleNode/></ext></extLst>"#
                .to_vec(),
        ),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let styles_xml = String::from_utf8(archive.read_file("xl/styles.xml").unwrap()).unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!styles_xml.contains("stale-style-extension"));
    assert!(!styles_xml.contains("staleStyleNode"));
    assert!(!styles_xml.contains("StaleImported"));
    assert!(!styles_xml.contains("<i/>"));
    assert!(styles_xml.contains("<b/>"));
    assert!(sheet_xml.contains(r#" s="1""#));
    assert!(!sheet_xml.contains(r#" s="0""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
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
        true,
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
        true,
    );
    let xml2 = String::from_utf8(writer2.to_xml()).unwrap();
    // In lossy path, palette index 15 should become cellXfs index 16
    assert!(
        xml2.contains("style=\"16\""),
        "Expected style=\"16\" on <col> element (lossy path), but got: {}",
        &xml2[..xml2.len().min(2000)]
    );
}
