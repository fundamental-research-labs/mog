use serde::{Deserialize, Serialize};

use crate::domain::drawings::ManualLayout;

use super::{ChartFormatData, ChartShadowData, LegendEntryData};

/// Chart legend configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegendData {
    #[serde(default)]
    pub show: bool,
    #[serde(default)]
    pub position: String,
    #[serde(default)]
    pub visible: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overlay: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entries: Option<Vec<LegendEntryData>>,
    /// Custom X position (0.0 to 1.0, fraction of chart width).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub custom_x: Option<f64>,
    /// Custom Y position (0.0 to 1.0, fraction of chart height).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub custom_y: Option<f64>,
    /// OOXML manual legend layout. When present this is the authoritative
    /// source; custom_x/custom_y remain compatibility projections.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub layout: Option<ManualLayout>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub shadow: Option<ChartShadowData>,
    // -- Additional legend properties --
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_shadow: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PieSliceData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explosion: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exploded_indices: Option<Vec<u32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explode_offset: Option<u32>,
    /// Whether all slices are exploded.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub explode_all: Option<bool>,
}
