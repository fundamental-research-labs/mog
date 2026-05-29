use super::*;

// -------------------------------------------------------------------------
// Helper function tests
// -------------------------------------------------------------------------

#[test]
fn test_format_number_integer() {
    assert_eq!(format_number(42.0), "42");
    assert_eq!(format_number(0.0), "0");
    assert_eq!(format_number(-100.0), "-100");
}

#[test]
fn test_format_number_decimal() {
    assert_eq!(format_number(3.14), "3.14");
    assert_eq!(format_number(1.5), "1.5");
    assert_eq!(format_number(0.001), "0.001");
}

// -------------------------------------------------------------------------
// Basic cell tests
// -------------------------------------------------------------------------

#[test]
fn test_write_number_cell() {
    let mut writer = SheetWriter::new();
    writer.set_number(0, 0, 42.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<c r=\"A1\">"));
    assert!(xml.contains("<v>42</v>"));
    assert!(xml.contains("</c>"));
}

#[test]
fn test_write_string_cell() {
    let mut writer = SheetWriter::new();
    writer.set_string(0, 0, 5);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<c r=\"A1\" t=\"s\">"));
    assert!(xml.contains("<v>5</v>"));
}

#[test]
fn test_write_inline_string_cell() {
    let mut writer = SheetWriter::new();
    writer.set_inline_string(0, 0, "Hello World");

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<c r=\"A1\" t=\"inlineStr\">"));
    assert!(xml.contains("<is><t>Hello World</t></is>"));
}

#[test]
fn test_write_boolean_cell() {
    let mut writer = SheetWriter::new();
    writer.set_boolean(0, 0, true);
    writer.set_boolean(0, 1, false);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<c r=\"A1\" t=\"b\">"));
    assert!(xml.contains("<v>1</v>"));
    assert!(xml.contains("<c r=\"B1\" t=\"b\">"));
    assert!(xml.contains("<v>0</v>"));
}

#[test]
fn test_write_error_cell() {
    let mut writer = SheetWriter::new();
    writer.set_error(0, 0, "#DIV/0!");

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<c r=\"A1\" t=\"e\">"));
    assert!(xml.contains("<v>#DIV/0!</v>"));
}

#[test]
fn test_write_formula_cell() {
    let mut writer = SheetWriter::new();
    writer.set_formula(0, 0, "SUM(B1:B10)");

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<c r=\"A1\">"));
    assert!(xml.contains("<f>SUM(B1:B10)</f>"));
}

#[test]
fn test_write_formula_canonicalizes_ooxml_future_function_prefixes() {
    let mut writer = SheetWriter::new();
    writer.set_formula(0, 0, r#"AVERAGEIFS(A:A,B:B,1)/STDEV.S(FILTER(A:A,B:B=1))"#);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(
        xml.contains(
            r#"<f>AVERAGEIFS(A:A,B:B,1)/_xlfn.STDEV.S(_xlfn._xlws.FILTER(A:A,B:B=1))</f>"#
        )
    );
}

#[test]
fn test_write_formula_with_cached_value() {
    let mut writer = SheetWriter::new();
    writer.set_formula_with_value(0, 0, "A1*2", CellValue::Number(84.0));

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<f>A1*2</f>"));
    assert!(xml.contains("<v>84</v>"));
}

#[test]
fn test_write_formula_with_force_recalc() {
    let mut writer = SheetWriter::new();
    let mut cd = CellData::new(
        0,
        0,
        CellValue::Formula {
            formula: "IF(D2=\"\",\"\",TODAY()-D2)".to_string(),
            cached_value: Some(Box::new(CellValue::Number(42.0))),
            cell_formula: None,
        },
    );
    cd.force_recalc = true;
    writer.add_cell(cd);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(
        xml.contains("<f ca=\"1\">IF(D2="),
        "Expected ca=\"1\" on <f> element, got: {}",
        xml
    );
    assert!(xml.contains("<v>42</v>"));
}

// -------------------------------------------------------------------------
// Column width tests
// -------------------------------------------------------------------------

#[test]
fn test_write_column_widths() {
    let mut writer = SheetWriter::new();
    writer.set_col_width(0, 15.0);
    writer.set_col_width(1, 20.0);
    writer.set_number(0, 0, 1.0); // Add a cell so sheet isn't empty

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<cols>"));
    assert!(xml.contains("<col min=\"1\" max=\"1\" width=\"15\""));
    assert!(xml.contains("<col min=\"2\" max=\"2\" width=\"20\""));
    assert!(xml.contains("customWidth=\"1\""));
    assert!(xml.contains("</cols>"));
}

#[test]
fn test_write_column_range() {
    let mut writer = SheetWriter::new();
    writer.add_col(ColWidth::range(1, 5, 12.0));
    writer.set_number(0, 0, 1.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<col min=\"1\" max=\"5\" width=\"12\""));
}

#[test]
fn test_write_hidden_column() {
    let mut writer = SheetWriter::new();
    writer.add_col(ColWidth::range(2, 2, 10.0).with_hidden(true));
    writer.set_number(0, 0, 1.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("hidden=\"1\""));
}

// -------------------------------------------------------------------------
// Row height tests
// -------------------------------------------------------------------------

#[test]
fn test_write_row_height() {
    let mut writer = SheetWriter::new();
    writer.set_row_height(0, 20.0);
    writer.set_number(0, 0, 1.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<row r=\"1\""));
    assert!(xml.contains("ht=\"20\""));
    assert!(xml.contains("customHeight=\"1\""));
}

#[test]
fn test_write_hidden_row() {
    let mut writer = SheetWriter::new();
    writer.set_row_hidden(0, true);
    writer.set_number(0, 0, 1.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("hidden=\"1\""));
}

// -------------------------------------------------------------------------
// Merge cell tests
// -------------------------------------------------------------------------

#[test]
fn test_write_merge_cells() {
    let mut writer = SheetWriter::new();
    writer.add_merge(0, 0, 0, 2); // A1:C1
    writer.add_merge(1, 0, 3, 1); // A2:B4
    writer.set_number(0, 0, 1.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<mergeCells count=\"2\">"));
    assert!(xml.contains("<mergeCell ref=\"A1:C1\"/>"));
    assert!(xml.contains("<mergeCell ref=\"A2:B4\"/>"));
    assert!(xml.contains("</mergeCells>"));
}

#[test]
fn test_merge_range_to_ref() {
    let merge = MergeRange::from_coords(0, 0, 2, 3);
    assert_eq!(merge.to_ref(), "A1:D3");
}

// -------------------------------------------------------------------------
// Frozen pane tests
// -------------------------------------------------------------------------

#[test]
fn test_write_frozen_rows() {
    let mut writer = SheetWriter::new();
    writer.set_frozen(1, 0); // Freeze 1 row
    writer.set_number(0, 0, 1.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<pane"));
    assert!(xml.contains("ySplit=\"1\""));
    assert!(xml.contains("topLeftCell=\"A2\""));
    assert!(xml.contains("state=\"frozen\""));
}

#[test]
fn test_write_frozen_cols() {
    let mut writer = SheetWriter::new();
    writer.set_frozen(0, 1); // Freeze 1 column
    writer.set_number(0, 0, 1.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<pane"));
    assert!(xml.contains("xSplit=\"1\""));
    assert!(xml.contains("topLeftCell=\"B1\""));
}

#[test]
fn test_write_frozen_both() {
    let mut writer = SheetWriter::new();
    writer.set_frozen(1, 1); // Freeze 1 row and 1 column
    writer.set_number(0, 0, 1.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("xSplit=\"1\""));
    assert!(xml.contains("ySplit=\"1\""));
    assert!(xml.contains("topLeftCell=\"B2\""));
    assert!(xml.contains("activePane=\"bottomRight\""));
}

// -------------------------------------------------------------------------
// Dimension tests
// -------------------------------------------------------------------------

#[test]
fn test_auto_dimension() {
    let mut writer = SheetWriter::new();
    writer.set_number(0, 0, 1.0);
    writer.set_number(5, 3, 2.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<dimension ref=\"A1:D6\"/>"));
}

#[test]
fn test_explicit_dimension() {
    let mut writer = SheetWriter::new();
    writer.set_dimension(0, 0, 9, 9);
    writer.set_number(0, 0, 1.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<dimension ref=\"A1:J10\"/>"));
}

// -------------------------------------------------------------------------
// Complete worksheet tests
// -------------------------------------------------------------------------

#[test]
fn test_complete_worksheet_xml() {
    let mut writer = SheetWriter::new();

    // Set column widths
    writer.set_col_width(0, 15.0);
    writer.set_col_width(1, 10.0);

    // Add cells
    writer.set_string(0, 0, 0); // A1: shared string
    writer.set_number(0, 1, 42.0); // B1: number
    writer.set_boolean(0, 2, true); // C1: boolean
    writer.set_formula_with_value(0, 3, "B1*2", CellValue::Number(84.0)); // D1: formula

    // Set row height
    writer.set_row_height(0, 20.0);

    // Add inline string
    writer.set_inline_string(1, 0, "Inline text"); // A2

    // Add merge
    writer.add_merge(0, 0, 0, 1); // A1:B1

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    // Verify XML structure
    assert!(xml.contains("<?xml version=\"1.0\""));
    assert!(xml.contains("<worksheet xmlns="));
    assert!(xml.contains("<dimension ref="));
    assert!(xml.contains("<sheetViews>"));
    assert!(xml.contains("<sheetFormatPr"));
    assert!(xml.contains("<cols>"));
    assert!(xml.contains("<sheetData>"));
    assert!(xml.contains("<mergeCells"));
    assert!(xml.contains("</worksheet>"));
}

#[test]
fn test_worksheet_with_style() {
    let mut writer = SheetWriter::new();
    writer.add_cell(CellData::with_style(0, 0, CellValue::Number(42.0), 1));

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<c r=\"A1\" s=\"1\">"));
}

#[test]
fn test_empty_worksheet() {
    let writer = SheetWriter::new();
    let xml = String::from_utf8(writer.to_xml()).unwrap();

    // Should still have valid structure
    assert!(xml.contains("<?xml version=\"1.0\""));
    assert!(xml.contains("<worksheet"));
    assert!(xml.contains("<sheetData>"));
    assert!(xml.contains("</sheetData>"));
    assert!(xml.contains("</worksheet>"));

    // Empty sheets still have a generated canonical dimension.
    assert!(xml.contains("<dimension ref=\"A1\"/>"));
    // Should not have cols or mergeCells
    assert!(!xml.contains("<cols>"));
    assert!(!xml.contains("<mergeCells"));
}

#[test]
fn test_multiple_rows() {
    let mut writer = SheetWriter::new();
    writer.set_number(0, 0, 1.0);
    writer.set_number(1, 0, 2.0);
    writer.set_number(2, 0, 3.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("<row r=\"1\""));
    assert!(xml.contains("<row r=\"2\""));
    assert!(xml.contains("<row r=\"3\""));
}

#[test]
fn test_cells_sorted_by_column() {
    let mut writer = SheetWriter::new();
    // Add cells out of order
    writer.set_number(0, 2, 3.0); // C1
    writer.set_number(0, 0, 1.0); // A1
    writer.set_number(0, 1, 2.0); // B1

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    // Find positions of cell references
    let a1_pos = xml.find("r=\"A1\"").unwrap();
    let b1_pos = xml.find("r=\"B1\"").unwrap();
    let c1_pos = xml.find("r=\"C1\"").unwrap();

    // Verify order
    assert!(a1_pos < b1_pos);
    assert!(b1_pos < c1_pos);
}

// -------------------------------------------------------------------------
// Sheet view tests
// -------------------------------------------------------------------------

#[test]
fn test_sheet_view_zoom() {
    let mut writer = SheetWriter::new();
    writer.set_view(SheetView {
        zoom_scale: 150,
        ..Default::default()
    });
    writer.set_number(0, 0, 1.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("zoomScale=\"150\""));
}

#[test]
fn test_sheet_view_hide_gridlines() {
    let mut writer = SheetWriter::new();
    writer.set_view(SheetView {
        show_grid_lines: false,
        ..Default::default()
    });
    writer.set_number(0, 0, 1.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("showGridLines=\"0\""));
}

#[test]
fn test_sheet_view_tab_selected() {
    let mut writer = SheetWriter::new();
    writer.set_view(SheetView {
        tab_selected: true,
        ..Default::default()
    });
    writer.set_number(0, 0, 1.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("tabSelected=\"1\""));
}

#[test]
fn test_sheet_view_all_attributes() {
    let mut writer = SheetWriter::new();
    writer.set_view(SheetView {
        window_protection: true,
        show_formulas: true,
        show_grid_lines: false,
        show_row_col_headers: false,
        show_zeros: false,
        tab_selected: true,
        show_ruler: false,
        show_outline_symbols: false,
        show_white_space: false,
        view: SheetViewType::PageLayout,
        top_left_cell: Some("C5".to_string()),
        zoom_scale: 125,
        zoom_scale_normal: 100,
        zoom_scale_page_layout_view: Some(80),
        zoom_scale_sheet_layout_view: Some(60),
        right_to_left: true,
        ..Default::default()
    });
    writer.set_number(0, 0, 1.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("windowProtection=\"1\""));
    assert!(xml.contains("showFormulas=\"1\""));
    assert!(xml.contains("showGridLines=\"0\""));
    assert!(xml.contains("showRowColHeaders=\"0\""));
    assert!(xml.contains("showZeros=\"0\""));
    assert!(xml.contains("rightToLeft=\"1\""));
    assert!(xml.contains("tabSelected=\"1\""));
    assert!(xml.contains("showRuler=\"0\""));
    assert!(xml.contains("showOutlineSymbols=\"0\""));
    assert!(xml.contains("showWhiteSpace=\"0\""));
    assert!(xml.contains("view=\"pageLayout\""));
    assert!(xml.contains("topLeftCell=\"C5\""));
    assert!(xml.contains("zoomScale=\"125\""));
    assert!(xml.contains("zoomScaleNormal=\"100\""));
    assert!(xml.contains("zoomScalePageLayoutView=\"80\""));
    assert!(xml.contains("zoomScaleSheetLayoutView=\"60\""));
}

// -------------------------------------------------------------------------
// XML escaping tests
// -------------------------------------------------------------------------

#[test]
fn test_inline_string_escaping() {
    let mut writer = SheetWriter::new();
    writer.set_inline_string(0, 0, "Test <>&\"' chars");

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("&lt;"));
    assert!(xml.contains("&gt;"));
    assert!(xml.contains("&amp;"));
}

#[test]
fn test_formula_escaping() {
    let mut writer = SheetWriter::new();
    writer.set_formula(0, 0, "IF(A1>0,\"Yes\",\"No\")");

    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(xml.contains("IF(A1&gt;0,"));
}

// -------------------------------------------------------------------------
// dyDescent round-trip tests
// -------------------------------------------------------------------------

#[test]
fn test_dy_descent_write_default_and_per_row() {
    let mut writer = SheetWriter::new();
    let mut fmt = SheetFormatPr::default();
    fmt.default_row_descent = Some(0.3);
    writer.set_sheet_format_pr(fmt);

    writer.set_row_height(0, 15.0);
    writer.set_row_descent(0, 0.3);
    writer.set_row_height(1, 20.0);
    writer.set_row_descent(1, 0.35);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    // Namespace declarations
    assert!(xml.contains("xmlns:mc="), "should have mc namespace");
    assert!(xml.contains("xmlns:x14ac="), "should have x14ac namespace");
    assert!(
        xml.contains("mc:Ignorable=\"x14ac\""),
        "should have mc:Ignorable"
    );

    // Default descent on sheetFormatPr
    assert!(
        xml.contains("x14ac:dyDescent=\"0.3\""),
        "sheetFormatPr should have dyDescent"
    );

    // Per-row descent
    assert!(
        xml.contains("x14ac:dyDescent=\"0.35\""),
        "row with non-default descent"
    );
}

#[test]
fn test_dy_descent_no_namespaces_when_absent() {
    let mut writer = SheetWriter::new();
    writer.set_number(0, 0, 42.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(
        !xml.contains("xmlns:mc"),
        "should not have mc namespace when no descent data"
    );
    assert!(
        !xml.contains("xmlns:x14ac"),
        "should not have x14ac namespace when no descent data"
    );
    assert!(
        !xml.contains("mc:Ignorable"),
        "should not have mc:Ignorable when no descent data"
    );
    assert!(
        !xml.contains("dyDescent"),
        "should not have dyDescent when no descent data"
    );
}

#[test]
fn test_dy_descent_parse_and_write_roundtrip() {
    // Simulate parsing a sheet XML fragment with dyDescent attributes
    use crate::domain::cells::{CellData, ParseExtras, parse_worksheet_fast_with_extras};

    let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
           xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac"
           xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
           mc:Ignorable="x14ac">
<sheetFormatPr defaultRowHeight="14.4" x14ac:dyDescent="0.3"/>
<sheetData>
<row r="1" ht="14.4" x14ac:dyDescent="0.3"><c r="A1"><v>1</v></c></row>
<row r="2" ht="20" x14ac:dyDescent="0.35"><c r="A2"><v>2</v></c></row>
</sheetData>
</worksheet>"#;

    let shared_strings: Vec<&str> = vec![];
    let mut cells = vec![CellData::default(); 100];
    let mut strings = Vec::new();
    let mut row_heights = Vec::new();
    let mut extras = ParseExtras::default();

    let count = parse_worksheet_fast_with_extras(
        xml,
        &shared_strings,
        &mut cells,
        &mut strings,
        &mut row_heights,
        &mut extras,
        &[],
    );

    assert_eq!(count, 2, "should parse 2 cells");
    assert_eq!(extras.row_descents.len(), 2, "should have 2 row descents");

    // Verify parsed descent values
    assert_eq!(extras.row_descents[0], (0, 0.3)); // row 1 -> 0-indexed row 0
    assert_eq!(extras.row_descents[1], (1, 0.35)); // row 2 -> 0-indexed row 1

    // Parse default descent from sheetFormatPr
    let pre_sd = &xml[..xml.windows(10).position(|w| w == b"<sheetData").unwrap()];
    let fmt_pr = crate::domain::worksheet::read::parse_sheet_format_pr(pre_sd);
    assert_eq!(fmt_pr.default_row_descent, Some(0.3));

    // Now write back
    let mut writer = SheetWriter::new();
    let mut fmt = SheetFormatPr::default();
    fmt.default_row_height = 14.4;
    fmt.default_row_descent = Some(0.3);
    writer.set_sheet_format_pr(fmt);

    // Only non-default descent values
    writer.set_row_height(0, 14.4);
    writer.set_row_height(1, 20.0);
    writer.set_row_descent(1, 0.35); // Only row 2 has non-default descent

    let output = String::from_utf8(writer.to_xml()).unwrap();

    // Verify output XML
    assert!(
        output.contains("mc:Ignorable=\"x14ac\""),
        "root should have mc:Ignorable"
    );
    assert!(
        output.contains("xmlns:x14ac="),
        "root should have x14ac namespace"
    );
    assert!(
        output.contains("x14ac:dyDescent=\"0.3\""),
        "sheetFormatPr should have default descent"
    );
    assert!(
        output.contains("x14ac:dyDescent=\"0.35\""),
        "row 2 should have non-default descent"
    );
}

// -------------------------------------------------------------------------
// xr:uid round-trip tests
// -------------------------------------------------------------------------

#[test]
fn test_xr_uid_write() {
    let mut writer = SheetWriter::new();
    writer.set_uid("{00000000-0001-0000-0000-000000000000}".to_string());
    writer.set_number(0, 0, 42.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("xmlns:mc="), "should have mc namespace");
    assert!(xml.contains("xmlns:xr="), "should have xr namespace");
    assert!(
        xml.contains("mc:Ignorable=\"xr\""),
        "should have mc:Ignorable with xr"
    );
    assert!(
        xml.contains("xr:uid=\"{00000000-0001-0000-0000-000000000000}\""),
        "should have xr:uid"
    );
    // Should NOT have x14ac when no descent data
    assert!(
        !xml.contains("xmlns:x14ac"),
        "should not have x14ac when no descent data"
    );
}

#[test]
fn test_xr_uid_no_namespaces_when_absent() {
    let mut writer = SheetWriter::new();
    writer.set_number(0, 0, 42.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(
        !xml.contains("xmlns:xr"),
        "should not have xr namespace when no uid"
    );
    assert!(
        !xml.contains("xr:uid"),
        "should not have xr:uid when no uid"
    );
}

#[test]
fn test_xr_uid_combined_with_descent() {
    let mut writer = SheetWriter::new();
    writer.set_uid("{ABCDEF01-2345-6789-ABCD-EF0123456789}".to_string());
    let mut fmt = SheetFormatPr::default();
    fmt.default_row_descent = Some(0.3);
    writer.set_sheet_format_pr(fmt);
    writer.set_number(0, 0, 42.0);

    let xml = String::from_utf8(writer.to_xml()).unwrap();

    assert!(xml.contains("xmlns:mc="), "should have mc namespace");
    assert!(xml.contains("xmlns:x14ac="), "should have x14ac namespace");
    assert!(xml.contains("xmlns:xr="), "should have xr namespace");
    assert!(
        xml.contains("mc:Ignorable=\"x14ac xr\""),
        "should have mc:Ignorable with both x14ac and xr"
    );
    assert!(
        xml.contains("xr:uid=\"{ABCDEF01-2345-6789-ABCD-EF0123456789}\""),
        "should have xr:uid"
    );
    assert!(
        xml.contains("x14ac:dyDescent=\"0.3\""),
        "should have dyDescent"
    );
}

#[test]
fn test_xr_uid_parse_and_write_roundtrip() {
    use crate::infra::scanner::{extract_quoted_value, find_attr_simd};

    let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
           xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
           xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision"
           xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac"
           xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
           mc:Ignorable="x14ac xr"
           xr:uid="{00000000-0001-0000-0000-000000000000}">
<sheetFormatPr defaultRowHeight="14.4" x14ac:dyDescent="0.3"/>
<sheetData>
<row r="1" ht="14.4" x14ac:dyDescent="0.3"><c r="A1"><v>1</v></c></row>
</sheetData>
</worksheet>"#;

    // Parse xr:uid from pre_sd
    let pre_sd = &xml[..xml.windows(10).position(|w| w == b"<sheetData").unwrap()];
    let uid = find_attr_simd(pre_sd, b"xr:uid=\"", 0).and_then(|p| {
        let value_start = p + b"xr:uid=\"".len();
        extract_quoted_value(pre_sd, value_start)
            .map(|(s, e)| String::from_utf8_lossy(&pre_sd[s..e]).into_owned())
    });
    assert_eq!(
        uid.as_deref(),
        Some("{00000000-0001-0000-0000-000000000000}")
    );

    // Parse default descent
    let fmt_pr = crate::domain::worksheet::read::parse_sheet_format_pr(pre_sd);
    assert_eq!(fmt_pr.default_row_descent, Some(0.3));

    // Write back
    let mut writer = SheetWriter::new();
    writer.set_uid(uid.unwrap());
    let mut fmt = SheetFormatPr::default();
    fmt.default_row_height = 14.4;
    fmt.default_row_descent = Some(0.3);
    writer.set_sheet_format_pr(fmt);
    writer.set_row_height(0, 14.4);
    writer.set_row_descent(0, 0.3);
    writer.set_number(0, 0, 1.0);

    let output = String::from_utf8(writer.to_xml()).unwrap();

    // Verify output XML
    assert!(
        output.contains("mc:Ignorable=\"x14ac xr\""),
        "root should have mc:Ignorable with both"
    );
    assert!(
        output.contains("xmlns:xr="),
        "root should have xr namespace"
    );
    assert!(
        output.contains("xmlns:x14ac="),
        "root should have x14ac namespace"
    );
    assert!(
        output.contains("xr:uid=\"{00000000-0001-0000-0000-000000000000}\""),
        "should have xr:uid"
    );
    assert!(
        output.contains("x14ac:dyDescent=\"0.3\""),
        "sheetFormatPr should have descent"
    );
}

#[test]
fn test_root_namespaces_mc_ignorable_roundtrip() {
    // Simulate round-trip of a sheet that has mc:Ignorable="x14ac xr xr2 xr3"
    // but where the Tier 1 domain fields (dyDescent, uid) might or might not be present.
    use crate::infra::xml_namespaces::NamespaceMap;

    let mut ns = NamespaceMap::new();
    ns.capture_from_element(
            br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision" xmlns:xr2="http://schemas.microsoft.com/office/spreadsheetml/2015/revision2" xmlns:xr3="http://schemas.openxmlformats.org/officeDocument/2006/relationships/metadata/core-properties" mc:Ignorable="x14ac xr xr2 xr3">"#
        );

    // Case 1: has_descent=true, has_uid=true (common case)
    {
        let mut writer = SheetWriter::new();
        writer.set_root_namespaces(ns.clone());
        writer.set_uid("{TEST-UID}".to_string());
        let mut fmt = SheetFormatPr::default();
        fmt.default_row_height = 14.4;
        fmt.default_row_descent = Some(0.3);
        writer.set_sheet_format_pr(fmt);

        let output = String::from_utf8(writer.to_xml()).unwrap();
        assert!(
            output.contains("mc:Ignorable="),
            "Case 1: mc:Ignorable should be present.\nGot: {}",
            &output[..output.len().min(500)]
        );
        assert!(
            output.contains("xmlns:mc="),
            "Case 1: xmlns:mc should be present"
        );
    }

    // Case 2: has_descent=false, has_uid=false (edge case — root namespaces have extension prefixes but no domain data uses them)
    {
        let mut writer = SheetWriter::new();
        writer.set_root_namespaces(ns.clone());
        // No uid, no descent

        let output = String::from_utf8(writer.to_xml()).unwrap();
        assert!(
            output.contains("mc:Ignorable="),
            "Case 2: mc:Ignorable should be present even without Tier 1 domain fields.\nGot: {}",
            &output[..output.len().min(500)]
        );
        assert!(
            output.contains("xmlns:mc="),
            "Case 2: xmlns:mc should be present"
        );
    }

    // Case 3: root namespaces exist but DON'T have mc — should not inject mc:Ignorable
    {
        let mut ns_no_mc = NamespaceMap::new();
        ns_no_mc.capture_from_element(
                br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">"#
            );

        let mut writer = SheetWriter::new();
        writer.set_root_namespaces(ns_no_mc);
        let mut fmt = SheetFormatPr::default();
        fmt.default_row_height = 14.4;
        fmt.default_row_descent = Some(0.3);
        writer.set_sheet_format_pr(fmt);

        let output = String::from_utf8(writer.to_xml()).unwrap();
        // Original didn't have mc:Ignorable, so we should NOT inject it
        assert!(
            !output.contains("mc:Ignorable="),
            "Case 3: mc:Ignorable should NOT be injected when original didn't have it.\nGot: {}",
            &output[..output.len().min(500)]
        );
        assert!(
            !output.contains("xmlns:mc="),
            "Case 3: xmlns:mc should NOT be injected when original didn't have it"
        );
    }
}
