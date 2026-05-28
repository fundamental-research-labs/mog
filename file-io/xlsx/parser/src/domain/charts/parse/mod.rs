//! Standard OOXML chart parsing orchestration and helpers.

mod attrs;
mod build_chart_space;
mod chart;
mod chart_groups;
mod chart_space;
mod config;
pub(crate) mod ext;
mod layout;
mod plot_area;
mod surfaces;
mod title;

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};

use super::*;
use ext::is_self_closing_tag;

// =============================================================================
// Chart Parsing
// =============================================================================

impl Chart {
    /// Parse chart XML content.
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the chart XML file
    ///
    /// # Returns
    /// Parsed Chart struct
    pub fn parse(xml: &[u8]) -> Self {
        let mut chart = Chart::default();

        // Find chartSpace root
        let chart_space_start = match find_tag_simd(xml, b"chartSpace", 0) {
            Some(pos) => pos,
            None => return chart,
        };

        // Find c:chart element
        let chart_start = match find_tag_simd(xml, b"chart", chart_space_start) {
            Some(pos) => pos,
            None => return chart,
        };

        // Parse ChartSpace-level properties that appear BEFORE <c:chart>
        // (date1904, lang, roundedCorners, style, AlternateContent, protection).
        // Scoped to xml[..chart_start] to avoid matching nested tags.
        chart_space::parse_chart_space_pre_chart_props(
            &xml[..chart_start],
            chart_space_start,
            &mut chart,
        );

        // Find plotArea first — its position bounds where chart-level children
        // (title, autoTitleDeleted, view3D, etc.) can appear. Without this bound,
        // searching for <c:title> from chart_start would match axis titles inside
        // plotArea when the chart itself has no title.
        let plot_area_start = find_tag_simd(xml, b"plotArea", chart_start);
        let chart_children_end = plot_area_start.unwrap_or(xml.len());

        // Parse title — only search before plotArea to avoid matching axis titles
        if let Some(title_start) = find_tag_simd(xml, b"title", chart_start) {
            if title_start < chart_children_end {
                let title_end = find_closing_tag(xml, b"title", title_start).unwrap_or(xml.len());
                chart.title = Some(title::parse_title(&xml[title_start..title_end]));
            }
        }

        // Parse autoTitleDeleted — search before plotArea first (spec location),
        // then anywhere in c:chart (Google Sheets places it after plotVisOnly).
        if let Some(atd_start) = find_tag_simd(xml, b"autoTitleDeleted", chart_start) {
            if atd_start < chart_children_end {
                chart.auto_title_deleted =
                    Some(attrs::parse_bool_attr(&xml[atd_start..], b"val=\""));
            } else {
                // Non-standard position (after plotArea) — still parse it
                let chart_close = find_closing_tag(xml, b"chart", chart_start).unwrap_or(xml.len());
                if atd_start < chart_close {
                    chart.auto_title_deleted =
                        Some(attrs::parse_bool_attr(&xml[atd_start..], b"val=\""));
                }
            }
        }

        // Parse pivotFmts — search before plotArea
        if let Some(pf_start) = find_tag_simd(xml, b"pivotFmts", chart_start) {
            if pf_start < chart_children_end {
                let pf_end = find_closing_tag(xml, b"pivotFmts", pf_start).unwrap_or(xml.len());
                let pf_bytes = &xml[pf_start..pf_end];
                let mut pos = 0;
                while let Some(fmt_start) = find_tag_simd(pf_bytes, b"pivotFmt", pos) {
                    let fmt_end = find_closing_tag(pf_bytes, b"pivotFmt", fmt_start)
                        .and_then(|lt| find_gt_simd(pf_bytes, lt).map(|gt| gt + 1))
                        .unwrap_or(pf_bytes.len());
                    let fmt_bytes = &pf_bytes[fmt_start..fmt_end];
                    chart.pivot_fmts.push(chart::parse_pivot_fmt(fmt_bytes));
                    pos = fmt_end;
                }
            }
        }

        // Parse view3D
        if let Some(v3d_start) = find_tag_simd(xml, b"view3D", chart_start) {
            let v3d_end = find_closing_tag(xml, b"view3D", v3d_start).unwrap_or(xml.len());
            chart.view_3d = Some(surfaces::parse_view_3d(&xml[v3d_start..v3d_end]));
        }

        // Parse floor
        if let Some(floor_start) = find_tag_simd(xml, b"floor", chart_start) {
            let floor_end = find_closing_tag(xml, b"floor", floor_start).unwrap_or(xml.len());
            chart.floor = Some(surfaces::parse_chart_surface(&xml[floor_start..floor_end]));
        }

        // Parse sideWall
        if let Some(sw_start) = find_tag_simd(xml, b"sideWall", chart_start) {
            let sw_end = find_closing_tag(xml, b"sideWall", sw_start).unwrap_or(xml.len());
            chart.side_wall = Some(surfaces::parse_chart_surface(&xml[sw_start..sw_end]));
        }

        // Parse backWall
        if let Some(bw_start) = find_tag_simd(xml, b"backWall", chart_start) {
            let bw_end = find_closing_tag(xml, b"backWall", bw_start).unwrap_or(xml.len());
            chart.back_wall = Some(surfaces::parse_chart_surface(&xml[bw_start..bw_end]));
        }

        // Parse plotArea
        if let Some(plot_area_start) = plot_area_start {
            let plot_area_end =
                find_closing_tag(xml, b"plotArea", plot_area_start).unwrap_or(xml.len());
            let plot_area_bytes = &xml[plot_area_start..plot_area_end];

            // Parse chart type, series, and chart-type config
            let (
                chart_type,
                is_3d,
                series,
                config,
                chart_dlbls,
                chart_type_ax_ids,
                raw_chart_type_attr,
                combo_groups,
            ) = chart_groups::parse_chart_type_and_series(plot_area_bytes);
            chart.chart_type = chart_type;
            chart.is_3d = is_3d;
            chart.series = series;
            chart.chart_type_config = config;
            chart.data_labels = chart_dlbls;
            chart.raw_chart_type_attr = raw_chart_type_attr;
            chart.chart_type_ax_ids = chart_type_ax_ids;
            chart.chart_groups = combo_groups;

            // Parse axes
            chart.plot_area = plot_area::parse_plot_area_axes(plot_area_bytes);

            // Parse plotArea's own direct-child shape properties.
            chart.plot_area.sp_pr = plot_area::parse_direct_plot_area_sp_pr(plot_area_bytes);
        }

        // Parse legend
        if let Some(legend_start) = find_tag_simd(xml, b"legend", chart_start) {
            let legend_end = find_closing_tag(xml, b"legend", legend_start).unwrap_or(xml.len());
            chart.legend = Some(chart::parse_legend(&xml[legend_start..legend_end]));
        }

        // Parse display options
        chart.display_options = chart::parse_display_options(xml, chart_start);

        // Parse ChartSpace-level properties that appear AFTER </c:chart>
        // (spPr, txPr, externalData, printSettings, userShapes).
        let chart_close_lt = find_closing_tag(xml, b"chart", chart_start);
        let chart_end = chart_close_lt
            .and_then(|lt| find_gt_simd(xml, lt).map(|gt| gt + 1))
            .unwrap_or(xml.len());
        chart_space::parse_chart_space_post_chart_props(xml, chart_end, &mut chart);

        // Parse chart-level extLst: find the LAST <c:extLst> before </c:chart>.
        // Search backwards by iterating all extLst positions and taking the last one
        // that's within the chart element and after the plotArea.
        if let Some(chart_close) = chart_close_lt {
            // The chart-level extLst appears after legend/plotVisOnly/dispBlanksAs.
            // Find the plotArea closing position to ensure we skip nested extLsts.
            let plot_area_end = find_closing_tag(xml, b"plotArea", chart_start)
                .and_then(|lt| find_gt_simd(xml, lt).map(|gt| gt + 1))
                .unwrap_or(chart_start);
            let legend_end = find_closing_tag(xml, b"legend", plot_area_end)
                .and_then(|lt| find_gt_simd(xml, lt).map(|gt| gt + 1))
                .unwrap_or(plot_area_end);

            // Search for extLst AFTER legend/plotArea but before </c:chart>
            let search_start = legend_end;
            let mut last_ext_start = None;
            let mut pos = search_start;
            while let Some(ext_pos) = find_tag_simd(xml, b"extLst", pos) {
                if ext_pos >= chart_close {
                    break;
                }
                last_ext_start = Some(ext_pos);
                pos = ext_pos + 1;
            }
            if let Some(ext_start) = last_ext_start {
                // Skip self-closing <c:extLst/> (empty extension list)
                if is_self_closing_tag(xml, ext_start) {
                    chart.has_empty_chart_ext_lst = true;
                } else {
                    let ext_end =
                        find_closing_tag(xml, b"extLst", ext_start).unwrap_or(chart_close);
                    chart.chart_extensions = parse_chart_ext_lst(&xml[ext_start..ext_end]);
                }
            }
        }

        // Parse ChartSpace-level extLst (after printSettings, before </c:chartSpace>)
        {
            let mut last_ext_start = None;
            let mut pos = chart_end;
            while let Some(ext_pos) = find_tag_simd(xml, b"extLst", pos) {
                last_ext_start = Some(ext_pos);
                pos = ext_pos + 1;
            }
            if let Some(ext_start) = last_ext_start {
                if !is_self_closing_tag(xml, ext_start) {
                    let ext_end = find_closing_tag(xml, b"extLst", ext_start).unwrap_or(xml.len());
                    chart.chart_space_extensions = parse_chart_ext_lst(&xml[ext_start..ext_end]);
                }
            }
        }

        // Build canonical ChartSpace for lossless serialization
        chart.chart_space = Some(build_chart_space::build_chart_space(&chart));

        chart
    }

    /// Parse a title element from XML bytes (public for axis title reuse).
    pub(crate) fn parse_title_from_xml(xml: &[u8]) -> Title {
        title::parse_title(xml)
    }

    /// Parse a layout element into the canonical `ManualLayout` from ooxml-types.
    pub(crate) fn parse_layout(xml: &[u8]) -> ManualLayout {
        layout::parse_layout(xml)
    }
}
