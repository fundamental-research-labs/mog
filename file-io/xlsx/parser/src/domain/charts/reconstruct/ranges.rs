//! Data-range to series synthesis for reconstructed charts.

use domain_types::chart::{
    ChartSeriesData, ChartSpec, apply_explicit_chart_source_ranges,
    synthesize_chart_series_from_data_range,
};

pub(super) fn series_for_export(spec: &ChartSpec) -> Vec<ChartSeriesData> {
    if !spec.series.is_empty() {
        return spec.series.clone();
    }

    let mut series = spec
        .data_range
        .as_deref()
        .and_then(|data_range| {
            synthesize_chart_series_from_data_range(&spec.chart_type, data_range)
        })
        .unwrap_or_default();
    apply_explicit_chart_source_ranges(
        &mut series,
        spec.category_range.as_deref(),
        spec.series_range.as_deref(),
    );
    series
}

pub(super) fn chart_series_data(
    name: Option<String>,
    categories: Option<String>,
    values: Option<String>,
    idx: u32,
) -> ChartSeriesData {
    ChartSeriesData {
        name,
        name_ref: None,
        r#type: None,
        color: None,
        stock_role: None,
        values,
        value_cache: None,
        value_source_kind: None,
        categories,
        x_role: None,
        category_cache: None,
        category_source_kind: None,
        category_source_type: None,
        category_levels: None,
        category_label_format: None,
        bubble_size: None,
        bubble_size_cache: None,
        bubble_size_source_kind: None,
        bubble_3d: None,
        smooth: None,
        show_lines: None,
        explosion: None,
        invert_if_negative: None,
        y_axis_index: None,
        show_markers: None,
        marker_size: None,
        marker_style: None,
        line_width: None,
        points: None,
        data_labels: None,
        trendlines: None,
        error_bars: None,
        x_error_bars: None,
        y_error_bars: None,
        idx: Some(idx),
        order: Some(idx),
        format: None,
        bar_shape: None,
        invert_color: None,
        marker_background_color: None,
        marker_foreground_color: None,
        marker_line_format: None,
        filtered: None,
        source_series_index: None,
        source_series_key: None,
        visible_order: None,
        pivot_series_key: None,
        pivot_data_field_index: None,
        projection_authority: None,
        projection_diagnostics: Vec::new(),
        show_shadow: None,
        show_connector_lines: None,
        leader_line_format: None,
        show_leader_lines: None,
        bin_options: None,
        boxwhisker_options: None,
    }
}
