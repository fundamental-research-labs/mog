use serde::{Deserialize, Serialize};

use crate::domain::drawings::ManualLayout;

use super::formatting::{ChartFormatData, ChartFormatStringData, ChartLineData};

/// Chart axes configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_axis: Option<SingleAxisData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_axis: Option<SingleAxisData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary_category_axis: Option<SingleAxisData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary_value_axis: Option<SingleAxisData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series_axis: Option<SingleAxisData>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SingleAxisData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default)]
    pub visible: bool,
    /// Whether axis visibility was explicitly authored. This distinguishes an
    /// omitted OOXML `<c:delete>` default from an explicit `delete val="0"`.
    #[serde(default, skip_serializing_if = "crate::is_false")]
    pub visible_explicit: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub axis_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grid_lines: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minor_grid_lines: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub major_unit: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minor_unit: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tick_marks: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minor_tick_marks: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reverse: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log_base: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_rich_text: Option<Vec<ChartFormatStringData>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub gridline_format: Option<ChartLineData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub minor_gridline_format: Option<ChartLineData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub cross_between: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tick_label_position: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub base_time_unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub major_time_unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub minor_time_unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub custom_display_unit: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub display_unit_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub display_unit_label_layout: Option<ManualLayout>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub display_unit_label_format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub label_alignment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub label_offset: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub no_multi_level_labels: Option<bool>,
    // -- Additional axis properties --
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_visible: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tick_label_spacing: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tick_mark_spacing: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub link_number_format: Option<bool>,
    /// Scale type: "linear" or "logarithmic".
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub scale_type: Option<String>,
    /// Category axis type: "automatic", "text", "date".
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub category_type: Option<String>,
    /// Where axis crosses: "automatic", "min", "max", "custom".
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub crosses_at: Option<String>,
    /// Custom crossing value when crosses_at is "custom".
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub crosses_at_value: Option<f64>,
    /// Whether tick marks are between categories (true) or on categories (false).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub is_between_categories: Option<bool>,
    /// Text orientation angle in degrees (-90 to 90). OOXML vertical text mode
    /// is carried separately on ChartFormatData::text_vertical_type.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub text_orientation: Option<f64>,
    /// Horizontal alignment for axis labels: "left", "center", "right", etc.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub alignment: Option<String>,
}
