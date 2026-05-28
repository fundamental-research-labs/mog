//! Chart type group detection and combo chart grouping.

use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_tag_simd,
};

use super::super::xml_helpers::{find_pos_after_last_ser, parse_ax_ids};
use super::super::*;
use super::attrs;
use super::config;

pub(super) type ParsedChartTypeAndSeries = (
    ChartType,
    bool,
    Vec<ChartSeries>,
    Option<ChartTypeConfig>,
    Option<DataLabelOptions>,
    Vec<u32>,
    Option<String>,
    Vec<ooxml_types::charts::ChartGroup>,
);

/// Parse chart type and series from plot area.
/// Returns: (chart_type, is_3d, series, config, d_lbls, ax_ids_from_chart_type, raw_chart_type_attr, chart_groups)
///
/// For combo charts (multiple chart type elements in plotArea), `chart_groups` contains
/// individually-parsed ChartGroup entries preserving per-group config, series, dLbls, and axIds.
/// The flat `series` field is the union of all groups' series for backwards compatibility.
pub(super) fn parse_chart_type_and_series(xml: &[u8]) -> ParsedChartTypeAndSeries {
    use ooxml_types::charts as oc;

    // List of chart type tags to check
    let chart_types: &[(&[u8], ChartType, bool)] = &[
        (b"barChart", ChartType::Bar, false),
        (b"bar3DChart", ChartType::Bar3D, true),
        (b"lineChart", ChartType::Line, false),
        (b"line3DChart", ChartType::Line3D, true),
        (b"pieChart", ChartType::Pie, false),
        (b"pie3DChart", ChartType::Pie3D, true),
        (b"doughnutChart", ChartType::Doughnut, false),
        (b"areaChart", ChartType::Area, false),
        (b"area3DChart", ChartType::Area3D, true),
        (b"scatterChart", ChartType::Scatter, false),
        (b"bubbleChart", ChartType::Bubble, false),
        (b"radarChart", ChartType::Radar, false),
        (b"surfaceChart", ChartType::Surface, false),
        (b"surface3DChart", ChartType::Surface3D, true),
        (b"stockChart", ChartType::Stock, false),
        (b"ofPieChart", ChartType::OfPie, false),
    ];

    // Scan for ALL occurrences of every chart type tag, recording byte offset.
    // This handles both multiple different types (areaChart + lineChart) and
    // duplicate types (lineChart + lineChart).
    let mut found_occurrences: Vec<(&[u8], ChartType, bool, usize)> = Vec::new();
    for (tag, chart_type, is_3d) in chart_types {
        let mut pos = 0;
        while let Some(start) = find_tag_simd(xml, tag, pos) {
            found_occurrences.push((tag, *chart_type, *is_3d, start));
            let end = find_closing_tag(xml, tag, start).unwrap_or(xml.len());
            pos = end;
        }
    }
    // Sort by byte offset to preserve original XML element order
    found_occurrences.sort_by_key(|&(_, _, _, start)| start);

    // If multiple chart type elements found, it's a combo chart
    if found_occurrences.len() > 1 {
        let mut all_series = Vec::new();
        let mut all_ax_ids = Vec::new();
        let mut groups = Vec::new();

        for (tag, chart_type, _, start) in &found_occurrences {
            let type_end = find_closing_tag(xml, tag, *start).unwrap_or(xml.len());
            let type_bytes = &xml[*start..type_end];

            let final_type = if *chart_type == ChartType::Bar {
                check_bar_direction(type_bytes)
            } else {
                *chart_type
            };

            let series = parse_all_series(type_bytes);
            let config = config::parse_chart_type_config(*chart_type, type_bytes);
            let ax_ids = parse_ax_ids(type_bytes);
            let raw_attr = attrs::parse_string_attr(&xml[*start..], b"chartType=\"");

            // Chart-group-level dLbls comes AFTER all <c:ser> elements in the
            // schema.  We must skip past all series to avoid matching a
            // series-level <c:dLbls> nested inside <c:ser>.
            let after_last_ser = find_pos_after_last_ser(type_bytes);
            let d_lbls =
                if let Some(dlbls_start) = find_tag_simd(type_bytes, b"dLbls", after_last_ser) {
                    let dlbls_end = find_closing_tag(type_bytes, b"dLbls", dlbls_start)
                        .unwrap_or(type_bytes.len());
                    Some(parse_data_labels(&type_bytes[dlbls_start..dlbls_end]))
                } else {
                    None
                };

            all_series.extend(series.clone());
            for id in &ax_ids {
                if !all_ax_ids.contains(id) {
                    all_ax_ids.push(*id);
                }
            }

            groups.push(oc::ChartGroup {
                chart_type: final_type,
                config: config.unwrap_or(ChartTypeConfig::Combo),
                series,
                d_lbls,
                ax_id: ax_ids,
                raw_chart_type_attr: raw_attr,
            });
        }

        return (
            ChartType::Combo,
            false,
            all_series,
            Some(ChartTypeConfig::Combo),
            None,
            all_ax_ids,
            None,
            groups,
        );
    }

    // Single chart type or no chart type found
    if let Some((tag, chart_type, is_3d, start)) = found_occurrences.first() {
        let type_end = find_closing_tag(xml, tag, *start).unwrap_or(xml.len());
        let type_bytes = &xml[*start..type_end];

        // Adjust for bar direction
        let final_type = if *chart_type == ChartType::Bar {
            check_bar_direction(type_bytes)
        } else {
            *chart_type
        };

        // Parse series
        let series = parse_all_series(type_bytes);

        // Parse chart-type config
        let config = config::parse_chart_type_config(*chart_type, type_bytes);

        // Parse chart-level dLbls (must skip past all <c:ser> to avoid
        // matching series-level dLbls nested inside a <c:ser>).
        let after_last_ser = find_pos_after_last_ser(type_bytes);
        let chart_dlbls =
            if let Some(dlbls_start) = find_tag_simd(type_bytes, b"dLbls", after_last_ser) {
                let dlbls_end =
                    find_closing_tag(type_bytes, b"dLbls", dlbls_start).unwrap_or(type_bytes.len());
                Some(parse_data_labels(&type_bytes[dlbls_start..dlbls_end]))
            } else {
                None
            };

        let chart_ax_ids = parse_ax_ids(type_bytes);
        let raw_chart_type_attr = attrs::parse_string_attr(&xml[*start..], b"chartType=\"");
        return (
            final_type,
            *is_3d,
            series,
            config,
            chart_dlbls,
            chart_ax_ids,
            raw_chart_type_attr,
            Vec::new(),
        );
    }

    (
        ChartType::Unknown,
        false,
        Vec::new(),
        None,
        None,
        Vec::new(),
        None,
        Vec::new(),
    )
}

/// Check bar chart direction to determine if it's actually a column chart.
fn check_bar_direction(xml: &[u8]) -> ChartType {
    if let Some(bar_dir_start) = find_tag_simd(xml, b"barDir", 0) {
        if let Some(val_pos) = find_attr_simd(xml, b"val=\"", bar_dir_start) {
            let value_start = val_pos + 5; // Skip `val="`
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = &xml[start..end];
                if val == b"col" {
                    return ChartType::Bar; // Vertical bars = Column chart style
                } else if val == b"bar" {
                    return ChartType::Bar; // Horizontal bars
                }
            }
        }
    }
    ChartType::Bar
}
