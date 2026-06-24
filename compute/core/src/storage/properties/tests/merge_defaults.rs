use super::*;

#[test]
fn test_merge_formats_merges_partial_borders_per_edge_and_side_field() {
    use ooxml_types::styles::BorderStyle;

    let lower = CellFormat {
        borders: Some(CellBorders {
            top: Some(CellBorderSide {
                style: Some(BorderStyle::Thin),
                color: Some("#111111".to_string()),
                ..Default::default()
            }),
            right: Some(CellBorderSide {
                style: Some(BorderStyle::Medium),
                color: Some("#222222".to_string()),
                ..Default::default()
            }),
            diagonal_up: Some(true),
            outline: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };
    let higher = CellFormat {
        borders: Some(CellBorders {
            top: Some(CellBorderSide {
                color: Some("#333333".to_string()),
                ..Default::default()
            }),
            bottom: Some(CellBorderSide {
                style: Some(BorderStyle::Dashed),
                color: Some("#444444".to_string()),
                ..Default::default()
            }),
            diagonal_up: Some(false),
            ..Default::default()
        }),
        ..Default::default()
    };

    let merged = merge_formats(&lower, &higher);
    let borders = merged.borders.expect("merged borders");

    let top = borders.top.expect("top border preserved");
    assert_eq!(top.style, Some(BorderStyle::Thin));
    assert_eq!(top.color, Some("#333333".to_string()));

    let right = borders.right.expect("right border preserved");
    assert_eq!(right.style, Some(BorderStyle::Medium));
    assert_eq!(right.color, Some("#222222".to_string()));

    let bottom = borders.bottom.expect("bottom border applied");
    assert_eq!(bottom.style, Some(BorderStyle::Dashed));
    assert_eq!(bottom.color, Some("#444444".to_string()));

    assert_eq!(borders.diagonal_up, Some(false));
    assert_eq!(borders.outline, Some(true));
}
#[test]
fn test_merge_formats_empty_borders_patch_clears_all_borders() {
    use ooxml_types::styles::BorderStyle;

    let lower = CellFormat {
        borders: Some(CellBorders {
            top: Some(CellBorderSide {
                style: Some(BorderStyle::Thin),
                color: Some("#111111".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        }),
        ..Default::default()
    };
    let higher = CellFormat {
        borders: Some(CellBorders::default()),
        ..Default::default()
    };

    let merged = merge_formats(&lower, &higher);
    assert_eq!(merged.borders, Some(CellBorders::default()));
}

#[test]
fn test_merge_formats_no_fill_pattern_clears_lower_fill_fields() {
    use ooxml_types::styles::PatternType;

    let lower = CellFormat {
        background_color: Some("#FFFFFF".to_string()),
        background_color_tint: Some(0.25),
        pattern_type: Some(PatternType::Solid),
        pattern_foreground_color: Some("#000000".to_string()),
        pattern_foreground_color_tint: Some(-0.25),
        gradient_fill: Some(domain_types::GradientFillFormat {
            gradient_type: "linear".to_string(),
            degree: Some(45.0),
            center: None,
            stops: Vec::new(),
        }),
        ..Default::default()
    };
    let higher = CellFormat {
        pattern_type: Some(PatternType::None),
        ..Default::default()
    };

    let merged = merge_formats(&lower, &higher);
    assert_eq!(merged.pattern_type, Some(PatternType::None));
    assert!(merged.background_color.is_none());
    assert!(merged.background_color_tint.is_none());
    assert!(merged.pattern_foreground_color.is_none());
    assert!(merged.pattern_foreground_color_tint.is_none());
    assert!(merged.gradient_fill.is_none());
}

#[test]
fn test_merge_formats_solid_fill_patch_overrides_lower_no_fill_pattern() {
    use ooxml_types::styles::PatternType;

    let lower = CellFormat {
        pattern_type: Some(PatternType::None),
        ..Default::default()
    };
    let higher = CellFormat {
        background_color: Some("#FFF2CC".to_string()),
        pattern_type: Some(PatternType::Solid),
        ..Default::default()
    };

    let merged = merge_formats(&lower, &higher);

    assert_eq!(merged.pattern_type, Some(PatternType::Solid));
    assert_eq!(merged.background_color, Some("#FFF2CC".to_string()));
}

#[test]
fn test_merge_formats_preserves_extended_sparse_fields() {
    let lower = CellFormat {
        font_color_tint: Some(0.25),
        auto_indent: Some(true),
        background_color_tint: Some(-0.4),
        pattern_foreground_color_tint: Some(0.5),
        pivot_button: Some(true),
        ..Default::default()
    };
    let higher = CellFormat {
        auto_indent: Some(false),
        ..Default::default()
    };

    let merged = merge_formats(&lower, &higher);
    assert_eq!(merged.font_color_tint, Some(0.25));
    assert_eq!(merged.auto_indent, Some(false));
    assert_eq!(merged.background_color_tint, Some(-0.4));
    assert_eq!(merged.pattern_foreground_color_tint, Some(0.5));
    assert_eq!(merged.pivot_button, Some(true));
}

#[test]
fn test_cell_properties_serde_roundtrip() {
    let props = CellProperties {
        format: Some(CellFormat {
            bold: Some(true),
            font_size: Some(domain_types::FontSize::from_millipoints(14000)),
            ..Default::default()
        }),
        provenance: Some("ai-generated".to_string()),
        validation: None,
        connection_id: Some("conn-1".to_string()),
        ..Default::default()
    };

    let json = serde_json::to_string(&props).unwrap();
    let parsed: CellProperties = serde_json::from_str(&json).unwrap();
    assert_eq!(props, parsed);
}

#[test]
fn test_cell_format_serde_camel_case() {
    let fmt = CellFormat {
        font_family: Some("Arial".to_string()),
        font_size: Some(domain_types::FontSize::from_millipoints(12000)),
        horizontal_align: Some(ooxml_types::styles::HorizontalAlign::Center),
        wrap_text: Some(true),
        ..Default::default()
    };

    let json = serde_json::to_string(&fmt).unwrap();
    // Verify camelCase in JSON
    assert!(json.contains("fontFamily"));
    assert!(json.contains("fontSize"));
    assert!(json.contains("horizontalAlign"));
    assert!(json.contains("wrapText"));
    // Should NOT contain snake_case
    assert!(!json.contains("font_family"));
    assert!(!json.contains("font_size"));

    let parsed: CellFormat = serde_json::from_str(&json).unwrap();
    assert_eq!(fmt, parsed);
}

#[test]
fn test_default_format_values() {
    let def = default_format();
    assert_eq!(def.font_family, Some("Calibri".to_string()));
    assert_eq!(
        def.font_size,
        Some(domain_types::FontSize::from_millipoints(11000))
    );
    assert_eq!(def.font_color, Some("#000000".to_string()));
    assert_eq!(def.bold, Some(false));
    assert_eq!(def.italic, Some(false));
    assert_eq!(def.locked, Some(true));
    assert_eq!(def.hidden, Some(false));
    assert!(def.number_format.is_none());
    assert!(def.background_color.is_none());
}

#[test]
fn test_merge_formats_higher_wins() {
    let lower = CellFormat {
        bold: Some(true),
        font_size: Some(domain_types::FontSize::from_millipoints(10000)),
        ..Default::default()
    };
    let higher = CellFormat {
        bold: Some(false),
        italic: Some(true),
        ..Default::default()
    };

    let merged = merge_formats(&lower, &higher);
    assert_eq!(merged.bold, Some(false)); // higher wins
    assert_eq!(
        merged.font_size,
        Some(domain_types::FontSize::from_millipoints(10000))
    ); // from lower
    assert_eq!(merged.italic, Some(true)); // from higher
}
