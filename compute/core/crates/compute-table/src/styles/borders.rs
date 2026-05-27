use value_types::Color;

use crate::types::{BorderDef, BorderStyle, TableCellFormat};

pub(super) fn thin_border(color: Color) -> BorderDef {
    BorderDef {
        style: BorderStyle::Thin,
        color,
    }
}

pub(super) fn medium_border(color: Color) -> BorderDef {
    BorderDef {
        style: BorderStyle::Medium,
        color,
    }
}

/// Add left/right/top/bottom edge borders to a format object (mutates in place).
pub(super) fn add_edge_borders(
    fmt: &mut TableCellFormat,
    left: bool,
    right: bool,
    top: bool,
    bottom: bool,
    border_color: Color,
) {
    let thin = || thin_border(border_color);
    if left && fmt.border_left.is_none() {
        fmt.border_left = Some(thin());
    }
    if right && fmt.border_right.is_none() {
        fmt.border_right = Some(thin());
    }
    if top && fmt.border_top.is_none() {
        fmt.border_top = Some(thin());
    }
    if bottom && fmt.border_bottom.is_none() {
        fmt.border_bottom = Some(thin());
    }
}

// =============================================================================
// Tests
