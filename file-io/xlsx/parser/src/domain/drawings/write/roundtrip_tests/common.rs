use crate::domain::drawings::write::types::{CellAnchor, DrawingColor, DrawingFill, SolidFill};

pub(super) fn rgb(hex: &str) -> DrawingColor {
    DrawingColor::SrgbClr {
        val: hex.into(),
        transforms: vec![],
    }
}

pub(super) fn solid_fill(hex: &str) -> DrawingFill {
    DrawingFill::Solid(SolidFill { color: rgb(hex) })
}

pub(super) fn default_anchors() -> (CellAnchor, CellAnchor) {
    (
        CellAnchor {
            col: 0,
            col_off: 0,
            row: 0,
            row_off: 0,
        },
        CellAnchor {
            col: 5,
            col_off: 0,
            row: 5,
            row_off: 0,
        },
    )
}
