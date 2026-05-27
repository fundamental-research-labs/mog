//! Standard OOXML chart parsing orchestration and helpers.

mod attrs;
mod chart;
mod chart_groups;
mod chart_space;
pub(crate) mod ext;
mod layout;
mod plot_area;
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
        Self::parse_chart_space_pre_chart_props(&xml[..chart_start], chart_space_start, &mut chart);

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
                chart.title = Some(Self::parse_title(&xml[title_start..title_end]));
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
                    chart.pivot_fmts.push(Self::parse_pivot_fmt(fmt_bytes));
                    pos = fmt_end;
                }
            }
        }

        // Parse view3D
        if let Some(v3d_start) = find_tag_simd(xml, b"view3D", chart_start) {
            let v3d_end = find_closing_tag(xml, b"view3D", v3d_start).unwrap_or(xml.len());
            chart.view_3d = Some(chart_groups::parse_view_3d(&xml[v3d_start..v3d_end]));
        }

        // Parse floor
        if let Some(floor_start) = find_tag_simd(xml, b"floor", chart_start) {
            let floor_end = find_closing_tag(xml, b"floor", floor_start).unwrap_or(xml.len());
            chart.floor = Some(chart_groups::parse_chart_surface(
                &xml[floor_start..floor_end],
            ));
        }

        // Parse sideWall
        if let Some(sw_start) = find_tag_simd(xml, b"sideWall", chart_start) {
            let sw_end = find_closing_tag(xml, b"sideWall", sw_start).unwrap_or(xml.len());
            chart.side_wall = Some(chart_groups::parse_chart_surface(&xml[sw_start..sw_end]));
        }

        // Parse backWall
        if let Some(bw_start) = find_tag_simd(xml, b"backWall", chart_start) {
            let bw_end = find_closing_tag(xml, b"backWall", bw_start).unwrap_or(xml.len());
            chart.back_wall = Some(chart_groups::parse_chart_surface(&xml[bw_start..bw_end]));
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
            ) = Self::parse_chart_type_and_series(plot_area_bytes);
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
            chart.legend = Some(Self::parse_legend(&xml[legend_start..legend_end]));
        }

        // Parse display options
        chart.display_options = Self::parse_display_options(xml, chart_start);

        // Parse ChartSpace-level properties that appear AFTER </c:chart>
        // (spPr, txPr, externalData, printSettings, userShapes).
        let chart_close_lt = find_closing_tag(xml, b"chart", chart_start);
        let chart_end = chart_close_lt
            .and_then(|lt| find_gt_simd(xml, lt).map(|gt| gt + 1))
            .unwrap_or(xml.len());
        Self::parse_chart_space_post_chart_props(xml, chart_end, &mut chart);

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
        chart.chart_space = Some(chart.build_chart_space());

        chart
    }

    /// Build a canonical `ChartSpace` from the parsed flat fields.
    fn build_chart_space(&self) -> ooxml_types::charts::ChartSpace {
        use ooxml_types::charts as oc;

        // Use axes in original XML encounter order for lossless round-trip
        let axes: Vec<oc::ChartAxis> = self.plot_area.axes_ordered.clone();

        // Build chart group(s)
        // Use axIds from the chart type element in their original order.
        // Fall back to axes_ordered if no chart-type axIds were parsed.
        let ax_ids: Vec<u32> = if self.chart_type_ax_ids.is_empty() {
            axes.iter().map(|a| a.ax_id).collect()
        } else {
            self.chart_type_ax_ids.clone()
        };

        let chart_groups = if !self.chart_groups.is_empty() {
            // Combo chart: use pre-built groups directly (preserves per-group config/series/axIds)
            self.chart_groups.clone()
        } else if let Some(config) = &self.chart_type_config {
            // Single chart type: build one group from flat fields
            vec![oc::ChartGroup {
                chart_type: self.chart_type,
                config: config.clone(),
                series: self.series.clone(),
                d_lbls: self.data_labels.clone(),
                ax_id: ax_ids,
                raw_chart_type_attr: self.raw_chart_type_attr.clone(),
            }]
        } else {
            Vec::new()
        };

        oc::ChartSpace {
            // date1904 and rounded_corners use Option to preserve absence vs false.
            date1904: self.date1904,
            lang: self.lang.clone(),
            rounded_corners: self.rounded_corners,
            style: self.style.map(|s| s as u8),
            style_alternate_content: self.style_alternate_content.clone(),
            style_after_chart: self.style_after_chart,
            clr_map_ovr: None,
            protection: self.protection.clone(),
            chart: oc::Chart {
                title: self.title.clone(),
                auto_title_deleted: self.auto_title_deleted,
                view_3d: self.view_3d.clone(),
                floor: self.floor.clone(),
                side_wall: self.side_wall.clone(),
                back_wall: self.back_wall.clone(),
                plot_area: oc::PlotArea {
                    layout: self.plot_area.layout.clone(),
                    chart_groups,
                    axes,
                    d_table: self.plot_area.data_table.clone(),
                    sp_pr: self.plot_area.sp_pr.clone(),
                    extensions: Vec::new(),
                },
                legend: self.legend.clone(),
                plot_vis_only: Some(self.display_options.plot_vis_only),
                disp_blanks_as: Some(self.display_options.disp_blanks_as),
                show_d_lbls_over_max: Some(self.display_options.show_data_lbls_over_max),
                pivot_fmts: self.pivot_fmts.clone(),
                extensions: self.chart_extensions.clone(),
                has_empty_ext_lst: self.has_empty_chart_ext_lst,
            },
            sp_pr: self.sp_pr.clone(),
            tx_pr: self.tx_pr.clone(),
            external_data: self.external_data.clone(),
            pivot_source: self.pivot_source.clone(),
            user_shapes: self.user_shapes.clone(),
            print_settings: self.print_settings.clone(),
            extensions: self.chart_space_extensions.clone(),
        }
    }

    /// Parse a title element from XML bytes (public for axis title reuse).
    pub(crate) fn parse_title_from_xml(xml: &[u8]) -> Title {
        title::parse_title(xml)
    }

    /// Parse chart title into the canonical `Title` type from ooxml-types.
    fn parse_title(xml: &[u8]) -> Title {
        title::parse_title(xml)
    }

    /// Parse chart type and series from plot area.
    /// Returns: (chart_type, is_3d, series, config, d_lbls, ax_ids_from_chart_type, raw_chart_type_attr, chart_groups)
    fn parse_chart_type_and_series(xml: &[u8]) -> chart_groups::ParsedChartTypeAndSeries {
        chart_groups::parse_chart_type_and_series(xml)
    }

    /// Parse a single `<c:pivotFmt>` element.
    fn parse_pivot_fmt(xml: &[u8]) -> ooxml_types::charts::PivotFmt {
        chart::parse_pivot_fmt(xml)
    }

    /// Parse legend into the canonical `Legend` type from ooxml-types.
    fn parse_legend(xml: &[u8]) -> Legend {
        chart::parse_legend(xml)
    }

    /// Parse display options.
    fn parse_display_options(xml: &[u8], chart_start: usize) -> DisplayOptions {
        chart::parse_display_options(xml, chart_start)
    }

    /// Parse a layout element into the canonical `ManualLayout` from ooxml-types.
    pub(crate) fn parse_layout(xml: &[u8]) -> ManualLayout {
        layout::parse_layout(xml)
    }

    /// Parse ChartSpace-level properties that appear BEFORE `<c:chart>`.
    fn parse_chart_space_pre_chart_props(xml: &[u8], start: usize, chart: &mut Chart) {
        chart_space::parse_chart_space_pre_chart_props(xml, start, chart)
    }

    /// Parse ChartSpace-level properties that appear AFTER `</c:chart>`.
    fn parse_chart_space_post_chart_props(xml: &[u8], start: usize, chart: &mut Chart) {
        chart_space::parse_chart_space_post_chart_props(xml, start, chart)
    }
}
