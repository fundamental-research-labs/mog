use super::super::components::{resolve_alignment, resolve_border, resolve_font};
use super::super::{
    AlignmentInput, BorderInput, BorderSideInput, CellXfInput, ColorInput, FillInput, FontInput,
    GradientFillInput, GradientStopInput, StyleInput, resolve_color, resolve_styles,
};
use super::make_input;

#[test]
fn full_style_conversion() {
    let input = make_input();
    let palette = resolve_styles(&input);
    let fmt = &palette[1];

    // Number format
    assert_eq!(fmt.number_format.as_deref(), Some("#,##0.00_);(#,##0.00)"));

    // Font
    let font = fmt.font.as_ref().expect("should have font");
    assert_eq!(font.bold, Some(true));
    assert_eq!(font.italic, Some(true));
    assert_eq!(font.underline.as_deref(), Some("single"));
    assert_eq!(font.size, Some(14000));
    assert_eq!(font.name.as_deref(), Some("Arial"));
    assert_eq!(font.color.as_deref(), Some("#FF0000"));
    assert_eq!(font.superscript, Some(true));

    // Fill
    let fill = fmt.fill.as_ref().expect("should have fill");
    assert_eq!(fill.background_color.as_deref(), Some("#4472C4"));

    // Border
    let border = fmt.border.as_ref().expect("should have border");
    let bottom = border.bottom.as_ref().expect("should have bottom border");
    assert_eq!(bottom.style, "thin");
    assert_eq!(bottom.color.as_deref(), Some("#000000"));

    // Alignment
    let align = fmt.alignment.as_ref().expect("should have alignment");
    assert_eq!(align.horizontal.as_deref(), Some("center"));
    assert_eq!(align.vertical.as_deref(), Some("middle")); // center → middle
    assert_eq!(align.wrap_text, Some(true));
    assert_eq!(align.indent, Some(2));

    // Protection
    let prot = fmt.protection.as_ref().expect("should have protection");
    assert_eq!(prot.locked, Some(true));
    assert_eq!(prot.hidden, Some(true));
}

#[test]
fn static_styles_preserve_theme_identity_and_tint_across_color_categories() {
    let theme_colors = vec![
        "#000000".to_string(),
        "#FFFFFF".to_string(),
        "#44546A".to_string(),
        "#E7E6E6".to_string(),
        "#4472C4".to_string(),
        "#ED7D31".to_string(),
        "#A5A5A5".to_string(),
        "#FFC000".to_string(),
        "#5B9BD5".to_string(),
        "#70AD47".to_string(),
        "#0563C1".to_string(),
        "#954F72".to_string(),
    ];
    let theme = |index, tint| ColorInput {
        theme: Some(index),
        tint,
        ..Default::default()
    };
    let input = StyleInput {
        fonts: vec![
            FontInput::default(),
            FontInput {
                color: Some(theme(4, Some(0.25))),
                ..Default::default()
            },
        ],
        fills: vec![
            FillInput::default(),
            FillInput {
                fill_type: "pattern".to_string(),
                pattern_type: "solid".to_string(),
                fg_color: Some(theme(5, Some(-0.2))),
                ..Default::default()
            },
            FillInput {
                fill_type: "pattern".to_string(),
                pattern_type: "darkGrid".to_string(),
                fg_color: Some(theme(6, Some(0.1))),
                bg_color: Some(theme(2, Some(-0.1))),
                ..Default::default()
            },
            FillInput {
                fill_type: "gradient".to_string(),
                gradient: Some(GradientFillInput {
                    gradient_type: "linear".to_string(),
                    degree: Some(45.0),
                    stops: vec![
                        GradientStopInput {
                            position: 0.0,
                            color: theme(7, Some(0.4)),
                        },
                        GradientStopInput {
                            position: 1.0,
                            color: theme(8, None),
                        },
                    ],
                    left: None,
                    right: None,
                    top: None,
                    bottom: None,
                }),
                ..Default::default()
            },
        ],
        borders: vec![
            BorderInput::default(),
            BorderInput {
                top: Some(BorderSideInput {
                    style: "thin".to_string(),
                    color: Some(theme(10, Some(0.3))),
                }),
                ..Default::default()
            },
        ],
        cell_xfs: vec![
            CellXfInput::default(),
            CellXfInput {
                font_id: Some(1),
                fill_id: Some(1),
                border_id: Some(1),
                apply_font: Some(true),
                apply_fill: Some(true),
                apply_border: Some(true),
                ..Default::default()
            },
            CellXfInput {
                fill_id: Some(2),
                apply_fill: Some(true),
                ..Default::default()
            },
            CellXfInput {
                fill_id: Some(3),
                apply_fill: Some(true),
                ..Default::default()
            },
        ],
        theme_colors: theme_colors.clone(),
        ..Default::default()
    };

    let palette = resolve_styles(&input);
    let combined = &palette[1];
    let font = combined.font.as_ref().unwrap();
    assert_eq!(font.color.as_deref(), Some("theme:accent1"));
    assert_eq!(font.color_tint, Some(0.25));
    let solid = combined.fill.as_ref().unwrap();
    assert_eq!(solid.background_color.as_deref(), Some("theme:accent2"));
    assert_eq!(solid.background_color_tint, Some(-0.2));
    let top = combined.border.as_ref().unwrap().top.as_ref().unwrap();
    assert_eq!(top.color.as_deref(), Some("theme:hyperlink"));
    assert_eq!(top.color_tint, Some(0.3));

    let pattern = palette[2].fill.as_ref().unwrap();
    assert_eq!(
        pattern.pattern_foreground_color.as_deref(),
        Some("theme:accent3")
    );
    assert_eq!(pattern.pattern_foreground_color_tint, Some(0.1));
    assert_eq!(pattern.background_color.as_deref(), Some("theme:light2"));
    assert_eq!(pattern.background_color_tint, Some(-0.1));

    let gradient = palette[3]
        .fill
        .as_ref()
        .unwrap()
        .gradient_fill
        .as_ref()
        .unwrap();
    assert_eq!(gradient.stops[0].color, "theme:accent4:0.4");
    assert_eq!(gradient.stops[1].color, "theme:accent5");

    // Display resolution remains a separate operation over the workbook theme.
    assert_eq!(
        resolve_color(&theme(4, None), &theme_colors).as_deref(),
        Some("#4472C4")
    );
}

#[test]
fn indexed_static_color_preserves_base_and_applies_parallel_tint_once() {
    let font = resolve_font(
        &FontInput {
            color: Some(ColorInput {
                indexed: Some(0),
                tint: Some(0.5),
                ..Default::default()
            }),
            ..Default::default()
        },
        None,
        None,
    );

    assert_eq!(font.color.as_deref(), Some("#000000"));
    assert_eq!(font.color_tint, Some(0.5));

    let mut format = crate::CellFormat {
        font_color: font.color,
        font_color_tint: font.color_tint,
        ..Default::default()
    };
    crate::theme_color::resolve_theme_refs(&mut format, &std::collections::HashMap::new());
    assert_eq!(format.font_color.as_deref(), Some("#808080"));
    assert_eq!(format.font_color_tint, None);

    let resolved_once = format.clone();
    crate::theme_color::resolve_theme_refs(&mut format, &std::collections::HashMap::new());
    assert_eq!(format, resolved_once);
}

#[test]
fn fill_resolution_preserves_no_fill_colorless_solid_and_colored_solid() {
    let input = StyleInput {
        fills: vec![
            FillInput {
                fill_type: "pattern".to_string(),
                pattern_type: "none".to_string(),
                ..Default::default()
            },
            FillInput {
                fill_type: "pattern".to_string(),
                pattern_type: "solid".to_string(),
                ..Default::default()
            },
            FillInput {
                fill_type: "pattern".to_string(),
                pattern_type: "solid".to_string(),
                fg_color: Some(ColorInput {
                    rgb: Some("FFFF0000".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        ],
        cell_xfs: vec![
            CellXfInput::default(),
            CellXfInput {
                fill_id: Some(0),
                apply_fill: Some(true),
                ..Default::default()
            },
            CellXfInput {
                fill_id: Some(1),
                apply_fill: Some(true),
                ..Default::default()
            },
            CellXfInput {
                fill_id: Some(2),
                apply_fill: Some(true),
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let palette = resolve_styles(&input);
    let no_fill = palette[1].fill.as_ref().expect("explicit no-fill");
    assert_eq!(no_fill.pattern_type.as_deref(), Some("none"));
    assert!(no_fill.background_color.is_none());

    let colorless_solid = palette[2].fill.as_ref().expect("colorless solid fill");
    assert_eq!(colorless_solid.pattern_type.as_deref(), Some("solid"));
    assert!(colorless_solid.background_color.is_none());

    let colored_solid = palette[3].fill.as_ref().expect("colored solid fill");
    assert_eq!(colored_solid.pattern_type.as_deref(), Some("solid"));
    assert_eq!(colored_solid.background_color.as_deref(), Some("#FF0000"));

    assert_ne!(no_fill, colorless_solid);
    assert_ne!(colorless_solid, colored_solid);
    assert_ne!(no_fill, colored_solid);
}

#[test]
fn font_scheme_sets_scheme_not_name() {
    let input = StyleInput {
        fonts: vec![FontInput {
            name: "Calibri".to_string(),
            size: 11.0,
            scheme: Some("minor".to_string()),
            ..Default::default()
        }],
        cell_xfs: vec![
            CellXfInput::default(),
            CellXfInput {
                font_id: Some(0),
                apply_font: Some(true),
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let palette = resolve_styles(&input);
    let font = palette[1].font.as_ref().expect("should have font");
    assert_eq!(font.scheme.as_deref(), Some("minor"));
    assert!(font.name.is_none());
}

#[test]
fn border_resolution() {
    let border = BorderInput {
        top: Some(BorderSideInput {
            style: "medium".to_string(),
            color: Some(ColorInput {
                rgb: Some("FFFF0000".to_string()),
                ..Default::default()
            }),
        }),
        bottom: Some(BorderSideInput {
            style: "none".to_string(),
            color: None,
        }),
        diagonal: Some(BorderSideInput {
            style: "thin".to_string(),
            color: None,
        }),
        diagonal_up: Some(true),
        diagonal_down: Some(true),
        ..Default::default()
    };

    let bf = resolve_border(&border).expect("should resolve border");
    assert!(bf.top.is_some());
    assert_eq!(bf.top.as_ref().unwrap().style, "medium");
    assert_eq!(bf.top.as_ref().unwrap().color.as_deref(), Some("#FF0000"));
    assert!(bf.bottom.is_none()); // "none" style is filtered
    assert!(bf.diagonal.is_some());
    assert_eq!(bf.diagonal_up, Some(true));
    assert_eq!(bf.diagonal_down, Some(true));
}

#[test]
fn border_diagonal_absent_vs_explicit_false_preserved() {
    // Absent on the OOXML side (None) must NOT be promoted to Some(false).
    let absent = BorderInput {
        diagonal: Some(BorderSideInput {
            style: "thin".to_string(),
            color: None,
        }),
        diagonal_up: None,
        diagonal_down: None,
        ..Default::default()
    };
    let bf = resolve_border(&absent).expect("has a diagonal side");
    assert_eq!(bf.diagonal_up, None);
    assert_eq!(bf.diagonal_down, None);

    // Explicit Some(false) must be preserved, not collapsed to None.
    let explicit_false = BorderInput {
        diagonal: Some(BorderSideInput {
            style: "thin".to_string(),
            color: None,
        }),
        diagonal_up: Some(false),
        diagonal_down: Some(false),
        ..Default::default()
    };
    let bf = resolve_border(&explicit_false).expect("has a diagonal side");
    assert_eq!(bf.diagonal_up, Some(false));
    assert_eq!(bf.diagonal_down, Some(false));

    // Asymmetric: one explicit true, other absent.
    let asymmetric = BorderInput {
        diagonal: Some(BorderSideInput {
            style: "thin".to_string(),
            color: None,
        }),
        diagonal_up: Some(true),
        diagonal_down: None,
        ..Default::default()
    };
    let bf = resolve_border(&asymmetric).expect("has a diagonal side");
    assert_eq!(bf.diagonal_up, Some(true));
    assert_eq!(bf.diagonal_down, None);
}

#[test]
fn alignment_resolution_preserves_all_fields() {
    let input = AlignmentInput {
        text_rotation: Some(255), // stacked/vertical sentinel
        reading_order: Some(2),   // rtl
        shrink_to_fit: Some(false),
        wrap_text: Some(false),
        indent: Some(0),
        relative_indent: Some(-3),
        justify_last_line: Some(true),
        ..Default::default()
    };
    let af = resolve_alignment(&input).expect("has properties");
    assert_eq!(af.rotation, Some(255));
    assert_eq!(af.reading_order.as_deref(), Some("rtl"));
    assert_eq!(af.shrink_to_fit, Some(false));
    assert_eq!(af.wrap_text, Some(false));
    assert_eq!(af.indent, Some(0));
    assert_eq!(af.relative_indent, Some(-3));
    assert_eq!(af.justify_last_line, Some(true));
}

#[test]
fn alignment_resolution_reading_order_tokens() {
    for (int_val, token) in [(0u32, "context"), (1, "ltr"), (2, "rtl")] {
        let input = AlignmentInput {
            reading_order: Some(int_val),
            ..Default::default()
        };
        let af = resolve_alignment(&input).expect("has readingOrder");
        assert_eq!(af.reading_order.as_deref(), Some(token));
    }
    // Unknown reading order value must not materialize a token.
    let input = AlignmentInput {
        reading_order: Some(99),
        ..Default::default()
    };
    assert!(resolve_alignment(&input).is_none());
}
