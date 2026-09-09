use std::collections::HashMap;

use super::value_refs::{convert_color_point_to_wire, resolve_cf_color};
use crate::cf::types::{
    CFColorPointWire, CFDataBarAxisPosition, CFDataBarDirection, CFDataBarWire,
};
use domain_types::domain::conditional_format as cf;

pub(super) fn normalize_data_bar_color(color: &str) -> Option<String> {
    value_types::Color::from_hex(color.trim())
        .ok()
        .map(|color| color.to_string())
}

pub(super) fn convert_data_bar_point_to_wire(
    pt: &cf::CFColorPoint,
    fallback_color: &str,
    theme_palette: &HashMap<String, String>,
) -> CFColorPointWire {
    let mut wire = convert_color_point_to_wire(pt, theme_palette);
    wire.color =
        normalize_data_bar_color(&wire.color).unwrap_or_else(|| fallback_color.to_string());
    wire
}

pub(super) fn convert_data_bar_to_wire(
    db: &cf::CFDataBar,
    theme_palette: &HashMap<String, String>,
) -> CFDataBarWire {
    use ooxml_types::cond_format::{DataBarAxisPosition, DataBarDirection};
    let direction = match db.direction {
        Some(DataBarDirection::LeftToRight) => CFDataBarDirection::LeftToRight,
        Some(DataBarDirection::RightToLeft) => CFDataBarDirection::RightToLeft,
        Some(DataBarDirection::Context) | None => CFDataBarDirection::default(),
    };
    // Note: the OOXML enum uses `Middle`; compute-cf's wire enum uses
    // `Midpoint`. Round-D does not unify these - the wire-types side is out
    // of Round-D scope per the task brief.
    let axis_position = match db.axis_position {
        Some(DataBarAxisPosition::Automatic) => CFDataBarAxisPosition::Automatic,
        Some(DataBarAxisPosition::Middle) => CFDataBarAxisPosition::Midpoint,
        Some(DataBarAxisPosition::None) => CFDataBarAxisPosition::None,
        None => CFDataBarAxisPosition::default(),
    };

    let resolve = |color: &cf::CFColor| {
        // Keep the existing ARGB/alpha contract for explicit RGB bars. Resolve
        // authored palette references only at this evaluation boundary.
        let explicit_rgb = if color.theme.is_none() && color.indexed.is_none() && !color.auto {
            color
                .rgb
                .as_deref()
                .and_then(|rgb| value_types::Color::from_hex(rgb.trim()).ok())
                .map(|rgb| {
                    let tinted = color
                        .tint
                        .map(|tint| domain_types::theme_color::apply_tint(&rgb.to_hex_rgb(), tint))
                        .and_then(|tinted| value_types::Color::from_hex(&tinted).ok())
                        .unwrap_or(rgb);
                    tinted.with_alpha(rgb.a()).to_string()
                })
        } else {
            None
        };
        explicit_rgb
            .or_else(|| resolve_cf_color(color, theme_palette))
            .and_then(|color| normalize_data_bar_color(&color))
            .unwrap_or_else(|| color.rgb.clone().unwrap_or_default())
    };
    let positive_color = resolve(&db.positive_color);

    CFDataBarWire {
        min_point: convert_data_bar_point_to_wire(&db.min_point, &positive_color, theme_palette),
        max_point: convert_data_bar_point_to_wire(&db.max_point, &positive_color, theme_palette),
        positive_color,
        negative_color: db.negative_color.as_ref().map(resolve),
        border_color: db.border_color.as_ref().map(resolve),
        negative_border_color: db.negative_border_color.as_ref().map(resolve),
        show_border: db.show_border.unwrap_or(false),
        gradient: db.gradient.unwrap_or(true),
        direction,
        axis_position,
        axis_color: db.axis_color.as_ref().map(resolve),
        show_value: db.show_value.unwrap_or(true),
        min_length: data_bar_length_to_wire(db.min_length, 10),
        max_length: data_bar_length_to_wire(db.max_length, 90),
        match_positive_fill_color: db.match_positive_fill_color.unwrap_or(false),
        match_positive_border_color: db.match_positive_border_color.unwrap_or(false),
    }
}

pub(super) fn data_bar_length_to_wire(value: Option<u32>, default: u8) -> u8 {
    value.map(|v| v.min(100) as u8).unwrap_or(default)
}
