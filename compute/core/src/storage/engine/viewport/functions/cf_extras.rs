use compute_cf::types::{DataBarResult, IconResult};
use compute_wire::{DataBarRenderData, IconRenderData};

use super::super::render::color_to_u32;

pub(super) fn data_bar_to_render(db: &DataBarResult) -> DataBarRenderData {
    DataBarRenderData {
        fill_percent: db.fill_percent as f32,
        color: color_to_u32(&db.color),
        is_negative: db.is_negative,
        gradient: db.gradient,
        show_value: db.show_value,
        show_axis: db.show_axis,
        axis_position: db.axis_position as f32,
        negative_color: db.negative_color.as_ref().map(color_to_u32).unwrap_or(0),
    }
}

/// Convert an `IconResult` (compute-cf) to an `IconRenderData` (compute-wire).
pub(super) fn icon_to_render(icon: &IconResult) -> IconRenderData {
    IconRenderData {
        set_name_index: icon.set_name as u8,
        icon_index: icon.icon_index,
        icon_only: !icon.show_value, // invert: show_value → icon_only
    }
}
