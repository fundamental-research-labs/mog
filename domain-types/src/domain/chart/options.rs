use serde::{Deserialize, Serialize};

use super::{ChartSubType, ChartType};

/// Pivot chart display options (field button visibility).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotChartOptionsData {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_axis_field_buttons: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_legend_field_buttons: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_report_filter_field_buttons: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_value_field_buttons: Option<bool>,
}

pub(super) fn radar_flags_from_sub_type(
    chart_type: &ChartType,
    sub_type: Option<&ChartSubType>,
) -> (Option<bool>, Option<bool>) {
    if !matches!(chart_type, ChartType::Radar) {
        return (None, None);
    }

    match sub_type {
        Some(ChartSubType::Filled) => (Some(true), None),
        Some(ChartSubType::Markers) => (None, Some(true)),
        _ => (None, None),
    }
}
