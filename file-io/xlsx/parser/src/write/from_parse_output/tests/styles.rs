use super::*;

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
fn test_style_mapping_preserves_palette_zero_as_default_style() {
    let palette = vec![DocumentFormat {
        font: Some(FontFormat {
            name: Some("Aptos Narrow".to_string()),
            size: Some(12_000),
            scheme: Some("minor".to_string()),
            ..Default::default()
        }),
        ..Default::default()
    }];

    let writer = build_styles(&palette);

    let default_font_id = writer.cell_style_xfs[0].font_id.unwrap() as usize;
    assert_eq!(
        writer.fonts[default_font_id].name.as_deref(),
        Some("Aptos Narrow")
    );
    assert_eq!(writer.fonts[default_font_id].size, Some(12.0));
    assert_eq!(writer.cell_xfs[0].font_id, Some(default_font_id as u32));
    assert_eq!(writer.cell_xfs[1].font_id, Some(default_font_id as u32));
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
