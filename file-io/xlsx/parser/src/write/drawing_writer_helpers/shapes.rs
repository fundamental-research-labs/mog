use domain_types::domain::floating_object::FloatingObjectCommon;

use crate::domain::drawings::write::{GroupShapeProps, ShapePreset, ShapeProps, TextBox};

/// Convert a shape-type floating object into `ShapeProps`.
/// Fallback for API-created shapes (no OOXML props). Produces minimal valid shape.
pub(super) fn convert_shape(common: &FloatingObjectCommon) -> ShapeProps {
    let name = if common.name.is_empty() {
        "Shape".to_string()
    } else {
        common.name.clone()
    };

    ShapeProps {
        original_id: None,
        name,
        preset: ShapePreset::Rect,
        fill: None,
        outline: None,
        text: None,
        macro_name: None,
        textlink: None,
        nv_ext_lst: None,
        tx_box: false,
        xfrm: None,
        style: None,
    }
}

/// Parse a shape preset string to the enum. Falls back to `Rect`.
pub(super) fn parse_shape_preset(s: &str) -> ShapePreset {
    match s {
        "rect" => ShapePreset::Rect,
        "ellipse" => ShapePreset::Ellipse,
        "roundRect" => ShapePreset::RoundRect,
        "triangle" => ShapePreset::Triangle,
        "rtTriangle" => ShapePreset::RightTriangle,
        "diamond" => ShapePreset::Diamond,
        "pentagon" => ShapePreset::Pentagon,
        "hexagon" => ShapePreset::Hexagon,
        "star5" => ShapePreset::Star5,
        "line" => ShapePreset::Line,
        "rightArrow" => ShapePreset::RightArrow,
        "leftArrow" => ShapePreset::LeftArrow,
        "upArrow" => ShapePreset::UpArrow,
        "downArrow" => ShapePreset::DownArrow,
        "cloud" => ShapePreset::Cloud,
        "heart" => ShapePreset::Heart,
        "can" => ShapePreset::Can,
        "cube" => ShapePreset::Cube,
        "flowChartProcess" => ShapePreset::FlowChartProcess,
        "flowChartDecision" => ShapePreset::FlowChartDecision,
        "flowChartTerminator" => ShapePreset::FlowChartTerminator,
        _ => ShapePreset::Rect,
    }
}

/// Convert a textbox-type floating object into a `TextBox`.
/// Fallback for API-created textboxes (no OOXML props). Produces minimal valid textbox.
pub(super) fn convert_text_box(common: &FloatingObjectCommon) -> TextBox {
    let name = if common.name.is_empty() {
        "TextBox".to_string()
    } else {
        common.name.clone()
    };
    TextBox::from_plain(&name, "")
}

/// Convert a group shape from its typed CT_GroupShape payload.
pub(super) fn convert_group_from_data(
    _common: &FloatingObjectCommon,
    group: &crate::domain::drawings::GroupShape,
) -> GroupShapeProps {
    crate::domain::drawings::write::convert::group_shape_to_props(group)
}

/// Fallback group construction when no GroupShape JSON is available (children are lost).
pub(super) fn convert_group_fallback(common: &FloatingObjectCommon) -> GroupShapeProps {
    let name = if common.name.is_empty() {
        "Group".to_string()
    } else {
        common.name.clone()
    };

    GroupShapeProps {
        original_id: None,
        name,
        description: None,
        title: None,
        hidden: !common.visible,
        hlink_click: None,
        hlink_hover: None,
        group_locking: None,
        nv_ext_lst: None,
        transform: None,
        fill: None,
        effects: None,
        bw_mode: None,
        scene3d: None,
        ext_lst: None,
        children: Vec::new(),
    }
}
