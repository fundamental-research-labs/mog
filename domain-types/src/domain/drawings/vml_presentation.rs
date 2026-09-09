//! Owner-scoped legacy VML shape presentation.

use serde::{Deserialize, Serialize};

/// Imported shape appearance and geometry provenance. This is not a cached VML
/// part: export regenerates live cell bindings, geometry, visibility and media
/// relationships, and omits presentation whose owner has been deleted.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmlShapePresentation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<crate::VmlStyleDimensionInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<crate::VmlStyleDimensionInfo>,
    #[serde(default)]
    pub source_order: u32,
    #[serde(default)]
    pub namespace_attrs: Vec<(String, String)>,
    #[serde(default)]
    pub shape_attrs: Vec<(String, String)>,
    /// Individual shape children; relationship-bearing children require live
    /// owner-scoped media mappings before they may be emitted.
    #[serde(default)]
    pub children_xml: Vec<String>,
    #[serde(default)]
    pub client_data_attrs: Vec<(String, String)>,
    /// ClientData children other than the modeled Anchor/Row/Column/Visible.
    #[serde(default)]
    pub client_data_children_xml: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape_type_xml: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape_layout_xml: Option<String>,
    #[serde(default)]
    pub anchor: VmlCellAnchor,
    #[serde(default)]
    pub visible: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible_element_xml: Option<String>,
}

/// VML cell anchor offsets are pixels; unlike note UI coordinates they may be
/// negative for objects extending outside the owning cell.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmlCellAnchor {
    pub left_column: u32,
    pub left_offset: i64,
    pub top_row: u32,
    pub top_offset: i64,
    pub right_column: u32,
    pub right_offset: i64,
    pub bottom_row: u32,
    pub bottom_offset: i64,
}

impl From<&crate::domain::comment::NoteShapeAnchor> for VmlCellAnchor {
    fn from(anchor: &crate::domain::comment::NoteShapeAnchor) -> Self {
        Self {
            left_column: anchor.left_column,
            left_offset: i64::from(anchor.left_offset),
            top_row: anchor.top_row,
            top_offset: i64::from(anchor.top_offset),
            right_column: anchor.right_column,
            right_offset: i64::from(anchor.right_offset),
            bottom_row: anchor.bottom_row,
            bottom_offset: i64::from(anchor.bottom_offset),
        }
    }
}
