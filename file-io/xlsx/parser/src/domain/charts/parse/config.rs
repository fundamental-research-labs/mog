//! Chart-type-specific configuration parsing.

use crate::infra::scanner::{find_attr_simd, find_closing_tag, find_tag_simd};

use super::super::*;
use super::attrs;
use super::ext::parse_chart_type_ext_lst;

/// Parse chart-type-specific configuration from the chart type element.
pub(super) fn parse_chart_type_config(
    chart_type: ChartType,
    xml: &[u8],
) -> Option<ChartTypeConfig> {
    match chart_type {
        ChartType::Bar => Some(ChartTypeConfig::Bar(parse_bar_config(xml))),
        ChartType::Bar3D => Some(ChartTypeConfig::Bar3D(parse_bar3d_config(xml))),
        ChartType::Line => Some(ChartTypeConfig::Line(parse_line_config(xml))),
        ChartType::Line3D => Some(ChartTypeConfig::Line3D(parse_line3d_config(xml))),
        ChartType::Pie => Some(ChartTypeConfig::Pie(parse_pie_config(xml))),
        ChartType::Pie3D => Some(ChartTypeConfig::Pie3D(parse_pie3d_config(xml))),
        ChartType::Doughnut => Some(ChartTypeConfig::Doughnut(parse_doughnut_config(xml))),
        ChartType::Area => Some(ChartTypeConfig::Area(parse_area_config(xml))),
        ChartType::Area3D => Some(ChartTypeConfig::Area3D(parse_area3d_config(xml))),
        ChartType::Scatter => Some(ChartTypeConfig::Scatter(parse_scatter_config(xml))),
        ChartType::Bubble => Some(ChartTypeConfig::Bubble(parse_bubble_config(xml))),
        ChartType::Radar => Some(ChartTypeConfig::Radar(parse_radar_config(xml))),
        ChartType::Surface => Some(ChartTypeConfig::Surface(parse_surface_config(xml))),
        ChartType::Surface3D => Some(ChartTypeConfig::Surface3D(parse_surface_config(xml))),
        ChartType::Stock => Some(ChartTypeConfig::Stock(parse_stock_config(xml))),
        ChartType::OfPie => Some(ChartTypeConfig::OfPie(parse_ofpie_config(xml))),
        _ => None,
    }
}

/// Parse bar chart config (barChart).
fn parse_bar_config(xml: &[u8]) -> BarChartConfig {
    let mut cfg = BarChartConfig::default();
    if let Some(start) = find_tag_simd(xml, b"barDir", 0) {
        if let Some(val) = attrs::parse_string_attr(&xml[start..], b"val=\"") {
            cfg.bar_dir = BarDirection::from_ooxml(&val);
        }
    }
    if let Some(start) = find_tag_simd(xml, b"grouping", 0) {
        if let Some(val) = attrs::parse_string_attr(&xml[start..], b"val=\"") {
            cfg.grouping = Some(Grouping::from_ooxml(&val));
        }
    }
    if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
        cfg.vary_colors = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    if let Some(start) = find_tag_simd(xml, b"gapWidth", 0) {
        cfg.gap_width = attrs::parse_u32_attr(&xml[start..], b"val=\"");
    }
    if let Some(start) = find_tag_simd(xml, b"overlap", 0) {
        cfg.overlap = attrs::parse_i32_attr(&xml[start..], b"val=\"");
    }
    if find_tag_simd(xml, b"serLines", 0).is_some() {
        cfg.ser_lines.push(ChartLines::default());
    }
    // Parse chart-type-level extLst (after axId elements, contains filtered series).
    cfg.extensions = parse_chart_type_ext_lst(xml);
    cfg
}

/// Parse bar3D chart config (bar3DChart).
fn parse_bar3d_config(xml: &[u8]) -> Bar3DChartConfig {
    let mut cfg = Bar3DChartConfig::default();
    if let Some(start) = find_tag_simd(xml, b"barDir", 0) {
        if let Some(val) = attrs::parse_string_attr(&xml[start..], b"val=\"") {
            cfg.bar_dir = BarDirection::from_ooxml(&val);
        }
    }
    if let Some(start) = find_tag_simd(xml, b"grouping", 0) {
        if let Some(val) = attrs::parse_string_attr(&xml[start..], b"val=\"") {
            cfg.grouping = Some(Grouping::from_ooxml(&val));
        }
    }
    if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
        cfg.vary_colors = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    if let Some(start) = find_tag_simd(xml, b"gapWidth", 0) {
        cfg.gap_width = attrs::parse_u32_attr(&xml[start..], b"val=\"");
    }
    if let Some(start) = find_tag_simd(xml, b"gapDepth", 0) {
        cfg.gap_depth = attrs::parse_u32_attr(&xml[start..], b"val=\"");
    }
    if let Some(start) = find_tag_simd(xml, b"shape", 0) {
        if let Some(val) = attrs::parse_string_attr(&xml[start..], b"val=\"") {
            cfg.shape = Some(BarShape::from_ooxml(&val));
        }
    }
    cfg.extensions = parse_chart_type_ext_lst(xml);
    cfg
}

/// Parse line chart config (lineChart).
fn parse_line_config(xml: &[u8]) -> LineChartConfig {
    let mut cfg = LineChartConfig::default();
    if let Some(start) = find_tag_simd(xml, b"grouping", 0) {
        if let Some(val) = attrs::parse_string_attr(&xml[start..], b"val=\"") {
            cfg.grouping = Grouping::from_ooxml(&val);
        }
    }
    if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
        cfg.vary_colors = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    if find_tag_simd(xml, b"dropLines", 0).is_some() {
        cfg.drop_lines = Some(ChartLines::default());
    }
    if find_tag_simd(xml, b"hiLowLines", 0).is_some() {
        cfg.hi_low_lines = Some(ChartLines::default());
    }
    if find_tag_simd(xml, b"upDownBars", 0).is_some() {
        cfg.up_down_bars = Some(parse_up_down_bars(xml));
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
                            cfg.marker = Some(attrs::parse_bool_attr(&region[start..], b"val=\""));
                        }
                    }
                }
            }
            if cfg.smooth.is_none() {
                if let Some(start) = find_tag_simd(region, b"smooth", 0) {
                    if let Some(val_pos) = find_attr_simd(&region[start..], b"val=\"", 0) {
                        if val_pos < 50 {
                            cfg.smooth = Some(attrs::parse_bool_attr(&region[start..], b"val=\""));
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
                // Only one axId - search after it
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
        if let Some(val) = attrs::parse_string_attr(&xml[start..], b"val=\"") {
            cfg.grouping = Grouping::from_ooxml(&val);
        }
    }
    if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
        cfg.vary_colors = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    if find_tag_simd(xml, b"dropLines", 0).is_some() {
        cfg.drop_lines = Some(ChartLines::default());
    }
    if let Some(start) = find_tag_simd(xml, b"gapDepth", 0) {
        cfg.gap_depth = attrs::parse_u32_attr(&xml[start..], b"val=\"");
    }
    cfg.extensions = parse_chart_type_ext_lst(xml);
    cfg
}

/// Parse pie3D chart config (pie3DChart) - only varyColors, no firstSliceAng per spec.
fn parse_pie3d_config(xml: &[u8]) -> ooxml_types::charts::Pie3DChartConfig {
    let mut cfg = ooxml_types::charts::Pie3DChartConfig::default();
    if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
        cfg.vary_colors = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    cfg.extensions = parse_chart_type_ext_lst(xml);
    cfg
}

/// Parse pie chart config (pieChart).
fn parse_pie_config(xml: &[u8]) -> ooxml_types::charts::PieChartConfig {
    let mut cfg = ooxml_types::charts::PieChartConfig::default();
    if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
        cfg.vary_colors = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    if let Some(start) = find_tag_simd(xml, b"firstSliceAng", 0) {
        cfg.first_slice_ang = attrs::parse_u32_attr(&xml[start..], b"val=\"");
    }
    cfg.extensions = parse_chart_type_ext_lst(xml);
    cfg
}

/// Parse doughnut chart config.
fn parse_doughnut_config(xml: &[u8]) -> DoughnutChartConfig {
    let mut cfg = DoughnutChartConfig::default();
    if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
        cfg.vary_colors = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    if let Some(start) = find_tag_simd(xml, b"firstSliceAng", 0) {
        cfg.first_slice_ang = attrs::parse_u32_attr(&xml[start..], b"val=\"");
    }
    if let Some(start) = find_tag_simd(xml, b"holeSize", 0) {
        cfg.hole_size = attrs::parse_u32_attr(&xml[start..], b"val=\"");
    }
    cfg.extensions = parse_chart_type_ext_lst(xml);
    cfg
}

/// Parse area chart config.
fn parse_area_config(xml: &[u8]) -> AreaChartConfig {
    let mut cfg = AreaChartConfig::default();
    if let Some(start) = find_tag_simd(xml, b"grouping", 0) {
        if let Some(val) = attrs::parse_string_attr(&xml[start..], b"val=\"") {
            cfg.grouping = Some(Grouping::from_ooxml(&val));
        }
    }
    if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
        cfg.vary_colors = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    if find_tag_simd(xml, b"dropLines", 0).is_some() {
        cfg.drop_lines = Some(ChartLines::default());
    }
    cfg.extensions = parse_chart_type_ext_lst(xml);
    cfg
}

/// Parse area3D chart config.
fn parse_area3d_config(xml: &[u8]) -> Area3DChartConfig {
    let mut cfg = Area3DChartConfig::default();
    if let Some(start) = find_tag_simd(xml, b"grouping", 0) {
        if let Some(val) = attrs::parse_string_attr(&xml[start..], b"val=\"") {
            cfg.grouping = Some(Grouping::from_ooxml(&val));
        }
    }
    if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
        cfg.vary_colors = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    if find_tag_simd(xml, b"dropLines", 0).is_some() {
        cfg.drop_lines = Some(ChartLines::default());
    }
    if let Some(start) = find_tag_simd(xml, b"gapDepth", 0) {
        cfg.gap_depth = attrs::parse_u32_attr(&xml[start..], b"val=\"");
    }
    cfg.extensions = parse_chart_type_ext_lst(xml);
    cfg
}

/// Parse scatter chart config.
fn parse_scatter_config(xml: &[u8]) -> ScatterChartConfig {
    let mut cfg = ScatterChartConfig::default();
    if let Some(start) = find_tag_simd(xml, b"scatterStyle", 0) {
        if let Some(val) = attrs::parse_string_attr(&xml[start..], b"val=\"") {
            cfg.scatter_style = ScatterStyle::from_ooxml(&val);
        }
    }
    if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
        cfg.vary_colors = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    cfg.extensions = parse_chart_type_ext_lst(xml);
    cfg
}

/// Parse bubble chart config.
fn parse_bubble_config(xml: &[u8]) -> BubbleChartConfig {
    let mut cfg = BubbleChartConfig::default();
    if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
        cfg.vary_colors = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    if let Some(start) = find_tag_simd(xml, b"bubbleScale", 0) {
        cfg.bubble_scale = attrs::parse_u32_attr(&xml[start..], b"val=\"");
    }
    if let Some(start) = find_tag_simd(xml, b"bubble3D", 0) {
        cfg.bubble_3d = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    if let Some(start) = find_tag_simd(xml, b"showNegBubbles", 0) {
        cfg.show_neg_bubbles = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    if let Some(start) = find_tag_simd(xml, b"sizeRepresents", 0) {
        if let Some(val) = attrs::parse_string_attr(&xml[start..], b"val=\"") {
            cfg.size_represents = Some(SizeRepresents::from_ooxml(&val));
        }
    }
    cfg.extensions = parse_chart_type_ext_lst(xml);
    cfg
}

/// Parse radar chart config.
fn parse_radar_config(xml: &[u8]) -> RadarChartConfig {
    let mut cfg = RadarChartConfig::default();
    if let Some(start) = find_tag_simd(xml, b"radarStyle", 0) {
        if let Some(val) = attrs::parse_string_attr(&xml[start..], b"val=\"") {
            cfg.radar_style = RadarStyle::from_ooxml(&val);
        }
    }
    if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
        cfg.vary_colors = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    cfg.extensions = parse_chart_type_ext_lst(xml);
    cfg
}

/// Parse surface chart config.
fn parse_surface_config(xml: &[u8]) -> SurfaceChartConfig {
    let mut cfg = SurfaceChartConfig::default();
    if let Some(start) = find_tag_simd(xml, b"wireframe", 0) {
        cfg.wireframe = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    // Parse bandFmts.
    let mut pos = 0;
    while let Some(bf_start) = find_tag_simd(xml, b"bandFmt", pos) {
        let bf_end = find_closing_tag(xml, b"bandFmt", bf_start).unwrap_or(xml.len());
        let bf_bytes = &xml[bf_start..bf_end];
        let mut band = ooxml_types::charts::BandFmt::default();
        if let Some(idx_start) = find_tag_simd(bf_bytes, b"idx", 0) {
            if let Some(v) = attrs::parse_u32_attr(&bf_bytes[idx_start..], b"val=\"") {
                band.idx = v;
            }
        }
        if let Some(sp_start) = find_tag_simd(bf_bytes, b"spPr", 0) {
            let sp_end = find_closing_tag(bf_bytes, b"spPr", sp_start).unwrap_or(bf_bytes.len());
            band.sp_pr = Some(parse_shape_properties(&bf_bytes[sp_start..sp_end]));
        }
        cfg.band_fmts.push(band);
        pos = bf_end;
    }
    cfg.extensions = parse_chart_type_ext_lst(xml);
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
        cfg.up_down_bars = Some(parse_up_down_bars(xml));
    }
    cfg.extensions = parse_chart_type_ext_lst(xml);
    cfg
}

/// Parse ofPie chart config.
fn parse_ofpie_config(xml: &[u8]) -> OfPieChartConfig {
    let mut cfg = OfPieChartConfig::default();
    if let Some(start) = find_tag_simd(xml, b"ofPieType", 0) {
        if let Some(val) = attrs::parse_string_attr(&xml[start..], b"val=\"") {
            cfg.of_pie_type = OfPieType::from_ooxml(&val);
        }
    }
    if let Some(start) = find_tag_simd(xml, b"varyColors", 0) {
        cfg.vary_colors = Some(attrs::parse_bool_attr(&xml[start..], b"val=\""));
    }
    if let Some(start) = find_tag_simd(xml, b"gapWidth", 0) {
        cfg.gap_width = attrs::parse_u32_attr(&xml[start..], b"val=\"");
    }
    if let Some(start) = find_tag_simd(xml, b"splitType", 0) {
        if let Some(val) = attrs::parse_string_attr(&xml[start..], b"val=\"") {
            cfg.split_type = Some(SplitType::from_ooxml(&val));
        }
    }
    if let Some(start) = find_tag_simd(xml, b"splitPos", 0) {
        cfg.split_pos = attrs::parse_f64_attr(&xml[start..], b"val=\"");
    }
    if let Some(start) = find_tag_simd(xml, b"secondPieSize", 0) {
        cfg.second_pie_size = attrs::parse_u32_attr(&xml[start..], b"val=\"");
    }
    // Parse custSplit - list of secondPiePt indices.
    if let Some(cs_start) = find_tag_simd(xml, b"custSplit", 0) {
        let cs_end = find_closing_tag(xml, b"custSplit", cs_start).unwrap_or(xml.len());
        let cs_xml = &xml[cs_start..cs_end];
        let mut indices = Vec::new();
        let mut pos = 0;
        while let Some(pt_start) = find_tag_simd(cs_xml, b"secondPiePt", pos) {
            if let Some(idx) = attrs::parse_u32_attr(&cs_xml[pt_start..], b"val=\"") {
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
    cfg.extensions = parse_chart_type_ext_lst(xml);
    cfg
}

/// Parse upDownBars.
fn parse_up_down_bars(xml: &[u8]) -> UpDownBars {
    let mut udb = UpDownBars::default();
    if let Some(udb_start) = find_tag_simd(xml, b"upDownBars", 0) {
        let udb_end = find_closing_tag(xml, b"upDownBars", udb_start).unwrap_or(xml.len());
        let udb_bytes = &xml[udb_start..udb_end];
        if let Some(start) = find_tag_simd(udb_bytes, b"gapWidth", 0) {
            udb.gap_width = attrs::parse_u32_attr(&udb_bytes[start..], b"val=\"");
        }
    }
    udb
}
