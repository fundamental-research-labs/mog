use super::super::components::{resolve_alignment, resolve_border};
use super::super::{
    AlignmentInput, BorderInput, BorderSideInput, CellXfInput, ColorInput, FontInput, StyleInput,
    resolve_styles,
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

    let bf = resolve_border(&border, &[]).expect("should resolve border");
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
    let bf = resolve_border(&absent, &[]).expect("has a diagonal side");
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
    let bf = resolve_border(&explicit_false, &[]).expect("has a diagonal side");
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
    let bf = resolve_border(&asymmetric, &[]).expect("has a diagonal side");
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
