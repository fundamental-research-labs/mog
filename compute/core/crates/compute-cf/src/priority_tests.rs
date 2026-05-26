use super::*;
use crate::types::{
    CFBorderStyle, CFDataBarDirection, CFIconSetName, CFMatchResult, CFUnderlineType,
    CfRenderStyle, ColorScaleResult, DataBarResult, IconResult,
};
use value_types::Color;

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

fn style_with_bg(color: &str) -> CfRenderStyle {
    CfRenderStyle {
        background_color: Some(Color::from_hex(color).unwrap()),
        ..Default::default()
    }
}

fn style_with_font(color: &str) -> CfRenderStyle {
    CfRenderStyle {
        font_color: Some(Color::from_hex(color).unwrap()),
        ..Default::default()
    }
}

fn make_data_bar_result() -> DataBarResult {
    DataBarResult {
        fill_percent: 50.0,
        color: Color::rgb(0, 128, 255),
        gradient: false,
        axis_position: 0.0,
        is_negative: false,
        negative_color: None,
        show_value: true,
        show_axis: false,
        border_color: None,
        negative_border_color: None,
        show_border: false,
        direction: CFDataBarDirection::LeftToRight,
        axis_color: None,
    }
}

fn make_color_scale_result(r: u8, g: u8, b: u8) -> ColorScaleResult {
    ColorScaleResult {
        color: Color::rgb(r, g, b),
    }
}

fn make_icon_result(index: u8) -> IconResult {
    IconResult {
        set_name: CFIconSetName::ThreeArrows,
        icon_index: index,
        show_value: true,
    }
}

// -----------------------------------------------------------------------
// merge_styles: both empty
// -----------------------------------------------------------------------

#[test]
fn test_merge_styles_both_empty() {
    let lower = CfRenderStyle::default();
    let higher = CfRenderStyle::default();
    let merged = merge_styles(lower, higher);
    assert_eq!(merged, CfRenderStyle::default());
}

// -----------------------------------------------------------------------
// merge_styles: only higher has values
// -----------------------------------------------------------------------

#[test]
fn test_merge_styles_only_higher() {
    let lower = CfRenderStyle::default();
    let higher = CfRenderStyle {
        background_color: Some(Color::from_hex("#FF0000").unwrap()),
        bold: Some(true),
        ..Default::default()
    };
    let merged = merge_styles(lower, higher);
    assert_eq!(
        merged.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    assert_eq!(merged.bold, Some(true));
    assert_eq!(merged.font_color, None);
}

// -----------------------------------------------------------------------
// merge_styles: only lower has values
// -----------------------------------------------------------------------

#[test]
fn test_merge_styles_only_lower() {
    let lower = CfRenderStyle {
        font_color: Some(Color::from_hex("#0000FF").unwrap()),
        italic: Some(true),
        ..Default::default()
    };
    let higher = CfRenderStyle::default();
    let merged = merge_styles(lower, higher);
    assert_eq!(merged.font_color, Some(Color::from_hex("#0000FF").unwrap()));
    assert_eq!(merged.italic, Some(true));
    assert_eq!(merged.background_color, None);
}

// -----------------------------------------------------------------------
// merge_styles: both have values, higher wins
// -----------------------------------------------------------------------

#[test]
fn test_merge_styles_higher_wins_on_overlap() {
    let lower = CfRenderStyle {
        background_color: Some(Color::from_hex("#0000FF").unwrap()),
        bold: Some(false),
        font_color: Some(Color::from_hex("#111111").unwrap()),
        ..Default::default()
    };
    let higher = CfRenderStyle {
        background_color: Some(Color::from_hex("#FF0000").unwrap()),
        bold: Some(true),
        ..Default::default()
    };
    let merged = merge_styles(lower, higher);
    // higher wins for overlapping fields
    assert_eq!(
        merged.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    assert_eq!(merged.bold, Some(true));
    // lower fills in non-overlapping fields
    assert_eq!(merged.font_color, Some(Color::from_hex("#111111").unwrap()));
}

// -----------------------------------------------------------------------
// merge_styles: partial overlap
// -----------------------------------------------------------------------

#[test]
fn test_merge_styles_partial_overlap() {
    let lower = CfRenderStyle {
        background_color: Some(Color::from_hex("#AAA").unwrap()),
        italic: Some(true),
        underline_type: Some(CFUnderlineType::Single),
        ..Default::default()
    };
    let higher = CfRenderStyle {
        font_color: Some(Color::from_hex("#BBB").unwrap()),
        bold: Some(true),
        underline_type: Some(CFUnderlineType::Double),
        ..Default::default()
    };
    let merged = merge_styles(lower, higher);
    // lower's exclusive
    assert_eq!(
        merged.background_color,
        Some(Color::from_hex("#AAA").unwrap())
    );
    assert_eq!(merged.italic, Some(true));
    // higher's exclusive
    assert_eq!(merged.font_color, Some(Color::from_hex("#BBB").unwrap()));
    assert_eq!(merged.bold, Some(true));
    // overlap: higher wins
    assert_eq!(merged.underline_type, Some(CFUnderlineType::Double));
}

// -----------------------------------------------------------------------
// merge_styles: all fields populated
// -----------------------------------------------------------------------

#[test]
fn test_merge_styles_all_fields() {
    let lower = CfRenderStyle {
        background_color: Some(Color::from_hex("#000").unwrap()),
        font_color: Some(Color::from_hex("#000").unwrap()),
        bold: Some(false),
        italic: Some(false),
        underline_type: Some(CFUnderlineType::None),
        strikethrough: Some(false),
        border_color: Some(Color::from_hex("#000").unwrap()),
        border_style: Some(CFBorderStyle::Thin),
        number_format: Some("0.00".to_string()),
        ..Default::default()
    };
    let higher = CfRenderStyle {
        background_color: Some(Color::from_hex("#FFF").unwrap()),
        font_color: Some(Color::from_hex("#FFF").unwrap()),
        bold: Some(true),
        italic: Some(true),
        underline_type: Some(CFUnderlineType::Double),
        strikethrough: Some(true),
        border_color: Some(Color::from_hex("#FFF").unwrap()),
        border_style: Some(CFBorderStyle::Thick),
        number_format: Some("#,##0".to_string()),
        ..Default::default()
    };
    let merged = merge_styles(lower, higher);
    assert_eq!(
        merged.background_color,
        Some(Color::from_hex("#FFF").unwrap())
    );
    assert_eq!(merged.font_color, Some(Color::from_hex("#FFF").unwrap()));
    assert_eq!(merged.bold, Some(true));
    assert_eq!(merged.italic, Some(true));
    assert_eq!(merged.underline_type, Some(CFUnderlineType::Double));
    assert_eq!(merged.strikethrough, Some(true));
    assert_eq!(merged.border_color, Some(Color::from_hex("#FFF").unwrap()));
    assert_eq!(merged.border_style, Some(CFBorderStyle::Thick));
}

// -----------------------------------------------------------------------
// merge_styles: number_format falls through from lower
// -----------------------------------------------------------------------

#[test]
fn test_merge_styles_number_format_falls_through() {
    let lower = CfRenderStyle {
        number_format: Some("0.00".to_string()),
        ..Default::default()
    };
    let higher = CfRenderStyle::default();
    let merged = merge_styles(lower, higher);
    assert_eq!(merged.number_format, Some("0.00".to_string()));
}

// -----------------------------------------------------------------------
// merge_results: both empty
// -----------------------------------------------------------------------

#[test]
fn test_merge_results_both_empty() {
    let higher = CFMatchResult::default();
    let lower = CFMatchResult::default();
    let merged = merge_results(higher, lower);
    assert!(!merged.has_any());
}

// -----------------------------------------------------------------------
// merge_results: only higher has style
// -----------------------------------------------------------------------

#[test]
fn test_merge_results_only_higher_has_style() {
    let higher = CFMatchResult {
        style: Some(style_with_bg("#FF0000")),
        ..Default::default()
    };
    let lower = CFMatchResult::default();
    let merged = merge_results(higher, lower);
    assert_eq!(
        merged.style.as_ref().unwrap().background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
}

// -----------------------------------------------------------------------
// merge_results: only lower has style
// -----------------------------------------------------------------------

#[test]
fn test_merge_results_only_lower_has_style() {
    let higher = CFMatchResult::default();
    let lower = CFMatchResult {
        style: Some(style_with_bg("#0000FF")),
        ..Default::default()
    };
    let merged = merge_results(higher, lower);
    assert_eq!(
        merged.style.as_ref().unwrap().background_color,
        Some(Color::from_hex("#0000FF").unwrap())
    );
}

// -----------------------------------------------------------------------
// merge_results: both have styles, higher wins on overlap
// -----------------------------------------------------------------------

#[test]
fn test_merge_results_both_have_styles() {
    let higher = CFMatchResult {
        style: Some(style_with_bg("#FF0000")),
        ..Default::default()
    };
    let lower = CFMatchResult {
        style: Some(CfRenderStyle {
            background_color: Some(Color::from_hex("#0000FF").unwrap()),
            font_color: Some(Color::from_hex("#00FF00").unwrap()),
            ..Default::default()
        }),
        ..Default::default()
    };
    let merged = merge_results(higher, lower);
    let style = merged.style.unwrap();
    // higher wins for background_color
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    // lower fills in font_color
    assert_eq!(style.font_color, Some(Color::from_hex("#00FF00").unwrap()));
}

// -----------------------------------------------------------------------
// merge_results: data_bar precedence (higher wins)
// -----------------------------------------------------------------------

#[test]
fn test_merge_results_data_bar_higher_wins() {
    let db1 = make_data_bar_result();
    let mut db2 = make_data_bar_result();
    db2.fill_percent = 75.0;

    let higher = CFMatchResult {
        data_bar: Some(db1),
        ..Default::default()
    };
    let lower = CFMatchResult {
        data_bar: Some(db2),
        ..Default::default()
    };
    let merged = merge_results(higher, lower);
    assert_eq!(merged.data_bar.unwrap().fill_percent, 50.0); // higher's value
}

#[test]
fn test_merge_results_data_bar_falls_through() {
    let db = make_data_bar_result();
    let higher = CFMatchResult::default();
    let lower = CFMatchResult {
        data_bar: Some(db),
        ..Default::default()
    };
    let merged = merge_results(higher, lower);
    assert!(merged.data_bar.is_some()); // lower's data_bar used
}

// -----------------------------------------------------------------------
// merge_results: color_scale precedence (higher wins)
// -----------------------------------------------------------------------

#[test]
fn test_merge_results_color_scale_higher_wins() {
    let cs1 = make_color_scale_result(255, 0, 0);
    let cs2 = make_color_scale_result(0, 255, 0);

    let higher = CFMatchResult {
        color_scale: Some(cs1),
        ..Default::default()
    };
    let lower = CFMatchResult {
        color_scale: Some(cs2),
        ..Default::default()
    };
    let merged = merge_results(higher, lower);
    assert_eq!(merged.color_scale.unwrap().color, Color::rgb(255, 0, 0));
}

#[test]
fn test_merge_results_color_scale_falls_through() {
    let cs = make_color_scale_result(0, 0, 255);
    let higher = CFMatchResult::default();
    let lower = CFMatchResult {
        color_scale: Some(cs),
        ..Default::default()
    };
    let merged = merge_results(higher, lower);
    assert!(merged.color_scale.is_some());
}

// -----------------------------------------------------------------------
// merge_results: icon precedence (higher wins)
// -----------------------------------------------------------------------

#[test]
fn test_merge_results_icon_higher_wins() {
    let icon1 = make_icon_result(0);
    let icon2 = make_icon_result(2);

    let higher = CFMatchResult {
        icon: Some(icon1),
        ..Default::default()
    };
    let lower = CFMatchResult {
        icon: Some(icon2),
        ..Default::default()
    };
    let merged = merge_results(higher, lower);
    assert_eq!(merged.icon.unwrap().icon_index, 0);
}

#[test]
fn test_merge_results_icon_falls_through() {
    let icon = make_icon_result(1);
    let higher = CFMatchResult::default();
    let lower = CFMatchResult {
        icon: Some(icon),
        ..Default::default()
    };
    let merged = merge_results(higher, lower);
    assert!(merged.icon.is_some());
    assert_eq!(merged.icon.unwrap().icon_index, 1);
}

// -----------------------------------------------------------------------
// merge_results: mixed -- style + data_bar from different priorities
// -----------------------------------------------------------------------

#[test]
fn test_merge_results_mixed_style_and_data_bar() {
    let higher = CFMatchResult {
        style: Some(style_with_bg("#FF0000")),
        ..Default::default()
    };
    let lower = CFMatchResult {
        style: Some(style_with_font("#00FF00")),
        data_bar: Some(make_data_bar_result()),
        ..Default::default()
    };
    let merged = merge_results(higher, lower);

    // Style merged: bg from higher, font from lower
    let style = merged.style.unwrap();
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
    assert_eq!(style.font_color, Some(Color::from_hex("#00FF00").unwrap()));

    // Data bar from lower (higher has none)
    assert!(merged.data_bar.is_some());
}

// -----------------------------------------------------------------------
// merge_results: number_format merge
// -----------------------------------------------------------------------

#[test]
fn test_merge_results_number_format_from_lower() {
    let higher = CFMatchResult {
        style: Some(CfRenderStyle {
            background_color: Some(Color::from_hex("#FF0000").unwrap()),
            number_format: None,
            ..Default::default()
        }),
        ..Default::default()
    };
    let lower = CFMatchResult {
        style: Some(CfRenderStyle {
            number_format: Some("0.00".to_string()),
            ..Default::default()
        }),
        ..Default::default()
    };
    let merged = merge_results(higher, lower);
    let style = merged.style.unwrap();
    assert_eq!(style.number_format, Some("0.00".to_string()));
    // higher's background_color is preserved
    assert_eq!(
        style.background_color,
        Some(Color::from_hex("#FF0000").unwrap())
    );
}

// -----------------------------------------------------------------------
// Three-way merge (chained, simulating evaluate_rules fold)
// -----------------------------------------------------------------------

#[test]
fn test_three_way_merge_chain() {
    // r1 = highest priority: bold only
    let r1 = CFMatchResult {
        style: Some(CfRenderStyle {
            bold: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };
    // r2 = middle priority: italic + bold(false)
    let r2 = CFMatchResult {
        style: Some(CfRenderStyle {
            bold: Some(false),
            italic: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };
    // r3 = lowest priority: strikethrough + italic(false)
    let r3 = CFMatchResult {
        style: Some(CfRenderStyle {
            italic: Some(false),
            strikethrough: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };

    // Chain: merge(r1, r2) then merge(result, r3)
    let merged_12 = merge_results(r1, r2);
    let merged_123 = merge_results(merged_12, r3);

    let style = merged_123.style.unwrap();
    // bold from r1 (highest priority): true
    assert_eq!(style.bold, Some(true));
    // italic from r2 (first to set it): true
    assert_eq!(style.italic, Some(true));
    // strikethrough from r3 (only one to set it): true
    assert_eq!(style.strikethrough, Some(true));
}

#[test]
fn test_three_way_merge_visual_exclusivity() {
    // r1 has color_scale, r2 has different color_scale, r3 has data_bar
    let r1 = CFMatchResult {
        color_scale: Some(ColorScaleResult {
            color: Color::rgb(255, 0, 0),
        }),
        ..Default::default()
    };
    let r2 = CFMatchResult {
        color_scale: Some(ColorScaleResult {
            color: Color::rgb(0, 255, 0),
        }),
        ..Default::default()
    };
    let r3 = CFMatchResult {
        data_bar: Some(DataBarResult {
            fill_percent: 50.0,
            color: Color::rgb(0, 0, 255),
            gradient: false,
            axis_position: 0.0,
            is_negative: false,
            negative_color: None,
            show_value: true,
            show_axis: false,
            border_color: None,
            negative_border_color: None,
            show_border: false,
            direction: CFDataBarDirection::LeftToRight,
            axis_color: None,
        }),
        ..Default::default()
    };

    let merged_12 = merge_results(r1, r2);
    let merged_123 = merge_results(merged_12, r3);

    // color_scale from r1 (first/highest): red
    assert_eq!(merged_123.color_scale.unwrap().color, Color::rgb(255, 0, 0));
    // data_bar from r3 (only one with it): present
    assert!(merged_123.data_bar.is_some());
}
