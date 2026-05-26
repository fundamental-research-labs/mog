use super::formatting::ChartFormatData;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartDataTableData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_horz_border: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_vert_border: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_outline: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_keys: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<ChartFormatData>,
    /// Whether to show legend keys in the data table.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_legend_key: Option<bool>,
    /// Whether the data table is visible.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub visible: Option<bool>,
}
