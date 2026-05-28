use super::super::color::{apply_tint, normalize_rgb, resolve_color};
use super::super::{ColorInput, StyleInput};

#[test]
fn theme_color_resolution_with_palette() {
    let input = StyleInput {
        theme_colors: vec![
            "#000000".to_string(), // dk1 (palette 0)
            "#FFFFFF".to_string(), // lt1 (palette 1)
            "#44546A".to_string(), // dk2 (palette 2)
            "#E7E6E6".to_string(), // lt2 (palette 3)
            "#4472C4".to_string(), // accent1 (palette 4)
        ],
        ..Default::default()
    };

    // theme=0 → lt1 → palette[1] = #FFFFFF
    let color = ColorInput {
        theme: Some(0),
        ..Default::default()
    };
    assert_eq!(
        resolve_color(&color, &input.theme_colors).as_deref(),
        Some("#FFFFFF")
    );

    // theme=1 → dk1 → palette[0] = #000000
    let color = ColorInput {
        theme: Some(1),
        ..Default::default()
    };
    assert_eq!(
        resolve_color(&color, &input.theme_colors).as_deref(),
        Some("#000000")
    );

    // theme=4 → accent1 → palette[4] = #4472C4
    let color = ColorInput {
        theme: Some(4),
        ..Default::default()
    };
    assert_eq!(
        resolve_color(&color, &input.theme_colors).as_deref(),
        Some("#4472C4")
    );
}

#[test]
fn theme_color_with_tint() {
    let input = StyleInput {
        theme_colors: vec![
            "#000000".to_string(),
            "#FFFFFF".to_string(),
            "#44546A".to_string(),
            "#E7E6E6".to_string(),
            "#4472C4".to_string(), // accent1
        ],
        ..Default::default()
    };

    // theme=4 (accent1 = #4472C4) with positive tint → lighter
    let color = ColorInput {
        theme: Some(4),
        tint: Some(0.5),
        ..Default::default()
    };
    let result = resolve_color(&color, &input.theme_colors);
    assert!(result.is_some());
    let hex = result.unwrap();
    assert!(hex.starts_with('#'));
    assert_eq!(hex.len(), 7); // #RRGGBB
}

#[test]
fn theme_color_fallback_without_palette() {
    // No theme_colors provided — should fall back to symbolic reference
    let color = ColorInput {
        theme: Some(4),
        tint: Some(0.39997),
        ..Default::default()
    };
    assert_eq!(
        resolve_color(&color, &[]).as_deref(),
        Some("theme:accent1:0.39997")
    );

    let color_no_tint = ColorInput {
        theme: Some(0),
        ..Default::default()
    };
    assert_eq!(
        resolve_color(&color_no_tint, &[]).as_deref(),
        Some("theme:light1")
    );
}

#[test]
fn indexed_system_colors_resolve() {
    let foreground = ColorInput {
        indexed: Some(64),
        ..Default::default()
    };
    assert_eq!(resolve_color(&foreground, &[]).as_deref(), Some("#000000"));

    let background = ColorInput {
        indexed: Some(65),
        ..Default::default()
    };
    assert_eq!(resolve_color(&background, &[]).as_deref(), Some("#FFFFFF"));
}

#[test]
fn rgb_normalization() {
    assert_eq!(normalize_rgb("FFFF0000"), "#FF0000");
    assert_eq!(normalize_rgb("FF0000"), "#FF0000");
    assert_eq!(normalize_rgb("#FF0000"), "#FF0000");
    assert_eq!(normalize_rgb("00FF00"), "#00FF00");
}

#[test]
fn apply_tint_positive_lightens() {
    // White has L=1.0, tinting further stays white
    let result = apply_tint("#000000", 0.5);
    // Black (L=0) with tint 0.5 → L = 0*(1-0.5) + 0.5 = 0.5 → mid-gray
    assert_eq!(result.len(), 7);
    assert!(result.starts_with('#'));
    // Should be approximately #808080 (mid-gray)
    let hex = &result[1..];
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap();
    assert!(r > 100 && r < 140, "expected mid-gray, got R={}", r);
}

#[test]
fn apply_tint_negative_darkens() {
    // White with negative tint → darker
    let result = apply_tint("#FFFFFF", -0.5);
    let hex = &result[1..];
    let r = u8::from_str_radix(&hex[0..2], 16).unwrap();
    assert!(r > 100 && r < 140, "expected mid-gray, got R={}", r);
}
