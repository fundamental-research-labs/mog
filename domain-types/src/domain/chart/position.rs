use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AnchorPosition {
    pub anchor_row: u32,
    pub anchor_col: u32,
    /// EMU offset
    pub anchor_row_offset: i64,
    /// EMU offset
    pub anchor_col_offset: i64,
    /// Absolute x position in EMU for `xdr:absoluteAnchor`.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub absolute_x: Option<i64>,
    /// Absolute y position in EMU for `xdr:absoluteAnchor`.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub absolute_y: Option<i64>,
    /// Two-cell anchor end row
    pub end_row: Option<u32>,
    /// Two-cell anchor end col
    pub end_col: Option<u32>,
    pub end_row_offset: Option<i64>,
    pub end_col_offset: Option<i64>,
    /// One-cell anchor extent cx in EMUs (only set for oneCellAnchor).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub extent_cx: Option<i64>,
    /// One-cell anchor extent cy in EMUs (only set for oneCellAnchor).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub extent_cy: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ObjectSize {
    /// Pixels
    pub width: f64,
    /// Pixels
    pub height: f64,
    /// Height in points (API-level unit, independent of pixel DPI).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub height_pt: Option<f64>,
    /// Width in points.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub width_pt: Option<f64>,
    /// Left offset in points.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub left_pt: Option<f64>,
    /// Top offset in points.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub top_pt: Option<f64>,
}
