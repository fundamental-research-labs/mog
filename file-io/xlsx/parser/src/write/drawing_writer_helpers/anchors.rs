use domain_types::domain::chart::{AnchorPosition, ObjectSize};
use domain_types::domain::floating_object::{AnchorMode, FloatingObjectAnchor};

use crate::domain::drawings::write::{
    AbsoluteAnchor, CellAnchor, ClientData, DrawingAnchor, DrawingObject, EditAs, Extent,
    OneCellAnchor, Position, TwoCellAnchor,
};

/// EMUs per pixel at 96 DPI (914400 EMUs/inch / 96 DPI).
pub(super) const EMUS_PER_PIXEL: i64 = 9525;

/// Convert a `FloatingObjectAnchor` into a legacy `AnchorPosition` for compatibility
/// with existing writer helper functions.
pub(super) fn anchor_to_legacy_position(anchor: &FloatingObjectAnchor) -> AnchorPosition {
    AnchorPosition {
        anchor_row: anchor.anchor_row,
        anchor_col: anchor.anchor_col,
        anchor_row_offset: anchor.anchor_row_offset,
        anchor_col_offset: anchor.anchor_col_offset,
        absolute_x: anchor.absolute_x,
        absolute_y: anchor.absolute_y,
        end_row: anchor.end_row,
        end_col: anchor.end_col,
        end_row_offset: anchor.end_row_offset,
        end_col_offset: anchor.end_col_offset,
        extent_cx: anchor.extent_cx,
        extent_cy: anchor.extent_cy,
    }
}

/// Get the editAs string from the anchor mode.
pub(super) fn anchor_mode_to_edit_as(mode: &AnchorMode) -> Option<String> {
    match mode {
        AnchorMode::OneCell => Some("oneCell".to_string()),
        AnchorMode::TwoCell => None,
        AnchorMode::Absolute => Some("absolute".to_string()),
    }
}

/// Convert an `AnchorPosition` into a write-side `TwoCellAnchor`.
///
/// If end row/col are present, produces a two-cell anchor. The `edit_as` field
/// defaults to `None` (OOXML default is "twoCell").
pub fn anchor_position_to_two_cell(pos: &AnchorPosition) -> TwoCellAnchor {
    let from = CellAnchor {
        col: pos.anchor_col,
        col_off: pos.anchor_col_offset,
        row: pos.anchor_row,
        row_off: pos.anchor_row_offset,
    };

    let to = CellAnchor {
        col: pos.end_col.unwrap_or(pos.anchor_col),
        col_off: pos.end_col_offset.unwrap_or(0),
        row: pos.end_row.unwrap_or(pos.anchor_row),
        row_off: pos.end_row_offset.unwrap_or(0),
    };

    TwoCellAnchor {
        from,
        to,
        edit_as: None,
        client_data: ClientData::default(),
        mc_alternate_content: None,
    }
}

/// Convert an `AnchorPosition` + `ObjectSize` into a one-cell anchor.
///
/// Used when the anchor position does not have end row/col (one-cell positioning).
/// When `extent_emu` is provided, uses those exact EMU values instead of computing
/// from pixel size (avoids precision loss from pixel->EMU round-trip).
pub fn anchor_position_to_one_cell(
    pos: &AnchorPosition,
    size: &ObjectSize,
    extent_emu: Option<(i64, i64)>,
) -> OneCellAnchor {
    let from = CellAnchor {
        col: pos.anchor_col,
        col_off: pos.anchor_col_offset,
        row: pos.anchor_row,
        row_off: pos.anchor_row_offset,
    };

    let (cx, cy) = extent_emu.unwrap_or_else(|| {
        (
            size.width as i64 * EMUS_PER_PIXEL,
            size.height as i64 * EMUS_PER_PIXEL,
        )
    });

    OneCellAnchor {
        from,
        extent: Extent { cx, cy },
        client_data: ClientData::default(),
        mc_alternate_content: None,
    }
}

/// Convert an absolute-positioned anchor into a write-side absolute anchor.
pub fn anchor_position_to_absolute(
    pos: &AnchorPosition,
    size: &ObjectSize,
    extent_emu: Option<(i64, i64)>,
) -> AbsoluteAnchor {
    let (cx, cy) = extent_emu
        .or_else(|| pos.extent_cx.zip(pos.extent_cy))
        .unwrap_or_else(|| {
            (
                size.width as i64 * EMUS_PER_PIXEL,
                size.height as i64 * EMUS_PER_PIXEL,
            )
        });

    AbsoluteAnchor {
        pos: Position {
            x: pos.absolute_x.unwrap_or(pos.anchor_col_offset),
            y: pos.absolute_y.unwrap_or(pos.anchor_row_offset),
        },
        extent: Extent { cx, cy },
        client_data: ClientData::default(),
    }
}

/// Determine the best anchor type for the given position/size and wrap a
/// `DrawingObject` into a `DrawingAnchor`.
pub(super) fn wrap_in_anchor(
    pos: &AnchorPosition,
    size: &ObjectSize,
    edit_as: Option<&str>,
    extent_emu: Option<(i64, i64)>,
    obj: DrawingObject,
) -> DrawingAnchor {
    if pos.absolute_x.is_some() && pos.absolute_y.is_some() {
        DrawingAnchor::Absolute(anchor_position_to_absolute(pos, size, extent_emu), obj)
    } else if pos.end_row.is_some() && pos.end_col.is_some() {
        let mut anchor = anchor_position_to_two_cell(pos);
        if let Some(ea) = edit_as {
            anchor.edit_as = Some(EditAs::from_ooxml(ea));
        }
        DrawingAnchor::TwoCell(anchor, obj)
    } else {
        DrawingAnchor::OneCell(anchor_position_to_one_cell(pos, size, extent_emu), obj)
    }
}
