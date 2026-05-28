use super::common::map_ooxml_chart_type_to_domain;
use super::data_refs::{
    extract_cat_ref_formula, extract_num_ref_formula, reconstruct_data_range,
    reconstruct_data_range_from_chart_groups,
};
use super::formatting::extract_fill_color;
use super::labels::extract_data_label_data;
use super::markers::extract_marker_config;
use super::series::extract_single_series;

pub(in crate::domain::charts::read) fn extract_chart_series(
    chart: &crate::domain::charts::Chart,
) -> Vec<domain_types::chart::ChartSeriesData> {
    use crate::domain::charts::series::SeriesTextSource;

    if !chart.chart_groups.is_empty() {
        let is_combo = chart.chart_groups.len() > 1;
        return chart
            .chart_groups
            .iter()
            .flat_map(|g| {
                let series_type = if is_combo {
                    Some(map_ooxml_chart_type_to_domain(g.chart_type, &g.config))
                } else {
                    None
                };
                g.series
                    .iter()
                    .map(move |s| extract_single_series(s, series_type.clone()))
            })
            .collect();
    }

    chart
        .series
        .iter()
        .map(|s| {
            let name = s.tx.as_ref().and_then(|tx| match tx {
                SeriesTextSource::Value(v) => Some(v.clone()),
                SeriesTextSource::StrRef(sr) => sr
                    .str_cache
                    .as_ref()
                    .and_then(|c| c.pts.first().map(|pt| pt.v.clone())),
            });

            let color = s.sp_pr.as_ref().and_then(|sp| extract_fill_color(sp));

            // Values range: val (standard) or y_val (scatter/bubble)
            let values =
                extract_num_ref_formula(&s.val).or_else(|| extract_num_ref_formula(&s.y_val));

            // Categories range: cat (standard) or x_val (scatter/bubble)
            let categories =
                extract_cat_ref_formula(&s.cat).or_else(|| extract_cat_ref_formula(&s.x_val));

            let bubble_size = extract_num_ref_formula(&s.bubble_size);

            // Markers
            let (show_markers, marker_size, marker_style) = extract_marker_config(&s.marker);

            // Per-point formatting
            let points = if s.d_pt.is_empty() {
                None
            } else {
                Some(
                    s.d_pt
                        .iter()
                        .map(|pt| {
                            let fill = pt.sp_pr.as_ref().and_then(|sp| extract_fill_color(sp));
                            domain_types::chart::PointFormatData {
                                idx: pt.idx,
                                fill,
                                border: None,
                                data_label: None,
                                visual_format: None,
                                marker_background_color: None,
                                marker_foreground_color: None,
                                marker_size: None,
                                marker_style: None,
                            }
                        })
                        .collect(),
                )
            };

            // Trendlines
            let trendlines = if s.trendline.is_empty() {
                None
            } else {
                Some(
                    s.trendline
                        .iter()
                        .map(|t| domain_types::chart::TrendlineData {
                            show: None,
                            r#type: Some(t.trendline_type.to_ooxml().to_string()),
                            color: None,
                            line_width: None,
                            order: t.order,
                            period: t.period,
                            forward: t.forward,
                            backward: t.backward,
                            intercept: None,
                            display_equation: t.disp_eq,
                            display_r_squared: t.disp_r_sqr,
                            name: t.name.clone(),
                            line_format: None,
                            label: None,
                        })
                        .collect(),
                )
            };

            // Error bars
            let (error_bars, x_error_bars, y_error_bars) = extract_error_bars_typed(&s.err_bars);

            // Series-level data labels
            let data_labels = s.d_lbls.as_ref().map(|dl| extract_data_label_data(dl));

            domain_types::chart::ChartSeriesData {
                name,
                r#type: None, // follow-up: derive per-series type for combo charts
                color,
                values,
                categories,
                bubble_size,
                smooth: s.smooth,
                explosion: s.explosion,
                invert_if_negative: s.invert_if_negative,
                y_axis_index: None, // follow-up: derive from c:axId cross-reference
                show_markers,
                marker_size,
                marker_style,
                line_width: None,
                points,
                data_labels,
                trendlines,
                error_bars,
                x_error_bars,
                y_error_bars,
                idx: Some(s.idx),
                order: Some(s.order),
                format: None,
                bar_shape: None,
                invert_color: None,
                marker_background_color: None,
                marker_foreground_color: None,
                filtered: None,
                show_shadow: None,
                show_connector_lines: None,
                leader_line_format: None,
                show_leader_lines: None,
            }
        })
        .collect()
}

fn extract_error_bars_typed(
    err_bars: &[ooxml_types::charts::ErrorBars],
) -> (
    Option<domain_types::chart::ErrorBarData>,
    Option<domain_types::chart::ErrorBarData>,
    Option<domain_types::chart::ErrorBarData>,
) {
    let mut general = None;
    let mut x_bars = None;
    let mut y_bars = None;

    for eb in err_bars {
        let data = domain_types::chart::ErrorBarData {
            visible: None,
            direction: eb.err_dir.as_ref().map(|d| d.to_ooxml().to_string()),
            bar_type: Some(eb.err_bar_type.to_ooxml().to_string()),
            value_type: Some(eb.err_val_type.to_ooxml().to_string()),
            value: eb.val,
            no_end_cap: None,
            line_format: None,
        };
        match eb.err_dir {
            Some(ooxml_types::charts::ErrorBarDirection::X) => x_bars = Some(data),
            Some(ooxml_types::charts::ErrorBarDirection::Y) => y_bars = Some(data),
            None => general = Some(data),
        }
    }

    (general, x_bars, y_bars)
}

pub(in crate::domain::charts::read) fn extract_legend(
    chart: &crate::domain::charts::Chart,
) -> Option<domain_types::chart::LegendData> {
    use ooxml_types::charts::LegendPosition;

    chart.legend.as_ref().map(|l| {
        let position = match l.legend_pos.unwrap_or(LegendPosition::Right) {
            LegendPosition::Bottom => "bottom",
            LegendPosition::Top => "top",
            LegendPosition::Left => "left",
            LegendPosition::Right => "right",
            LegendPosition::TopRight => "right",
        };
        domain_types::chart::LegendData {
            show: false,
            position: position.to_string(),
            visible: true,
            overlay: None,
            format: None,
            entries: None,
            custom_x: None,
            custom_y: None,
            shadow: None,
            show_shadow: None,
        }
    })
}

/// Extract axes as typed AxisData.
pub(in crate::domain::charts::read) fn extract_axes(
    chart: &crate::domain::charts::Chart,
) -> Option<domain_types::chart::AxisData> {
    let cat_ax = chart
        .plot_area
        .cat_ax
        .as_ref()
        .or(chart.plot_area.date_ax.as_ref());
    let val_ax = chart.plot_area.val_ax.as_ref();

    if cat_ax.is_none() && val_ax.is_none() {
        return None;
    }

    let category_axis = cat_ax.map(|ax| domain_types::chart::SingleAxisData {
        title: ax
            .title
            .as_ref()
            .and_then(crate::domain::charts::axes::extract_title_text),
        visible: !ax.delete,
        ..Default::default()
    });

    let value_axis = val_ax.map(|ax| domain_types::chart::SingleAxisData {
        title: ax
            .title
            .as_ref()
            .and_then(crate::domain::charts::axes::extract_title_text),
        visible: !ax.delete,
        min: ax.scaling.min,
        max: ax.scaling.max,
        ..Default::default()
    });

    Some(domain_types::chart::AxisData {
        category_axis,
        value_axis,
        secondary_category_axis: None,
        secondary_value_axis: None,
        series_axis: None,
    })
}

/// Extract chart-level data labels as typed DataLabelData.
pub(in crate::domain::charts::read) fn extract_chart_data_labels(
    chart: &crate::domain::charts::Chart,
) -> Option<domain_types::chart::DataLabelData> {
    chart
        .data_labels
        .as_ref()
        .map(|dl| extract_data_label_data(dl))
}

/// Extract a reconstructed data range from all series references.
pub(in crate::domain::charts::read) fn extract_data_range(
    chart: &crate::domain::charts::Chart,
) -> Option<String> {
    if matches!(
        chart.chart_type,
        ooxml_types::charts::ChartType::Scatter | ooxml_types::charts::ChartType::Bubble
    ) {
        return None;
    }
    if !chart.chart_groups.is_empty() {
        return reconstruct_data_range_from_chart_groups(&chart.chart_groups);
    }
    reconstruct_data_range(&chart.series)
}

/// Map Rust ChartType + config to the TS ChartType string.
pub(in crate::domain::charts::read) fn map_chart_type_to_ts(
    chart: &crate::domain::charts::Chart,
) -> String {
    use ooxml_types::charts::{BarDirection, ChartType, ChartTypeConfig};

    match chart.chart_type {
        ChartType::Bar => {
            // Check bar direction from config
            match &chart.chart_type_config {
                Some(ChartTypeConfig::Bar(bc)) => match bc.bar_dir {
                    BarDirection::Bar => "bar".to_string(),
                    BarDirection::Column => "column".to_string(),
                },
                _ => "column".to_string(),
            }
        }
        ChartType::Bar3D => match &chart.chart_type_config {
            Some(ChartTypeConfig::Bar3D(bc)) => match bc.bar_dir {
                BarDirection::Bar => "bar3d".to_string(),
                BarDirection::Column => "column3d".to_string(),
            },
            _ => "column3d".to_string(),
        },
        ChartType::Line => "line".to_string(),
        ChartType::Line3D => "line3d".to_string(),
        ChartType::Pie => "pie".to_string(),
        ChartType::Pie3D => "pie3d".to_string(),
        ChartType::Doughnut => "doughnut".to_string(),
        ChartType::Area => "area".to_string(),
        ChartType::Area3D => "area3d".to_string(),
        ChartType::Scatter => "scatter".to_string(),
        ChartType::Bubble => "bubble".to_string(),
        ChartType::Radar => "radar".to_string(),
        ChartType::Stock => "stock".to_string(),
        ChartType::Surface => "surface".to_string(),
        ChartType::Surface3D => "surface3d".to_string(),
        ChartType::OfPie => "ofPie".to_string(),
        _ => "column".to_string(), // Default fallback
    }
}

/// Extract sub-type string from chart type config (grouping).
pub(in crate::domain::charts::read) fn extract_sub_type(
    chart: &crate::domain::charts::Chart,
) -> Option<String> {
    use ooxml_types::charts::ChartTypeConfig;

    match &chart.chart_type_config {
        Some(ChartTypeConfig::Bar(c)) => c.grouping.as_ref().and_then(grouping_to_sub_type),
        Some(ChartTypeConfig::Bar3D(c)) => c.grouping.as_ref().and_then(grouping_to_sub_type),
        Some(ChartTypeConfig::Line(c)) => grouping_to_sub_type(&c.grouping),
        Some(ChartTypeConfig::Line3D(c)) => grouping_to_sub_type(&c.grouping),
        Some(ChartTypeConfig::Area(c)) => c.grouping.as_ref().and_then(grouping_to_sub_type),
        Some(ChartTypeConfig::Area3D(c)) => c.grouping.as_ref().and_then(grouping_to_sub_type),
        _ => None,
    }
}

/// Convert Grouping enum to sub-type string.
fn grouping_to_sub_type(g: &ooxml_types::charts::Grouping) -> Option<String> {
    match g {
        ooxml_types::charts::Grouping::Clustered => Some("clustered".to_string()),
        ooxml_types::charts::Grouping::Stacked => Some("stacked".to_string()),
        ooxml_types::charts::Grouping::PercentStacked => Some("percentStacked".to_string()),
        ooxml_types::charts::Grouping::Standard => None, // Default, don't emit
    }
}
