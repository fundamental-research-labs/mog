//! Charts parser for XLSX chart definitions
//!
//! This module parses chart XML parts (xl/charts/chartN.xml) using the
//! DrawingML chart schema (dml-chart.xsd, ECMA-376 Part 1, Section 21).
//!
//! # OOXML Chart Structure
//!
//! Charts are stored in separate XML files within the XLSX archive:
//! - `/xl/charts/chartN.xml` - Chart definition
//! - `/xl/drawings/drawingN.xml` - Drawing anchor (position)
//!
//! The chart XML uses the `c:` namespace prefix for chart elements.
//!
//! # Supported Chart Types
//!
//! - Bar and Column charts (clustered, stacked, 100% stacked)
//! - Line charts (straight, smooth)
//! - Pie and Doughnut charts
//! - Area charts (stacked, 100% stacked)
//! - Scatter and Bubble charts
//! - Radar charts
//! - Surface charts (3D)
//! - Stock charts (HLC, OHLC)
//! - Combo charts (multiple types combined)

pub mod axes;
pub mod chart_ex_read;
pub mod chart_ex_write;
pub mod read;
pub mod reconstruct;
pub mod series;
pub mod types;
pub mod write_canonical;
mod xml_helpers;

use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd,
};

pub use axes::*;
pub use series::*;
pub use types::*;

// Re-export chart-level types from ooxml-types.
// Note: types also re-exported by submodules (axes, series, types) are NOT duplicated here —
// they reach `charts::` via `pub use axes::*` / `pub use series::*` / `pub use types::*`.
pub use ooxml_types::charts::{
    AnchorType, Area3DChartConfig, AreaChartConfig, Bar3DChartConfig, BarChartConfig,
    BubbleChartConfig, ChartProtection, ChartSurface, ChartTypeConfig, DataTableConfig,
    DisplayBlanksAs, DoughnutChartConfig, ExternalData, LegendPosition, Line3DChartConfig,
    LineChartConfig, OfPieChartConfig, OfPieType, PageMargins, PageSetup, PrintSettings,
    RadarChartConfig, ScatterChartConfig, ShapeProperties, SizeRepresents, SplitType,
    StockChartConfig, SurfaceChartConfig, TextBody, UpDownBars, View3D,
};

// Re-export chart document model types from ooxml-types.
pub use ooxml_types::charts::{Legend, LegendEntry, Title, TitleText};

use xml_helpers::{
    find_pos_after_last_ser, is_self_closing_tag, parse_ax_ids, parse_chart_type_ext_lst,
};

type ParsedChartTypeAndSeries = (
    ChartType,
    bool,
    Vec<ChartSeries>,
    Option<ChartTypeConfig>,
    Option<DataLabelOptions>,
    Vec<u32>,
    Option<String>,
    Vec<ooxml_types::charts::ChartGroup>,
);

// =============================================================================
// Chart Space (Root Element)
// =============================================================================

/// Complete chart definition from chart XML part.
/// Corresponds to CT_ChartSpace in ECMA-376.
#[derive(Debug, Clone, Default)]
pub struct Chart {
    /// Primary chart type
    pub chart_type: ChartType,
    /// Chart-type-specific configuration (grouping, direction, style, etc.)
    pub chart_type_config: Option<ChartTypeConfig>,
    /// Axis IDs as they appeared in the chart type element (e.g., <c:barChart><c:axId>...).
    /// Preserves original ordering for round-trip fidelity.
    pub chart_type_ax_ids: Vec<u32>,
    /// Chart title
    pub title: Option<Title>,
    /// Legend configuration
    pub legend: Option<Legend>,
    /// Plot area containing chart data
    pub plot_area: PlotArea,
    /// Data series
    pub series: Vec<ChartSeries>,
    /// Pre-built chart groups for combo charts (multiple chart type elements).
    /// Empty for single-type charts (built from flat fields in build_chart_space).
    pub chart_groups: Vec<ooxml_types::charts::ChartGroup>,
    /// Whether this is a 3D chart
    pub is_3d: bool,
    /// Display options
    pub display_options: DisplayOptions,
    /// Chart-level data labels
    pub data_labels: Option<DataLabelOptions>,
    /// 3D view configuration
    pub view_3d: Option<View3D>,
    /// Floor surface (3D charts)
    pub floor: Option<ChartSurface>,
    /// Side wall surface (3D charts)
    pub side_wall: Option<ChartSurface>,
    /// Back wall surface (3D charts)
    pub back_wall: Option<ChartSurface>,
    /// Whether auto title is deleted.
    /// `None` means the element was absent in the original XML.
    pub auto_title_deleted: Option<bool>,
    /// Pivot chart formatting entries (c:pivotFmts).
    pub pivot_fmts: Vec<ooxml_types::charts::PivotFmt>,

    // --- ChartSpace-level properties ---
    /// Whether the file uses the 1904 date system.
    /// `None` means the element was absent in the original XML.
    pub date1904: Option<bool>,
    /// Language code (e.g. "en-US")
    pub lang: Option<String>,
    /// Whether chart has rounded corners.
    /// `None` means the element was absent in the original XML.
    pub rounded_corners: Option<bool>,
    /// Chart style index
    pub style: Option<u32>,
    /// Raw mc:AlternateContent XML for the style element (round-trip fidelity).
    /// When present, written verbatim instead of flat `<c:style>`.
    pub style_alternate_content: Option<String>,
    /// Whether the `style_alternate_content` appeared after `</c:chart>` (non-standard).
    pub style_after_chart: bool,
    /// Non-standard `chartType` attribute on the chart type element (Google Sheets).
    pub raw_chart_type_attr: Option<String>,
    /// Chart protection settings
    pub protection: Option<ChartProtection>,
    /// ChartSpace-level shape properties
    pub sp_pr: Option<ShapeProperties>,
    /// ChartSpace-level text body properties
    pub tx_pr: Option<TextBody>,
    /// External data reference
    pub external_data: Option<ExternalData>,
    /// Print settings
    pub print_settings: Option<PrintSettings>,
    /// Chart-level extLst entries (inside `<c:chart>`, after legend/display opts)
    pub chart_extensions: Vec<ooxml_types::charts::ExtensionEntry>,
    /// Whether the original XML had an empty self-closing chart-level `<c:extLst/>`
    pub has_empty_chart_ext_lst: bool,
    /// ChartSpace-level extLst entries (inside `<c:chartSpace>`, after printSettings)
    pub chart_space_extensions: Vec<ooxml_types::charts::ExtensionEntry>,
    /// Pivot source metadata (CT_PivotSource) — links chart to a PivotTable
    pub pivot_source: Option<ooxml_types::charts::PivotSource>,
    /// User shapes relationship ID (c:userShapes r:id="...") — drawing overlay
    pub user_shapes: Option<String>,

    /// Canonical ChartSpace for lossless round-trip serialization.
    /// Built during parse from the same XML data that populates the flat fields above.
    /// When present, the write path uses this for serialization instead of going
    /// through the lossy ChartWriter conversion.
    pub chart_space: Option<ooxml_types::charts::ChartSpace>,

    /// Original chart XML part bytes. L2 stores charts as floating objects, and
    /// deeply deserializing ChartSpace JSON during export can overflow worker
    /// stacks. Preserve the imported XML as the passthrough source of truth
    /// unless the chart is later reconstructed from typed runtime fields.
    pub raw_chart_xml: Option<Vec<u8>>,

    /// Raw bytes of chart auxiliary files for round-trip passthrough.
    /// Key is the ZIP entry path (e.g., "xl/charts/colors1.xml"), value is the raw bytes.
    pub auxiliary_files: Vec<(String, Vec<u8>)>,
    /// Raw bytes of the chart's .rels file (e.g., "xl/charts/_rels/chart1.xml.rels")
    pub chart_rels_bytes: Option<(String, Vec<u8>)>,
    /// Original ZIP path of this chart file for round-trip fidelity.
    /// E.g., "xl/charts/chart2.xml". Used to preserve original numbering.
    pub original_path: Option<String>,
}

// ChartTitle, Legend, LegendEntry — now imported from ooxml_types::charts

/// Plot area containing chart data and axes.
/// Corresponds to CT_PlotArea in ECMA-376.
///
/// Axes are boxed to reduce stack size — each `ChartAxis` is ~24 KB due to
/// nested `TextBody`/`ShapeProperties` trees, and six of them would push this
/// struct past 140 KB, causing stack overflows in test threads.
#[derive(Debug, Clone, Default)]
pub struct PlotArea {
    /// Layout information
    pub layout: Option<ManualLayout>,
    /// Category axis (X-axis for most charts)
    pub cat_ax: Option<Box<ChartAxis>>,
    /// Value axis (Y-axis for most charts)
    pub val_ax: Option<Box<ChartAxis>>,
    /// Date axis (alternative to category axis)
    pub date_ax: Option<Box<ChartAxis>>,
    /// Series axis (for 3D charts)
    pub ser_ax: Option<Box<ChartAxis>>,
    /// Secondary category axis
    pub cat_ax_secondary: Option<Box<ChartAxis>>,
    /// Secondary value axis
    pub val_ax_secondary: Option<Box<ChartAxis>>,
    /// All axes in original XML encounter order (for lossless round-trip).
    pub axes_ordered: Vec<ChartAxis>,
    /// Data table (if shown)
    pub data_table: Option<DataTableConfig>,
    /// Plot area shape properties (background/border)
    pub sp_pr: Option<ShapeProperties>,
}

// Layout (now ManualLayout), DataTable (now DataTableConfig) — imported from ooxml_types::charts

/// Display options for chart.
#[derive(Debug, Clone, Default)]
pub struct DisplayOptions {
    /// Plot visible cells only
    pub plot_vis_only: bool,
    /// How to display blank cells
    pub disp_blanks_as: DisplayBlanksAs,
    /// Show data labels over maximum
    pub show_data_lbls_over_max: bool,
}

// =============================================================================
// Title text extraction helper
// =============================================================================

/// Extract plain text from a chart `Title`.
///
/// This is the chart-level equivalent of `axes::extract_title_text`. It delegates
/// to the same logic: for `TitleText::Rich`, concatenate all text runs; for
/// `TitleText::StrRef`, return the first cached value.
pub fn extract_chart_title_text(title: &Title) -> Option<String> {
    axes::extract_title_text(title)
}

// =============================================================================
// Chart Relationships
// =============================================================================

/// Reference to a chart from a drawing.
#[derive(Debug, Clone, Default)]
pub struct ChartRef {
    /// Relationship ID
    pub r_id: String,
    /// Chart type (parsed from chart XML)
    pub chart_type: ChartType,
    /// Anchor information
    pub anchor: ChartAnchor,
}

/// Chart anchor position in a drawing.
#[derive(Debug, Clone, Default)]
pub struct ChartAnchor {
    /// Anchor type
    pub anchor_type: AnchorType,
    /// From cell (for twoCellAnchor)
    pub from_col: u32,
    pub from_col_off: i64,
    pub from_row: u32,
    pub from_row_off: i64,
    /// To cell (for twoCellAnchor)
    pub to_col: Option<u32>,
    pub to_col_off: Option<i64>,
    pub to_row: Option<u32>,
    pub to_row_off: Option<i64>,
    /// Extent for oneCell/absolute anchors (in EMUs)
    pub cx: Option<i64>,
    pub cy: Option<i64>,
}

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
                    Some(Self::parse_bool_attr(&xml[atd_start..], b"val=\""));
            } else {
                // Non-standard position (after plotArea) — still parse it
                let chart_close = find_closing_tag(xml, b"chart", chart_start).unwrap_or(xml.len());
                if atd_start < chart_close {
                    chart.auto_title_deleted =
                        Some(Self::parse_bool_attr(&xml[atd_start..], b"val=\""));
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
            chart.view_3d = Some(Self::parse_view_3d(&xml[v3d_start..v3d_end]));
        }

        // Parse floor
        if let Some(floor_start) = find_tag_simd(xml, b"floor", chart_start) {
            let floor_end = find_closing_tag(xml, b"floor", floor_start).unwrap_or(xml.len());
            chart.floor = Some(Self::parse_chart_surface(&xml[floor_start..floor_end]));
        }

        // Parse sideWall
        if let Some(sw_start) = find_tag_simd(xml, b"sideWall", chart_start) {
            let sw_end = find_closing_tag(xml, b"sideWall", sw_start).unwrap_or(xml.len());
            chart.side_wall = Some(Self::parse_chart_surface(&xml[sw_start..sw_end]));
        }

        // Parse backWall
        if let Some(bw_start) = find_tag_simd(xml, b"backWall", chart_start) {
            let bw_end = find_closing_tag(xml, b"backWall", bw_start).unwrap_or(xml.len());
            chart.back_wall = Some(Self::parse_chart_surface(&xml[bw_start..bw_end]));
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
            chart.plot_area = Self::parse_plot_area_axes(plot_area_bytes);

            // Parse plotArea's own spPr — must be a DIRECT child of <c:plotArea>,
            // appearing after all chart groups, axes, and dTable per OOXML element
            // ordering. We find the end of the last axis/dTable/chart-group, then
            // search for <spPr> only in the trailing portion. This avoids picking up
            // spPr elements that belong to child elements (series, axes, gridlines).
            {
                let mut after_children = 0usize;

                // Find end of all chart group elements
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
                    while let Some(start) = find_tag_simd(plot_area_bytes, tag, pos) {
                        let end = find_closing_tag(plot_area_bytes, tag, start)
                            .and_then(|lt| find_gt_simd(plot_area_bytes, lt).map(|gt| gt + 1))
                            .unwrap_or(plot_area_bytes.len());
                        if end > after_children {
                            after_children = end;
                        }
                        pos = end;
                    }
                }

                // Find end of all axis elements
                for tag in &[&b"catAx"[..], b"valAx", b"dateAx", b"serAx"] {
                    let mut pos = 0;
                    while let Some(start) = find_tag_simd(plot_area_bytes, tag, pos) {
                        let end = find_closing_tag(plot_area_bytes, tag, start)
                            .and_then(|lt| find_gt_simd(plot_area_bytes, lt).map(|gt| gt + 1))
                            .unwrap_or(plot_area_bytes.len());
                        if end > after_children {
                            after_children = end;
                        }
                        pos = end;
                    }
                }

                // Find end of dTable
                if let Some(dt_start) = find_tag_simd(plot_area_bytes, b"dTable", 0) {
                    let dt_end = find_closing_tag(plot_area_bytes, b"dTable", dt_start)
                        .and_then(|lt| find_gt_simd(plot_area_bytes, lt).map(|gt| gt + 1))
                        .unwrap_or(plot_area_bytes.len());
                    if dt_end > after_children {
                        after_children = dt_end;
                    }
                }

                // Now search for <spPr> only in the tail after all children
                if let Some(sp_start) = find_tag_simd(plot_area_bytes, b"spPr", after_children) {
                    let sp_end = find_closing_tag(plot_area_bytes, b"spPr", sp_start)
                        .unwrap_or(plot_area_bytes.len());
                    chart.plot_area.sp_pr =
                        Some(parse_shape_properties(&plot_area_bytes[sp_start..sp_end]));
                }
            }
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
        Self::parse_title(xml)
    }

    /// Parse chart title into the canonical `Title` type from ooxml-types.
    fn parse_title(xml: &[u8]) -> Title {
        let mut title = Title::default();

        // Try to find rich text first, then strRef
        if let Some(rich_start) = find_tag_simd(xml, b"rich", 0) {
            let rich_end = find_closing_tag(xml, b"rich", rich_start).unwrap_or(xml.len());
            let rich_bytes = &xml[rich_start..rich_end];

            // Parse full rich text body and store as TitleText::Rich
            title.tx = Some(TitleText::Rich(parse_text_body(rich_bytes)));
        } else if let Some(strref_start) = find_tag_simd(xml, b"strRef", 0) {
            let strref_end = find_closing_tag(xml, b"strRef", strref_start).unwrap_or(xml.len());
            title.tx = Some(TitleText::StrRef(parse_str_ref(
                &xml[strref_start..strref_end],
            )));
        }

        // Check for overlay attribute
        if let Some(overlay_start) = find_tag_simd(xml, b"overlay", 0) {
            let val = Self::parse_bool_attr(&xml[overlay_start..], b"val=\"");
            title.overlay = Some(val);
        }

        // Parse layout
        if let Some(layout_start) = find_tag_simd(xml, b"layout", 0) {
            let layout_end = find_closing_tag(xml, b"layout", layout_start).unwrap_or(xml.len());
            title.layout = Some(Self::parse_layout(&xml[layout_start..layout_end]));
        }

        // Parse spPr
        if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
            let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
            title.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
        }

        // Parse txPr
        if let Some(txpr_start) = find_tag_simd(xml, b"txPr", 0) {
            let txpr_end = find_closing_tag(xml, b"txPr", txpr_start).unwrap_or(xml.len());
            title.tx_pr = Some(parse_text_body(&xml[txpr_start..txpr_end]));
        }

        title
    }

    /// Parse chart type and series from plot area.
    /// Returns: (chart_type, is_3d, series, config, d_lbls, ax_ids_from_chart_type, raw_chart_type_attr, chart_groups)
    ///
    /// For combo charts (multiple chart type elements in plotArea), `chart_groups` contains
    /// individually-parsed ChartGroup entries preserving per-group config, series, dLbls, and axIds.
    /// The flat `series` field is the union of all groups' series for backwards compatibility.
    fn parse_chart_type_and_series(xml: &[u8]) -> ParsedChartTypeAndSeries {
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
                    Self::check_bar_direction(type_bytes)
                } else {
                    *chart_type
                };

                let series = parse_all_series(type_bytes);
                let config = Self::parse_chart_type_config(*chart_type, type_bytes);
                let ax_ids = parse_ax_ids(type_bytes);
                let raw_attr = Self::parse_string_attr(&xml[*start..], b"chartType=\"");

                // Chart-group-level dLbls comes AFTER all <c:ser> elements in the
                // schema.  We must skip past all series to avoid matching a
                // series-level <c:dLbls> nested inside <c:ser>.
                let after_last_ser = find_pos_after_last_ser(type_bytes);
                let d_lbls = if let Some(dlbls_start) =
                    find_tag_simd(type_bytes, b"dLbls", after_last_ser)
                {
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
                Self::check_bar_direction(type_bytes)
            } else {
                *chart_type
            };

            // Parse series
            let series = parse_all_series(type_bytes);

            // Parse chart-type config
            let config = Self::parse_chart_type_config(*chart_type, type_bytes);

            // Parse chart-level dLbls (must skip past all <c:ser> to avoid
            // matching series-level dLbls nested inside a <c:ser>).
            let after_last_ser = find_pos_after_last_ser(type_bytes);
            let chart_dlbls =
                if let Some(dlbls_start) = find_tag_simd(type_bytes, b"dLbls", after_last_ser) {
                    let dlbls_end = find_closing_tag(type_bytes, b"dLbls", dlbls_start)
                        .unwrap_or(type_bytes.len());
                    Some(parse_data_labels(&type_bytes[dlbls_start..dlbls_end]))
                } else {
                    None
                };

            let chart_ax_ids = parse_ax_ids(type_bytes);
            let raw_chart_type_attr = Self::parse_string_attr(&xml[*start..], b"chartType=\"");
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

    /// Parse a single `<c:pivotFmt>` element.
    ///
    /// OOXML CT_PivotFmt element order: idx, spPr, txPr, marker, dLbl, extLst.
    /// Elements like spPr and txPr also appear nested inside dLbl, so we must
    /// parse dLbl first to find its boundary, then only search for direct-child
    /// spPr/txPr/marker in the region BEFORE dLbl starts.
    fn parse_pivot_fmt(xml: &[u8]) -> ooxml_types::charts::PivotFmt {
        let mut pf = ooxml_types::charts::PivotFmt::default();

        if let Some(idx_start) = find_tag_simd(xml, b"idx", 0) {
            pf.idx = parse_val_attr_u32(&xml[idx_start..]);
        }

        // Find dLbl boundary first — spPr/txPr/marker that appear after dLbl
        // are nested children of dLbl, not direct children of pivotFmt.
        let dl_start = find_tag_simd(xml, b"dLbl", 0);
        let direct_end = dl_start.unwrap_or(xml.len());
        let direct_region = &xml[..direct_end];

        if let Some(sp_start) = find_tag_simd(direct_region, b"spPr", 0) {
            let sp_end =
                find_closing_tag(direct_region, b"spPr", sp_start).unwrap_or(direct_region.len());
            pf.sp_pr = Some(parse_shape_properties(&direct_region[sp_start..sp_end]));
        }
        if let Some(txpr_start) = find_tag_simd(direct_region, b"txPr", 0) {
            let txpr_end =
                find_closing_tag(direct_region, b"txPr", txpr_start).unwrap_or(direct_region.len());
            pf.tx_pr = Some(parse_text_body(&direct_region[txpr_start..txpr_end]));
        }
        if let Some(m_start) = find_tag_simd(direct_region, b"marker", 0) {
            let m_end =
                find_closing_tag(direct_region, b"marker", m_start).unwrap_or(direct_region.len());
            pf.marker = Some(parse_marker(&direct_region[m_start..m_end]));
        }
        if let Some(dl_pos) = dl_start {
            let dl_end = find_closing_tag(xml, b"dLbl", dl_pos)
                .and_then(|lt| find_gt_simd(xml, lt).map(|gt| gt + 1))
                .unwrap_or(xml.len());
            pf.d_lbl = Some(parse_individual_data_label(&xml[dl_pos..dl_end]));
        }
        pf.extensions = parse_chart_ext_lst(xml);

        pf
    }

    /// Parse legend into the canonical `Legend` type from ooxml-types.
    fn parse_legend(xml: &[u8]) -> Legend {
        let mut legend = Legend::default();

        // Parse position
        if let Some(pos_start) = find_tag_simd(xml, b"legendPos", 0) {
            if let Some(val) = Self::parse_string_attr(&xml[pos_start..], b"val=\"") {
                legend.legend_pos = Some(LegendPosition::from_ooxml(&val));
            }
        }

        // Parse overlay
        if let Some(overlay_start) = find_tag_simd(xml, b"overlay", 0) {
            let val = Self::parse_bool_attr(&xml[overlay_start..], b"val=\"");
            legend.overlay = Some(val);
        }

        // Parse legend entries
        let mut pos = 0;
        while let Some(entry_start) = find_tag_simd(xml, b"legendEntry", pos) {
            let entry_end = find_closing_tag(xml, b"legendEntry", entry_start).unwrap_or(xml.len());
            let entry_bytes = &xml[entry_start..entry_end];

            let mut entry = LegendEntry::default();

            if let Some(idx_start) = find_tag_simd(entry_bytes, b"idx", 0) {
                if let Some(val) = Self::parse_u32_attr(&entry_bytes[idx_start..], b"val=\"") {
                    entry.idx = val;
                }
            }

            if let Some(delete_start) = find_tag_simd(entry_bytes, b"delete", 0) {
                let val = Self::parse_bool_attr(&entry_bytes[delete_start..], b"val=\"");
                entry.delete = Some(val);
            }

            legend.legend_entry.push(entry);
            pos = entry_end;
        }

        // Parse layout > manualLayout
        if let Some(layout_start) = find_tag_simd(xml, b"layout", 0) {
            let layout_end = find_closing_tag(xml, b"layout", layout_start).unwrap_or(xml.len());
            let layout = Self::parse_layout(&xml[layout_start..layout_end]);
            // Only store if there's actual content (not an empty <c:layout/>)
            if layout.x.is_some()
                || layout.y.is_some()
                || layout.w.is_some()
                || layout.h.is_some()
                || layout.layout_target.is_some()
                || layout.x_mode.is_some()
                || layout.y_mode.is_some()
                || layout.w_mode.is_some()
                || layout.h_mode.is_some()
            {
                legend.layout = Some(layout);
            }
        }

        // Parse spPr
        if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
            let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
            legend.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
        }

        // Parse txPr
        if let Some(txpr_start) = find_tag_simd(xml, b"txPr", 0) {
            let txpr_end = find_closing_tag(xml, b"txPr", txpr_start).unwrap_or(xml.len());
            legend.tx_pr = Some(parse_text_body(&xml[txpr_start..txpr_end]));
        }

        legend
    }

    /// Parse plot area axes, preserving original XML element order.
    ///
    /// Scans for all axis types (catAx, valAx, dateAx, serAx) sequentially
    /// to preserve their interleaving order for lossless round-trip.
    fn parse_plot_area_axes(xml: &[u8]) -> PlotArea {
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
                let layout_end =
                    find_closing_tag(xml, b"layout", layout_start).unwrap_or(xml.len());
                plot_area.layout = Some(Self::parse_layout(&xml[layout_start..layout_end]));
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
            plot_area.data_table = Some(Self::parse_data_table(&xml[dt_start..dt_end]));
        }

        plot_area
    }

    /// Parse data table into the canonical `DataTableConfig` from ooxml-types.
    fn parse_data_table(xml: &[u8]) -> DataTableConfig {
        let mut dt = DataTableConfig::default();

        if let Some(start) = find_tag_simd(xml, b"showHorzBorder", 0) {
            dt.show_horz_border = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        if let Some(start) = find_tag_simd(xml, b"showVertBorder", 0) {
            dt.show_vert_border = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        if let Some(start) = find_tag_simd(xml, b"showOutline", 0) {
            dt.show_outline = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        if let Some(start) = find_tag_simd(xml, b"showKeys", 0) {
            dt.show_keys = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
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

    /// Parse display options.
    fn parse_display_options(xml: &[u8], chart_start: usize) -> DisplayOptions {
        let mut opts = DisplayOptions::default();

        if let Some(start) = find_tag_simd(xml, b"plotVisOnly", chart_start) {
            opts.plot_vis_only = Self::parse_bool_attr(&xml[start..], b"val=\"");
        }

        if let Some(start) = find_tag_simd(xml, b"dispBlanksAs", chart_start) {
            if let Some(val) = Self::parse_string_attr(&xml[start..], b"val=\"") {
                opts.disp_blanks_as = DisplayBlanksAs::from_ooxml(&val);
            }
        }

        if let Some(start) = find_tag_simd(xml, b"showDLblsOverMax", chart_start) {
            opts.show_data_lbls_over_max = Self::parse_bool_attr(&xml[start..], b"val=\"");
        }

        opts
    }

    // -------------------------------------------------------------------------
    // Chart-Type Config Parsing
    // -------------------------------------------------------------------------

    /// Parse chart-type-specific configuration from the chart type element.
    fn parse_chart_type_config(chart_type: ChartType, xml: &[u8]) -> Option<ChartTypeConfig> {
        match chart_type {
            ChartType::Bar => Some(ChartTypeConfig::Bar(Self::parse_bar_config(xml))),
            ChartType::Bar3D => Some(ChartTypeConfig::Bar3D(Self::parse_bar3d_config(xml))),
            ChartType::Line => Some(ChartTypeConfig::Line(Self::parse_line_config(xml))),
            ChartType::Line3D => Some(ChartTypeConfig::Line3D(Self::parse_line3d_config(xml))),
            ChartType::Pie => Some(ChartTypeConfig::Pie(Self::parse_pie_config(xml))),
            ChartType::Pie3D => Some(ChartTypeConfig::Pie3D(Self::parse_pie3d_config(xml))),
            ChartType::Doughnut => {
                Some(ChartTypeConfig::Doughnut(Self::parse_doughnut_config(xml)))
            }
            ChartType::Area => Some(ChartTypeConfig::Area(Self::parse_area_config(xml))),
            ChartType::Area3D => Some(ChartTypeConfig::Area3D(Self::parse_area3d_config(xml))),
            ChartType::Scatter => Some(ChartTypeConfig::Scatter(Self::parse_scatter_config(xml))),
            ChartType::Bubble => Some(ChartTypeConfig::Bubble(Self::parse_bubble_config(xml))),
            ChartType::Radar => Some(ChartTypeConfig::Radar(Self::parse_radar_config(xml))),
            ChartType::Surface => Some(ChartTypeConfig::Surface(Self::parse_surface_config(xml))),
            ChartType::Surface3D => {
                Some(ChartTypeConfig::Surface3D(Self::parse_surface_config(xml)))
            }
            ChartType::Stock => Some(ChartTypeConfig::Stock(Self::parse_stock_config(xml))),
            ChartType::OfPie => Some(ChartTypeConfig::OfPie(Self::parse_ofpie_config(xml))),
            _ => None,
        }
    }

    /// Parse bar chart config (barChart).
    fn parse_bar_config(xml: &[u8]) -> BarChartConfig {
        let mut cfg = BarChartConfig::default();
        if let Some(start) = find_tag_simd(xml, b"barDir", 0) {
            if let Some(val) = Self::parse_string_attr(&xml[start..], b"val=\"") {
                cfg.bar_dir = BarDirection::from_ooxml(&val);
            }
        }
        if let Some(start) = find_tag_simd(xml, b"grouping", 0) {
            if let Some(val) = Self::parse_string_attr(&xml[start..], b"val=\"") {
                cfg.grouping = Some(Grouping::from_ooxml(&val));
            }
        }
        if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
            cfg.vary_colors = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        if let Some(start) = find_tag_simd(xml, b"gapWidth", 0) {
            cfg.gap_width = Self::parse_u32_attr(&xml[start..], b"val=\"");
        }
        if let Some(start) = find_tag_simd(xml, b"overlap", 0) {
            cfg.overlap = Self::parse_i32_attr(&xml[start..], b"val=\"");
        }
        if find_tag_simd(xml, b"serLines", 0).is_some() {
            cfg.ser_lines.push(ChartLines::default());
        }
        // Parse chart-type-level extLst (after axId elements, contains filtered series)
        cfg.extensions = parse_chart_type_ext_lst(xml);
        cfg
    }

    /// Parse bar3D chart config (bar3DChart).
    fn parse_bar3d_config(xml: &[u8]) -> Bar3DChartConfig {
        let mut cfg = Bar3DChartConfig::default();
        if let Some(start) = find_tag_simd(xml, b"barDir", 0) {
            if let Some(val) = Self::parse_string_attr(&xml[start..], b"val=\"") {
                cfg.bar_dir = BarDirection::from_ooxml(&val);
            }
        }
        if let Some(start) = find_tag_simd(xml, b"grouping", 0) {
            if let Some(val) = Self::parse_string_attr(&xml[start..], b"val=\"") {
                cfg.grouping = Some(Grouping::from_ooxml(&val));
            }
        }
        if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
            cfg.vary_colors = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        if let Some(start) = find_tag_simd(xml, b"gapWidth", 0) {
            cfg.gap_width = Self::parse_u32_attr(&xml[start..], b"val=\"");
        }
        if let Some(start) = find_tag_simd(xml, b"gapDepth", 0) {
            cfg.gap_depth = Self::parse_u32_attr(&xml[start..], b"val=\"");
        }
        if let Some(start) = find_tag_simd(xml, b"shape", 0) {
            if let Some(val) = Self::parse_string_attr(&xml[start..], b"val=\"") {
                cfg.shape = Some(BarShape::from_ooxml(&val));
            }
        }
        cfg
    }

    /// Parse line chart config (lineChart).
    fn parse_line_config(xml: &[u8]) -> LineChartConfig {
        let mut cfg = LineChartConfig::default();
        if let Some(start) = find_tag_simd(xml, b"grouping", 0) {
            if let Some(val) = Self::parse_string_attr(&xml[start..], b"val=\"") {
                cfg.grouping = Grouping::from_ooxml(&val);
            }
        }
        if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
            cfg.vary_colors = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        if find_tag_simd(xml, b"dropLines", 0).is_some() {
            cfg.drop_lines = Some(ChartLines::default());
        }
        if find_tag_simd(xml, b"hiLowLines", 0).is_some() {
            cfg.hi_low_lines = Some(ChartLines::default());
        }
        if find_tag_simd(xml, b"upDownBars", 0).is_some() {
            cfg.up_down_bars = Some(Self::parse_up_down_bars(xml));
        }
        // chart-level marker and smooth can appear before OR after <c:axId> elements
        // (OOXML spec says before, but real files vary). Search the non-series region.
        {
            // Helper: search a region for chart-level marker/smooth (not series-level)
            let mut search_marker_smooth = |region: &[u8]| {
                if cfg.marker.is_none() {
                    if let Some(start) = find_tag_simd(region, b"marker", 0) {
                        if let Some(val_pos) = find_attr_simd(&region[start..], b"val=\"", 0) {
                            if val_pos < 50 {
                                cfg.marker =
                                    Some(Self::parse_bool_attr(&region[start..], b"val=\""));
                            }
                        }
                    }
                }
                if cfg.smooth.is_none() {
                    if let Some(start) = find_tag_simd(region, b"smooth", 0) {
                        if let Some(val_pos) = find_attr_simd(&region[start..], b"val=\"", 0) {
                            if val_pos < 50 {
                                cfg.smooth =
                                    Some(Self::parse_bool_attr(&region[start..], b"val=\""));
                            }
                        }
                    }
                }
            };

            if let Some(first_axid) = find_tag_simd(xml, b"axId", 0) {
                // Search before the first axId
                let search_start = first_axid.saturating_sub(200);
                search_marker_smooth(&xml[search_start..first_axid]);

                // Search after the last axId (find second axId, then search after it)
                let after_first = first_axid + 5;
                if let Some(second_axid) = find_tag_simd(xml, b"axId", after_first) {
                    let after_second = (second_axid + 30).min(xml.len());
                    let end = (after_second + 200).min(xml.len());
                    search_marker_smooth(&xml[after_second..end]);
                } else {
                    // Only one axId — search after it
                    let after = (first_axid + 30).min(xml.len());
                    let end = (after + 200).min(xml.len());
                    search_marker_smooth(&xml[after..end]);
                }
            }
        }
        cfg.extensions = parse_chart_type_ext_lst(xml);
        cfg
    }

    /// Parse line3D chart config (line3DChart).
    fn parse_line3d_config(xml: &[u8]) -> Line3DChartConfig {
        let mut cfg = Line3DChartConfig::default();
        if let Some(start) = find_tag_simd(xml, b"grouping", 0) {
            if let Some(val) = Self::parse_string_attr(&xml[start..], b"val=\"") {
                cfg.grouping = Grouping::from_ooxml(&val);
            }
        }
        if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
            cfg.vary_colors = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        if find_tag_simd(xml, b"dropLines", 0).is_some() {
            cfg.drop_lines = Some(ChartLines::default());
        }
        if let Some(start) = find_tag_simd(xml, b"gapDepth", 0) {
            cfg.gap_depth = Self::parse_u32_attr(&xml[start..], b"val=\"");
        }
        cfg
    }

    /// Parse pie3D chart config (pie3DChart) — only varyColors, no firstSliceAng per spec.
    fn parse_pie3d_config(xml: &[u8]) -> ooxml_types::charts::Pie3DChartConfig {
        let mut cfg = ooxml_types::charts::Pie3DChartConfig::default();
        if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
            cfg.vary_colors = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        cfg
    }

    /// Parse pie chart config (pieChart).
    fn parse_pie_config(xml: &[u8]) -> ooxml_types::charts::PieChartConfig {
        let mut cfg = ooxml_types::charts::PieChartConfig::default();
        if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
            cfg.vary_colors = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        if let Some(start) = find_tag_simd(xml, b"firstSliceAng", 0) {
            cfg.first_slice_ang = Self::parse_u32_attr(&xml[start..], b"val=\"");
        }
        cfg
    }

    /// Parse doughnut chart config.
    fn parse_doughnut_config(xml: &[u8]) -> DoughnutChartConfig {
        let mut cfg = DoughnutChartConfig::default();
        if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
            cfg.vary_colors = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        if let Some(start) = find_tag_simd(xml, b"firstSliceAng", 0) {
            cfg.first_slice_ang = Self::parse_u32_attr(&xml[start..], b"val=\"");
        }
        if let Some(start) = find_tag_simd(xml, b"holeSize", 0) {
            cfg.hole_size = Self::parse_u32_attr(&xml[start..], b"val=\"");
        }
        cfg
    }

    /// Parse area chart config.
    fn parse_area_config(xml: &[u8]) -> AreaChartConfig {
        let mut cfg = AreaChartConfig::default();
        if let Some(start) = find_tag_simd(xml, b"grouping", 0) {
            if let Some(val) = Self::parse_string_attr(&xml[start..], b"val=\"") {
                cfg.grouping = Some(Grouping::from_ooxml(&val));
            }
        }
        if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
            cfg.vary_colors = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        if find_tag_simd(xml, b"dropLines", 0).is_some() {
            cfg.drop_lines = Some(ChartLines::default());
        }
        cfg
    }

    /// Parse area3D chart config.
    fn parse_area3d_config(xml: &[u8]) -> Area3DChartConfig {
        let mut cfg = Area3DChartConfig::default();
        if let Some(start) = find_tag_simd(xml, b"grouping", 0) {
            if let Some(val) = Self::parse_string_attr(&xml[start..], b"val=\"") {
                cfg.grouping = Some(Grouping::from_ooxml(&val));
            }
        }
        if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
            cfg.vary_colors = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        if find_tag_simd(xml, b"dropLines", 0).is_some() {
            cfg.drop_lines = Some(ChartLines::default());
        }
        if let Some(start) = find_tag_simd(xml, b"gapDepth", 0) {
            cfg.gap_depth = Self::parse_u32_attr(&xml[start..], b"val=\"");
        }
        cfg
    }

    /// Parse scatter chart config.
    fn parse_scatter_config(xml: &[u8]) -> ScatterChartConfig {
        let mut cfg = ScatterChartConfig::default();
        if let Some(start) = find_tag_simd(xml, b"scatterStyle", 0) {
            if let Some(val) = Self::parse_string_attr(&xml[start..], b"val=\"") {
                cfg.scatter_style = ScatterStyle::from_ooxml(&val);
            }
        }
        if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
            cfg.vary_colors = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        cfg
    }

    /// Parse bubble chart config.
    fn parse_bubble_config(xml: &[u8]) -> BubbleChartConfig {
        let mut cfg = BubbleChartConfig::default();
        if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
            cfg.vary_colors = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        if let Some(start) = find_tag_simd(xml, b"bubbleScale", 0) {
            cfg.bubble_scale = Self::parse_u32_attr(&xml[start..], b"val=\"");
        }
        if let Some(start) = find_tag_simd(xml, b"bubble3D", 0) {
            cfg.bubble_3d = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        if let Some(start) = find_tag_simd(xml, b"showNegBubbles", 0) {
            cfg.show_neg_bubbles = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        if let Some(start) = find_tag_simd(xml, b"sizeRepresents", 0) {
            if let Some(val) = Self::parse_string_attr(&xml[start..], b"val=\"") {
                cfg.size_represents = Some(SizeRepresents::from_ooxml(&val));
            }
        }
        cfg
    }

    /// Parse radar chart config.
    fn parse_radar_config(xml: &[u8]) -> RadarChartConfig {
        let mut cfg = RadarChartConfig::default();
        if let Some(start) = find_tag_simd(xml, b"radarStyle", 0) {
            if let Some(val) = Self::parse_string_attr(&xml[start..], b"val=\"") {
                cfg.radar_style = RadarStyle::from_ooxml(&val);
            }
        }
        if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
            cfg.vary_colors = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        cfg
    }

    /// Parse surface chart config.
    fn parse_surface_config(xml: &[u8]) -> SurfaceChartConfig {
        let mut cfg = SurfaceChartConfig::default();
        if let Some(start) = find_tag_simd(xml, b"wireframe", 0) {
            cfg.wireframe = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        // Parse bandFmts
        let mut pos = 0;
        while let Some(bf_start) = find_tag_simd(xml, b"bandFmt", pos) {
            let bf_end = find_closing_tag(xml, b"bandFmt", bf_start).unwrap_or(xml.len());
            let bf_bytes = &xml[bf_start..bf_end];
            let mut band = ooxml_types::charts::BandFmt::default();
            if let Some(idx_start) = find_tag_simd(bf_bytes, b"idx", 0) {
                if let Some(v) = Self::parse_u32_attr(&bf_bytes[idx_start..], b"val=\"") {
                    band.idx = v;
                }
            }
            if let Some(sp_start) = find_tag_simd(bf_bytes, b"spPr", 0) {
                let sp_end =
                    find_closing_tag(bf_bytes, b"spPr", sp_start).unwrap_or(bf_bytes.len());
                band.sp_pr = Some(parse_shape_properties(&bf_bytes[sp_start..sp_end]));
            }
            cfg.band_fmts.push(band);
            pos = bf_end;
        }
        cfg
    }

    /// Parse stock chart config.
    fn parse_stock_config(xml: &[u8]) -> StockChartConfig {
        let mut cfg = StockChartConfig::default();
        if find_tag_simd(xml, b"dropLines", 0).is_some() {
            cfg.drop_lines = Some(ChartLines::default());
        }
        if find_tag_simd(xml, b"hiLowLines", 0).is_some() {
            cfg.hi_low_lines = Some(ChartLines::default());
        }
        if find_tag_simd(xml, b"upDownBars", 0).is_some() {
            cfg.up_down_bars = Some(Self::parse_up_down_bars(xml));
        }
        cfg
    }

    /// Parse ofPie chart config.
    fn parse_ofpie_config(xml: &[u8]) -> OfPieChartConfig {
        let mut cfg = OfPieChartConfig::default();
        if let Some(start) = find_tag_simd(xml, b"ofPieType", 0) {
            if let Some(val) = Self::parse_string_attr(&xml[start..], b"val=\"") {
                cfg.of_pie_type = OfPieType::from_ooxml(&val);
            }
        }
        if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
            cfg.vary_colors = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        if let Some(start) = find_tag_simd(xml, b"gapWidth", 0) {
            cfg.gap_width = Self::parse_u32_attr(&xml[start..], b"val=\"");
        }
        if let Some(start) = find_tag_simd(xml, b"splitType", 0) {
            if let Some(val) = Self::parse_string_attr(&xml[start..], b"val=\"") {
                cfg.split_type = Some(SplitType::from_ooxml(&val));
            }
        }
        if let Some(start) = find_tag_simd(xml, b"splitPos", 0) {
            cfg.split_pos = Self::parse_f64_attr(&xml[start..], b"val=\"");
        }
        if let Some(start) = find_tag_simd(xml, b"secondPieSize", 0) {
            cfg.second_pie_size = Self::parse_u32_attr(&xml[start..], b"val=\"");
        }
        // Parse custSplit - list of secondPiePt indices
        if let Some(cs_start) = find_tag_simd(xml, b"custSplit", 0) {
            let cs_end = find_closing_tag(xml, b"custSplit", cs_start).unwrap_or(xml.len());
            let cs_xml = &xml[cs_start..cs_end];
            let mut indices = Vec::new();
            let mut pos = 0;
            while let Some(pt_start) = find_tag_simd(cs_xml, b"secondPiePt", pos) {
                if let Some(idx) = Self::parse_u32_attr(&cs_xml[pt_start..], b"val=\"") {
                    indices.push(idx);
                }
                pos = pt_start + 1;
            }
            if !indices.is_empty() {
                cfg.cust_split = Some(indices);
            }
        }
        if find_tag_simd(xml, b"serLines", 0).is_some() {
            cfg.ser_lines.push(ChartLines::default());
        }
        cfg
    }

    /// Parse upDownBars.
    fn parse_up_down_bars(xml: &[u8]) -> UpDownBars {
        let mut udb = UpDownBars::default();
        if let Some(udb_start) = find_tag_simd(xml, b"upDownBars", 0) {
            let udb_end = find_closing_tag(xml, b"upDownBars", udb_start).unwrap_or(xml.len());
            let udb_bytes = &xml[udb_start..udb_end];
            if let Some(start) = find_tag_simd(udb_bytes, b"gapWidth", 0) {
                udb.gap_width = Self::parse_u32_attr(&udb_bytes[start..], b"val=\"");
            }
        }
        udb
    }

    // -------------------------------------------------------------------------
    // View3D, Surface, Layout, ChartSpace Parsing
    // -------------------------------------------------------------------------

    /// Parse view3D element.
    fn parse_view_3d(xml: &[u8]) -> View3D {
        let mut v = View3D::default();
        if let Some(start) = find_tag_simd(xml, b"rotX", 0) {
            v.rot_x = Some(Self::parse_i32_attr(&xml[start..], b"val=\"").unwrap_or(15) as i8);
        }
        if let Some(start) = find_tag_simd(xml, b"rotY", 0) {
            v.rot_y = Some(Self::parse_u32_attr(&xml[start..], b"val=\"").unwrap_or(20) as u16);
        }
        if let Some(start) = find_tag_simd(xml, b"rAngAx", 0) {
            v.right_angle_axes = Some(Self::parse_bool_attr(&xml[start..], b"val=\""));
        }
        if let Some(start) = find_tag_simd(xml, b"perspective", 0) {
            v.perspective =
                Some(Self::parse_u32_attr(&xml[start..], b"val=\"").unwrap_or(30) as u8);
        }
        if let Some(start) = find_tag_simd(xml, b"hPercent", 0) {
            v.height_percent =
                Some(Self::parse_u32_attr(&xml[start..], b"val=\"").unwrap_or(100) as u16);
        }
        if let Some(start) = find_tag_simd(xml, b"depthPercent", 0) {
            v.depth_percent =
                Some(Self::parse_u32_attr(&xml[start..], b"val=\"").unwrap_or(100) as u16);
        }
        v
    }

    /// Parse a chart surface (floor/sideWall/backWall).
    fn parse_chart_surface(xml: &[u8]) -> ChartSurface {
        let mut surface = ChartSurface::default();
        if let Some(start) = find_tag_simd(xml, b"thickness", 0) {
            surface.thickness = Self::parse_string_attr(&xml[start..], b"val=\"");
        }
        if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
            let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
            surface.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
        }
        surface
    }

    /// Parse a layout element into the canonical `ManualLayout` from ooxml-types.
    pub(crate) fn parse_layout(xml: &[u8]) -> ManualLayout {
        let mut layout = ManualLayout::default();

        if let Some(ml_start) = find_tag_simd(xml, b"manualLayout", 0) {
            let ml_end = find_closing_tag(xml, b"manualLayout", ml_start).unwrap_or(xml.len());
            let ml = &xml[ml_start..ml_end];

            if let Some(start) = find_tag_simd(ml, b"layoutTarget", 0) {
                if let Some(val) = Self::parse_string_attr(&ml[start..], b"val=\"") {
                    layout.layout_target = Some(LayoutTarget::from_ooxml(&val));
                }
            }
            if let Some(start) = find_tag_simd(ml, b"xMode", 0) {
                if let Some(val) = Self::parse_string_attr(&ml[start..], b"val=\"") {
                    layout.x_mode = Some(LayoutMode::from_ooxml(&val));
                }
            }
            if let Some(start) = find_tag_simd(ml, b"yMode", 0) {
                if let Some(val) = Self::parse_string_attr(&ml[start..], b"val=\"") {
                    layout.y_mode = Some(LayoutMode::from_ooxml(&val));
                }
            }
            if let Some(start) = find_tag_simd(ml, b"wMode", 0) {
                if let Some(val) = Self::parse_string_attr(&ml[start..], b"val=\"") {
                    layout.w_mode = Some(LayoutMode::from_ooxml(&val));
                }
            }
            if let Some(start) = find_tag_simd(ml, b"hMode", 0) {
                if let Some(val) = Self::parse_string_attr(&ml[start..], b"val=\"") {
                    layout.h_mode = Some(LayoutMode::from_ooxml(&val));
                }
            }
            if let Some(start) = find_tag_simd(ml, b"x", 0) {
                layout.x = Self::parse_f64_attr(&ml[start..], b"val=\"");
            }
            if let Some(start) = find_tag_simd(ml, b"y", 0) {
                layout.y = Self::parse_f64_attr(&ml[start..], b"val=\"");
            }
            if let Some(start) = find_tag_simd(ml, b"w", 0) {
                layout.w = Self::parse_f64_attr(&ml[start..], b"val=\"");
            }
            if let Some(start) = find_tag_simd(ml, b"h", 0) {
                layout.h = Self::parse_f64_attr(&ml[start..], b"val=\"");
            }
        }

        layout
    }

    /// Parse ChartSpace-level properties.
    /// Parse ChartSpace-level properties that appear BEFORE `<c:chart>`:
    /// date1904, lang, roundedCorners, style, AlternateContent, protection.
    fn parse_chart_space_pre_chart_props(xml: &[u8], start: usize, chart: &mut Chart) {
        if let Some(d_start) = find_tag_simd(xml, b"date1904", start) {
            chart.date1904 = Some(Self::parse_bool_attr(&xml[d_start..], b"val=\""));
        }
        if let Some(l_start) = find_tag_simd(xml, b"lang", start) {
            chart.lang = Self::parse_string_attr(&xml[l_start..], b"val=\"");
        }
        if let Some(rc_start) = find_tag_simd(xml, b"roundedCorners", start) {
            chart.rounded_corners = Some(Self::parse_bool_attr(&xml[rc_start..], b"val=\""));
        }
        if let Some(s_start) = find_tag_simd(xml, b"style", start) {
            chart.style = Self::parse_u32_attr(&xml[s_start..], b"val=\"");
        }

        // Detect mc:AlternateContent wrapping the style element for round-trip.
        // Excel writes: <mc:AlternateContent><mc:Choice Requires="c14"><c14:style val="102"/>
        //               </mc:Choice><mc:Fallback><c:style val="2"/></mc:Fallback></mc:AlternateContent>
        if let Some(ac_start) = find_tag_simd(xml, b"AlternateContent", start) {
            // find_tag_simd returns the position of '<', so ac_start is the '<' of <mc:AlternateContent
            let ac_close_lt = find_closing_tag(xml, b"AlternateContent", ac_start);
            if let Some(close_lt) = ac_close_lt {
                // find_closing_tag returns the '<' of </mc:AlternateContent>.
                // Find the '>' that ends the closing tag.
                let close_gt = find_gt_simd(xml, close_lt)
                    .map(|p| p + 1)
                    .unwrap_or(xml.len());
                if let Ok(raw) = std::str::from_utf8(&xml[ac_start..close_gt]) {
                    chart.style_alternate_content = Some(raw.to_string());
                }
            }
        }

        // Parse pivotSource
        if let Some(ps_start) = find_tag_simd(xml, b"pivotSource", start) {
            let ps_end = find_closing_tag(xml, b"pivotSource", ps_start).unwrap_or(xml.len());
            let ps_bytes = &xml[ps_start..ps_end];
            let name = if let Some(n_start) = find_tag_simd(ps_bytes, b"name", 0) {
                let n_end = find_closing_tag(ps_bytes, b"name", n_start).unwrap_or(ps_bytes.len());
                let n_open_end = find_gt_simd(ps_bytes, n_start)
                    .map(|p| p + 1)
                    .unwrap_or(n_start);
                String::from_utf8_lossy(&ps_bytes[n_open_end..n_end])
                    .trim()
                    .to_string()
            } else {
                String::new()
            };
            let fmt_id = if let Some(f_start) = find_tag_simd(ps_bytes, b"fmtId", 0) {
                Self::parse_u32_attr(&ps_bytes[f_start..], b"val=\"").unwrap_or(0)
            } else {
                0
            };
            let extensions = parse_chart_ext_lst(ps_bytes);
            chart.pivot_source = Some(ooxml_types::charts::PivotSource {
                name,
                fmt_id,
                extensions,
            });
        }

        // Parse protection
        if let Some(prot_start) = find_tag_simd(xml, b"protection", start) {
            let prot_end = find_closing_tag(xml, b"protection", prot_start).unwrap_or(xml.len());
            let prot_xml = &xml[prot_start..prot_end];
            let mut prot = ChartProtection::default();
            if let Some(p) = find_tag_simd(prot_xml, b"chartObject", 0) {
                prot.chart_object = Some(Self::parse_bool_attr(&prot_xml[p..], b"val=\""));
            }
            if let Some(p) = find_tag_simd(prot_xml, b"data", 0) {
                prot.data = Some(Self::parse_bool_attr(&prot_xml[p..], b"val=\""));
            }
            if let Some(p) = find_tag_simd(prot_xml, b"formatting", 0) {
                prot.formatting = Some(Self::parse_bool_attr(&prot_xml[p..], b"val=\""));
            }
            if let Some(p) = find_tag_simd(prot_xml, b"selection", 0) {
                prot.selection = Some(Self::parse_bool_attr(&prot_xml[p..], b"val=\""));
            }
            if let Some(p) = find_tag_simd(prot_xml, b"userInterface", 0) {
                prot.user_interface = Some(Self::parse_bool_attr(&prot_xml[p..], b"val=\""));
            }
            chart.protection = Some(prot);
        }
    }

    /// Parse ChartSpace-level properties that appear AFTER `</c:chart>`:
    /// spPr, txPr, externalData, printSettings, and mc:AlternateContent (style).
    fn parse_chart_space_post_chart_props(xml: &[u8], start: usize, chart: &mut Chart) {
        // Some producers (e.g., Google Sheets) place mc:AlternateContent (wrapping
        // c14:style) AFTER </c:chart> instead of before it. If we didn't already
        // capture it in the pre-chart pass, look for it here.
        if chart.style_alternate_content.is_none() {
            if let Some(ac_start) = find_tag_simd(xml, b"AlternateContent", start) {
                let ac_close_lt = find_closing_tag(xml, b"AlternateContent", ac_start);
                if let Some(close_lt) = ac_close_lt {
                    let close_gt = find_gt_simd(xml, close_lt)
                        .map(|p| p + 1)
                        .unwrap_or(xml.len());
                    if let Ok(raw) = std::str::from_utf8(&xml[ac_start..close_gt]) {
                        chart.style_alternate_content = Some(raw.to_string());
                        chart.style_after_chart = true;
                    }
                }
            }
        }

        // Parse externalData
        if let Some(ext_start) = find_tag_simd(xml, b"externalData", start) {
            let ext_end = find_closing_tag(xml, b"externalData", ext_start).unwrap_or(xml.len());
            let ext_xml = &xml[ext_start..ext_end];
            let r_id = Self::parse_string_attr(ext_xml, b"r:id=\"").unwrap_or_default();
            let auto_update = find_tag_simd(ext_xml, b"autoUpdate", 0)
                .map(|p| Self::parse_bool_attr(&ext_xml[p..], b"val=\""));
            chart.external_data = Some(ExternalData { r_id, auto_update });
        }

        // Parse printSettings
        if let Some(ps_start) = find_tag_simd(xml, b"printSettings", start) {
            let ps_end = find_closing_tag(xml, b"printSettings", ps_start).unwrap_or(xml.len());
            let ps_xml = &xml[ps_start..ps_end];
            let mut ps = PrintSettings::default();

            // Parse headerFooter (CT_HeaderFooter)
            if let Some(hf_start) = find_tag_simd(ps_xml, b"headerFooter", 0) {
                let mut hf = ooxml_types::print::HeaderFooter::default();
                // Check if it has children (non-self-closing)
                if let Some(hf_end) = find_closing_tag(ps_xml, b"headerFooter", hf_start) {
                    let hf_xml = &ps_xml[hf_start..hf_end];
                    if let Some(p) = find_tag_simd(hf_xml, b"oddHeader", 0) {
                        hf.odd_header = Self::parse_element_text(&hf_xml[p..], b"oddHeader");
                    }
                    if let Some(p) = find_tag_simd(hf_xml, b"oddFooter", 0) {
                        hf.odd_footer = Self::parse_element_text(&hf_xml[p..], b"oddFooter");
                    }
                    if let Some(p) = find_tag_simd(hf_xml, b"evenHeader", 0) {
                        hf.even_header = Self::parse_element_text(&hf_xml[p..], b"evenHeader");
                    }
                    if let Some(p) = find_tag_simd(hf_xml, b"evenFooter", 0) {
                        hf.even_footer = Self::parse_element_text(&hf_xml[p..], b"evenFooter");
                    }
                    if let Some(p) = find_tag_simd(hf_xml, b"firstHeader", 0) {
                        hf.first_header = Self::parse_element_text(&hf_xml[p..], b"firstHeader");
                    }
                    if let Some(p) = find_tag_simd(hf_xml, b"firstFooter", 0) {
                        hf.first_footer = Self::parse_element_text(&hf_xml[p..], b"firstFooter");
                    }
                    // Parse attributes
                    if let Some(v) =
                        Self::parse_string_attr(&ps_xml[hf_start..], b"differentOddEven=\"")
                    {
                        hf.different_odd_even = v == "1" || v == "true";
                    }
                    if let Some(v) =
                        Self::parse_string_attr(&ps_xml[hf_start..], b"differentFirst=\"")
                    {
                        hf.different_first = v == "1" || v == "true";
                    }
                }
                ps.header_footer = Some(hf);
            }

            // Parse pageMargins
            if let Some(pm_start) = find_tag_simd(ps_xml, b"pageMargins", 0) {
                let pm_xml = &ps_xml[pm_start..];
                let mut margins = PageMargins::default();
                if let Some(v) = Self::parse_f64_attr(pm_xml, b"b=\"") {
                    margins.bottom = v;
                }
                if let Some(v) = Self::parse_f64_attr(pm_xml, b"l=\"") {
                    margins.left = v;
                }
                if let Some(v) = Self::parse_f64_attr(pm_xml, b"r=\"") {
                    margins.right = v;
                }
                if let Some(v) = Self::parse_f64_attr(pm_xml, b"t=\"") {
                    margins.top = v;
                }
                if let Some(v) = Self::parse_f64_attr(pm_xml, b"header=\"") {
                    margins.header = v;
                }
                if let Some(v) = Self::parse_f64_attr(pm_xml, b"footer=\"") {
                    margins.footer = v;
                }
                ps.page_margins = Some(margins);
            }

            // Parse pageSetup (CT_PageSetup, §21.2.2.135 — all 11 attributes)
            if let Some(psu_start) = find_tag_simd(ps_xml, b"pageSetup", 0) {
                let psu_xml = &ps_xml[psu_start..];
                let mut setup = PageSetup::default();
                setup.paper_size = Self::parse_u32_attr(psu_xml, b"paperSize=\"");
                setup.paper_height = Self::parse_string_attr(psu_xml, b"paperHeight=\"");
                setup.paper_width = Self::parse_string_attr(psu_xml, b"paperWidth=\"");
                setup.first_page_number = Self::parse_u32_attr(psu_xml, b"firstPageNumber=\"");
                setup.orientation = Self::parse_string_attr(psu_xml, b"orientation=\"")
                    .map(|s| ooxml_types::charts::PageOrientation::from_ooxml(&s));
                setup.black_and_white = Self::parse_string_attr(psu_xml, b"blackAndWhite=\"")
                    .map(|s| s == "1" || s == "true");
                setup.draft =
                    Self::parse_string_attr(psu_xml, b"draft=\"").map(|s| s == "1" || s == "true");
                setup.use_first_page_number =
                    Self::parse_string_attr(psu_xml, b"useFirstPageNumber=\"")
                        .map(|s| s == "1" || s == "true");
                setup.horizontal_dpi =
                    Self::parse_u32_attr(psu_xml, b"horizontalDpi=\"").map(|v| v as i32);
                setup.vertical_dpi =
                    Self::parse_u32_attr(psu_xml, b"verticalDpi=\"").map(|v| v as i32);
                setup.copies = Self::parse_u32_attr(psu_xml, b"copies=\"");
                ps.page_setup = Some(setup);
            }

            chart.print_settings = Some(ps);
        }

        // Parse userShapes (c:userShapes r:id="...")
        if let Some(us_start) = find_tag_simd(xml, b"userShapes", start) {
            chart.user_shapes = Self::parse_string_attr(&xml[us_start..], b"r:id=\"");
        }

        // Parse chartSpace-level spPr (after </c:chart>)
        if let Some(sp_start) = find_tag_simd(xml, b"spPr", start) {
            let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
            chart.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
        }

        // Parse chartSpace-level txPr (after </c:chart>)
        if let Some(tp_start) = find_tag_simd(xml, b"txPr", start) {
            let tp_end = find_closing_tag(xml, b"txPr", tp_start).unwrap_or(xml.len());
            chart.tx_pr = Some(parse_text_body(&xml[tp_start..tp_end]));
        }
    }

    // -------------------------------------------------------------------------
    // Attribute Parsing Helpers
    // -------------------------------------------------------------------------

    /// Parse a boolean attribute value.
    fn parse_bool_attr(xml: &[u8], attr: &[u8]) -> bool {
        if let Some(attr_pos) = find_attr_simd(xml, attr, 0) {
            let value_start = attr_pos + attr.len();
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                if start < end {
                    let val = &xml[start..end];
                    return val == b"1" || val == b"true" || val == b"True";
                }
            }
        }
        false
    }

    /// Parse a string attribute value.
    fn parse_string_attr(xml: &[u8], attr: &[u8]) -> Option<String> {
        let attr_pos = find_attr_simd(xml, attr, 0)?;
        let value_start = attr_pos + attr.len();
        let (start, end) = extract_quoted_value(xml, value_start)?;
        Some(String::from_utf8_lossy(&xml[start..end]).to_string())
    }

    /// Parse a u32 attribute value.
    fn parse_u32_attr(xml: &[u8], attr: &[u8]) -> Option<u32> {
        let attr_pos = find_attr_simd(xml, attr, 0)?;
        let value_start = attr_pos + attr.len();
        let (start, end) = extract_quoted_value(xml, value_start)?;

        let mut result: u32 = 0;
        for &b in &xml[start..end] {
            if b.is_ascii_digit() {
                result = result.saturating_mul(10).saturating_add((b - b'0') as u32);
            } else {
                break;
            }
        }
        Some(result)
    }

    /// Parse an i32 attribute value.
    fn parse_i32_attr(xml: &[u8], attr: &[u8]) -> Option<i32> {
        let attr_pos = find_attr_simd(xml, attr, 0)?;
        let value_start = attr_pos + attr.len();
        let (start, end) = extract_quoted_value(xml, value_start)?;
        let s = std::str::from_utf8(&xml[start..end]).ok()?;
        s.parse().ok()
    }

    /// Parse an f64 attribute value.
    fn parse_f64_attr(xml: &[u8], attr: &[u8]) -> Option<f64> {
        let attr_pos = find_attr_simd(xml, attr, 0)?;
        let value_start = attr_pos + attr.len();
        let (start, end) = extract_quoted_value(xml, value_start)?;
        let s = std::str::from_utf8(&xml[start..end]).ok()?;
        s.parse().ok()
    }

    /// Extract text content from an XML element like `<tag>text</tag>`.
    /// `xml` should start at the opening `<tag` position.
    fn parse_element_text(xml: &[u8], tag: &[u8]) -> Option<String> {
        // Find the '>' that ends the opening tag
        let gt = find_gt_simd(xml, 0)?;
        let text_start = gt + 1;
        // Find the '<' that starts the closing tag
        let close_lt = find_closing_tag(xml, tag, 0)?;
        if close_lt <= text_start {
            return None;
        }
        std::str::from_utf8(&xml[text_start..close_lt])
            .ok()
            .map(|s| s.to_string())
    }
}

// =============================================================================
// Shape Properties & Text Body Parsing (module-level helpers)
// =============================================================================

/// Parse `<c:spPr>` (or `<a:spPr>`) shape properties from XML bytes.
/// Delegates to the complete drawings module parser which handles:
/// - All fill types (solid, gradient, pattern, blip) with full color transforms
/// - Complete outline parsing (width, cap, compound, join, head/tail ends)
/// - Transform 2D, preset geometry, effect lists, 3D properties, extLst
pub fn parse_shape_properties(xml: &[u8]) -> ShapeProperties {
    crate::domain::drawings::parse_shape_properties(xml)
}

/// Parse `<c:txPr>` or `<c:rich>` text body from XML bytes.
/// Delegates to the complete drawings module parser which handles:
/// - Full body properties (insets, overflow, autofit, text warp, etc.)
/// - Complete paragraph properties (alignment, spacing, bullets, tabs, etc.)
/// - Full run properties (underline, strikethrough, kerning, spacing, baseline,
///   caps, highlight, hyperlinks, text outline, text fill, etc.)
/// - Line breaks, text fields, and list styles
pub fn parse_text_body(xml: &[u8]) -> TextBody {
    crate::domain::drawings::parse_text_body(xml).unwrap_or_default()
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests;
