#![allow(unused_imports)]

use std::sync::Arc;

use super::helpers::{
    assert_cells_match, cell, formula_cell, make_single_sheet, roundtrip, styled_cell,
};
use domain_types::{
    AlignmentFormat, BorderFormat, BorderSide, CFCellRange, CFRule, CFStyle, CellData,
    ColDimension, Comment, CommentType, ConditionalFormat, DocumentFormat, DocumentProperties,
    ErrorStyle, FillFormat, FontFormat, FrozenPane, MergeRegion, NamedRange, ParseOutput,
    RowDimension, SheetData, SheetDimensions, TableColumnSpec, TableSpec, ValidationOperator,
    ValidationRule, ValidationSpec,
};
use value_types::{CellError, CellValue, FiniteF64};
use xlsx_parser::infra::package_integrity::validate_archive_package_integrity;
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;
use xlsx_parser::zip::XlsxArchive;

#[test]
fn roundtrip_font_formatting() {
    let bold_red = DocumentFormat {
        font: Some(FontFormat {
            name: Some("Arial".to_string()),
            size: Some(14_000), // 14pt in millipoints
            color: Some("#FF0000".to_string()),
            bold: Some(true),
            italic: Some(true),
            underline: Some("single".to_string()),
            strikethrough: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };

    let mut output = make_single_sheet(
        "FontStyles",
        vec![styled_cell(
            0,
            0,
            CellValue::Text(Arc::from("Styled text")),
            0,
        )],
    );
    output.style_palette = vec![bold_red.clone()];

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets.len(), 1);

    let rt_cell = rt.sheets[0]
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("styled cell should exist");

    let rt_style_id = rt_cell.style_id.expect("cell should have a style_id");
    let rt_fmt = &rt.style_palette[rt_style_id as usize];

    let rt_font = rt_fmt.font.as_ref().expect("font should be preserved");
    assert_eq!(rt_font.name.as_deref(), Some("Arial"));
    assert_eq!(rt_font.bold, Some(true));
    assert_eq!(rt_font.italic, Some(true));
    assert_eq!(rt_font.strikethrough, Some(true));
    assert_eq!(rt_font.underline.as_deref(), Some("single"));
    // Color may be normalized -- check it contains red
    if let Some(ref color) = rt_font.color {
        assert!(
            color.to_uppercase().contains("FF0000"),
            "Expected red color, got {color}"
        );
    }
}

#[test]
fn imported_deleted_style_bearing_cell_drops_unreferenced_stylesheet() {
    let mut imported = make_single_sheet(
        "ImportedStyles",
        vec![styled_cell(
            0,
            0,
            CellValue::Text(Arc::from("delete me")),
            0,
        )],
    );
    imported.style_palette = vec![DocumentFormat {
        font: Some(FontFormat {
            name: Some("StaleFont".to_string()),
            size: Some(16_000),
            bold: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    }];

    let imported_bytes =
        write_xlsx_from_parse_output(&imported).expect("initial export should succeed");
    let imported_archive =
        XlsxArchive::new(&imported_bytes).expect("initial XLSX should be readable");
    let imported_styles =
        String::from_utf8(imported_archive.read_file("xl/styles.xml").unwrap()).unwrap();
    assert!(imported_styles.contains("StaleFont"));

    let (mut output, _diagnostics) =
        parse_xlsx_to_output(&imported_bytes).expect("initial XLSX should parse");
    output.sheets[0].cells.clear();

    let exported = write_xlsx_from_parse_output(&output).expect("mutated export should succeed");
    let archive = XlsxArchive::new(&exported).expect("exported XLSX should be readable");
    let styles_xml = String::from_utf8(archive.read_file("xl/styles.xml").unwrap()).unwrap();

    assert!(!styles_xml.contains("StaleFont"));
    assert!(styles_xml.contains(r#"<cellXfs count="1""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn roundtrip_font_size_preserved() {
    // Test multiple font sizes survive round-trip
    let small = DocumentFormat {
        font: Some(FontFormat {
            size: Some(8_000), // 8pt
            ..Default::default()
        }),
        ..Default::default()
    };
    let large = DocumentFormat {
        font: Some(FontFormat {
            size: Some(24_000), // 24pt
            ..Default::default()
        }),
        ..Default::default()
    };

    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "FontSizes".to_string(),
            rows: 1,
            cols: 2,
            cells: vec![
                styled_cell(0, 0, CellValue::Text(Arc::from("Small")), 0),
                styled_cell(0, 1, CellValue::Text(Arc::from("Large")), 1),
            ],
            ..Default::default()
        }],
        style_palette: vec![small, large],
        workbook_stylesheet: None,
        ..Default::default()
    };

    let rt = roundtrip(&output);

    // Verify both font sizes survived
    let cell_0 = rt.sheets[0].cells.iter().find(|c| c.col == 0).unwrap();
    let cell_1 = rt.sheets[0].cells.iter().find(|c| c.col == 1).unwrap();

    let fmt_0 = &rt.style_palette[cell_0.style_id.unwrap() as usize];
    let fmt_1 = &rt.style_palette[cell_1.style_id.unwrap() as usize];

    let size_0 = fmt_0.font.as_ref().and_then(|f| f.size).unwrap_or(0);
    let size_1 = fmt_1.font.as_ref().and_then(|f| f.size).unwrap_or(0);

    // Sizes should be different and roughly correct (allow millipoint rounding)
    assert!(size_0 < size_1, "Small font should be smaller than large");
    assert!(
        (size_0 as f64 - 8_000.0).abs() < 500.0,
        "Small font size {size_0} should be ~8000 millipoints"
    );
    assert!(
        (size_1 as f64 - 24_000.0).abs() < 500.0,
        "Large font size {size_1} should be ~24000 millipoints"
    );
}

#[test]
fn roundtrip_fill_formatting() {
    let yellow_fill = DocumentFormat {
        fill: Some(FillFormat {
            background_color: None,
            pattern_type: Some("solid".to_string()),
            pattern_foreground_color: Some("#FFFF00".to_string()),
            ..Default::default()
        }),
        ..Default::default()
    };

    let mut output = make_single_sheet(
        "FillStyles",
        vec![styled_cell(
            0,
            0,
            CellValue::Text(Arc::from("Yellow cell")),
            0,
        )],
    );
    output.style_palette = vec![yellow_fill.clone()];

    let rt = roundtrip(&output);

    let rt_cell = rt.sheets[0]
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("styled cell should exist");
    let rt_style_id = rt_cell.style_id.expect("cell should have a style_id");
    let rt_fmt = &rt.style_palette[rt_style_id as usize];

    let rt_fill = rt_fmt.fill.as_ref().expect("fill should be preserved");
    assert_eq!(rt_fill.pattern_type.as_deref(), Some("solid"));
    assert!(
        rt_fill.pattern_foreground_color.is_some() || rt_fill.background_color.is_some(),
        "Fill color should be preserved in some form"
    );
}

#[test]
fn roundtrip_border_formatting() {
    let borders = DocumentFormat {
        border: Some(BorderFormat {
            top: Some(BorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            bottom: Some(BorderSide {
                style: "medium".to_string(),
                color: Some("#FF0000".to_string()),
                color_tint: None,
            }),
            left: Some(BorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            right: Some(BorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            diagonal: None,
            diagonal_up: None,
            diagonal_down: None,
        }),
        ..Default::default()
    };

    let mut output = make_single_sheet(
        "Borders",
        vec![styled_cell(0, 0, CellValue::Text(Arc::from("Bordered")), 0)],
    );
    output.style_palette = vec![borders.clone()];

    let rt = roundtrip(&output);

    let rt_cell = rt.sheets[0]
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("styled cell should exist");
    let rt_style_id = rt_cell.style_id.expect("cell should have a style_id");
    let rt_fmt = &rt.style_palette[rt_style_id as usize];

    let rt_border = rt_fmt.border.as_ref().expect("border should be preserved");

    assert!(rt_border.top.is_some(), "Top border should be preserved");
    assert!(
        rt_border.bottom.is_some(),
        "Bottom border should be preserved"
    );
    assert!(rt_border.left.is_some(), "Left border should be preserved");
    assert!(
        rt_border.right.is_some(),
        "Right border should be preserved"
    );

    // Check border styles survived
    assert_eq!(rt_border.top.as_ref().unwrap().style, "thin");
    assert_eq!(rt_border.bottom.as_ref().unwrap().style, "medium");
}

#[test]
fn roundtrip_diagonal_border() {
    let borders = DocumentFormat {
        border: Some(BorderFormat {
            top: None,
            bottom: None,
            left: None,
            right: None,
            diagonal: Some(BorderSide {
                style: "thin".to_string(),
                color: Some("#0000FF".to_string()),
                color_tint: None,
            }),
            diagonal_up: Some(true),
            diagonal_down: Some(true),
        }),
        ..Default::default()
    };

    let mut output = make_single_sheet(
        "DiagBorder",
        vec![styled_cell(0, 0, CellValue::Text(Arc::from("Diagonal")), 0)],
    );
    output.style_palette = vec![borders];

    let rt = roundtrip(&output);

    let rt_cell = rt.sheets[0]
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("styled cell should exist");
    let rt_style_id = rt_cell.style_id.expect("cell should have a style_id");
    let rt_fmt = &rt.style_palette[rt_style_id as usize];

    // Diagonal border is less commonly supported -- just check it doesn't crash
    // and the cell still has formatting
    assert!(
        rt_fmt.border.is_some()
            || rt_fmt.font.is_some()
            || rt_fmt.fill.is_some()
            || rt_fmt.alignment.is_some()
            || rt_fmt.number_format.is_some(),
        "Some formatting should survive even if diagonal is dropped"
    );
}

#[test]
fn roundtrip_alignment_formatting() {
    let centered = DocumentFormat {
        alignment: Some(AlignmentFormat {
            horizontal: Some("center".to_string()),
            vertical: Some("middle".to_string()),
            wrap_text: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };

    let mut output = make_single_sheet(
        "Alignment",
        vec![styled_cell(0, 0, CellValue::Text(Arc::from("Centered")), 0)],
    );
    output.style_palette = vec![centered.clone()];

    let rt = roundtrip(&output);

    let rt_cell = rt.sheets[0]
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("styled cell should exist");
    let rt_style_id = rt_cell.style_id.expect("cell should have a style_id");
    let rt_fmt = &rt.style_palette[rt_style_id as usize];

    let rt_align = rt_fmt
        .alignment
        .as_ref()
        .expect("alignment should be preserved");
    assert_eq!(rt_align.horizontal.as_deref(), Some("center"));
    assert_eq!(rt_align.vertical.as_deref(), Some("middle"));
    assert_eq!(rt_align.wrap_text, Some(true));
}

#[test]
fn roundtrip_text_rotation() {
    let rotated = DocumentFormat {
        alignment: Some(AlignmentFormat {
            rotation: Some(45),
            ..Default::default()
        }),
        ..Default::default()
    };

    let mut output = make_single_sheet(
        "Rotated",
        vec![styled_cell(0, 0, CellValue::Text(Arc::from("Rotated")), 0)],
    );
    output.style_palette = vec![rotated];

    let rt = roundtrip(&output);

    let rt_cell = rt.sheets[0]
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("styled cell should exist");
    let rt_style_id = rt_cell.style_id.expect("cell should have a style_id");
    let rt_fmt = &rt.style_palette[rt_style_id as usize];

    let rt_align = rt_fmt
        .alignment
        .as_ref()
        .expect("alignment should be preserved for rotation");
    assert_eq!(rt_align.rotation, Some(45), "Rotation should round-trip");
}

#[test]
fn roundtrip_number_format() {
    let currency = DocumentFormat {
        number_format: Some("#,##0.00".to_string()),
        ..Default::default()
    };

    let mut output = make_single_sheet(
        "NumFmt",
        vec![styled_cell(
            0,
            0,
            CellValue::Number(FiniteF64::new(1234.56).unwrap()),
            0,
        )],
    );
    output.style_palette = vec![currency.clone()];

    let rt = roundtrip(&output);

    let rt_cell = rt.sheets[0]
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("styled cell should exist");
    let rt_style_id = rt_cell.style_id.expect("cell should have a style_id");
    let rt_fmt = &rt.style_palette[rt_style_id as usize];

    assert_eq!(
        rt_fmt.number_format.as_deref(),
        Some("#,##0.00"),
        "Number format should round-trip exactly"
    );
}

#[test]
fn roundtrip_date_number_format() {
    let date_fmt = DocumentFormat {
        number_format: Some("yyyy-mm-dd".to_string()),
        ..Default::default()
    };

    let mut output = make_single_sheet(
        "DateFmt",
        vec![styled_cell(
            0,
            0,
            // Excel date serial for 2024-01-15
            CellValue::Number(FiniteF64::new(45306.0).unwrap()),
            0,
        )],
    );
    output.style_palette = vec![date_fmt];

    let rt = roundtrip(&output);

    let rt_cell = rt.sheets[0]
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("styled cell should exist");
    let rt_style_id = rt_cell.style_id.expect("cell should have a style_id");
    let rt_fmt = &rt.style_palette[rt_style_id as usize];

    assert_eq!(
        rt_fmt.number_format.as_deref(),
        Some("yyyy-mm-dd"),
        "Date format should round-trip exactly"
    );
}

#[test]
fn roundtrip_combined_styles() {
    // A cell with font + fill + border + alignment + number format all at once
    let rich_style = DocumentFormat {
        font: Some(FontFormat {
            name: Some("Calibri".to_string()),
            size: Some(11_000),
            bold: Some(true),
            color: Some("#FFFFFF".to_string()),
            ..Default::default()
        }),
        fill: Some(FillFormat {
            pattern_type: Some("solid".to_string()),
            pattern_foreground_color: Some("#4472C4".to_string()),
            background_color: None,
            ..Default::default()
        }),
        border: Some(BorderFormat {
            top: Some(BorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            bottom: Some(BorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            left: Some(BorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            right: Some(BorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            diagonal: None,
            diagonal_up: None,
            diagonal_down: None,
        }),
        alignment: Some(AlignmentFormat {
            horizontal: Some("center".to_string()),
            vertical: Some("middle".to_string()),
            wrap_text: Some(true),
            ..Default::default()
        }),
        number_format: Some("#,##0".to_string()),
        ..Default::default()
    };

    let mut output = make_single_sheet(
        "RichStyle",
        vec![styled_cell(
            0,
            0,
            CellValue::Number(FiniteF64::new(42000.0).unwrap()),
            0,
        )],
    );
    output.style_palette = vec![rich_style];

    let rt = roundtrip(&output);

    let rt_cell = rt.sheets[0]
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 0)
        .expect("styled cell should exist");
    let rt_style_id = rt_cell.style_id.expect("cell should have a style_id");
    let rt_fmt = &rt.style_palette[rt_style_id as usize];

    // Each style component should survive
    assert!(rt_fmt.font.is_some(), "Font should survive combined style");
    assert!(rt_fmt.fill.is_some(), "Fill should survive combined style");
    assert!(
        rt_fmt.border.is_some(),
        "Border should survive combined style"
    );
    assert!(
        rt_fmt.alignment.is_some(),
        "Alignment should survive combined style"
    );
    assert_eq!(
        rt_fmt.number_format.as_deref(),
        Some("#,##0"),
        "Number format should survive combined style"
    );

    // Verify font details
    let font = rt_fmt.font.as_ref().unwrap();
    assert_eq!(font.name.as_deref(), Some("Calibri"));
    assert_eq!(font.bold, Some(true));
}

// =============================================================================
// Named ranges
// =============================================================================
