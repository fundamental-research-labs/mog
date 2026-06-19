use serde::{Deserialize, Serialize};

use super::floating_object::ChartData;
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

pub(super) fn radar_sub_type_from_flags(
    chart_type: &ChartType,
    radar_filled: Option<bool>,
    radar_markers: Option<bool>,
) -> Option<ChartSubType> {
    if !matches!(chart_type, ChartType::Radar) {
        return None;
    }

    match (radar_filled, radar_markers) {
        (Some(true), _) => Some(ChartSubType::Filled),
        (_, Some(true)) => Some(ChartSubType::Markers),
        _ => None,
    }
}

pub(super) fn effective_sub_type_from_chart_data(chart_data: &ChartData) -> Option<ChartSubType> {
    chart_data.sub_type.clone().or_else(|| {
        radar_sub_type_from_flags(
            &chart_data.chart_type,
            chart_data.radar_filled,
            chart_data.radar_markers,
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn radar_flags_convert_to_renderable_subtypes() {
        assert_eq!(
            radar_sub_type_from_flags(&ChartType::Radar, None, Some(true)),
            Some(ChartSubType::Markers)
        );
        assert_eq!(
            radar_sub_type_from_flags(&ChartType::Radar, Some(true), None),
            Some(ChartSubType::Filled)
        );
        assert_eq!(
            radar_sub_type_from_flags(&ChartType::Line, None, Some(true)),
            None
        );
    }
}
