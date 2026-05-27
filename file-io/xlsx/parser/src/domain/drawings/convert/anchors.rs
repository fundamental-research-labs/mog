//! Anchor conversion from read-side drawing anchors to writer anchors.

use super::{read, write};

/// Convert a read-side `TwoCellAnchor` into a write-side `TwoCellAnchor`.
///
/// The anchor structs differ structurally: read-side embeds `DrawingContent`,
/// write-side separates content into `DrawingObject`. Geometry types are shared
/// re-exports from `ooxml-types`, so they can be cloned directly.
pub fn convert_two_cell_anchor(a: &read::TwoCellAnchor) -> write::TwoCellAnchor {
    write::TwoCellAnchor {
        from: a.from.clone(),
        to: a.to.clone(),
        edit_as: a.edit_as,
        client_data: a.client_data,
        mc_alternate_content: a.mc_alternate_content.clone(),
    }
}

/// Convert a read-side `OneCellAnchor` into a write-side `OneCellAnchor`.
pub fn convert_one_cell_anchor(a: &read::OneCellAnchor) -> write::OneCellAnchor {
    write::OneCellAnchor {
        from: a.from.clone(),
        extent: a.extent.clone(),
        client_data: a.client_data,
        mc_alternate_content: a.mc_alternate_content.clone(),
    }
}

/// Convert a read-side `AbsoluteAnchor` into a write-side `AbsoluteAnchor`.
pub fn convert_absolute_anchor(a: &read::AbsoluteAnchor) -> write::AbsoluteAnchor {
    write::AbsoluteAnchor {
        pos: a.pos.clone(),
        extent: a.extent.clone(),
        client_data: a.client_data,
    }
}
