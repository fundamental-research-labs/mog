use serde::{Deserialize, Serialize};

use crate::domain::drawings::ManualLayout;

use super::TrendlineLabelData;
use super::formatting::{ChartFormatData, ChartFormatStringData, ChartLineData};
use super::series::ChartSeriesPointCacheData;

/// Data label configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataLabelData {
    #[serde(default)]
    pub show: bool,
    /// Explicit OOXML delete/suppression. This is distinct from an absent label
    /// and from an effective hidden label inherited from parent defaults.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub delete: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_value: Option<bool>,
    #[serde(alias = "showCategory", skip_serializing_if = "Option::is_none")]
    pub show_category_name: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_series_name: Option<bool>,
    #[serde(alias = "showPercent", skip_serializing_if = "Option::is_none")]
    pub show_percentage: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_bubble_size: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_legend_key: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub separator: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_leader_lines: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visual_format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
    /// Text orientation angle in degrees (-90 to 90).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub text_orientation: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub rich_text: Option<Vec<ChartFormatStringData>>,
    // -- Additional data label properties --
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub auto_text: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub horizontal_alignment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub vertical_alignment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub link_number_format: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub geometric_shape_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub formula: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub leader_lines_format: Option<ChartLineData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub layout: Option<ManualLayout>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendlineData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub period: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forward: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backward: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intercept: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_equation: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_r_squared: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_format: Option<ChartLineData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<TrendlineLabelData>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorBarData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visible: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bar_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no_end_cap: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_format: Option<ChartLineData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub plus_source: Option<ErrorBarSourceData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub minus_source: Option<ErrorBarSourceData>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorBarSourceData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache: Option<ChartSeriesPointCacheData>,
}
