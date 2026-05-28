use domain_types::domain::conditional_format::{CFColorPoint, CFColorScale, CFDataBar, CFIconSet};
use ooxml_types::cond_format::CfvoType;

use crate::engine_types::cf::{
    CFColorScalePreset, CFDataBarPreset, CFIconSetPreset, CFPresetCategory,
};

// =============================================================================
// Presets
// =============================================================================

pub(crate) fn cp(value_type: ooxml_types::cond_format::CfvoType, color: &str) -> CFColorPoint {
    use ooxml_types::cond_format::CfvoType;
    // The preset helpers only pass boundary kinds that carry no payload
    // (Min / Max / AutoMin / AutoMax). Numeric-carrying kinds route
    // through `cp_val` below.
    let value = match value_type {
        CfvoType::Min => domain_types::CFValueRef::Min,
        CfvoType::Max => domain_types::CFValueRef::Max,
        CfvoType::AutoMin => domain_types::CFValueRef::AutoMin,
        CfvoType::AutoMax => domain_types::CFValueRef::AutoMax,
        // Caller misuse: a payload-carrying kind was passed without a value.
        // Fall back to a zeroed numeric point so presets render something.
        CfvoType::Num => domain_types::CFValueRef::Number { value: 0.0 },
        CfvoType::Percent => domain_types::CFValueRef::Percent { value: 0.0 },
        CfvoType::Percentile => domain_types::CFValueRef::Percentile { value: 0.0 },
        CfvoType::Formula => domain_types::CFValueRef::Formula {
            source: String::new(),
        },
    };
    CFColorPoint {
        value,
        ooxml_value: None,
        color: color.to_string(),
        color_theme: None,
        color_tint: None,
        color_indexed: None,
        color_auto: None,
        ext_lst_xml: None,
    }
}

pub(crate) fn cp_val(
    value_type: ooxml_types::cond_format::CfvoType,
    value: f64,
    color: &str,
) -> CFColorPoint {
    use ooxml_types::cond_format::CfvoType;
    // `cp_val` is the numeric-carrying helper; formula / min / max kinds
    // go through `cp` above.
    let value = match value_type {
        CfvoType::Num => domain_types::CFValueRef::Number { value },
        CfvoType::Percent => domain_types::CFValueRef::Percent { value },
        CfvoType::Percentile => domain_types::CFValueRef::Percentile { value },
        CfvoType::Formula => domain_types::CFValueRef::Formula {
            source: value.to_string(),
        },
        CfvoType::Min => domain_types::CFValueRef::Min,
        CfvoType::Max => domain_types::CFValueRef::Max,
        CfvoType::AutoMin => domain_types::CFValueRef::AutoMin,
        CfvoType::AutoMax => domain_types::CFValueRef::AutoMax,
    };
    CFColorPoint {
        value,
        ooxml_value: None,
        color: color.to_string(),
        color_theme: None,
        color_tint: None,
        color_indexed: None,
        color_auto: None,
        ext_lst_xml: None,
    }
}

fn db_preset(id: &str, name: &str, color: &str, neg: &str, gradient: bool) -> CFDataBarPreset {
    use ooxml_types::cond_format::{CfvoType, DataBarAxisPosition};
    CFDataBarPreset {
        id: id.to_string(),
        name: name.to_string(),
        data_bar: CFDataBar {
            min_point: cp(CfvoType::Min, color),
            max_point: cp(CfvoType::Max, color),
            min_length: None,
            max_length: None,
            positive_color: color.to_string(),
            negative_color: Some(neg.to_string()),
            border_color: None,
            negative_border_color: None,
            show_border: None,
            gradient: Some(gradient),
            direction: None,
            axis_position: Some(DataBarAxisPosition::Automatic),
            axis_color: None,
            show_value: Some(true),
            match_positive_fill_color: None,
            match_positive_border_color: None,
            ext_id: None,
        },
    }
}

/// Get all data bar presets.
pub fn data_bar_presets() -> Vec<CFDataBarPreset> {
    vec![
        db_preset(
            "databar-blue-gradient",
            "Blue Gradient",
            "#638EC6",
            "#FF555A",
            true,
        ),
        db_preset(
            "databar-blue-solid",
            "Blue Solid",
            "#638EC6",
            "#FF555A",
            false,
        ),
        db_preset(
            "databar-green-gradient",
            "Green Gradient",
            "#63BE7B",
            "#FF555A",
            true,
        ),
        db_preset(
            "databar-green-solid",
            "Green Solid",
            "#63BE7B",
            "#FF555A",
            false,
        ),
        db_preset(
            "databar-red-gradient",
            "Red Gradient",
            "#F8696B",
            "#638EC6",
            true,
        ),
        db_preset(
            "databar-red-solid",
            "Red Solid",
            "#F8696B",
            "#638EC6",
            false,
        ),
        db_preset(
            "databar-orange-gradient",
            "Orange Gradient",
            "#FFAB46",
            "#FF555A",
            true,
        ),
        db_preset(
            "databar-orange-solid",
            "Orange Solid",
            "#FFAB46",
            "#FF555A",
            false,
        ),
    ]
}

/// Get all color scale presets.
pub fn color_scale_presets() -> Vec<CFColorScalePreset> {
    vec![
        CFColorScalePreset {
            id: "colorscale-green-yellow-red".into(),
            name: "Green - Yellow - Red".into(),
            color_scale: CFColorScale {
                points: Vec::new(),
                min_point: cp(CfvoType::Min, "#63BE7B"),
                mid_point: Some(cp_val(CfvoType::Percentile, 50.0, "#FFEB84")),
                max_point: cp(CfvoType::Max, "#F8696B"),
            },
        },
        CFColorScalePreset {
            id: "colorscale-red-yellow-green".into(),
            name: "Red - Yellow - Green".into(),
            color_scale: CFColorScale {
                points: Vec::new(),
                min_point: cp(CfvoType::Min, "#F8696B"),
                mid_point: Some(cp_val(CfvoType::Percentile, 50.0, "#FFEB84")),
                max_point: cp(CfvoType::Max, "#63BE7B"),
            },
        },
        CFColorScalePreset {
            id: "colorscale-green-white-red".into(),
            name: "Green - White - Red".into(),
            color_scale: CFColorScale {
                points: Vec::new(),
                min_point: cp(CfvoType::Min, "#63BE7B"),
                mid_point: Some(cp_val(CfvoType::Percentile, 50.0, "#FFFFFF")),
                max_point: cp(CfvoType::Max, "#F8696B"),
            },
        },
        CFColorScalePreset {
            id: "colorscale-red-white-green".into(),
            name: "Red - White - Green".into(),
            color_scale: CFColorScale {
                points: Vec::new(),
                min_point: cp(CfvoType::Min, "#F8696B"),
                mid_point: Some(cp_val(CfvoType::Percentile, 50.0, "#FFFFFF")),
                max_point: cp(CfvoType::Max, "#63BE7B"),
            },
        },
        CFColorScalePreset {
            id: "colorscale-blue-white-red".into(),
            name: "Blue - White - Red".into(),
            color_scale: CFColorScale {
                points: Vec::new(),
                min_point: cp(CfvoType::Min, "#5A8AC6"),
                mid_point: Some(cp_val(CfvoType::Percentile, 50.0, "#FFFFFF")),
                max_point: cp(CfvoType::Max, "#F8696B"),
            },
        },
        CFColorScalePreset {
            id: "colorscale-red-white-blue".into(),
            name: "Red - White - Blue".into(),
            color_scale: CFColorScale {
                points: Vec::new(),
                min_point: cp(CfvoType::Min, "#F8696B"),
                mid_point: Some(cp_val(CfvoType::Percentile, 50.0, "#FFFFFF")),
                max_point: cp(CfvoType::Max, "#5A8AC6"),
            },
        },
        CFColorScalePreset {
            id: "colorscale-white-blue".into(),
            name: "White - Blue".into(),
            color_scale: CFColorScale {
                points: Vec::new(),
                min_point: cp(CfvoType::Min, "#FFFFFF"),
                mid_point: None,
                max_point: cp(CfvoType::Max, "#5A8AC6"),
            },
        },
        CFColorScalePreset {
            id: "colorscale-white-red".into(),
            name: "White - Red".into(),
            color_scale: CFColorScale {
                points: Vec::new(),
                min_point: cp(CfvoType::Min, "#FFFFFF"),
                mid_point: None,
                max_point: cp(CfvoType::Max, "#F8696B"),
            },
        },
        CFColorScalePreset {
            id: "colorscale-white-green".into(),
            name: "White - Green".into(),
            color_scale: CFColorScale {
                points: Vec::new(),
                min_point: cp(CfvoType::Min, "#FFFFFF"),
                mid_point: None,
                max_point: cp(CfvoType::Max, "#63BE7B"),
            },
        },
        CFColorScalePreset {
            id: "colorscale-yellow-green".into(),
            name: "Yellow - Green".into(),
            color_scale: CFColorScale {
                points: Vec::new(),
                min_point: cp(CfvoType::Min, "#FFEB84"),
                mid_point: None,
                max_point: cp(CfvoType::Max, "#63BE7B"),
            },
        },
    ]
}

fn icon_preset(kind: ooxml_types::cond_format::IconSetType, display_name: &str) -> CFIconSetPreset {
    CFIconSetPreset {
        id: format!("iconset-{}", kind.to_ooxml().to_lowercase()),
        name: display_name.to_string(),
        icon_set: CFIconSet {
            icon_set_name: kind,
            reverse_order: Some(false),
            show_icon_only: Some(false),
            percent: None,
            thresholds: vec![],
            custom_icons: vec![],
        },
    }
}

/// Get all icon set presets.
pub fn icon_set_presets() -> Vec<CFIconSetPreset> {
    use ooxml_types::cond_format::IconSetType::*;
    vec![
        icon_preset(ThreeArrows, "3 Arrows (Colored)"),
        icon_preset(ThreeArrowsGray, "3 Arrows (Gray)"),
        icon_preset(ThreeTrafficLights1, "3 Traffic Lights"),
        icon_preset(ThreeTrafficLights2, "3 Traffic Lights (Rimmed)"),
        icon_preset(ThreeSigns, "3 Signs"),
        icon_preset(ThreeSymbols, "3 Symbols (Circled)"),
        icon_preset(ThreeSymbols2, "3 Symbols (Uncircled)"),
        icon_preset(ThreeFlags, "3 Flags"),
        icon_preset(ThreeStars, "3 Stars"),
        icon_preset(ThreeTriangles, "3 Triangles"),
        icon_preset(FourArrows, "4 Arrows (Colored)"),
        icon_preset(FourArrowsGray, "4 Arrows (Gray)"),
        icon_preset(FourRating, "4 Rating"),
        icon_preset(FourRedToBlack, "4 Red to Black"),
        icon_preset(FourTrafficLights, "4 Traffic Lights"),
        icon_preset(FiveArrows, "5 Arrows (Colored)"),
        icon_preset(FiveArrowsGray, "5 Arrows (Gray)"),
        icon_preset(FiveRating, "5 Rating"),
        icon_preset(FiveQuarters, "5 Quarters"),
        icon_preset(FiveBoxes, "5 Boxes"),
    ]
}

/// Get a preset by ID (searches all categories).
pub fn get_preset_by_id(id: &str) -> Option<CFPresetCategory> {
    if data_bar_presets().iter().any(|p| p.id == id) {
        return Some(CFPresetCategory::DataBar);
    }
    if color_scale_presets().iter().any(|p| p.id == id) {
        return Some(CFPresetCategory::ColorScale);
    }
    if icon_set_presets().iter().any(|p| p.id == id) {
        return Some(CFPresetCategory::IconSet);
    }
    None
}
