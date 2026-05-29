use super::*;
use crate::write::from_parse_output::styles::build_styles;

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
fn writes_table_styles_from_typed_parse_output() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.custom_table_styles = vec![ooxml_types::styles::TableStyleDef {
        name: "MyCustomTableStyle".to_string(),
        pivot: Some(false),
        table: Some(true),
        count: Some(1),
        elements: vec![ooxml_types::styles::TableStyleElementDef {
            style_type: ooxml_types::styles::TableStyleType::WholeTable,
            dxf_id: Some(0),
            size: None,
        }],
        xr_uid: None,
    }];
    output.default_table_style = Some("MyCustomTableStyle".to_string());

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let styles_xml = String::from_utf8(archive.read_file("xl/styles.xml").unwrap()).unwrap();

    assert!(styles_xml.contains(r#"defaultTableStyle="MyCustomTableStyle""#));
    assert!(styles_xml.contains(r#"<tableStyle name="MyCustomTableStyle""#));
    assert!(styles_xml.contains(r#"<tableStyleElement type="wholeTable" dxfId="0"/>"#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn workbook_stylesheet_dxfs_export_without_sidecar_context() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        conditional_formats: vec![ConditionalFormat {
            id: "cf-1".to_string(),
            sheet_id: "sheet-1".to_string(),
            pivot: None,
            ranges: vec![CFCellRange::single(0, 0)],
            range_identities: None,
            rules: vec![CFRule::CellValue {
                id: "rule-1".to_string(),
                operator: ooxml_types::cond_format::CfOperator::GreaterThan,
                value1: serde_json::json!("1"),
                value2: None,
                style: CFStyle {
                    dxf_id: Some(0),
                    ..Default::default()
                },
                priority: 1,
                stop_if_true: Some(false),
                text: None,
            }],
        }],
        ..Default::default()
    }]);
    output.workbook_stylesheet = Some(WorkbookStylesheet::from_stylesheet(
        ooxml_types::styles::Stylesheet {
            dxfs: vec![ooxml_types::styles::DxfDef {
                font: Some(ooxml_types::styles::FontDef {
                    bold: Some(true),
                    color: Some(ooxml_types::styles::ColorDef::Rgb {
                        val: "FFFF0000".to_string(),
                        tint: None,
                    }),
                    ..Default::default()
                }),
                ..Default::default()
            }],
            ..Default::default()
        },
        Vec::new(),
        None,
    ));

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let styles_xml = String::from_utf8(archive.read_file("xl/styles.xml").unwrap()).unwrap();

    assert!(styles_xml.contains(r#"<dxfs count="1">"#), "{styles_xml}");
    assert!(
        styles_xml.contains(r#"<color rgb="FFFF0000"/>"#),
        "{styles_xml}"
    );
}

#[test]
fn imported_workbook_stylesheet_dxf_registry_remaps_to_reachable_live_dxfs() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        conditional_formats: vec![ConditionalFormat {
            id: "cf-1".to_string(),
            sheet_id: "sheet-1".to_string(),
            pivot: None,
            ranges: vec![CFCellRange::single(0, 0)],
            range_identities: None,
            rules: vec![CFRule::CellValue {
                id: "rule-1".to_string(),
                operator: ooxml_types::cond_format::CfOperator::GreaterThan,
                value1: serde_json::json!("1"),
                value2: None,
                style: CFStyle {
                    dxf_id: Some(5),
                    ..Default::default()
                },
                priority: 1,
                stop_if_true: Some(false),
                text: None,
            }],
        }],
        ..Default::default()
    }]);

    let imported_styles = crate::domain::styles::write::StylesWriter::with_defaults();
    let mut workbook_stylesheet = WorkbookStylesheet::from_stylesheet(
        ooxml_types::styles::Stylesheet {
            fonts: imported_styles.fonts,
            fills: imported_styles.fills,
            borders: imported_styles.borders,
            cell_style_xfs: imported_styles.cell_style_xfs,
            cell_xfs: imported_styles.cell_xfs,
            cell_styles: imported_styles.cell_styles,
            ..Default::default()
        },
        Vec::new(),
        None,
    );
    workbook_stylesheet.dxf_registry = vec![
        domain_types::DxfDef {
            id: 0,
            font: Some(ooxml_types::styles::FontDef {
                italic: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        },
        domain_types::DxfDef {
            id: 5,
            font: Some(ooxml_types::styles::FontDef {
                bold: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        },
    ];
    output.workbook_stylesheet = Some(workbook_stylesheet);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let styles_xml = String::from_utf8(archive.read_file("xl/styles.xml").unwrap()).unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(styles_xml.contains(r#"<dxfs count="1">"#), "{styles_xml}");
    assert!(
        sheet_xml.contains(r#"dxfId="0""#),
        "reachable imported dxfId must be remapped to regenerated dxf table, got: {sheet_xml}"
    );
}

#[test]
fn imported_workbook_stylesheet_without_live_style_refs_regenerates_default_styles() {
    let mut imported_styles = crate::domain::styles::write::StylesWriter::with_defaults();
    imported_styles
        .cell_xfs
        .push(ooxml_types::styles::CellXfDef {
            num_fmt_id: Some(49),
            font_id: Some(0),
            fill_id: Some(0),
            border_id: Some(0),
            xf_id: Some(0),
            apply_number_format: Some(true),
            ..Default::default()
        });

    let output = ParseOutput {
        workbook_stylesheet: Some(WorkbookStylesheet::from_stylesheet(
            ooxml_types::styles::Stylesheet {
                fonts: imported_styles.fonts,
                fills: imported_styles.fills,
                borders: imported_styles.borders,
                cell_style_xfs: imported_styles.cell_style_xfs,
                cell_xfs: imported_styles.cell_xfs,
                cell_styles: imported_styles.cell_styles,
                ..Default::default()
            },
            Vec::new(),
            None,
        )),
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let styles_xml = String::from_utf8(archive.read_file("xl/styles.xml").unwrap()).unwrap();

    assert!(
        styles_xml.contains(r#"<cellXfs count="1">"#),
        "imported cellXfs must not remain stylesheet authority without live refs, got: {styles_xml}"
    );
    assert!(
        !styles_xml.contains(r#"numFmtId="49""#),
        "imported cellXfs must not be replayed as live styles, got: {styles_xml}"
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
fn test_style_mapping_keeps_palette_zero_out_of_default_style() {
    let palette = vec![DocumentFormat {
        number_format: Some("#,##0.00".to_string()),
        font: Some(FontFormat {
            name: Some("Aptos Narrow".to_string()),
            size: Some(12_000),
            scheme: Some("minor".to_string()),
            ..Default::default()
        }),
        border: Some(BorderFormat {
            top: Some(DomainBorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            bottom: Some(DomainBorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            left: Some(DomainBorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            right: Some(DomainBorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            ..Default::default()
        }),
        ..Default::default()
    }];

    let writer = build_styles(&palette);

    assert_eq!(writer.cell_style_xfs[0].num_fmt_id, Some(0));
    assert_eq!(writer.cell_style_xfs[0].font_id, Some(0));
    assert_eq!(writer.cell_style_xfs[0].fill_id, Some(0));
    assert_eq!(writer.cell_style_xfs[0].border_id, Some(0));
    assert_eq!(writer.cell_xfs[0].num_fmt_id, Some(0));
    assert_eq!(writer.cell_xfs[0].font_id, Some(0));
    assert_eq!(writer.cell_xfs[0].fill_id, Some(0));
    assert_eq!(writer.cell_xfs[0].border_id, Some(0));

    let applied_font_id = writer.cell_xfs[1].font_id.unwrap() as usize;
    assert_eq!(
        writer.fonts[applied_font_id].name.as_deref(),
        Some("Aptos Narrow")
    );
    assert_eq!(writer.fonts[applied_font_id].size, Some(12.0));
    assert_ne!(writer.cell_xfs[1].num_fmt_id, Some(0));
    assert_ne!(writer.cell_xfs[1].border_id, Some(0));
}

#[test]
fn test_modeled_palette_zero_writes_as_cell_xfs_one() {
    let output = ParseOutput {
        style_palette: vec![DocumentFormat {
            number_format: Some("#,##0.00".to_string()),
            border: Some(BorderFormat {
                top: Some(DomainBorderSide {
                    style: "thin".to_string(),
                    color: Some("#000000".to_string()),
                    color_tint: None,
                }),
                ..Default::default()
            }),
            ..Default::default()
        }],
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![DomainCellData {
                row: 0,
                col: 0,
                value: DomainValue::Number(FiniteF64::new(1.0).unwrap()),
                style_id: Some(0),
                ..Default::default()
            }],
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
        styles_xml.contains(
            r#"<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>"#
        ),
        "cellStyleXfs[0] must stay default, got: {styles_xml}"
    );
    assert!(
        styles_xml.contains(
            r#"<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>"#
        ),
        "cellXfs[0] must stay default, got: {styles_xml}"
    );
    assert!(
        styles_xml.contains(r#"<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>"#),
        "palette[0] must emit as the applied style after default, got: {styles_xml}"
    );
    assert!(
        sheet_xml.contains(r#"<c r="A1" s="1"><v>1</v></c>"#),
        "style_id 0 must write as s=\"1\", got: {sheet_xml}"
    );
}

#[test]
fn live_palette_style_ids_are_export_authority_even_with_imported_stylesheet() {
    let mut imported_styles = crate::domain::styles::write::StylesWriter::with_defaults();
    imported_styles
        .cell_xfs
        .push(ooxml_types::styles::CellXfDef {
            num_fmt_id: Some(49),
            font_id: Some(0),
            fill_id: Some(0),
            border_id: Some(0),
            xf_id: Some(0),
            apply_number_format: Some(true),
            ..Default::default()
        });

    let output = ParseOutput {
        workbook_stylesheet: Some(WorkbookStylesheet::from_stylesheet(
            ooxml_types::styles::Stylesheet {
                num_fmts: imported_styles.num_fmts,
                fonts: imported_styles.fonts,
                fills: imported_styles.fills,
                borders: imported_styles.borders,
                cell_style_xfs: imported_styles.cell_style_xfs,
                cell_xfs: imported_styles.cell_xfs,
                cell_styles: imported_styles.cell_styles,
                ..Default::default()
            },
            Vec::new(),
            None,
        )),
        style_palette: vec![
            DocumentFormat::default(),
            DocumentFormat {
                fill: Some(FillFormat {
                    background_color: Some("#FF0000".to_string()),
                    pattern_type: Some("solid".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        ],
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![DomainCellData {
                row: 0,
                col: 0,
                value: DomainValue::Number(FiniteF64::new(1.0).unwrap()),
                style_id: Some(1),
                ..Default::default()
            }],
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
        styles_xml.contains(r#"<cellXfs count="3">"#),
        "{styles_xml}"
    );
    assert!(
        styles_xml.to_lowercase().contains("ff0000"),
        "live palette fill must be regenerated, got: {styles_xml}"
    );
    assert!(
        !styles_xml.contains(r#"numFmtId="49""#),
        "imported cellXfs must not override live palette, got: {styles_xml}"
    );
    assert!(
        sheet_xml.contains(r#"<c r="A1" s="2"><v>1</v></c>"#),
        "live palette style ID 1 must emit as s=\"2\" after the default xf, got: {sheet_xml}"
    );
}

#[test]
fn invalid_live_palette_style_ids_are_not_coerced_from_imported_stylesheet() {
    let mut imported_styles = crate::domain::styles::write::StylesWriter::with_defaults();
    imported_styles
        .cell_xfs
        .resize(956, ooxml_types::styles::CellXfDef::default());

    let output = ParseOutput {
        workbook_stylesheet: Some(WorkbookStylesheet::from_stylesheet(
            ooxml_types::styles::Stylesheet {
                fonts: imported_styles.fonts,
                fills: imported_styles.fills,
                borders: imported_styles.borders,
                cell_style_xfs: imported_styles.cell_style_xfs,
                cell_xfs: imported_styles.cell_xfs,
                cell_styles: imported_styles.cell_styles,
                ..Default::default()
            },
            Vec::new(),
            None,
        )),
        style_palette: vec![DocumentFormat {
            number_format: Some("#,##0".to_string()),
            ..Default::default()
        }],
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![
                DomainCellData {
                    row: 0,
                    col: 0,
                    value: DomainValue::Number(FiniteF64::new(1.0).unwrap()),
                    style_id: Some(0),
                    ..Default::default()
                },
                DomainCellData {
                    row: 0,
                    col: 1,
                    value: DomainValue::Number(FiniteF64::new(2.0).unwrap()),
                    style_id: Some(956),
                    ..Default::default()
                },
            ],
            authored_style_runs: vec![AuthoredStyleRun {
                start_row: 0,
                start_col: 2,
                end_row: 0,
                end_col: 2,
                style_id: 162,
            }],
            row_styles: vec![RowStyleEntry {
                row: 2,
                style_id: 955,
            }],
            col_styles: vec![ColStyleEntry {
                col: 3,
                style_id: 162,
            }],
            dimensions: SheetDimensions {
                col_widths: vec![ColDimension {
                    col: 4,
                    width: 12.0,
                    custom_width: true,
                    hidden: false,
                    best_fit: false,
                    collapsed: false,
                    phonetic: false,
                    ..Default::default()
                }],
                trailing_col_ranges: vec![TrailingColRange {
                    min: 8,
                    max: 9,
                    width: 8.43,
                    custom_width: false,
                    hidden: false,
                    best_fit: false,
                    collapsed: false,
                    phonetic: false,
                    style_id: Some(955),
                    ..Default::default()
                }],
                ..Default::default()
            },
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(
        sheet_xml.contains(r#"<c r="A1" s="1"><v>1</v></c>"#),
        "{sheet_xml}"
    );
    assert!(
        sheet_xml.contains(r#"<c r="B1"><v>2</v></c>"#),
        "invalid workbook style IDs must not be coerced, got: {sheet_xml}"
    );
    assert!(!sheet_xml.contains(r#"<c r="C1" s="162"/>"#), "{sheet_xml}");
    assert!(!sheet_xml.contains(r#"s="955""#), "{sheet_xml}");
    assert!(!sheet_xml.contains(r#"style="162""#), "{sheet_xml}");
    assert!(!sheet_xml.contains(r#"style="955""#), "{sheet_xml}");
    assert!(!sheet_xml.contains(r#"s="956""#), "{sheet_xml}");
    assert!(!sheet_xml.contains(r#"style="956""#), "{sheet_xml}");
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
            function_group_id: Some(6),
            shortcut_key: Some("K".to_string()),
            function: true,
            vb_procedure: true,
            publish_to_server: true,
            workbook_parameter: true,
            ..Default::default()
        }],
        ..Default::default()
    };
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    assert!(workbook_xml.contains("comment=\"comment text\""));
    assert!(workbook_xml.contains("customMenu=\"menu text\""));
    assert!(workbook_xml.contains("description=\"description text\""));
    assert!(workbook_xml.contains("help=\"help text\""));
    assert!(workbook_xml.contains("statusBar=\"status text\""));
    assert!(workbook_xml.contains("functionGroupId=\"6\""));
    assert!(workbook_xml.contains("shortcutKey=\"K\""));
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
                phonetic: false,
                ..Default::default()
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
    let style_remapper =
        super::super::style_remap::StyleExportRemapper::palette_projection(u32::MAX);
    let writer = build_sheet(
        &sheet_data,
        &mut shared_strings,
        &no_dt_bodies,
        &no_dt_regions,
        true,
        &style_remapper,
    );
    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(
        xml.contains("style=\"16\""),
        "Expected style=\"16\" on <col> element, but got: {}",
        &xml[..xml.len().min(2000)]
    );
}
