use super::common::map_ooxml_chart_type_to_domain;
use super::data_refs::{extract_cat_ref_formula, extract_num_ref_formula};
use super::formatting::{extract_chart_format, extract_chart_line, extract_fill_color};
use super::labels::extract_data_label_data;
use super::markers::extract_marker_config;
use super::text::extract_chart_text_string;

pub(super) fn extract_series_from_chart_space(
    cs: &ooxml_types::charts::ChartSpace,
) -> Vec<domain_types::chart::ChartSeriesData> {
    let is_combo = cs.chart.plot_area.chart_groups.len() > 1;
    cs.chart
        .plot_area
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
        .collect()
}

/// Extract a single series from an ooxml ChartSeries.
pub(super) fn extract_single_series(
    s: &ooxml_types::charts::ChartSeries,
    series_type: Option<domain_types::ChartType>,
) -> domain_types::chart::ChartSeriesData {
    use ooxml_types::charts::SeriesTextSource;

    // Name
    let name = s.tx.as_ref().and_then(|tx| match tx {
        SeriesTextSource::Value(v) => Some(v.clone()),
        SeriesTextSource::StrRef(sr) => sr
            .str_cache
            .as_ref()
            .and_then(|c| c.pts.first().map(|pt| pt.v.clone())),
    });

    // Legacy fill color
    let color = s.sp_pr.as_ref().and_then(|sp| extract_fill_color(sp));

    // Values range: val (standard) or y_val (scatter/bubble)
    let values = extract_num_ref_formula(&s.val).or_else(|| extract_num_ref_formula(&s.y_val));

    // Categories range: cat (standard) or x_val (scatter/bubble)
    let categories = extract_cat_ref_formula(&s.cat).or_else(|| extract_cat_ref_formula(&s.x_val));

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
                    let visual_format = extract_chart_format(pt.sp_pr.as_ref(), None);
                    domain_types::chart::PointFormatData {
                        idx: pt.idx,
                        fill,
                        border: None,
                        data_label: None,
                        visual_format,
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
                .map(|t| {
                    let line_format = t
                        .sp_pr
                        .as_ref()
                        .and_then(|sp| sp.ln.as_ref())
                        .map(|ln| extract_chart_line(ln));
                    let label = t.trendline_lbl.as_ref().map(|lbl| {
                        let text = lbl.tx.as_ref().and_then(|tx| extract_chart_text_string(tx));
                        let format = extract_chart_format(lbl.sp_pr.as_ref(), lbl.tx_pr.as_ref());
                        let number_format = lbl.num_fmt.as_ref().map(|nf| nf.format_code.clone());
                        let layout = lbl.layout.as_ref().map(Into::into);
                        domain_types::chart::TrendlineLabelData {
                            text,
                            format,
                            number_format,
                            layout,
                        }
                    });
                    domain_types::chart::TrendlineData {
                        show: None,
                        r#type: Some(t.trendline_type.to_ooxml().to_string()),
                        color: None,
                        line_width: None,
                        order: t.order,
                        period: t.period,
                        forward: t.forward,
                        backward: t.backward,
                        intercept: t.intercept,
                        display_equation: t.disp_eq,
                        display_r_squared: t.disp_r_sqr,
                        name: t.name.clone(),
                        line_format,
                        label,
                    }
                })
                .collect(),
        )
    };

    // Error bars
    let (error_bars, x_error_bars, y_error_bars) = extract_error_bars_new(&s.err_bars);

    // Series-level data labels
    let data_labels = s.d_lbls.as_ref().map(|dl| extract_data_label_data(dl));

    // Rich format from sp_pr + tx_pr
    let format = extract_chart_format(s.sp_pr.as_ref(), None);

    // Bar shape
    let bar_shape = s.shape.map(|bs| bs.to_ooxml().to_string());

    domain_types::chart::ChartSeriesData {
        name,
        r#type: series_type,
        color,
        values,
        categories,
        bubble_size,
        smooth: s.smooth,
        explosion: s.explosion,
        invert_if_negative: s.invert_if_negative,
        y_axis_index: None,
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
        format,
        bar_shape,
        invert_color: None,
        marker_background_color: None,
        marker_foreground_color: None,
        filtered: None,
        show_shadow: None,
        show_connector_lines: None,
        leader_line_format: None,
        show_leader_lines: None,
    }
}

/// Extract error bars with line_format support.
fn extract_error_bars_new(
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
        let line_format = eb
            .sp_pr
            .as_ref()
            .and_then(|sp| sp.ln.as_ref())
            .map(|ln| extract_chart_line(ln));
        let data = domain_types::chart::ErrorBarData {
            visible: None,
            direction: eb.err_dir.as_ref().map(|d| d.to_ooxml().to_string()),
            bar_type: Some(eb.err_bar_type.to_ooxml().to_string()),
            value_type: Some(eb.err_val_type.to_ooxml().to_string()),
            value: eb.val,
            no_end_cap: eb.no_end_cap,
            line_format,
        };
        match eb.err_dir {
            Some(ooxml_types::charts::ErrorBarDirection::X) => x_bars = Some(data),
            Some(ooxml_types::charts::ErrorBarDirection::Y) => y_bars = Some(data),
            None => general = Some(data),
        }
    }

    (general, x_bars, y_bars)
}

// Extract legend from ChartSpace.
