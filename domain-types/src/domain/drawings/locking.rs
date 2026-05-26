//! Drawing locking flags — CT_*Locking mirror (typed OOXML preservation A.7 primitive).
//!
//! `DrawingLocking` is the domain-level mirror of
//! `ooxml_types::drawings::DrawingLocking`. Covers the `AG_Locking` attribute
//! group shared by CT_ConnectorLocking, CT_PictureLocking, and
//! CT_ShapeLocking, plus the two shape-family-specific attributes:
//!
//! - `no_crop` — picture-only (CT_PictureLocking/@noCrop)
//! - `no_text_edit` — shape-only (CT_ShapeLocking/@noTextEdit)
//!
//! Both are harmless defaults on the other families so a single type works
//! for all three locking surfaces. `Default` emits no JSON keys.

use serde::{Deserialize, Serialize};

/// Unified drawing-object locking properties
/// (CT_PictureLocking / CT_ShapeLocking / CT_ConnectorLocking).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct DrawingLocking {
    /// Disallow cropping (picture-only, `picLocks/@noCrop`).
    #[serde(skip_serializing_if = "is_false")]
    pub no_crop: bool,
    /// Disallow text editing (shape-only, `spLocks/@noTextEdit`).
    #[serde(skip_serializing_if = "is_false")]
    pub no_text_edit: bool,
    /// Disallow grouping (`@noGrp`).
    #[serde(skip_serializing_if = "is_false")]
    pub no_grp: bool,
    /// Disallow selection (`@noSelect`).
    #[serde(skip_serializing_if = "is_false")]
    pub no_select: bool,
    /// Disallow rotation (`@noRot`).
    #[serde(skip_serializing_if = "is_false")]
    pub no_rot: bool,
    /// Disallow aspect ratio changes (`@noChangeAspect`).
    #[serde(skip_serializing_if = "is_false")]
    pub no_change_aspect: bool,
    /// Disallow moving (`@noMove`).
    #[serde(skip_serializing_if = "is_false")]
    pub no_move: bool,
    /// Disallow resizing (`@noResize`).
    #[serde(skip_serializing_if = "is_false")]
    pub no_resize: bool,
    /// Disallow editing connection / adjust points (`@noEditPoints`).
    #[serde(skip_serializing_if = "is_false")]
    pub no_edit_points: bool,
    /// Disallow adjusting handles (`@noAdjustHandles`).
    #[serde(skip_serializing_if = "is_false")]
    pub no_adjust_handles: bool,
    /// Disallow changing arrowheads (`@noChangeArrowheads`).
    #[serde(skip_serializing_if = "is_false")]
    pub no_change_arrow_heads: bool,
    /// Disallow changing the shape type (`@noChangeShapeType`).
    #[serde(skip_serializing_if = "is_false")]
    pub no_change_shape_type: bool,
    /// Extension list — opaque XML passthrough.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext_lst: Option<String>,
}

fn is_false(v: &bool) -> bool {
    !*v
}

impl DrawingLocking {
    /// Returns `true` if any locking attribute is non-default or `ext_lst`
    /// is populated. Mirrors `ooxml_types::drawings::GroupLocking::has_any`
    /// convention — lets writers decide whether to emit the element.
    pub fn has_any(&self) -> bool {
        self.no_crop
            || self.no_text_edit
            || self.no_grp
            || self.no_select
            || self.no_rot
            || self.no_change_aspect
            || self.no_move
            || self.no_resize
            || self.no_edit_points
            || self.no_adjust_handles
            || self.no_change_arrow_heads
            || self.no_change_shape_type
            || self.ext_lst.is_some()
    }
}

// ===========================================================================
// Converters to/from ooxml_types
// ===========================================================================

use ooxml_types::drawings::DrawingLocking as ODrawingLocking;

impl From<&ODrawingLocking> for DrawingLocking {
    fn from(l: &ODrawingLocking) -> Self {
        Self {
            no_crop: l.no_crop,
            no_text_edit: l.no_text_edit,
            no_grp: l.no_grp,
            no_select: l.no_select,
            no_rot: l.no_rot,
            no_change_aspect: l.no_change_aspect,
            no_move: l.no_move,
            no_resize: l.no_resize,
            no_edit_points: l.no_edit_points,
            no_adjust_handles: l.no_adjust_handles,
            no_change_arrow_heads: l.no_change_arrowheads,
            no_change_shape_type: l.no_change_shape_type,
            ext_lst: l.ext_lst.clone(),
        }
    }
}

impl From<DrawingLocking> for ODrawingLocking {
    fn from(l: DrawingLocking) -> Self {
        Self {
            no_crop: l.no_crop,
            no_text_edit: l.no_text_edit,
            no_grp: l.no_grp,
            no_select: l.no_select,
            no_rot: l.no_rot,
            no_change_aspect: l.no_change_aspect,
            no_move: l.no_move,
            no_resize: l.no_resize,
            no_edit_points: l.no_edit_points,
            no_adjust_handles: l.no_adjust_handles,
            no_change_arrowheads: l.no_change_arrow_heads,
            no_change_shape_type: l.no_change_shape_type,
            ext_lst: l.ext_lst,
        }
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_emits_no_keys() {
        let l = DrawingLocking::default();
        let json = serde_json::to_string(&l).unwrap();
        assert_eq!(json, "{}");
    }

    #[test]
    fn round_trip_full_surface() {
        let original = ODrawingLocking {
            no_crop: true,
            no_text_edit: true,
            no_grp: true,
            no_select: true,
            no_rot: true,
            no_change_aspect: true,
            no_move: true,
            no_resize: true,
            no_edit_points: true,
            no_adjust_handles: true,
            no_change_arrowheads: true,
            no_change_shape_type: true,
            ext_lst: Some("<a:extLst/>".into()),
        };
        let dom: DrawingLocking = (&original).into();
        let round: ODrawingLocking = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn round_trip_partial() {
        let original = ODrawingLocking {
            no_change_aspect: true,
            no_move: true,
            ..Default::default()
        };
        let dom: DrawingLocking = (&original).into();
        let round: ODrawingLocking = dom.into();
        assert_eq!(original, round);
    }

    #[test]
    fn has_any_matches_non_default() {
        let l = DrawingLocking::default();
        assert!(!l.has_any());
        let l2 = DrawingLocking {
            no_resize: true,
            ..Default::default()
        };
        assert!(l2.has_any());
    }
}
