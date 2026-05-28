//! Wire-format types for IPC deserialization from TypeScript.

use serde::Deserialize;

use cell_types::RangePos;

use super::{
    CFDataBarAxisPosition, CFDataBarDirection, CFIconSetName, CFIconThresholdOperator, CFOperator,
    CFRuleType, CFTextOperator, CFValueType, CfRenderStyle, CfValue, CustomIcon, DatePeriod,
};

fn default_true() -> bool {
    true
}

fn default_min_length() -> u8 {
    10
}

fn default_max_length() -> u8 {
    90
}

/// Wire format for a color point (min, mid, or max).
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CFColorPointWire {
    #[serde(rename = "type")]
    pub value_type: CFValueType,
    /// Threshold operand. Typed in typed formula boundary; consumed by
    /// `parse_point_value` in `convert.rs`.
    pub value: Option<CfValue>,
    pub color: String,
}

/// Wire format for a color scale (2 or 3 colors).
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CFColorScaleWire {
    pub min_point: CFColorPointWire,
    pub mid_point: Option<CFColorPointWire>,
    pub max_point: CFColorPointWire,
}

/// Wire format for a data bar.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CFDataBarWire {
    pub min_point: CFColorPointWire,
    pub max_point: CFColorPointWire,
    pub positive_color: String,
    pub negative_color: Option<String>,
    pub border_color: Option<String>,
    pub negative_border_color: Option<String>,
    #[serde(default)]
    pub show_border: bool,
    #[serde(default)]
    pub gradient: bool,
    #[serde(default)]
    pub direction: CFDataBarDirection,
    #[serde(default)]
    pub axis_position: CFDataBarAxisPosition,
    pub axis_color: Option<String>,
    #[serde(default = "default_true")]
    pub show_value: bool,
    #[serde(default = "default_min_length")]
    pub min_length: u8,
    #[serde(default = "default_max_length")]
    pub max_length: u8,
    /// When true, negative bars use the positive fill color instead of negative_color.
    #[serde(default)]
    pub match_positive_fill_color: bool,
    /// When true, negative bars use the positive border color instead of negative_border_color.
    #[serde(default)]
    pub match_positive_border_color: bool,
}

/// Wire format for an icon threshold.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CFIconThresholdWire {
    #[serde(rename = "type")]
    pub value_type: CFValueType,
    /// Threshold operand. Typed in typed formula boundary
    pub value: Option<CfValue>,
    pub operator: CFIconThresholdOperator,
    /// Custom icon override — use an icon from a different set for this threshold.
    pub custom_icon: Option<CustomIcon>,
}

/// Wire format for an icon set.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CFIconSetWire {
    pub icon_set_name: CFIconSetName,
    pub thresholds: Vec<CFIconThresholdWire>,
    pub percent: Option<bool>,
    #[serde(default)]
    pub reverse_order: bool,
    #[serde(default)]
    pub show_icon_only: bool,
}

/// Wire format for a CF rule, received from TypeScript via IPC.
/// Flat struct with many optional fields -- converted to `CFRule` at the boundary.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CFRuleWire {
    pub rule_type: CFRuleType,
    pub priority: i32,
    #[serde(default)]
    pub stop_if_true: bool,
    pub style: Option<CfRenderStyle>,
    pub operator: Option<CFOperator>,
    /// Operand values for cell-value comparisons (1 value for scalar
    /// operators, 2 for between/notBetween). Typed in typed formula boundary —
    /// replaced the previous lossy `Vec<String>` that round-tripped
    /// threshold operands through `json_value_to_string`.
    #[serde(default)]
    pub values: Vec<CfValue>,
    pub formula: Option<String>,
    pub color_scale: Option<CFColorScaleWire>,
    pub data_bar: Option<CFDataBarWire>,
    pub icon_set: Option<CFIconSetWire>,
    pub text: Option<String>,
    pub text_operator: Option<CFTextOperator>,
    pub date_period: Option<DatePeriod>,
    pub rank: Option<u32>,
    pub percent: Option<bool>,
    pub bottom: Option<bool>,
    pub above: Option<bool>,
    pub equal_average: Option<bool>,
    pub std_dev: Option<i32>,
    pub unique: Option<bool>,
    pub blanks: Option<bool>,
    pub errors: Option<bool>,
    #[serde(default)]
    pub ranges: Vec<RangePos>,
}
