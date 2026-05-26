use std::sync::Arc;

use super::helpers::*;
use domain_types::{
    AlignmentFormat, BorderFormat, BorderSide, DocumentFormat, FillFormat, FontFormat,
};
use value_types::{CellValue, FiniteF64};

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
            0, // index into style_palette
        )],
    );
    output.style_palette = vec![bold_red.clone()];

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets.len(), 1);

    // Find the cell and its style
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
    // Color may be normalized -- check it's a red
    if let Some(ref color) = rt_font.color {
        assert!(
            color.to_uppercase().contains("FF0000"),
            "Expected red color, got {color}"
        );
    }
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
    // The foreground color should round-trip (possibly in a normalized form)
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
fn roundtrip_alignment_formatting() {
    let centered = DocumentFormat {
        alignment: Some(AlignmentFormat {
            horizontal: Some("center".to_string()),
            vertical: Some("middle".to_string()),
            wrap_text: Some(true),
            rotation: None,
            indent: None,
            shrink_to_fit: None,
            auto_indent: None,
            reading_order: None,
            relative_indent: None,
            justify_last_line: None,
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
