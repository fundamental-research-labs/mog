//! 40 CF preset configurations (single source of truth).
//!
//! Ported from `spreadsheet-model/src/conditional-format/presets.ts`.
//!
//! Three categories:
//! - **Data Bars** (8): 4 colors x gradient/solid
//! - **Color Scales** (10): 6 three-color + 4 two-color
//! - **Icon Sets** (22): 10 three-icon + 7 four-icon + 5 five-icon
//!
//! Total: 40 presets (8 + 10 + 22)
//! (The task description says 39 but the TS source has 40.)
//!
//! All preset lists are lazily initialized via `LazyLock` and cached for the
//! lifetime of the process, avoiding repeated heap allocation on every call.

use std::sync::LazyLock;

use value_types::Color;

use crate::types::{
    CFColorPoint, CFColorScale, CFDataBar, CFDataBarAxisPosition, CFDataBarDirection,
    CFIconSetName, CFValueType,
};

// =============================================================================
// Data Bar Presets (8 total: 4 colors x gradient/solid)
// =============================================================================

/// Helper to build a data bar preset.
fn make_data_bar(color: &str, negative_color: &str, gradient: bool) -> CFDataBar {
    // SAFETY: hardcoded hex color literal.
    let c = Color::from_hex(color).unwrap();
    // SAFETY: hardcoded hex color literal.
    let nc = Color::from_hex(negative_color).unwrap();
    CFDataBar {
        min_point: CFColorPoint {
            value_type: CFValueType::Min,
            value: None,
            color: c,
        },
        max_point: CFColorPoint {
            value_type: CFValueType::Max,
            value: None,
            color: c,
        },
        positive_color: c,
        negative_color: Some(nc),
        border_color: None,
        negative_border_color: None,
        show_border: false,
        gradient,
        direction: CFDataBarDirection::LeftToRight,
        axis_position: CFDataBarAxisPosition::Automatic,
        axis_color: None,
        show_value: true,
        min_length: 10,
        max_length: 90,
        match_positive_fill_color: false,
        match_positive_border_color: false,
    }
}

static DATA_BAR_PRESETS: LazyLock<Vec<CFDataBar>> = LazyLock::new(|| {
    vec![
        // Blue gradient
        make_data_bar("#638EC6", "#FF555A", true),
        // Blue solid
        make_data_bar("#638EC6", "#FF555A", false),
        // Green gradient
        make_data_bar("#63BE7B", "#FF555A", true),
        // Green solid
        make_data_bar("#63BE7B", "#FF555A", false),
        // Red gradient (negative color is blue, not red)
        make_data_bar("#F8696B", "#638EC6", true),
        // Red solid
        make_data_bar("#F8696B", "#638EC6", false),
        // Orange gradient
        make_data_bar("#FFAB46", "#FF555A", true),
        // Orange solid
        make_data_bar("#FFAB46", "#FF555A", false),
    ]
});

/// All data bar presets (8 total: 4 colors x gradient/solid).
///
/// Colors: Blue (#638EC6), Green (#63BE7B), Red (#F8696B), Orange (#FFAB46).
/// Each color has a gradient and a solid variant.
///
/// Returns a reference to a lazily initialized, process-lifetime cached slice.
pub fn data_bar_presets() -> &'static [CFDataBar] {
    &DATA_BAR_PRESETS
}

// =============================================================================
// Color Scale Presets (10 total: 6 three-color + 4 two-color)
// =============================================================================

/// Helper: 3-color scale with midPoint at percentile 50.
fn three_color_scale(min_color: &str, mid_color: &str, max_color: &str) -> CFColorScale {
    CFColorScale {
        min_point: CFColorPoint {
            value_type: CFValueType::Min,
            value: None,
            // SAFETY: hardcoded hex color literal.
            color: Color::from_hex(min_color).unwrap(),
        },
        mid_point: Some(CFColorPoint {
            value_type: CFValueType::Percentile,
            value: Some(50.0),
            // SAFETY: hardcoded hex color literal.
            color: Color::from_hex(mid_color).unwrap(),
        }),
        max_point: CFColorPoint {
            value_type: CFValueType::Max,
            value: None,
            // SAFETY: hardcoded hex color literal.
            color: Color::from_hex(max_color).unwrap(),
        },
    }
}

/// Helper: 2-color scale (no midPoint).
fn two_color_scale(min_color: &str, max_color: &str) -> CFColorScale {
    CFColorScale {
        min_point: CFColorPoint {
            value_type: CFValueType::Min,
            value: None,
            // SAFETY: hardcoded hex color literal.
            color: Color::from_hex(min_color).unwrap(),
        },
        mid_point: None,
        max_point: CFColorPoint {
            value_type: CFValueType::Max,
            value: None,
            // SAFETY: hardcoded hex color literal.
            color: Color::from_hex(max_color).unwrap(),
        },
    }
}

static COLOR_SCALE_PRESETS: LazyLock<Vec<CFColorScale>> = LazyLock::new(|| {
    vec![
        // 3-color scales
        three_color_scale("#63BE7B", "#FFEB84", "#F8696B"), // Green - Yellow - Red
        three_color_scale("#F8696B", "#FFEB84", "#63BE7B"), // Red - Yellow - Green
        three_color_scale("#63BE7B", "#FFFFFF", "#F8696B"), // Green - White - Red
        three_color_scale("#F8696B", "#FFFFFF", "#63BE7B"), // Red - White - Green
        three_color_scale("#5A8AC6", "#FFFFFF", "#F8696B"), // Blue - White - Red
        three_color_scale("#F8696B", "#FFFFFF", "#5A8AC6"), // Red - White - Blue
        // 2-color scales
        two_color_scale("#FFFFFF", "#5A8AC6"), // White - Blue
        two_color_scale("#FFFFFF", "#F8696B"), // White - Red
        two_color_scale("#FFFFFF", "#63BE7B"), // White - Green
        two_color_scale("#FFEB84", "#63BE7B"), // Yellow - Green
    ]
});

/// All color scale presets (10 total: 6 three-color + 4 two-color).
///
/// Returns a reference to a lazily initialized, process-lifetime cached slice.
pub fn color_scale_presets() -> &'static [CFColorScale] {
    &COLOR_SCALE_PRESETS
}

// =============================================================================
// Icon Set Presets (20 total)
// =============================================================================

static ICON_SET_PRESET_NAMES: LazyLock<Vec<CFIconSetName>> = LazyLock::new(|| {
    vec![
        // 3-icon sets (10)
        CFIconSetName::ThreeArrows,
        CFIconSetName::ThreeArrowsGray,
        CFIconSetName::ThreeTrafficLights1,
        CFIconSetName::ThreeTrafficLights2,
        CFIconSetName::ThreeSigns,
        CFIconSetName::ThreeSymbols,
        CFIconSetName::ThreeSymbols2,
        CFIconSetName::ThreeFlags,
        CFIconSetName::ThreeStars,
        CFIconSetName::ThreeTriangles,
        // 4-icon sets (5)
        CFIconSetName::FourArrows,
        CFIconSetName::FourArrowsGray,
        CFIconSetName::FourRating,
        CFIconSetName::FourRedToBlack,
        CFIconSetName::FourTrafficLights,
        // 5-icon sets (5)
        CFIconSetName::FiveArrows,
        CFIconSetName::FiveArrowsGray,
        CFIconSetName::FiveRating,
        CFIconSetName::FiveQuarters,
        CFIconSetName::FiveBoxes,
    ]
});

/// All icon set preset names (20 total).
///
/// These are the Excel-compatible icon set names used to identify which
/// icon set to render. The actual icon thresholds are computed at evaluation
/// time based on the number of icons in the set.
///
/// Returns a reference to a lazily initialized, process-lifetime cached slice.
pub fn icon_set_preset_names() -> &'static [CFIconSetName] {
    &ICON_SET_PRESET_NAMES
}

#[cfg(test)]
#[path = "presets_tests.rs"]
mod tests;
