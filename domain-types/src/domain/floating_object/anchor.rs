use serde::{Deserialize, Serialize};

// ===========================================================================
// SECTION C: Anchor Types
// ===========================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AnchorMode {
    #[serde(rename = "oneCell")]
    OneCell,
    #[serde(rename = "twoCell")]
    TwoCell,
    #[serde(rename = "absolute")]
    Absolute,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct FloatingObjectAnchor {
    pub anchor_row: u32,
    pub anchor_col: u32,
    /// EMU offset from anchor cell.
    #[serde(rename = "anchorRowOffsetEmu", alias = "anchorRowOffset")]
    pub anchor_row_offset: i64,
    /// EMU offset from anchor cell.
    #[serde(rename = "anchorColOffsetEmu", alias = "anchorColOffset")]
    pub anchor_col_offset: i64,
    pub anchor_mode: AnchorMode,
    /// Absolute x position in EMU for `xdr:absoluteAnchor`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "absoluteXEmu", alias = "absoluteX")]
    pub absolute_x: Option<i64>,
    /// Absolute y position in EMU for `xdr:absoluteAnchor`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "absoluteYEmu", alias = "absoluteY")]
    pub absolute_y: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_row: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_col: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "endRowOffsetEmu", alias = "endRowOffset")]
    pub end_row_offset: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "endColOffsetEmu", alias = "endColOffset")]
    pub end_col_offset: Option<i64>,
    /// Extent cx in EMU (oneCell anchor).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "extentCxEmu", alias = "extentCx")]
    pub extent_cx: Option<i64>,
    /// Extent cy in EMU (oneCell anchor).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "extentCyEmu", alias = "extentCy")]
    pub extent_cy: Option<i64>,
}

impl Default for FloatingObjectAnchor {
    fn default() -> Self {
        Self {
            anchor_row: 0,
            anchor_col: 0,
            anchor_row_offset: 0,
            anchor_col_offset: 0,
            anchor_mode: AnchorMode::OneCell,
            absolute_x: None,
            absolute_y: None,
            end_row: None,
            end_col: None,
            end_row_offset: None,
            end_col_offset: None,
            extent_cx: None,
            extent_cy: None,
        }
    }
}
