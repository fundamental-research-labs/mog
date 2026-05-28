//! Plot-area parsing helpers for standard OOXML charts.

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};

use super::super::*;
use super::attrs;
use super::ext::{find_top_level_ext_lst, parse_chart_ext_lst_at};
use super::layout;

/// Parse plot area axes, preserving original XML element order.
///
/// Scans for all axis types (catAx, valAx, dateAx, serAx) sequentially
/// to preserve their interleaving order for lossless round-trip.
pub(super) fn parse_plot_area_axes(xml: &[u8]) -> PlotArea {
    let mut plot_area = PlotArea::default();

    // Parse plotArea layout — must detect self-closing <c:layout/> to avoid
    // find_closing_tag scanning past it and matching a nested </c:layout> from
    // a dLbl element, which would incorrectly pull dLbl layout data into plotArea.
    if let Some(layout_start) = find_tag_simd(xml, b"layout", 0) {
        let gt_pos = find_gt_simd(xml, layout_start).unwrap_or(xml.len());
        let is_self_closing = gt_pos > 0 && xml[gt_pos - 1] == b'/';
        if is_self_closing {
            // Empty layout (e.g. <c:layout/>) — preserve as empty ManualLayout
            plot_area.layout = Some(ManualLayout::default());
        } else {
            let layout_end = find_closing_tag(xml, b"layout", layout_start).unwrap_or(xml.len());
            plot_area.layout = Some(layout::parse_layout(&xml[layout_start..layout_end]));
        }
    }

    // Axis tag names to scan for
    const AXIS_TAGS: &[&[u8]] = &[b"catAx", b"valAx", b"dateAx", b"serAx"];

    // Collect all axis positions and parse them in encounter order
    let mut axis_positions: Vec<(usize, &[u8])> = Vec::new();
    for tag in AXIS_TAGS {
        let mut pos = 0;
        while let Some(ax_start) = find_tag_simd(xml, tag, pos) {
            axis_positions.push((ax_start, tag));
            let ax_end = find_closing_tag(xml, tag, ax_start).unwrap_or(xml.len());
            pos = ax_end;
        }
    }
    // Sort by position to get original XML order
    axis_positions.sort_by_key(|&(pos, _)| pos);

    // Track how many of each type we've seen for primary/secondary assignment
    let mut cat_count = 0u32;
    let mut val_count = 0u32;

    for (ax_start, tag) in &axis_positions {
        let ax_end = find_closing_tag(xml, tag, *ax_start).unwrap_or(xml.len());
        let axis = axes::parse_axis(&xml[*ax_start..ax_end]);

        // Store in ordered vec for canonical round-trip
        plot_area.axes_ordered.push(axis.clone());

        // Also assign to typed slots for quick access
        match *tag {
            b"catAx" => {
                if cat_count == 0 {
                    plot_area.cat_ax = Some(Box::new(axis));
                } else {
                    plot_area.cat_ax_secondary = Some(Box::new(axis));
                }
                cat_count += 1;
            }
            b"valAx" => {
                if val_count == 0 {
                    plot_area.val_ax = Some(Box::new(axis));
                } else {
                    plot_area.val_ax_secondary = Some(Box::new(axis));
                }
                val_count += 1;
            }
            b"dateAx" => {
                plot_area.date_ax = Some(Box::new(axis));
            }
            b"serAx" => {
                plot_area.ser_ax = Some(Box::new(axis));
            }
            _ => {}
        }
    }

    // Parse data table
    if let Some(dt_start) = find_tag_simd(xml, b"dTable", 0) {
        let dt_end = find_closing_tag(xml, b"dTable", dt_start).unwrap_or(xml.len());
        plot_area.data_table = Some(parse_data_table(&xml[dt_start..dt_end]));
    }

    if let Some(ext_start) = find_top_level_ext_lst(xml) {
        plot_area.extensions = parse_chart_ext_lst_at(xml, ext_start);
    }

    plot_area
}

/// Parse data table into the canonical `DataTableConfig` from ooxml-types.
fn parse_data_table(xml: &[u8]) -> DataTableConfig {
    let mut dt = DataTableConfig::default();

    if let Some(start) = find_tag_simd(xml, b"showHorzBorder", 0) {
        dt.show_horz_border = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    if let Some(start) = find_tag_simd(xml, b"showVertBorder", 0) {
        dt.show_vert_border = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    if let Some(start) = find_tag_simd(xml, b"showOutline", 0) {
        dt.show_outline = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    if let Some(start) = find_tag_simd(xml, b"showKeys", 0) {
        dt.show_keys = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }

    // Parse spPr
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
        let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
        dt.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
    }

    // Parse txPr
    if let Some(txpr_start) = find_tag_simd(xml, b"txPr", 0) {
        let txpr_end = find_closing_tag(xml, b"txPr", txpr_start).unwrap_or(xml.len());
        dt.tx_pr = Some(parse_text_body(&xml[txpr_start..txpr_end]));
    }

    dt
}

/// Parse plotArea's own direct-child `spPr`.
///
/// The search starts after chart groups, axes, and dTable so nested series,
/// axis, gridline, and title shape properties are not mistaken for the
/// plot-area background/border properties.
pub(super) fn parse_direct_plot_area_sp_pr(xml: &[u8]) -> Option<ShapeProperties> {
    let mut after_children = 0usize;

    let chart_group_tags: &[&[u8]] = &[
        b"barChart",
        b"bar3DChart",
        b"lineChart",
        b"line3DChart",
        b"pieChart",
        b"pie3DChart",
        b"doughnutChart",
        b"areaChart",
        b"area3DChart",
        b"scatterChart",
        b"bubbleChart",
        b"radarChart",
        b"surfaceChart",
        b"surface3DChart",
        b"stockChart",
        b"ofPieChart",
    ];
    for tag in chart_group_tags {
        let mut pos = 0;
        while let Some(start) = find_tag_simd(xml, tag, pos) {
            let end = find_closing_tag(xml, tag, start)
                .and_then(|lt| find_gt_simd(xml, lt).map(|gt| gt + 1))
                .unwrap_or(xml.len());
            after_children = after_children.max(end);
            pos = end;
        }
    }

    for tag in &[&b"catAx"[..], b"valAx", b"dateAx", b"serAx"] {
        let mut pos = 0;
        while let Some(start) = find_tag_simd(xml, tag, pos) {
            let end = find_closing_tag(xml, tag, start)
                .and_then(|lt| find_gt_simd(xml, lt).map(|gt| gt + 1))
                .unwrap_or(xml.len());
            after_children = after_children.max(end);
            pos = end;
        }
    }

    if let Some(dt_start) = find_tag_simd(xml, b"dTable", 0) {
        let dt_end = find_closing_tag(xml, b"dTable", dt_start)
            .and_then(|lt| find_gt_simd(xml, lt).map(|gt| gt + 1))
            .unwrap_or(xml.len());
        after_children = after_children.max(dt_end);
    }

    let sp_start = find_tag_simd(xml, b"spPr", after_children)?;
    let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
    Some(parse_shape_properties(&xml[sp_start..sp_end]))
}
