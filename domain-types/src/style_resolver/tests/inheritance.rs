use std::collections::HashMap;

use super::super::{
    AlignmentInput, BorderInput, BorderSideInput, CellXfInput, ColorInput, FillInput, FontInput,
    ProtectionInput, StyleInput, resolve_styles,
};

#[test]
fn explicit_false_apply_flags_preserve_base_style() {
    let input = StyleInput {
        cell_style_xfs: vec![CellXfInput {
            num_fmt_id: Some(164),
            font_id: Some(1),
            fill_id: Some(1),
            border_id: Some(1),
            alignment: Some(AlignmentInput {
                horizontal: Some("center".to_string()),
                wrap_text: Some(false),
                ..Default::default()
            }),
            protection: Some(ProtectionInput {
                locked: true,
                hidden: true,
            }),
            quote_prefix: true,
            pivot_button: true,
            ..Default::default()
        }],
        cell_xfs: vec![
            CellXfInput::default(),
            CellXfInput {
                xf_id: Some(0),
                num_fmt_id: Some(165),
                font_id: Some(2),
                fill_id: Some(2),
                border_id: Some(2),
                apply_number_format: Some(false),
                apply_font: Some(false),
                apply_fill: Some(false),
                apply_border: Some(false),
                apply_alignment: Some(false),
                apply_protection: Some(false),
                alignment: Some(AlignmentInput {
                    horizontal: Some("right".to_string()),
                    ..Default::default()
                }),
                protection: Some(ProtectionInput {
                    locked: false,
                    hidden: false,
                }),
                ..Default::default()
            },
        ],
        fonts: vec![
            FontInput::default(),
            FontInput {
                name: "Base".to_string(),
                size: 12.0,
                bold: true,
                ..Default::default()
            },
            FontInput {
                name: "Direct".to_string(),
                size: 18.0,
                italic: true,
                ..Default::default()
            },
        ],
        fills: vec![
            FillInput {
                fill_type: "pattern".to_string(),
                pattern_type: "none".to_string(),
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
            FillInput {
                fill_type: "pattern".to_string(),
                pattern_type: "solid".to_string(),
                fg_color: Some(ColorInput {
                    rgb: Some("FF00FF00".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        ],
        borders: vec![
            BorderInput::default(),
            BorderInput {
                top: Some(BorderSideInput {
                    style: "thin".to_string(),
                    color: None,
                }),
                ..Default::default()
            },
            BorderInput {
                top: Some(BorderSideInput {
                    style: "thick".to_string(),
                    color: None,
                }),
                ..Default::default()
            },
        ],
        num_fmts: {
            let mut m = HashMap::new();
            m.insert(164, "0.000".to_string());
            m.insert(165, "0.0".to_string());
            m
        },
        ..Default::default()
    };

    let fmt = &resolve_styles(&input)[1];
    assert_eq!(fmt.number_format.as_deref(), Some("0.000"));
    assert_eq!(
        fmt.font.as_ref().and_then(|f| f.name.as_deref()),
        Some("Base")
    );
    assert_eq!(
        fmt.fill
            .as_ref()
            .and_then(|f| f.background_color.as_deref()),
        Some("#FF0000")
    );
    assert_eq!(
        fmt.border
            .as_ref()
            .and_then(|b| b.top.as_ref())
            .map(|s| s.style.as_str()),
        Some("thin")
    );
    assert_eq!(
        fmt.alignment.as_ref().and_then(|a| a.horizontal.as_deref()),
        Some("center")
    );
    assert_eq!(fmt.protection.as_ref().and_then(|p| p.hidden), Some(true));
    assert_eq!(fmt.quote_prefix, Some(true));
    assert_eq!(fmt.pivot_button, Some(true));
}

#[test]
fn absent_apply_flags_use_nonzero_and_presence_heuristics() {
    let input = StyleInput {
        cell_xfs: vec![
            CellXfInput::default(),
            CellXfInput {
                num_fmt_id: Some(164),
                font_id: Some(1),
                fill_id: Some(1),
                border_id: Some(1),
                alignment: Some(AlignmentInput {
                    vertical: Some("center".to_string()),
                    ..Default::default()
                }),
                protection: Some(ProtectionInput {
                    locked: false,
                    hidden: true,
                }),
                ..Default::default()
            },
        ],
        fonts: vec![
            FontInput::default(),
            FontInput {
                name: "Heuristic".to_string(),
                bold: true,
                ..Default::default()
            },
        ],
        fills: vec![
            FillInput {
                fill_type: "pattern".to_string(),
                pattern_type: "none".to_string(),
                ..Default::default()
            },
            FillInput {
                fill_type: "pattern".to_string(),
                pattern_type: "solid".to_string(),
                fg_color: Some(ColorInput {
                    rgb: Some("FF4472C4".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        ],
        borders: vec![
            BorderInput::default(),
            BorderInput {
                bottom: Some(BorderSideInput {
                    style: "thin".to_string(),
                    color: None,
                }),
                ..Default::default()
            },
        ],
        num_fmts: {
            let mut m = HashMap::new();
            m.insert(164, "0.000%".to_string());
            m
        },
        ..Default::default()
    };

    let fmt = &resolve_styles(&input)[1];
    assert_eq!(fmt.number_format.as_deref(), Some("0.000%"));
    assert_eq!(fmt.font.as_ref().and_then(|f| f.bold), Some(true));
    assert_eq!(
        fmt.fill
            .as_ref()
            .and_then(|f| f.background_color.as_deref()),
        Some("#4472C4")
    );
    assert!(
        fmt.border
            .as_ref()
            .and_then(|b| b.bottom.as_ref())
            .is_some()
    );
    assert_eq!(
        fmt.alignment.as_ref().and_then(|a| a.vertical.as_deref()),
        Some("middle")
    );
    assert_eq!(fmt.protection.as_ref().and_then(|p| p.locked), Some(false));
    assert_eq!(fmt.protection.as_ref().and_then(|p| p.hidden), Some(true));
}

#[test]
fn applied_number_format_zero_preserves_general_override() {
    let input = StyleInput {
        cell_style_xfs: vec![CellXfInput {
            num_fmt_id: Some(164),
            ..Default::default()
        }],
        cell_xfs: vec![
            CellXfInput::default(),
            CellXfInput {
                xf_id: Some(0),
                num_fmt_id: Some(0),
                apply_number_format: Some(true),
                ..Default::default()
            },
        ],
        num_fmts: {
            let mut m = HashMap::new();
            m.insert(164, "#,##0".to_string());
            m
        },
        ..Default::default()
    };

    let fmt = &resolve_styles(&input)[1];
    assert_eq!(fmt.number_format.as_deref(), Some("General"));
}

#[test]
fn present_number_format_zero_preserves_general_override_without_apply_flag() {
    let input = StyleInput {
        cell_style_xfs: vec![CellXfInput {
            num_fmt_id: Some(164),
            ..Default::default()
        }],
        cell_xfs: vec![
            CellXfInput::default(),
            CellXfInput {
                xf_id: Some(0),
                num_fmt_id: Some(0),
                ..Default::default()
            },
        ],
        num_fmts: {
            let mut m = HashMap::new();
            m.insert(164, "#,##0".to_string());
            m
        },
        ..Default::default()
    };

    let fmt = &resolve_styles(&input)[1];
    assert_eq!(fmt.number_format.as_deref(), Some("General"));
}

#[test]
fn present_fill_zero_without_apply_flag_inherits_base_fill() {
    let input = StyleInput {
        cell_style_xfs: vec![CellXfInput {
            fill_id: Some(1),
            ..Default::default()
        }],
        cell_xfs: vec![
            CellXfInput::default(),
            CellXfInput {
                xf_id: Some(0),
                fill_id: Some(0),
                ..Default::default()
            },
        ],
        fills: vec![
            FillInput {
                fill_type: "pattern".to_string(),
                pattern_type: "none".to_string(),
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
        ..Default::default()
    };

    let fmt = &resolve_styles(&input)[1];
    let fill = fmt.fill.as_ref().expect("base fill");
    assert_eq!(fill.pattern_type.as_deref(), Some("solid"));
    assert_eq!(fill.background_color.as_deref(), Some("#FF0000"));
}

#[test]
fn present_fill_zero_without_apply_flag_does_not_materialize_no_fill() {
    let input = StyleInput {
        cell_xfs: vec![
            CellXfInput::default(),
            CellXfInput {
                fill_id: Some(0),
                ..Default::default()
            },
        ],
        fills: vec![FillInput {
            fill_type: "pattern".to_string(),
            pattern_type: "none".to_string(),
            ..Default::default()
        }],
        ..Default::default()
    };

    let fmt = &resolve_styles(&input)[1];
    assert!(fmt.fill.is_none());
}

#[test]
fn applied_fill_zero_preserves_no_fill_override() {
    let input = StyleInput {
        cell_style_xfs: vec![CellXfInput {
            fill_id: Some(1),
            ..Default::default()
        }],
        cell_xfs: vec![
            CellXfInput::default(),
            CellXfInput {
                xf_id: Some(0),
                fill_id: Some(0),
                apply_fill: Some(true),
                ..Default::default()
            },
        ],
        fills: vec![
            FillInput {
                fill_type: "pattern".to_string(),
                pattern_type: "none".to_string(),
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
        ..Default::default()
    };

    let fmt = &resolve_styles(&input)[1];
    let fill = fmt.fill.as_ref().expect("explicit no-fill override");
    assert_eq!(fill.pattern_type.as_deref(), Some("none"));
    assert!(fill.background_color.is_none());
}

#[test]
fn applied_alignment_defaults_block_base_alignment() {
    let input = StyleInput {
        cell_style_xfs: vec![CellXfInput {
            alignment: Some(AlignmentInput {
                horizontal: Some("right".to_string()),
                vertical: Some("top".to_string()),
                wrap_text: Some(true),
                text_rotation: Some(45),
                indent: Some(3),
                shrink_to_fit: Some(true),
                reading_order: Some(2),
                auto_indent: Some(true),
                relative_indent: Some(2),
                justify_last_line: Some(true),
            }),
            ..Default::default()
        }],
        cell_xfs: vec![
            CellXfInput::default(),
            CellXfInput {
                xf_id: Some(0),
                apply_alignment: Some(true),
                alignment: Some(AlignmentInput {
                    vertical: Some("center".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let alignment = resolve_styles(&input)[1].alignment.clone().unwrap();
    assert_eq!(alignment.horizontal.as_deref(), Some("general"));
    assert_eq!(alignment.vertical.as_deref(), Some("middle"));
    assert_eq!(alignment.wrap_text, Some(false));
    assert_eq!(alignment.rotation, Some(0));
    assert_eq!(alignment.indent, Some(0));
    assert_eq!(alignment.shrink_to_fit, Some(false));
    assert_eq!(alignment.reading_order.as_deref(), Some("context"));
    assert_eq!(alignment.auto_indent, Some(false));
    assert_eq!(alignment.relative_indent, Some(0));
    assert_eq!(alignment.justify_last_line, Some(false));
}

#[test]
fn applied_font_false_effects_block_base_font() {
    let input = StyleInput {
        cell_style_xfs: vec![CellXfInput {
            font_id: Some(1),
            ..Default::default()
        }],
        cell_xfs: vec![
            CellXfInput::default(),
            CellXfInput {
                xf_id: Some(0),
                font_id: Some(2),
                apply_font: Some(true),
                ..Default::default()
            },
        ],
        fonts: vec![
            FontInput::default(),
            FontInput {
                name: "Base".to_string(),
                bold: true,
                italic: true,
                underline: Some("single".to_string()),
                strikethrough: true,
                vert_align: Some("superscript".to_string()),
                ..Default::default()
            },
            FontInput {
                name: "Direct".to_string(),
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let font = resolve_styles(&input)[1].font.clone().unwrap();
    assert_eq!(font.name.as_deref(), Some("Direct"));
    assert_eq!(font.bold, Some(false));
    assert_eq!(font.italic, Some(false));
    assert_eq!(font.underline.as_deref(), Some("none"));
    assert_eq!(font.strikethrough, Some(false));
    assert_eq!(font.superscript, Some(false));
    assert_eq!(font.subscript, Some(false));
    assert_eq!(font.vertical_align.as_deref(), Some("baseline"));
}
