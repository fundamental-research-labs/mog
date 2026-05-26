use super::*;
use value_types::Color;

use crate::types::CFIconSetName;

#[test]
fn test_data_bar_presets_count() {
    assert_eq!(data_bar_presets().len(), 8);
}

#[test]
fn test_color_scale_presets_count() {
    assert_eq!(color_scale_presets().len(), 10);
}

#[test]
fn test_icon_set_preset_names_count() {
    assert_eq!(icon_set_preset_names().len(), 20);
}

#[test]
fn test_data_bar_blue_gradient() {
    let presets = data_bar_presets();
    let blue_gradient = &presets[0];
    assert_eq!(
        blue_gradient.positive_color,
        Color::from_hex("#638EC6").unwrap()
    );
    assert_eq!(
        blue_gradient.negative_color,
        Some(Color::from_hex("#FF555A").unwrap())
    );
    assert!(blue_gradient.gradient);
    assert!(blue_gradient.show_value);
    assert_eq!(
        blue_gradient.axis_position,
        CFDataBarAxisPosition::Automatic
    );
    assert_eq!(blue_gradient.direction, CFDataBarDirection::LeftToRight);
    assert!(!blue_gradient.show_border);
    assert_eq!(blue_gradient.min_point.value_type, CFValueType::Min);
    assert_eq!(blue_gradient.max_point.value_type, CFValueType::Max);
}

#[test]
fn test_data_bar_blue_solid() {
    let presets = data_bar_presets();
    let blue_solid = &presets[1];
    assert_eq!(
        blue_solid.positive_color,
        Color::from_hex("#638EC6").unwrap()
    );
    assert!(!blue_solid.gradient);
}

#[test]
fn test_data_bar_red_gradient_has_blue_negative() {
    let presets = data_bar_presets();
    let red_gradient = &presets[4];
    assert_eq!(
        red_gradient.positive_color,
        Color::from_hex("#F8696B").unwrap()
    );
    assert_eq!(
        red_gradient.negative_color,
        Some(Color::from_hex("#638EC6").unwrap())
    );
    assert!(red_gradient.gradient);
}

#[test]
fn test_data_bar_orange_solid() {
    let presets = data_bar_presets();
    let orange_solid = &presets[7];
    assert_eq!(
        orange_solid.positive_color,
        Color::from_hex("#FFAB46").unwrap()
    );
    assert_eq!(
        orange_solid.negative_color,
        Some(Color::from_hex("#FF555A").unwrap())
    );
    assert!(!orange_solid.gradient);
}

#[test]
fn test_color_scale_green_yellow_red() {
    let presets = color_scale_presets();
    let gyr = &presets[0];
    assert_eq!(gyr.min_point.color, Color::from_hex("#63BE7B").unwrap());
    assert_eq!(gyr.min_point.value_type, CFValueType::Min);
    let mid = gyr.mid_point.as_ref().unwrap();
    assert_eq!(mid.color, Color::from_hex("#FFEB84").unwrap());
    assert_eq!(mid.value_type, CFValueType::Percentile);
    assert_eq!(mid.value, Some(50.0));
    assert_eq!(gyr.max_point.color, Color::from_hex("#F8696B").unwrap());
    assert_eq!(gyr.max_point.value_type, CFValueType::Max);
}

#[test]
fn test_color_scale_two_color_white_blue() {
    let presets = color_scale_presets();
    let wb = &presets[6]; // first 2-color scale
    assert_eq!(wb.min_point.color, Color::from_hex("#FFFFFF").unwrap());
    assert_eq!(wb.max_point.color, Color::from_hex("#5A8AC6").unwrap());
    assert!(wb.mid_point.is_none());
}

#[test]
fn test_color_scale_two_color_yellow_green() {
    let presets = color_scale_presets();
    let yg = &presets[9]; // last preset
    assert_eq!(yg.min_point.color, Color::from_hex("#FFEB84").unwrap());
    assert_eq!(yg.max_point.color, Color::from_hex("#63BE7B").unwrap());
    assert!(yg.mid_point.is_none());
}

#[test]
fn test_icon_set_names_start_and_end() {
    let names = icon_set_preset_names();
    assert_eq!(names[0], CFIconSetName::ThreeArrows);
    assert_eq!(names[19], CFIconSetName::FiveBoxes);
}

#[test]
fn test_icon_set_names_include_all_categories() {
    let names = icon_set_preset_names();
    // 3-icon: 10, 4-icon: 5, 5-icon: 5
    let three_count = names.iter().filter(|n| n.icon_count() == 3).count();
    let four_count = names.iter().filter(|n| n.icon_count() == 4).count();
    let five_count = names.iter().filter(|n| n.icon_count() == 5).count();
    assert_eq!(three_count, 10);
    assert_eq!(four_count, 5);
    assert_eq!(five_count, 5);
}

#[test]
fn test_three_color_scales_have_mid_point() {
    let presets = color_scale_presets();
    // First 6 are three-color
    for i in 0..6 {
        assert!(
            presets[i].mid_point.is_some(),
            "Preset {} should have mid_point",
            i
        );
    }
    // Last 4 are two-color
    for i in 6..10 {
        assert!(
            presets[i].mid_point.is_none(),
            "Preset {} should not have mid_point",
            i
        );
    }
}
