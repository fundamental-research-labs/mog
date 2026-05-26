//! Tests for styles writer.

use super::types::*;
use super::writer::StylesWriter;

// -------------------------------------------------------------------------
// StylesWriter creation tests
// -------------------------------------------------------------------------

#[test]
fn test_new_empty_writer() {
    let writer = StylesWriter::new();
    assert!(writer.num_fmts.is_empty());
    assert!(writer.fonts.is_empty());
    assert!(writer.fills.is_empty());
    assert!(writer.borders.is_empty());
    assert!(writer.cell_xfs.is_empty());
    assert!(writer.cell_style_xfs.is_empty());
}

#[test]
fn test_with_defaults() {
    let writer = StylesWriter::with_defaults();

    // Should have default font
    assert_eq!(writer.fonts.len(), 1);
    assert_eq!(writer.fonts[0].name, Some("Calibri".to_string()));
    assert_eq!(writer.fonts[0].size, Some(11.0));

    // Should have 2 required fills
    assert_eq!(writer.fills.len(), 2);

    // Should have 1 default border
    assert_eq!(writer.borders.len(), 1);

    // Should have 1 cell style XF
    assert_eq!(writer.cell_style_xfs.len(), 1);

    // Should have 1 default cell XF
    assert_eq!(writer.cell_xfs.len(), 1);
}

// -------------------------------------------------------------------------
// Number format tests
// -------------------------------------------------------------------------

#[test]
fn test_add_num_fmt() {
    let mut writer = StylesWriter::new();

    let id1 = writer.add_num_fmt("#,##0.00");
    assert_eq!(id1, 164);

    let id2 = writer.add_num_fmt("yyyy-mm-dd");
    assert_eq!(id2, 165);

    assert_eq!(writer.num_fmts.len(), 2);
}

#[test]
fn test_num_fmt_deduplication() {
    let mut writer = StylesWriter::new();

    let id1 = writer.add_num_fmt("#,##0.00");
    let id2 = writer.add_num_fmt("#,##0.00");

    assert_eq!(id1, id2);
    assert_eq!(writer.num_fmts.len(), 1);
}

#[test]
fn test_num_fmt_different_codes() {
    let mut writer = StylesWriter::new();

    let id1 = writer.add_num_fmt("#,##0");
    let id2 = writer.add_num_fmt("#,##0.00");

    assert_ne!(id1, id2);
    assert_eq!(writer.num_fmts.len(), 2);
}

// -------------------------------------------------------------------------
// Font tests
// -------------------------------------------------------------------------

#[test]
fn test_add_font() {
    let mut writer = StylesWriter::new();

    let font = FontDef {
        name: Some("Arial".to_string()),
        size: Some(12.0),
        bold: Some(true),
        ..Default::default()
    };

    let id = writer.add_font(font);
    assert_eq!(id, 0);
    assert_eq!(writer.fonts.len(), 1);
}

#[test]
fn test_font_deduplication() {
    let mut writer = StylesWriter::new();

    let font1 = FontDef {
        name: Some("Arial".to_string()),
        size: Some(12.0),
        bold: Some(true),
        ..Default::default()
    };

    let font2 = FontDef {
        name: Some("Arial".to_string()),
        size: Some(12.0),
        bold: Some(true),
        ..Default::default()
    };

    let id1 = writer.add_font(font1);
    let id2 = writer.add_font(font2);

    assert_eq!(id1, id2);
    assert_eq!(writer.fonts.len(), 1);
}

#[test]
fn test_font_with_all_properties() {
    let mut writer = StylesWriter::with_defaults();

    let font = FontDef {
        name: Some("Calibri".to_string()),
        size: Some(14.0),
        bold: Some(true),
        italic: Some(true),
        underline: Some(UnderlineStyle::Double),
        strikethrough: Some(true),
        color: Some(ColorDef::Rgb {
            val: "FFFF0000".to_string(),
            tint: None,
        }),
        family: Some(2),
        scheme: None,
        ..Default::default()
    };

    let id = writer.add_font(font);
    assert_eq!(id, 1); // 0 is the default font
}

// -------------------------------------------------------------------------
// Fill tests
// -------------------------------------------------------------------------

#[test]
fn test_add_fill_solid() {
    let mut writer = StylesWriter::new();

    let fill = FillDef::Solid {
        fg_color: ColorDef::Rgb {
            val: "FFFFFF00".to_string(),
            tint: None,
        },
    };
    let id = writer.add_fill(fill);

    assert_eq!(id, 0);
    assert_eq!(writer.fills.len(), 1);
}

#[test]
fn test_fill_deduplication() {
    let mut writer = StylesWriter::new();

    let fill1 = FillDef::Solid {
        fg_color: ColorDef::Rgb {
            val: "FFFFFF00".to_string(),
            tint: None,
        },
    };
    let fill2 = FillDef::Solid {
        fg_color: ColorDef::Rgb {
            val: "FFFFFF00".to_string(),
            tint: None,
        },
    };

    let id1 = writer.add_fill(fill1);
    let id2 = writer.add_fill(fill2);

    assert_eq!(id1, id2);
    assert_eq!(writer.fills.len(), 1);
}

#[test]
fn test_add_fill_pattern() {
    let mut writer = StylesWriter::new();

    let fill = FillDef::Pattern {
        pattern_type: Some(PatternType::Gray125),
        fg_color: Some(ColorDef::Indexed { id: 64, tint: None }),
        bg_color: None,
    };

    let id = writer.add_fill(fill);
    assert_eq!(id, 0);
}

#[test]
fn test_add_fill_gradient() {
    let mut writer = StylesWriter::new();

    let fill = FillDef::Gradient {
        gradient_type: GradientType::Linear,
        degree: Some(90.0),
        stops: vec![
            GradientStop {
                position: 0.0,
                color: ColorDef::Rgb {
                    val: "FFFFFFFF".to_string(),
                    tint: None,
                },
            },
            GradientStop {
                position: 1.0,
                color: ColorDef::Rgb {
                    val: "FF000000".to_string(),
                    tint: None,
                },
            },
        ],
        left: None,
        right: None,
        top: None,
        bottom: None,
    };

    let id = writer.add_fill(fill);
    assert_eq!(id, 0);
}

// -------------------------------------------------------------------------
// Border tests
// -------------------------------------------------------------------------

#[test]
fn test_add_border_empty() {
    let mut writer = StylesWriter::new();

    let border = BorderDef::default();
    let id = writer.add_border(border);

    assert_eq!(id, 0);
    assert_eq!(writer.borders.len(), 1);
}

#[test]
fn test_add_border_thin() {
    let mut writer = StylesWriter::new();

    let border = BorderDef {
        left: Some(BorderSideDef {
            style: BorderStyle::Thin,
            color: Some(ColorDef::Indexed { id: 64, tint: None }),
        }),
        right: Some(BorderSideDef {
            style: BorderStyle::Thin,
            color: Some(ColorDef::Indexed { id: 64, tint: None }),
        }),
        top: Some(BorderSideDef {
            style: BorderStyle::Thin,
            color: Some(ColorDef::Indexed { id: 64, tint: None }),
        }),
        bottom: Some(BorderSideDef {
            style: BorderStyle::Thin,
            color: Some(ColorDef::Indexed { id: 64, tint: None }),
        }),
        ..Default::default()
    };

    let id = writer.add_border(border);
    assert_eq!(id, 0);
}

#[test]
fn test_border_deduplication() {
    let mut writer = StylesWriter::new();

    let border1 = BorderDef {
        left: Some(BorderSideDef {
            style: BorderStyle::Thin,
            color: None,
        }),
        ..Default::default()
    };

    let border2 = BorderDef {
        left: Some(BorderSideDef {
            style: BorderStyle::Thin,
            color: None,
        }),
        ..Default::default()
    };

    let id1 = writer.add_border(border1);
    let id2 = writer.add_border(border2);

    assert_eq!(id1, id2);
    assert_eq!(writer.borders.len(), 1);
}

#[test]
fn test_border_with_diagonal() {
    let mut writer = StylesWriter::new();

    let border = BorderDef {
        diagonal: Some(BorderSideDef {
            style: BorderStyle::Thin,
            color: Some(ColorDef::Rgb {
                val: "FFFF0000".to_string(),
                tint: None,
            }),
        }),
        diagonal_up: Some(true),
        diagonal_down: Some(true),
        ..Default::default()
    };

    let id = writer.add_border(border);
    assert_eq!(id, 0);
}

// -------------------------------------------------------------------------
// Cell XF tests
// -------------------------------------------------------------------------

#[test]
fn test_add_cell_xf() {
    let mut writer = StylesWriter::with_defaults();

    let xf = CellXfDef {
        num_fmt_id: Some(0),
        font_id: Some(0),
        fill_id: Some(0),
        border_id: Some(0),
        xf_id: Some(0),
        ..Default::default()
    };

    let id = writer.add_cell_xf(xf);
    assert_eq!(id, 1); // 0 is the default
}

#[test]
fn test_cell_xf_not_deduplicated() {
    let mut writer = StylesWriter::new();

    let xf1 = CellXfDef::default();
    let xf2 = CellXfDef::default();

    let id1 = writer.add_cell_xf(xf1);
    let id2 = writer.add_cell_xf(xf2);

    // Cell XFs should NOT be deduplicated
    assert_ne!(id1, id2);
    assert_eq!(writer.cell_xfs.len(), 2);
}

// -------------------------------------------------------------------------
// create_style tests
// -------------------------------------------------------------------------

#[test]
fn test_create_style_simple() {
    let mut writer = StylesWriter::with_defaults();

    let style_id = writer.create_style(None, None, None, None, None);

    // Should create a new cell XF
    assert_eq!(style_id, 1);
}

#[test]
fn test_create_style_with_font() {
    let mut writer = StylesWriter::with_defaults();

    let font = FontDef {
        name: Some("Arial".to_string()),
        size: Some(12.0),
        bold: Some(true),
        ..Default::default()
    };

    let style_id = writer.create_style(Some(font), None, None, None, None);

    assert_eq!(style_id, 1);
    assert_eq!(writer.fonts.len(), 2); // Default + new
}

#[test]
fn test_create_style_with_all_components() {
    let mut writer = StylesWriter::with_defaults();

    let font = FontDef {
        name: Some("Arial".to_string()),
        size: Some(14.0),
        bold: Some(true),
        ..Default::default()
    };

    let fill = FillDef::Solid {
        fg_color: ColorDef::Rgb {
            val: "FFFFFF00".to_string(),
            tint: None,
        },
    };

    let border = BorderDef {
        left: Some(BorderSideDef {
            style: BorderStyle::Thin,
            color: None,
        }),
        ..Default::default()
    };

    let alignment = AlignmentDef {
        horizontal: Some(HorizontalAlign::Center),
        vertical: Some(VerticalAlign::Center),
        wrap_text: Some(true),
        ..Default::default()
    };

    let style_id = writer.create_style(
        Some(font),
        Some(fill),
        Some(border),
        Some("#,##0.00"),
        Some(alignment),
    );

    assert_eq!(style_id, 1);
    assert_eq!(writer.fonts.len(), 2);
    assert_eq!(writer.fills.len(), 3);
    assert_eq!(writer.borders.len(), 2);
    assert_eq!(writer.num_fmts.len(), 1);
}

// -------------------------------------------------------------------------
// XML generation tests
// -------------------------------------------------------------------------

#[test]
fn test_to_xml_default() {
    let writer = StylesWriter::with_defaults();
    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    // Check XML declaration
    assert!(xml_str.contains("<?xml version=\"1.0\""));

    // Check styleSheet element
    assert!(xml_str.contains("<styleSheet"));
    assert!(xml_str.contains("</styleSheet>"));

    // Check fonts section
    assert!(xml_str.contains("<fonts count=\"1\">"));
    assert!(xml_str.contains("<name val=\"Calibri\"/>"));

    // Check fills section
    assert!(xml_str.contains("<fills count=\"2\">"));
    assert!(xml_str.contains("patternType=\"none\""));
    assert!(xml_str.contains("patternType=\"gray125\""));

    // Check borders section
    assert!(xml_str.contains("<borders count=\"1\">"));

    // Check cellStyleXfs section
    assert!(xml_str.contains("<cellStyleXfs count=\"1\">"));

    // Check cellXfs section
    assert!(xml_str.contains("<cellXfs count=\"1\">"));
}

#[test]
fn test_to_xml_with_custom_num_fmt() {
    let mut writer = StylesWriter::with_defaults();
    writer.add_num_fmt("#,##0.00");

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<numFmts count=\"1\">"));
    assert!(xml_str.contains("numFmtId=\"164\""));
    assert!(xml_str.contains("formatCode=\"#,##0.00\""));
}

#[test]
fn test_to_xml_with_bold_font() {
    let mut writer = StylesWriter::with_defaults();

    writer.add_font(FontDef {
        name: Some("Arial".to_string()),
        size: Some(12.0),
        bold: Some(true),
        ..Default::default()
    });

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<fonts count=\"2\">"));
    assert!(xml_str.contains("<b/>"));
    assert!(xml_str.contains("<name val=\"Arial\"/>"));
}

#[test]
fn test_to_xml_with_alignment() {
    let mut writer = StylesWriter::with_defaults();

    let xf = CellXfDef {
        num_fmt_id: Some(0),
        font_id: Some(0),
        fill_id: Some(0),
        border_id: Some(0),
        xf_id: Some(0),
        alignment: Some(AlignmentDef {
            horizontal: Some(HorizontalAlign::Center),
            vertical: Some(VerticalAlign::Center),
            wrap_text: Some(true),
            ..Default::default()
        }),
        apply_alignment: Some(true),
        ..Default::default()
    };

    writer.add_cell_xf(xf);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("applyAlignment=\"1\""));
    assert!(xml_str.contains("<alignment"));
    assert!(xml_str.contains("horizontal=\"center\""));
    assert!(xml_str.contains("vertical=\"center\""));
    assert!(xml_str.contains("wrapText=\"1\""));
}

#[test]
fn test_to_xml_with_solid_fill() {
    let mut writer = StylesWriter::with_defaults();

    writer.add_fill(FillDef::Solid {
        fg_color: ColorDef::Rgb {
            val: "FFFFFF00".to_string(),
            tint: None,
        },
    });

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<fills count=\"3\">"));
    assert!(xml_str.contains("patternType=\"solid\""));
    assert!(xml_str.contains("<fgColor rgb=\"FFFFFF00\"/>"));
}

#[test]
fn test_to_xml_with_gradient_fill() {
    let mut writer = StylesWriter::with_defaults();

    writer.add_fill(FillDef::Gradient {
        gradient_type: GradientType::Linear,
        degree: Some(90.0),
        stops: vec![
            GradientStop {
                position: 0.0,
                color: ColorDef::Rgb {
                    val: "FFFFFFFF".to_string(),
                    tint: None,
                },
            },
            GradientStop {
                position: 1.0,
                color: ColorDef::Rgb {
                    val: "FF000000".to_string(),
                    tint: None,
                },
            },
        ],
        left: None,
        right: None,
        top: None,
        bottom: None,
    });

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<gradientFill"));
    assert!(xml_str.contains("type=\"linear\""));
    assert!(xml_str.contains("degree=\"90\""));
    assert!(xml_str.contains("<stop"));
    assert!(xml_str.contains("position=\"0\""));
    assert!(xml_str.contains("position=\"1\""));
}

#[test]
fn test_to_xml_with_borders() {
    let mut writer = StylesWriter::with_defaults();

    writer.add_border(BorderDef {
        left: Some(BorderSideDef {
            style: BorderStyle::Thin,
            color: Some(ColorDef::Indexed { id: 64, tint: None }),
        }),
        right: Some(BorderSideDef {
            style: BorderStyle::Medium,
            color: None,
        }),
        top: Some(BorderSideDef {
            style: BorderStyle::Thick,
            color: Some(ColorDef::Rgb {
                val: "FF000000".to_string(),
                tint: None,
            }),
        }),
        bottom: Some(BorderSideDef {
            style: BorderStyle::Double,
            color: None,
        }),
        ..Default::default()
    });

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("<borders count=\"2\">"));
    assert!(xml_str.contains("<left style=\"thin\">"));
    assert!(xml_str.contains("<right style=\"medium\">"));
    assert!(xml_str.contains("<top style=\"thick\">"));
    assert!(xml_str.contains("<bottom style=\"double\">"));
    assert!(xml_str.contains("indexed=\"64\""));
}

#[test]
fn test_to_xml_with_protection() {
    let mut writer = StylesWriter::with_defaults();

    let xf = CellXfDef {
        num_fmt_id: Some(0),
        font_id: Some(0),
        fill_id: Some(0),
        border_id: Some(0),
        xf_id: Some(0),
        protection: Some(ProtectionDef {
            locked: Some(true),
            hidden: Some(true),
        }),
        apply_protection: Some(true),
        ..Default::default()
    };

    writer.add_cell_xf(xf);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("applyProtection=\"1\""));
    assert!(xml_str.contains("<protection"));
    assert!(xml_str.contains("locked=\"1\""));
    assert!(xml_str.contains("hidden=\"1\""));
}

#[test]
fn test_to_xml_with_theme_color() {
    let mut writer = StylesWriter::new();

    writer.fonts.push(FontDef {
        name: Some("Calibri".to_string()),
        size: Some(11.0),
        color: Some(ColorDef::Theme {
            id: 1,
            tint: Some("0.5".to_string()),
        }),
        ..Default::default()
    });

    writer.fills.push(FillDef::None);
    writer.borders.push(BorderDef::default());
    writer.cell_style_xfs.push(CellXfDef::default());
    writer.cell_xfs.push(CellXfDef::default());

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("theme=\"1\""));
    assert!(xml_str.contains("tint=\"0.5\""));
}

// -------------------------------------------------------------------------
// Enum value tests
// -------------------------------------------------------------------------

#[test]
fn test_underline_style_values() {
    assert_eq!(UnderlineStyle::Single.to_ooxml(), "single");
    assert_eq!(UnderlineStyle::Double.to_ooxml(), "double");
    assert_eq!(
        UnderlineStyle::SingleAccounting.to_ooxml(),
        "singleAccounting"
    );
    assert_eq!(
        UnderlineStyle::DoubleAccounting.to_ooxml(),
        "doubleAccounting"
    );
    assert_eq!(UnderlineStyle::None.to_ooxml(), "none");
}

#[test]
fn test_pattern_type_values() {
    assert_eq!(PatternType::None.to_ooxml(), "none");
    assert_eq!(PatternType::Solid.to_ooxml(), "solid");
    assert_eq!(PatternType::Gray125.to_ooxml(), "gray125");
    assert_eq!(PatternType::Gray0625.to_ooxml(), "gray0625");
    assert_eq!(PatternType::DarkGray.to_ooxml(), "darkGray");
    assert_eq!(PatternType::MediumGray.to_ooxml(), "mediumGray");
    assert_eq!(PatternType::LightGray.to_ooxml(), "lightGray");
}

#[test]
fn test_border_style_values() {
    assert_eq!(BorderStyle::None.to_ooxml(), "none");
    assert_eq!(BorderStyle::Thin.to_ooxml(), "thin");
    assert_eq!(BorderStyle::Medium.to_ooxml(), "medium");
    assert_eq!(BorderStyle::Thick.to_ooxml(), "thick");
    assert_eq!(BorderStyle::Dashed.to_ooxml(), "dashed");
    assert_eq!(BorderStyle::Dotted.to_ooxml(), "dotted");
    assert_eq!(BorderStyle::Double.to_ooxml(), "double");
    assert_eq!(BorderStyle::Hair.to_ooxml(), "hair");
    assert_eq!(BorderStyle::MediumDashed.to_ooxml(), "mediumDashed");
    assert_eq!(BorderStyle::DashDot.to_ooxml(), "dashDot");
    assert_eq!(BorderStyle::MediumDashDot.to_ooxml(), "mediumDashDot");
    assert_eq!(BorderStyle::DashDotDot.to_ooxml(), "dashDotDot");
    assert_eq!(BorderStyle::MediumDashDotDot.to_ooxml(), "mediumDashDotDot");
    assert_eq!(BorderStyle::SlantDashDot.to_ooxml(), "slantDashDot");
}

#[test]
fn test_horizontal_align_values() {
    assert_eq!(HorizontalAlign::General.to_ooxml(), "general");
    assert_eq!(HorizontalAlign::Left.to_ooxml(), "left");
    assert_eq!(HorizontalAlign::Center.to_ooxml(), "center");
    assert_eq!(HorizontalAlign::Right.to_ooxml(), "right");
    assert_eq!(HorizontalAlign::Fill.to_ooxml(), "fill");
    assert_eq!(HorizontalAlign::Justify.to_ooxml(), "justify");
    assert_eq!(
        HorizontalAlign::CenterContinuous.to_ooxml(),
        "centerContinuous"
    );
    assert_eq!(HorizontalAlign::Distributed.to_ooxml(), "distributed");
}

#[test]
fn test_vertical_align_values() {
    assert_eq!(VerticalAlign::Top.to_ooxml(), "top");
    assert_eq!(VerticalAlign::Center.to_ooxml(), "center");
    assert_eq!(VerticalAlign::Bottom.to_ooxml(), "bottom");
    assert_eq!(VerticalAlign::Justify.to_ooxml(), "justify");
    assert_eq!(VerticalAlign::Distributed.to_ooxml(), "distributed");
}

// -------------------------------------------------------------------------
// Integration test - complete styles.xml
// -------------------------------------------------------------------------

#[test]
fn test_complete_styles_xml_output() {
    let mut writer = StylesWriter::with_defaults();

    // Add a custom number format
    let num_fmt_id = writer.add_num_fmt("#,##0.00");

    // Add a bold font
    let font_id = writer.add_font(FontDef {
        name: Some("Calibri".to_string()),
        size: Some(11.0),
        bold: Some(true),
        color: Some(ColorDef::Rgb {
            val: "FFFF0000".to_string(),
            tint: None,
        }),
        ..Default::default()
    });

    // Add a yellow fill
    let fill_id = writer.add_fill(FillDef::Solid {
        fg_color: ColorDef::Rgb {
            val: "FFFFFF00".to_string(),
            tint: None,
        },
    });

    // Add a thin border
    let border_id = writer.add_border(BorderDef {
        left: Some(BorderSideDef {
            style: BorderStyle::Thin,
            color: Some(ColorDef::Indexed { id: 64, tint: None }),
        }),
        right: Some(BorderSideDef {
            style: BorderStyle::Thin,
            color: Some(ColorDef::Indexed { id: 64, tint: None }),
        }),
        top: Some(BorderSideDef {
            style: BorderStyle::Thin,
            color: Some(ColorDef::Indexed { id: 64, tint: None }),
        }),
        bottom: Some(BorderSideDef {
            style: BorderStyle::Thin,
            color: Some(ColorDef::Indexed { id: 64, tint: None }),
        }),
        ..Default::default()
    });

    // Create a style combining all
    let xf = CellXfDef {
        num_fmt_id: Some(num_fmt_id),
        font_id: Some(font_id),
        fill_id: Some(fill_id),
        border_id: Some(border_id),
        xf_id: Some(0),
        alignment: Some(AlignmentDef {
            horizontal: Some(HorizontalAlign::Center),
            vertical: Some(VerticalAlign::Center),
            wrap_text: Some(true),
            ..Default::default()
        }),
        apply_number_format: Some(true),
        apply_font: Some(true),
        apply_fill: Some(true),
        apply_border: Some(true),
        apply_alignment: Some(true),
        ..Default::default()
    };

    writer.add_cell_xf(xf);

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    // Verify structure
    assert!(xml_str.starts_with("<?xml version=\"1.0\""));
    assert!(xml_str.contains("<styleSheet xmlns="));

    // Verify numFmts
    assert!(xml_str.contains("<numFmts count=\"1\">"));
    assert!(xml_str.contains("numFmtId=\"164\""));

    // Verify fonts
    assert!(xml_str.contains("<fonts count=\"2\">"));
    assert!(xml_str.contains("<b/>"));

    // Verify fills
    assert!(xml_str.contains("<fills count=\"3\">"));
    assert!(xml_str.contains("patternType=\"solid\""));

    // Verify borders
    assert!(xml_str.contains("<borders count=\"2\">"));

    // Verify cellXfs
    assert!(xml_str.contains("<cellXfs count=\"2\">"));
    assert!(xml_str.contains("applyNumberFormat=\"1\""));
    assert!(xml_str.contains("applyFont=\"1\""));
    assert!(xml_str.contains("applyFill=\"1\""));
    assert!(xml_str.contains("applyBorder=\"1\""));
    assert!(xml_str.contains("applyAlignment=\"1\""));

    // Verify alignment
    assert!(xml_str.contains("<alignment"));
    assert!(xml_str.contains("horizontal=\"center\""));
    assert!(xml_str.contains("wrapText=\"1\""));
}

// -------------------------------------------------------------------------
// Cell styles tests
// -------------------------------------------------------------------------

#[test]
fn test_write_cell_styles() {
    let mut writer = StylesWriter::with_defaults();
    writer.cell_styles = vec![CellStyleDef {
        name: Some("Normal".to_string()),
        xf_id: 0,
        builtin_id: Some(0),
        custom_builtin: None,
        i_level: None,
        hidden: None,
        ext_lst: None,
        xr_uid: None,
    }];
    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();
    assert!(xml_str.contains("<cellStyles count=\"1\">"));
    assert!(xml_str.contains("name=\"Normal\""));
    assert!(xml_str.contains("xfId=\"0\""));
    assert!(xml_str.contains("builtinId=\"0\""));
}

#[test]
fn test_write_cell_styles_custom_builtin() {
    let mut writer = StylesWriter::with_defaults();
    writer.cell_styles = vec![CellStyleDef {
        name: Some("MyCustom".to_string()),
        xf_id: 1,
        builtin_id: None,
        custom_builtin: Some(true),
        i_level: None,
        hidden: None,
        ext_lst: None,
        xr_uid: None,
    }];
    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();
    assert!(xml_str.contains("customBuiltin=\"1\""));
    assert!(!xml_str.contains("builtinId"));
}

// -------------------------------------------------------------------------
// DXF tests
// -------------------------------------------------------------------------

#[test]
fn test_write_dxfs_font_only() {
    let mut writer = StylesWriter::with_defaults();
    writer.dxfs = vec![DxfDef {
        font: Some(FontDef {
            bold: Some(true),
            ..FontDef::default()
        }),
        ..DxfDef::default()
    }];
    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();
    assert!(xml_str.contains("<dxfs count=\"1\">"));
    assert!(xml_str.contains("<dxf>"));
    assert!(xml_str.contains("<b/>"));
}

#[test]
fn test_write_dxfs_num_fmt() {
    let mut writer = StylesWriter::with_defaults();
    writer.dxfs = vec![DxfDef {
        num_fmt: Some(NumberFormatDef {
            id: 164,
            format_code: "#,##0".to_string(),
        }),
        ..DxfDef::default()
    }];
    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();
    assert!(xml_str.contains("numFmtId=\"164\""));
    assert!(xml_str.contains("formatCode=\"#,##0\""));
}

#[test]
fn test_write_dxfs_alignment_protection() {
    let mut writer = StylesWriter::with_defaults();
    writer.dxfs = vec![DxfDef {
        alignment: Some(AlignmentDef {
            horizontal: Some(HorizontalAlign::Center),
            ..Default::default()
        }),
        protection: Some(ProtectionDef {
            locked: Some(true),
            hidden: None,
        }),
        ..DxfDef::default()
    }];
    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();
    assert!(xml_str.contains("horizontal=\"center\""));
    assert!(xml_str.contains("<protection"));
    assert!(xml_str.contains("locked=\"1\""));
}

// -------------------------------------------------------------------------
// Colors tests
// -------------------------------------------------------------------------

#[test]
fn test_write_colors() {
    let mut writer = StylesWriter::with_defaults();
    writer.colors = Some(ColorsDef {
        indexed_colors: vec!["FF000000".to_string(), "FFFFFFFF".to_string()],
        mru_colors: vec![ColorDef::rgb("FFFF0000")],
    });
    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();
    assert!(xml_str.contains("<colors>"));
    assert!(xml_str.contains("<indexedColors>"));
    assert!(xml_str.contains("rgb=\"FF000000\""));
    assert!(xml_str.contains("<mruColors>"));
    assert!(xml_str.contains("rgb=\"FFFF0000\""));
}

#[test]
fn test_write_colors_empty_not_emitted() {
    let mut writer = StylesWriter::with_defaults();
    writer.colors = Some(ColorsDef {
        indexed_colors: vec![],
        mru_colors: vec![],
    });
    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();
    assert!(!xml_str.contains("<colors>"));
}

#[test]
fn test_write_colors_indexed_only() {
    let mut writer = StylesWriter::with_defaults();
    writer.colors = Some(ColorsDef {
        indexed_colors: vec!["FF000000".to_string()],
        mru_colors: vec![],
    });
    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();
    assert!(xml_str.contains("<indexedColors>"));
    assert!(!xml_str.contains("<mruColors>"));
}

// -------------------------------------------------------------------------
// Table styles tests
// -------------------------------------------------------------------------

#[test]
fn test_write_table_styles() {
    let mut writer = StylesWriter::with_defaults();
    writer.default_table_style = Some("TableStyleMedium2".to_string());
    writer.table_styles = vec![TableStyleDef {
        name: "Custom".to_string(),
        pivot: Some(false),
        table: Some(true),
        count: Some(1),
        elements: vec![TableStyleElementDef {
            style_type: TableStyleType::WholeTable,
            dxf_id: Some(0),
            size: None,
        }],
        ..Default::default()
    }];
    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();
    assert!(xml_str.contains("defaultTableStyle=\"TableStyleMedium2\""));
    assert!(xml_str.contains("<tableStyle name=\"Custom\""));
    assert!(xml_str.contains("type=\"wholeTable\""));
}

#[test]
fn test_write_table_styles_with_pivot_and_size() {
    let mut writer = StylesWriter::with_defaults();
    writer.default_pivot_style = Some("PivotStyleLight16".to_string());
    writer.table_styles = vec![TableStyleDef {
        name: "PivotStyle".to_string(),
        pivot: Some(true),
        table: Some(true),
        count: Some(2),
        elements: vec![
            TableStyleElementDef {
                style_type: TableStyleType::HeaderRow,
                dxf_id: Some(0),
                size: None,
            },
            TableStyleElementDef {
                style_type: TableStyleType::FirstRowStripe,
                dxf_id: Some(1),
                size: Some(2),
            },
        ],
        ..Default::default()
    }];
    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();
    assert!(xml_str.contains("defaultPivotStyle=\"PivotStyleLight16\""));
    assert!(xml_str.contains("pivot=\"1\""));
    assert!(xml_str.contains("type=\"headerRow\""));
    assert!(xml_str.contains("size=\"2\""));
}

// -------------------------------------------------------------------------
// Element ordering test
// -------------------------------------------------------------------------

#[test]
fn test_ooxml_element_order() {
    let mut writer = StylesWriter::with_defaults();
    writer.add_num_fmt("#,##0");
    writer.cell_styles = vec![CellStyleDef {
        name: Some("Normal".to_string()),
        xf_id: 0,
        builtin_id: Some(0),
        custom_builtin: None,
        i_level: None,
        hidden: None,
        ext_lst: None,
        xr_uid: None,
    }];
    writer.dxfs = vec![DxfDef {
        font: Some(FontDef {
            bold: Some(true),
            ..FontDef::default()
        }),
        ..DxfDef::default()
    }];
    writer.table_styles = vec![TableStyleDef {
        name: "T1".to_string(),
        pivot: Some(false),
        table: Some(true),
        count: Some(0),
        elements: vec![],
        ..Default::default()
    }];
    writer.colors = Some(ColorsDef {
        indexed_colors: vec!["FF000000".to_string()],
        mru_colors: vec![],
    });

    let xml = writer.to_xml();
    let xml_str = String::from_utf8(xml).unwrap();

    // Verify OOXML spec order:
    // numFmts < fonts < fills < borders < cellStyleXfs < cellXfs < cellStyles < dxfs < tableStyles < colors
    let pos_numfmts = xml_str.find("<numFmts").unwrap();
    let pos_fonts = xml_str.find("<fonts").unwrap();
    let pos_fills = xml_str.find("<fills").unwrap();
    let pos_borders = xml_str.find("<borders").unwrap();
    let pos_cell_style_xfs = xml_str.find("<cellStyleXfs").unwrap();
    let pos_cell_xfs = xml_str.find("<cellXfs").unwrap();
    let pos_cell_styles = xml_str.find("<cellStyles").unwrap();
    let pos_dxfs = xml_str.find("<dxfs").unwrap();
    let pos_table_styles = xml_str.find("<tableStyles").unwrap();
    let pos_colors = xml_str.find("<colors>").unwrap();

    assert!(pos_numfmts < pos_fonts);
    assert!(pos_fonts < pos_fills);
    assert!(pos_fills < pos_borders);
    assert!(pos_borders < pos_cell_style_xfs);
    assert!(pos_cell_style_xfs < pos_cell_xfs);
    assert!(pos_cell_xfs < pos_cell_styles);
    assert!(pos_cell_styles < pos_dxfs);
    assert!(pos_dxfs < pos_table_styles);
    assert!(pos_table_styles < pos_colors);
}

// -------------------------------------------------------------------------
// knownFonts round-trip tests
// -------------------------------------------------------------------------

#[test]
fn test_known_fonts_false_does_not_emit_x14ac() {
    let mut writer = StylesWriter::with_defaults();
    writer.known_fonts = false;
    let xml = writer.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    // Should NOT contain x14ac namespace or mc:Ignorable
    assert!(
        !xml_str.contains("x14ac"),
        "x14ac should not appear when known_fonts is false"
    );
    assert!(
        !xml_str.contains("mc:Ignorable"),
        "mc:Ignorable should not appear when known_fonts is false"
    );
    assert!(
        !xml_str.contains("knownFonts"),
        "knownFonts should not appear when known_fonts is false"
    );
}

#[test]
fn test_known_fonts_true_emits_x14ac_namespace_and_attribute() {
    let mut writer = StylesWriter::with_defaults();
    writer.known_fonts = true;
    let xml = writer.to_xml();
    let xml_str = String::from_utf8_lossy(&xml);

    // <styleSheet> should have xmlns:x14ac, xmlns:mc, and mc:Ignorable
    assert!(
        xml_str.contains(
            "xmlns:x14ac=\"http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac\""
        ),
        "Missing xmlns:x14ac on styleSheet"
    );
    assert!(
        xml_str
            .contains("xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\""),
        "Missing xmlns:mc on styleSheet"
    );
    assert!(
        xml_str.contains("mc:Ignorable=\"x14ac\""),
        "Missing mc:Ignorable on styleSheet"
    );

    // <fonts> element should have x14ac:knownFonts="1"
    assert!(
        xml_str.contains("x14ac:knownFonts=\"1\""),
        "Missing x14ac:knownFonts=\"1\" on fonts element"
    );
}

#[test]
fn test_known_fonts_roundtrip_via_parse() {
    // Write XML with knownFonts=true
    let mut writer = StylesWriter::with_defaults();
    writer.known_fonts = true;
    let xml_bytes = writer.to_xml();

    // Parse it back using the styles parser
    use crate::domain::styles::read::parse_known_fonts;
    let parsed = parse_known_fonts(&xml_bytes);
    assert!(
        parsed,
        "parse_known_fonts should return true for XML with x14ac:knownFonts=\"1\""
    );

    // Also test that it returns false when knownFonts is not present
    let mut writer2 = StylesWriter::with_defaults();
    writer2.known_fonts = false;
    let xml_bytes2 = writer2.to_xml();
    let parsed2 = parse_known_fonts(&xml_bytes2);
    assert!(
        !parsed2,
        "parse_known_fonts should return false for XML without knownFonts"
    );
}
