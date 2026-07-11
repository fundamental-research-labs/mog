use super::*;
use crate::write::from_parse_output::styles::build_styles;
use ooxml_types::styles::{FillDef, PatternType};

#[test]
fn semantic_theme_color_names_and_indices_lower_to_ooxml_theme_ids() {
    let cases = [
        ("theme:light1", 0),
        ("theme:dark1", 1),
        ("theme:light2", 2),
        ("theme:dark2", 3),
        ("theme:accent1", 4),
        ("theme:accent6", 9),
        ("theme:hyperlink", 10),
        ("theme:followedHyperlink", 11),
        ("theme:7", 7),
    ];

    for (semantic, id) in cases {
        assert_eq!(
            hex_to_color_def(semantic),
            ColorDef::Theme { id, tint: None },
            "incorrect theme mapping for {semantic}"
        );
    }

    assert_eq!(
        hex_to_color_def("theme:accent2:0.3999755851924192"),
        ColorDef::Theme {
            id: 5,
            tint: Some("0.3999755851924192".to_string()),
        }
    );
}

#[test]
fn theme_colors_lower_for_fonts_pattern_fills_borders_and_gradient_stops() {
    let writer = build_styles(&[DocumentFormat {
        font: Some(FontFormat {
            color: Some("theme:accent1:-0.2".to_string()),
            color_tint: Some(0.25),
            ..Default::default()
        }),
        fill: Some(FillFormat {
            pattern_type: Some("darkGrid".to_string()),
            pattern_foreground_color: Some("theme:6".to_string()),
            background_color: Some("theme:dark2:-0.1".to_string()),
            ..Default::default()
        }),
        border: Some(BorderFormat {
            top: Some(DomainBorderSide {
                style: "thin".to_string(),
                color: Some("theme:followedHyperlink:0.4".to_string()),
                color_tint: Some(0.0),
            }),
            ..Default::default()
        }),
        ..Default::default()
    }]);

    let xf = &writer.cell_xfs[0];
    assert_eq!(
        writer.fonts[xf.font_id.unwrap() as usize].color,
        Some(ColorDef::Theme {
            id: 4,
            tint: Some("0.25".to_string()),
        })
    );
    assert_eq!(
        writer.fills[xf.fill_id.unwrap() as usize],
        FillDef::Pattern {
            pattern_type: Some(PatternType::DarkGrid),
            fg_color: Some(ColorDef::Theme { id: 6, tint: None }),
            bg_color: Some(ColorDef::Theme {
                id: 3,
                tint: Some("-0.1".to_string()),
            }),
        }
    );
    assert_eq!(
        writer.borders[xf.border_id.unwrap() as usize]
            .top
            .as_ref()
            .and_then(|side| side.color.clone()),
        Some(ColorDef::Theme { id: 11, tint: None })
    );

    let gradient_writer = build_styles(&[DocumentFormat {
        fill: Some(FillFormat {
            gradient_fill: Some(domain_types::GradientFillFormat {
                gradient_type: "linear".to_string(),
                degree: Some(45.0),
                center: None,
                stops: vec![
                    domain_types::GradientStopFormat {
                        position: 0.0,
                        color: "theme:accent3:-0.35".to_string(),
                    },
                    domain_types::GradientStopFormat {
                        position: 1.0,
                        color: "#AABBCC".to_string(),
                    },
                ],
            }),
            ..Default::default()
        }),
        ..Default::default()
    }]);
    let gradient_xf = &gradient_writer.cell_xfs[0];
    let FillDef::Gradient { stops, .. } =
        &gradient_writer.fills[gradient_xf.fill_id.unwrap() as usize]
    else {
        panic!("expected gradient fill");
    };
    assert_eq!(
        stops[0].color,
        ColorDef::Theme {
            id: 6,
            tint: Some("-0.35".to_string()),
        }
    );
    assert_eq!(
        stops[1].color,
        ColorDef::Rgb {
            val: "FFAABBCC".to_string(),
            tint: None,
        }
    );
}

#[test]
fn xlsx_reimport_preserves_symbolic_theme_colors_across_static_cell_styles() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![
            DomainCellData {
                row: 0,
                col: 0,
                value: DomainValue::Number(FiniteF64::new(1.0).unwrap()),
                style_id: Some(0),
                ..Default::default()
            },
            DomainCellData {
                row: 1,
                col: 0,
                value: DomainValue::Number(FiniteF64::new(2.0).unwrap()),
                style_id: Some(1),
                ..Default::default()
            },
        ],
        ..Default::default()
    }]);
    output.style_palette = vec![
        DocumentFormat {
            font: Some(FontFormat {
                color: Some("theme:accent1".to_string()),
                color_tint: Some(0.25),
                ..Default::default()
            }),
            fill: Some(FillFormat {
                pattern_type: Some("darkGrid".to_string()),
                pattern_foreground_color: Some("theme:accent3".to_string()),
                pattern_foreground_color_tint: Some(0.1),
                background_color: Some("theme:dark2".to_string()),
                background_color_tint: Some(-0.1),
                ..Default::default()
            }),
            border: Some(BorderFormat {
                top: Some(DomainBorderSide {
                    style: "thin".to_string(),
                    color: Some("theme:hyperlink".to_string()),
                    color_tint: Some(0.3),
                }),
                ..Default::default()
            }),
            ..Default::default()
        },
        DocumentFormat {
            fill: Some(FillFormat {
                gradient_fill: Some(domain_types::GradientFillFormat {
                    gradient_type: "linear".to_string(),
                    degree: Some(45.0),
                    center: None,
                    stops: vec![
                        domain_types::GradientStopFormat {
                            position: 0.0,
                            color: "theme:accent4:0.4".to_string(),
                        },
                        domain_types::GradientStopFormat {
                            position: 1.0,
                            color: "theme:accent5".to_string(),
                        },
                    ],
                }),
                ..Default::default()
            }),
            ..Default::default()
        },
    ];

    let bytes = write_xlsx_from_parse_output(&output).expect("export themed styles");
    let (reimported, _) = crate::parse_xlsx_to_output(&bytes).expect("reimport themed styles");

    let combined = &reimported.style_palette[0];
    let font = combined.font.as_ref().unwrap();
    assert_eq!(font.color.as_deref(), Some("theme:accent1"));
    assert_eq!(font.color_tint, Some(0.25));
    let pattern = combined.fill.as_ref().unwrap();
    assert_eq!(
        pattern.pattern_foreground_color.as_deref(),
        Some("theme:accent3")
    );
    assert_eq!(pattern.pattern_foreground_color_tint, Some(0.1));
    assert_eq!(pattern.background_color.as_deref(), Some("theme:dark2"));
    assert_eq!(pattern.background_color_tint, Some(-0.1));
    let border = combined.border.as_ref().unwrap().top.as_ref().unwrap();
    assert_eq!(border.color.as_deref(), Some("theme:hyperlink"));
    assert_eq!(border.color_tint, Some(0.3));

    let gradient = reimported.style_palette[1]
        .fill
        .as_ref()
        .unwrap()
        .gradient_fill
        .as_ref()
        .unwrap();
    assert_eq!(gradient.stops[0].color, "theme:accent4:0.4");
    assert_eq!(gradient.stops[1].color, "theme:accent5");
}
