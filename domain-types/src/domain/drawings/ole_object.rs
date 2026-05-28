//! OLE-object round-trip properties.
//!
//! These types mirror the OOXML `<objectPr>` child element of `<oleObject>`
//! (CT_ObjectPr) — OLE display/interaction properties plus the `<anchor>`
//! grandchild. They live in `domain-types` — rather than in `xlsx-parser`,
//! where they used to be named `OleObjectPropertiesOutput` — so that
//! `OleObjectOoxmlProps.object_pr` can be a typed field instead of a
//! `serde_json::Value` blob (typed OOXML preservation).

use serde::{Deserialize, Serialize};

/// Serializable `<objectPr>` properties for an OLE object.
///
/// Captures the visual + interaction flags of CT_ObjectPr plus the optional
/// `<anchor>` grandchild, in a shape suitable for both WASM JSON output and
/// typed round-trip bookkeeping on `OleObjectOoxmlProps`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OleObjectProperties {
    pub default_size: bool,
    pub print: bool,
    pub disabled: bool,
    pub locked: bool,
    pub auto_fill: bool,
    pub auto_line: bool,
    pub auto_pict: bool,
    pub r#macro: Option<String>,
    pub alt_text: Option<String>,
    pub dde: bool,
    #[serde(default)]
    pub ui_object: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r_id: Option<String>,
    pub anchor: Option<OleObjectAnchor>,
}

/// `<anchor>` child of `<objectPr>`, pairing two cell-anchor endpoints.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OleObjectAnchor {
    pub move_with_cells: bool,
    pub size_with_cells: bool,
    pub from: OleAnchorPoint,
    pub to: OleAnchorPoint,
}

/// A single cell-anchor endpoint for `<objectPr><anchor>`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OleAnchorPoint {
    pub col: u32,
    pub col_off: i64,
    pub row: u32,
    pub row_off: i64,
}
