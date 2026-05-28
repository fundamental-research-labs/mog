use std::collections::HashMap;

use super::*;

fn make_input() -> StyleInput {
    StyleInput {
        cell_style_xfs: vec![
            // cellStyleXfs[0]: Normal style — default font/fill/border/numFmt
            CellXfInput {
                num_fmt_id: Some(0),
                font_id: Some(0),
                fill_id: Some(0),
                border_id: Some(0),
                ..Default::default()
            },
        ],
        num_fmts: {
            let mut m = HashMap::new();
            m.insert(164, "#,##0.00_);(#,##0.00)".to_string());
            m
        },
        fonts: vec![
            // Font 0: default with minor scheme
            FontInput {
                name: "Calibri".to_string(),
                size: 11.0,
                bold: false,
                italic: false,
                underline: Some("none".to_string()),
                strikethrough: false,
                color: None,
                scheme: Some("minor".to_string()),
                vert_align: None,
                condense: None,
                extend: None,
                outline: None,
                shadow: None,
                charset: None,
                family: None,
            },
            // Font 1: bold with color
            FontInput {
                name: "Arial".to_string(),
                size: 14.0,
                bold: true,
                italic: true,
                underline: Some("single".to_string()),
                strikethrough: false,
                color: Some(ColorInput {
                    rgb: Some("FFFF0000".to_string()),
                    theme: None,
                    tint: None,
                    indexed: None,
                    auto: false,
                }),
                scheme: None,
                vert_align: Some("superscript".to_string()),
                condense: None,
                extend: None,
                outline: None,
                shadow: None,
                charset: None,
                family: None,
            },
        ],
        fills: vec![
            // Fill 0: none
            FillInput {
                fill_type: "pattern".to_string(),
                pattern_type: "none".to_string(),
                fg_color: None,
                bg_color: None,
                gradient: None,
            },
            // Fill 1: gray125 (standard padding)
            FillInput {
                fill_type: "pattern".to_string(),
                pattern_type: "gray125".to_string(),
                fg_color: None,
                bg_color: None,
                gradient: None,
            },
            // Fill 2: solid blue
            FillInput {
                fill_type: "pattern".to_string(),
                pattern_type: "solid".to_string(),
                fg_color: Some(ColorInput {
                    rgb: Some("FF4472C4".to_string()),
                    theme: None,
                    tint: None,
                    indexed: None,
                    auto: false,
                }),
                bg_color: None,
                gradient: None,
            },
        ],
        borders: vec![
            // Border 0: none
            BorderInput::default(),
            // Border 1: thin bottom
            BorderInput {
                bottom: Some(BorderSideInput {
                    style: "thin".to_string(),
                    color: Some(ColorInput {
                        rgb: Some("FF000000".to_string()),
                        ..Default::default()
                    }),
                }),
                ..Default::default()
            },
        ],
        cell_xfs: vec![
            // XF 0: default
            CellXfInput {
                num_fmt_id: Some(0),
                font_id: Some(0),
                fill_id: Some(0),
                border_id: Some(0),
                apply_number_format: Some(false),
                apply_font: Some(false),
                apply_fill: Some(false),
                apply_border: Some(false),
                apply_alignment: Some(false),
                apply_protection: Some(false),
                ..Default::default()
            },
            // XF 1: bold + blue fill + custom number format + alignment + protection + border
            CellXfInput {
                num_fmt_id: Some(164),
                font_id: Some(1),
                fill_id: Some(2),
                border_id: Some(1),
                apply_number_format: Some(true),
                apply_font: Some(true),
                apply_fill: Some(true),
                apply_border: Some(true),
                apply_alignment: Some(true),
                apply_protection: Some(true),
                alignment: Some(AlignmentInput {
                    horizontal: Some("center".to_string()),
                    vertical: Some("center".to_string()),
                    wrap_text: Some(true),
                    indent: Some(2),
                    ..Default::default()
                }),
                protection: Some(ProtectionInput {
                    locked: true,
                    hidden: true,
                }),
                ..Default::default()
            },
        ],
        theme_colors: vec![],
        major_font: None,
        minor_font: None,
    }
}

mod cache;
mod color;
mod components;
mod inheritance;
mod number_format;
mod public_api;
