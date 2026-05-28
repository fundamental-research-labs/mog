use super::super::*;
use domain_types::{
    CellBorderSide, CellBorders, CellFormat, FontSize, GradientCenter, GradientFillFormat,
    GradientStopFormat,
};

/// Helper: roundtrip serialize then deserialize, assert equality.
fn roundtrip(formats: &[CellFormat], start_index: u16) -> Vec<CellFormat> {
    let bytes = serialize_palette_binary(formats, start_index);
    let (si, result) = deserialize_palette_binary(&bytes).expect("deserialize should succeed");
    assert_eq!(si, start_index);
    assert_eq!(result.len(), formats.len());
    result
}

#[test]
fn empty_palette_roundtrip() {
    let result = roundtrip(&[], 0);
    assert!(result.is_empty());

    // Also check with non-zero start_index.
    let bytes = serialize_palette_binary(&[], 42);
    let (si, fmts) = deserialize_palette_binary(&bytes).unwrap();
    assert_eq!(si, 42);
    assert!(fmts.is_empty());
}

#[test]
fn default_format_roundtrip() {
    let formats = vec![CellFormat::default()];
    let result = roundtrip(&formats, 0);
    assert_eq!(result[0], CellFormat::default());

    // Verify the binary is minimal: header (8) + presence u32 (4) + pool (0) = 12
    let bytes = serialize_palette_binary(&formats, 0);
    assert_eq!(bytes.len(), 12);
}

#[test]
fn fully_populated_roundtrip() {
    let fmt = CellFormat {
        font_family: Some("Calibri".into()),
        font_size: Some(FontSize::from_millipoints(11000)),
        font_color: Some("#000000".into()),
        bold: Some(true),
        italic: Some(false),
        underline_type: Some(ooxml_types::styles::UnderlineStyle::Single),
        strikethrough: Some(false),
        superscript: Some(false),
        subscript: Some(false),
        font_outline: Some(true),
        font_shadow: Some(false),
        font_theme: Some("minor".into()),
        font_charset: Some(0),
        font_family_type: Some(2),
        horizontal_align: Some(ooxml_types::styles::HorizontalAlign::Left),
        vertical_align: Some(domain_types::CellVerticalAlign::Top),
        wrap_text: Some(true),
        indent: Some(1),
        text_rotation: Some(-45),
        shrink_to_fit: Some(false),
        reading_order: Some("context".into()),
        number_format: Some("0.00%".into()),
        background_color: Some("#FFFFFF".into()),
        pattern_type: Some(ooxml_types::styles::PatternType::Solid),
        pattern_foreground_color: Some("#EEEEEE".into()),
        gradient_fill: Some(GradientFillFormat {
            gradient_type: "linear".into(),
            degree: Some(90.0),
            center: Some(GradientCenter {
                left: 0.5,
                top: 0.5,
            }),
            stops: vec![
                GradientStopFormat {
                    position: 0.0,
                    color: "#FF0000".into(),
                },
                GradientStopFormat {
                    position: 1.0,
                    color: "#0000FF".into(),
                },
            ],
        }),
        borders: Some(CellBorders {
            top: Some(CellBorderSide {
                style: Some(ooxml_types::styles::BorderStyle::Thin),
                color: Some("#000000".into()),
                color_tint: None,
            }),
            right: Some(CellBorderSide {
                style: Some(ooxml_types::styles::BorderStyle::Medium),
                color: Some("#FF0000".into()),
                color_tint: None,
            }),
            bottom: Some(CellBorderSide {
                style: Some(ooxml_types::styles::BorderStyle::Thick),
                color: None,
                color_tint: None,
            }),
            left: Some(CellBorderSide {
                style: None,
                color: Some("#00FF00".into()),
                color_tint: None,
            }),
            diagonal: Some(CellBorderSide {
                style: Some(ooxml_types::styles::BorderStyle::Dashed),
                color: Some("#0000FF".into()),
                color_tint: None,
            }),
            diagonal_up: Some(true),
            diagonal_down: Some(false),
            vertical: Some(CellBorderSide {
                style: Some(ooxml_types::styles::BorderStyle::Dotted),
                color: None,
                color_tint: None,
            }),
            horizontal: Some(CellBorderSide {
                style: None,
                color: None,
                color_tint: None,
            }),
            outline: Some(true),
        }),
        locked: Some(true),
        hidden: Some(false),
        // quote_prefix is not wire-encoded; it round-trips as None.
        quote_prefix: None,
        // tint / auto-indent fields are not wire-encoded; they round-trip as None.
        font_color_tint: None,
        auto_indent: None,
        background_color_tint: None,
        pattern_foreground_color_tint: None,
    };

    let result = roundtrip(std::slice::from_ref(&fmt), 5);
    assert_eq!(result[0], fmt);
}

#[test]
fn string_dedup_in_pool() {
    // Two formats with the same font_family should share pool bytes.
    let fmt1 = CellFormat {
        font_family: Some("Arial".into()),
        ..Default::default()
    };
    let fmt2 = CellFormat {
        font_family: Some("Arial".into()),
        bold: Some(true),
        ..Default::default()
    };

    let bytes = serialize_palette_binary(&[fmt1.clone(), fmt2.clone()], 0);

    // The string "Arial" (5 bytes) should appear exactly once in the pool.
    // Header (8) + record1 (4 mask + 6 strref) + record2 (4 mask + 6 strref + 1 bool) + pool
    // pool should be exactly 5 bytes ("Arial").
    let pool_size = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
    assert_eq!(pool_size, 5, "pool should contain 'Arial' exactly once");

    // Verify roundtrip.
    let (_, result) = deserialize_palette_binary(&bytes).unwrap();
    assert_eq!(result[0], fmt1);
    assert_eq!(result[1], fmt2);
}

#[test]
#[allow(clippy::float_cmp)] // Roundtrip of exact bit patterns — exact comparison is correct.
fn gradient_fill_with_stops() {
    let fmt = CellFormat {
        gradient_fill: Some(GradientFillFormat {
            gradient_type: "path".into(),
            degree: None,
            center: Some(GradientCenter {
                left: 0.25,
                top: 0.75,
            }),
            stops: vec![
                GradientStopFormat {
                    position: 0.0,
                    color: "#AAAAAA".into(),
                },
                GradientStopFormat {
                    position: 0.5,
                    color: "#BBBBBB".into(),
                },
                GradientStopFormat {
                    position: 1.0,
                    color: "#CCCCCC".into(),
                },
            ],
        }),
        ..Default::default()
    };

    let result = roundtrip(std::slice::from_ref(&fmt), 0);
    let gf = result[0].gradient_fill.as_ref().unwrap();
    assert_eq!(gf.gradient_type, "path");
    assert_eq!(gf.degree, None);
    assert!(gf.center.is_some());
    let center = gf.center.as_ref().unwrap();
    assert_eq!(center.left, 0.25);
    assert_eq!(center.top, 0.75);
    assert_eq!(gf.stops.len(), 3);
    assert_eq!(gf.stops[0].color, "#AAAAAA");
    assert_eq!(gf.stops[2].position, 1.0);
}

#[test]
fn full_borders_roundtrip() {
    let fmt = CellFormat {
        borders: Some(CellBorders {
            top: Some(CellBorderSide {
                style: Some(ooxml_types::styles::BorderStyle::Thin),
                color: Some("#111111".into()),
                color_tint: None,
            }),
            right: Some(CellBorderSide {
                style: Some(ooxml_types::styles::BorderStyle::Medium),
                color: Some("#222222".into()),
                color_tint: None,
            }),
            bottom: Some(CellBorderSide {
                style: Some(ooxml_types::styles::BorderStyle::Thick),
                color: Some("#333333".into()),
                color_tint: None,
            }),
            left: Some(CellBorderSide {
                style: Some(ooxml_types::styles::BorderStyle::Double),
                color: Some("#444444".into()),
                color_tint: None,
            }),
            diagonal: Some(CellBorderSide {
                style: Some(ooxml_types::styles::BorderStyle::Dashed),
                color: Some("#555555".into()),
                color_tint: None,
            }),
            diagonal_up: Some(true),
            diagonal_down: Some(true),
            vertical: Some(CellBorderSide {
                style: Some(ooxml_types::styles::BorderStyle::Dotted),
                color: Some("#666666".into()),
                color_tint: None,
            }),
            horizontal: Some(CellBorderSide {
                style: Some(ooxml_types::styles::BorderStyle::Hair),
                color: Some("#777777".into()),
                color_tint: None,
            }),
            outline: Some(false),
        }),
        ..Default::default()
    };

    let result = roundtrip(std::slice::from_ref(&fmt), 0);
    assert_eq!(result[0], fmt);
}

#[test]
fn partial_border_side() {
    use ooxml_types::styles::BorderStyle;
    // Style only
    let style_only = CellBorderSide {
        style: Some(BorderStyle::Thin),
        color: None,
        color_tint: None,
    };
    // Color only
    let color_only = CellBorderSide {
        style: None,
        color: Some("#ABCDEF".into()),
        color_tint: None,
    };
    // Both
    let both = CellBorderSide {
        style: Some(BorderStyle::Medium),
        color: Some("#123456".into()),
        color_tint: None,
    };

    let fmt = CellFormat {
        borders: Some(CellBorders {
            top: Some(style_only.clone()),
            right: Some(color_only.clone()),
            bottom: Some(both.clone()),
            ..Default::default()
        }),
        ..Default::default()
    };

    let result = roundtrip(&[fmt], 0);
    let borders = result[0].borders.as_ref().unwrap();
    assert_eq!(borders.top.as_ref().unwrap().style, Some(BorderStyle::Thin));
    assert_eq!(borders.top.as_ref().unwrap().color, None);
    assert_eq!(borders.right.as_ref().unwrap().style, None);
    assert_eq!(
        borders.right.as_ref().unwrap().color,
        Some("#ABCDEF".into())
    );
    assert_eq!(
        borders.bottom.as_ref().unwrap().style,
        Some(BorderStyle::Medium)
    );
    assert_eq!(
        borders.bottom.as_ref().unwrap().color,
        Some("#123456".into())
    );
    assert!(borders.left.is_none());
}

#[test]
fn large_palette() {
    let formats: Vec<CellFormat> = (0..1000u32)
        .map(|i| CellFormat {
            font_family: Some(format!("Font{}", i % 50)),
            font_size: Some(FontSize::from_millipoints(8000 + i * 100)),
            bold: if i % 3 == 0 { Some(true) } else { None },
            font_color: if i % 5 == 0 {
                Some(format!("#{:06X}", i * 257))
            } else {
                None
            },
            number_format: if i % 7 == 0 {
                Some("0.00".into())
            } else {
                None
            },
            ..Default::default()
        })
        .collect();

    let bytes = serialize_palette_binary(&formats, 100);
    let (si, result) = deserialize_palette_binary(&bytes).unwrap();
    assert_eq!(si, 100);
    assert_eq!(result.len(), 1000);

    // Spot-check a few entries.
    for i in [0, 1, 42, 500, 999] {
        assert_eq!(result[i], formats[i], "mismatch at index {i}");
    }
}

#[test]
fn truncated_buffer_returns_error() {
    let fmt = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    let bytes = serialize_palette_binary(&[fmt], 0);

    // Truncate to just the header.
    let result = deserialize_palette_binary(&bytes[..PALETTE_HEADER_SIZE]);
    assert!(result.is_err());
}

#[test]
fn start_index_preserved() {
    let formats = vec![CellFormat {
        font_family: Some("Test".into()),
        ..Default::default()
    }];
    for si in [0u16, 1, 100, u16::MAX] {
        let bytes = serialize_palette_binary(&formats, si);
        let (got_si, _) = deserialize_palette_binary(&bytes).unwrap();
        assert_eq!(got_si, si);
    }
}
