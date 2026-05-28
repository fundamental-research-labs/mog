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
            FillInput::default(),
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
            FillInput::default(),
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
