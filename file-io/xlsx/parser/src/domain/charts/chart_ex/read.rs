//! ChartEx XML parser — parses `cx:chartSpace` into `ChartExSpace`.
//!
//! Uses the same SIMD-based scanning approach as the standard chart parser.

use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd,
};
use crate::infra::xml::decode_xml_entities;

use ooxml_types::chart_ex::*;

use crate::domain::charts::{parse_shape_properties, parse_text_body};

// =============================================================================
// Main entry point
// =============================================================================

/// Parse a ChartEx XML part (`cx:chartSpace`) into a `ChartExSpace`.
pub fn parse_chart_ex(xml: &[u8]) -> ChartExSpace {
    let mut result = ChartExSpace::default();

    let root_start = match find_tag_simd(xml, b"chartSpace", 0) {
        Some(p) => p,
        None => return result,
    };

    // Parse cx:chartData
    if let Some(cd_start) = find_tag_simd(xml, b"chartData", root_start) {
        let cd_end = find_closing_tag(xml, b"chartData", cd_start).unwrap_or(xml.len());
        result.chart_data = parse_chart_data(&xml[cd_start..cd_end]);
    }

    // Parse cx:chart
    if let Some(_ch_start) = find_tag_simd(xml, b"chart", root_start) {
        // Skip past chartData — we need the cx:chart, not cx:chartData
        let search_from = find_closing_tag(xml, b"chartData", root_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(root_start);
        if let Some(ch_start) = find_tag_simd(xml, b"chart", search_from) {
            let ch_end = find_closing_tag(xml, b"chart", ch_start).unwrap_or(xml.len());
            result.chart = parse_chart_ex_chart(&xml[ch_start..ch_end]);
        }
    } else {
        // No chartData — look for chart directly
        if let Some(ch_start) = find_tag_simd(xml, b"chart", root_start) {
            let ch_end = find_closing_tag(xml, b"chart", ch_start).unwrap_or(xml.len());
            result.chart = parse_chart_ex_chart(&xml[ch_start..ch_end]);
        }
    }

    // Find where </cx:chart> ends — everything after this is chartSpace-level
    let after_chart = {
        // Skip past chartData first
        let past_data = find_closing_tag(xml, b"chartData", root_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(root_start);
        // Now find </cx:chart> after chartData
        let chart_start = find_tag_simd(xml, b"chart", past_data).unwrap_or(past_data);
        find_closing_tag(xml, b"chart", chart_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(past_data)
    };

    // Parse cx:fmtOvrs (after </cx:chart>, before cx:spPr)
    let mut sp_search = after_chart;
    if let Some(fmtovrs_start) = find_tag_simd(xml, b"fmtOvrs", after_chart) {
        let fmtovrs_end = find_closing_tag(xml, b"fmtOvrs", fmtovrs_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        result.fmt_ovrs = parse_fmt_ovrs(&xml[fmtovrs_start..fmtovrs_end]);
        sp_search = fmtovrs_end;
    }

    // Parse cx:spPr (after fmtOvrs, at chartSpace level)
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", sp_search) {
        let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
        result.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
    }

    // Parse cx:txPr (after spPr)
    if let Some(txpr_start) = find_tag_simd(xml, b"txPr", sp_search) {
        let txpr_end = find_closing_tag(xml, b"txPr", txpr_start).unwrap_or(xml.len());
        result.tx_pr = Some(parse_text_body(&xml[txpr_start..txpr_end]));
    }

    // Parse cx:printSettings
    if let Some(ps_start) = find_tag_simd(xml, b"printSettings", sp_search) {
        let ps_end = find_closing_tag(xml, b"printSettings", ps_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        let raw = std::str::from_utf8(&xml[ps_start..ps_end])
            .unwrap_or("")
            .to_string();
        result.print_settings = Some(ChartExPrintSettings {
            raw_xml: if raw.is_empty() { None } else { Some(raw) },
        });
    }

    result
}

// =============================================================================
// ChartData parsing
// =============================================================================

fn parse_chart_data(xml: &[u8]) -> ChartExChartData {
    let mut chart_data = ChartExChartData::default();
    let mut pos = 0;

    while let Some(data_start) = find_tag_simd(xml, b"data", pos) {
        // Skip "chartData" — we need "data" not "chartData"
        let tag_end = find_gt_simd(xml, data_start).unwrap_or(xml.len());
        let tag_bytes = &xml[data_start..tag_end];

        // Check this is cx:data (has id= attr) not chartData
        if find_attr_simd(tag_bytes, b"id=\"", 0).is_none() {
            pos = tag_end + 1;
            continue;
        }

        let data_end = find_closing_tag(xml, b"data", data_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        let data_bytes = &xml[data_start..data_end];

        let id = parse_attr_u32(tag_bytes, b"id=\"").unwrap_or(0);
        let dimensions = parse_dimensions(data_bytes);

        chart_data.data.push(ChartExData { id, dimensions });
        pos = data_end;
    }

    chart_data
}

fn parse_dimensions(xml: &[u8]) -> Vec<ChartExDimension> {
    let mut dims = Vec::new();
    let mut pos = 0;

    // Parse strDim elements
    while let Some(dim_start) = find_tag_simd(xml, b"strDim", pos) {
        let dim_end = find_closing_tag(xml, b"strDim", dim_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        let dim_bytes = &xml[dim_start..dim_end];
        let tag_end = find_gt_simd(dim_bytes, 0).unwrap_or(dim_bytes.len());
        let tag_bytes = &dim_bytes[..tag_end];

        let dim_type = parse_attr_str(tag_bytes, b"type=\"").unwrap_or_default();
        let formula = parse_formula_element(dim_bytes);

        dims.push(ChartExDimension::String { dim_type, formula });
        pos = dim_end;
    }

    // Parse numDim elements
    pos = 0;
    while let Some(dim_start) = find_tag_simd(xml, b"numDim", pos) {
        let dim_end = find_closing_tag(xml, b"numDim", dim_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        let dim_bytes = &xml[dim_start..dim_end];
        let tag_end = find_gt_simd(dim_bytes, 0).unwrap_or(dim_bytes.len());
        let tag_bytes = &dim_bytes[..tag_end];

        let dim_type = parse_attr_str(tag_bytes, b"type=\"").unwrap_or_default();
        let formula = parse_formula_element(dim_bytes);

        dims.push(ChartExDimension::Numeric { dim_type, formula });
        pos = dim_end;
    }

    dims
}

fn parse_formula_element(xml: &[u8]) -> ChartExFormula {
    let mut formula = ChartExFormula::default();
    // Find <cx:f ...>...</cx:f> or just <f ...>...</f>
    if let Some(f_start) = find_tag_simd(xml, b"f", 0) {
        let f_tag_end = find_gt_simd(xml, f_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let tag_bytes = &xml[f_start..f_tag_end];

        // Parse dir attribute
        formula.dir = parse_attr_str(tag_bytes, b"dir=\"");

        // Parse text content
        let f_close = find_closing_tag(xml, b"f", f_start).unwrap_or(xml.len());
        if f_tag_end < f_close {
            formula.content = std::str::from_utf8(&xml[f_tag_end..f_close])
                .unwrap_or("")
                .to_string();
        }
    }
    formula
}

// =============================================================================
// Chart parsing
// =============================================================================

fn parse_chart_ex_chart(xml: &[u8]) -> ChartExChart {
    let mut chart = ChartExChart::default();

    // Parse title
    if let Some(t_start) = find_tag_simd(xml, b"title", 0) {
        let t_end = find_closing_tag(xml, b"title", t_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        chart.title = Some(parse_chart_ex_title(&xml[t_start..t_end]));
    }

    // Parse plotArea
    if let Some(pa_start) = find_tag_simd(xml, b"plotArea", 0) {
        let pa_end = find_closing_tag(xml, b"plotArea", pa_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        chart.plot_area = parse_chart_ex_plot_area(&xml[pa_start..pa_end]);
    }

    // Parse legend
    if let Some(l_start) = find_tag_simd(xml, b"legend", 0) {
        let l_end = find_closing_tag(xml, b"legend", l_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        chart.legend = Some(parse_chart_ex_legend(&xml[l_start..l_end]));
    }

    chart
}

fn parse_chart_ex_title(xml: &[u8]) -> ChartExTitle {
    let mut title = ChartExTitle::default();
    let tag_end = find_gt_simd(xml, 0).unwrap_or(xml.len());
    let tag_bytes = &xml[..tag_end];

    title.pos = parse_attr_str(tag_bytes, b"pos=\"");
    title.align = parse_attr_str(tag_bytes, b"align=\"");
    title.overlay = parse_attr_bool(tag_bytes, b"overlay=\"");

    // Parse tx
    if let Some(tx_start) = find_tag_simd(xml, b"tx", 0) {
        // Skip "txPr" — we want "tx" not "txPr"
        let _tx_tag_end = find_gt_simd(xml, tx_start).unwrap_or(xml.len());
        // Check it's not txPr
        let check = &xml[tx_start..std::cmp::min(tx_start + 10, xml.len())];
        if !check.starts_with(b"txPr") {
            let tx_end = find_closing_tag(xml, b"tx", tx_start)
                .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
                .unwrap_or(xml.len());
            title.tx = Some(parse_chart_ex_text(&xml[tx_start..tx_end]));
        }
    }

    // Parse txPr
    if let Some(txpr_start) = find_tag_simd(xml, b"txPr", 0) {
        let txpr_end = find_closing_tag(xml, b"txPr", txpr_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        title.tx_pr = Some(parse_text_body(&xml[txpr_start..txpr_end]));
    }

    // Parse spPr (title shape properties)
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
        // Skip spPr inside tx — only parse if it's a direct child of title
        let tx_end =
            find_closing_tag(xml, b"tx", 0).and_then(|p| find_gt_simd(xml, p).map(|g| g + 1));
        let search_after = tx_end.unwrap_or(0);
        if sp_start >= search_after {
            let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
            title.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
        } else if let Some(sp2_start) = find_tag_simd(xml, b"spPr", search_after) {
            let sp_end = find_closing_tag(xml, b"spPr", sp2_start).unwrap_or(xml.len());
            title.sp_pr = Some(parse_shape_properties(&xml[sp2_start..sp_end]));
        }
    }

    title
}

fn parse_chart_ex_text(xml: &[u8]) -> ChartExText {
    let mut text = ChartExText::default();

    // Parse txData
    if let Some(td_start) = find_tag_simd(xml, b"txData", 0) {
        let td_end = find_closing_tag(xml, b"txData", td_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        text.tx_data = Some(parse_chart_ex_tx_data(&xml[td_start..td_end]));
    }

    // Parse rich (DrawingML text body)
    if let Some(r_start) = find_tag_simd(xml, b"rich", 0) {
        let r_end = find_closing_tag(xml, b"rich", r_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        text.rich = Some(parse_text_body(&xml[r_start..r_end]));
    }

    text
}

fn parse_chart_ex_tx_data(xml: &[u8]) -> ChartExTxData {
    let mut tx_data = ChartExTxData::default();

    // Parse cx:f
    if let Some(f_start) = find_tag_simd(xml, b"f", 0) {
        let f_tag_end = find_gt_simd(xml, f_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let f_close = find_closing_tag(xml, b"f", f_start).unwrap_or(xml.len());
        if f_tag_end < f_close {
            tx_data.formula = Some(
                std::str::from_utf8(&xml[f_tag_end..f_close])
                    .unwrap_or("")
                    .to_string(),
            );
        }
    }

    // Parse cx:v
    if let Some(v_start) = find_tag_simd(xml, b"v", 0) {
        // Avoid matching "visibility" or other v-prefixed tags
        let v_tag_end = find_gt_simd(xml, v_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        // Check that the tag name is just "v" (or "cx:v")
        let tag_name_end = v_start
            + memchr::memchr3(b' ', b'>', b'/', &xml[v_start..]).unwrap_or(xml.len() - v_start);
        let tag_name = std::str::from_utf8(&xml[v_start..tag_name_end]).unwrap_or("");
        // Accept "v", "cx:v"
        if tag_name == "v" || tag_name.ends_with(":v") {
            let v_close = find_closing_tag(xml, b"v", v_start).unwrap_or(xml.len());
            if v_tag_end <= v_close {
                tx_data.value = Some(decode_xml_entities(&xml[v_tag_end..v_close]));
            }
        }
    }

    tx_data
}

// =============================================================================
// PlotArea parsing
// =============================================================================

fn parse_chart_ex_plot_area(xml: &[u8]) -> ChartExPlotArea {
    let mut plot_area = ChartExPlotArea::default();

    // Parse plotAreaRegion
    if let Some(par_start) = find_tag_simd(xml, b"plotAreaRegion", 0) {
        let par_end = find_closing_tag(xml, b"plotAreaRegion", par_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        plot_area.plot_area_region = parse_chart_ex_plot_area_region(&xml[par_start..par_end]);
    }

    // Parse plotArea-level spPr (between plotAreaRegion and axes)
    let sp_search_start = find_closing_tag(xml, b"plotAreaRegion", 0)
        .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
        .unwrap_or(0);
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", sp_search_start) {
        // Only if it's before the first axis (it's a plotArea-level spPr, not axis-level)
        let first_axis = find_tag_simd(xml, b"axis", sp_search_start);
        if first_axis.is_none() || sp_start < first_axis.unwrap() {
            let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
            plot_area.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
        }
    }

    // Parse axes
    let mut pos = 0;
    while let Some(ax_start) = find_tag_simd(xml, b"axis", pos) {
        // Skip "plotAreaRegion" by checking the tag name
        let ax_end = find_closing_tag(xml, b"axis", ax_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());

        // Check it's a self-closing or real axis tag
        let tag_end = find_gt_simd(xml, ax_start).unwrap_or(xml.len());
        let _tag_bytes = &xml[ax_start..tag_end];

        plot_area
            .axes
            .push(parse_chart_ex_axis(&xml[ax_start..ax_end]));

        pos = ax_end;
    }

    plot_area
}

fn parse_chart_ex_plot_area_region(xml: &[u8]) -> ChartExPlotAreaRegion {
    let mut region = ChartExPlotAreaRegion::default();

    // Parse spPr for the region itself (before series)
    // NOTE: The region-level spPr is rare but possible
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
        // Only if it appears before any series
        let first_series = find_tag_simd(xml, b"series", 0);
        if first_series.is_none() || sp_start < first_series.unwrap() {
            let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
            region.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
        }
    }

    // Parse series
    let mut pos = 0;
    while let Some(ser_start) = find_tag_simd(xml, b"series", pos) {
        let ser_end = find_closing_tag(xml, b"series", ser_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        region
            .series
            .push(parse_chart_ex_series(&xml[ser_start..ser_end]));
        pos = ser_end;
    }

    region
}

fn parse_chart_ex_series(xml: &[u8]) -> ChartExSeries {
    let mut series = ChartExSeries::default();
    let tag_end = find_gt_simd(xml, 0).unwrap_or(xml.len());
    let tag_bytes = &xml[..tag_end];

    // Parse attributes
    if let Some(lid) = parse_attr_str(tag_bytes, b"layoutId=\"") {
        series.layout_id = ChartExLayoutId::from_ooxml(&lid);
    }
    series.unique_id = parse_attr_str(tag_bytes, b"uniqueId=\"");
    series.format_idx = parse_attr_u32(tag_bytes, b"formatIdx=\"");
    series.hidden = parse_attr_bool(tag_bytes, b"hidden=\"");

    // Parse tx
    if let Some(tx_start) = find_tag_simd(xml, b"tx", 0) {
        // Check it's not txPr
        let remaining = &xml[tx_start..std::cmp::min(tx_start + 10, xml.len())];
        if !remaining.starts_with(b"txPr") {
            let tx_end = find_closing_tag(xml, b"tx", tx_start)
                .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
                .unwrap_or(xml.len());
            series.tx = Some(parse_chart_ex_text(&xml[tx_start..tx_end]));
        }
    }

    // Parse series-level spPr (the first spPr before any dataPt)
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
        // Only take this spPr if it's before the first dataPt (it's the series-level one)
        let first_data_pt = find_tag_simd(xml, b"dataPt", 0);
        if first_data_pt.is_none() || sp_start < first_data_pt.unwrap() {
            let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
            series.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
        }
    }

    // Parse dataPt elements
    {
        let mut pos = 0;
        while let Some(dpt_start) = find_tag_simd(xml, b"dataPt", pos) {
            let dpt_end = find_closing_tag(xml, b"dataPt", dpt_start)
                .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
                .unwrap_or(xml.len());
            let dpt_bytes = &xml[dpt_start..dpt_end];
            let dpt_tag_end = find_gt_simd(dpt_bytes, 0).unwrap_or(dpt_bytes.len());

            let idx = parse_attr_u32(&dpt_bytes[..dpt_tag_end], b"idx=\"").unwrap_or(0);
            let sp = if let Some(sp_start) = find_tag_simd(dpt_bytes, b"spPr", 0) {
                let sp_end =
                    find_closing_tag(dpt_bytes, b"spPr", sp_start).unwrap_or(dpt_bytes.len());
                Some(parse_shape_properties(&dpt_bytes[sp_start..sp_end]))
            } else {
                None
            };

            series.data_points.push(ChartExDataPoint { idx, sp_pr: sp });
            pos = dpt_end;
        }
    }

    // Parse dataLabels
    if let Some(dl_start) = find_tag_simd(xml, b"dataLabels", 0) {
        let dl_end = find_closing_tag(xml, b"dataLabels", dl_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        series.data_labels = Some(parse_chart_ex_data_labels(&xml[dl_start..dl_end]));
    }

    // Parse dataId
    if let Some(di_start) = find_tag_simd(xml, b"dataId", 0) {
        let di_tag_end = find_gt_simd(xml, di_start).unwrap_or(xml.len());
        series.data_id = parse_attr_u32(&xml[di_start..di_tag_end], b"val=\"");
    }

    // Parse layoutPr
    if let Some(lp_start) = find_tag_simd(xml, b"layoutPr", 0) {
        let lp_end = find_closing_tag(xml, b"layoutPr", lp_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        series.layout_pr = Some(parse_chart_ex_layout_props(&xml[lp_start..lp_end]));
    }

    series
}

// =============================================================================
// DataLabels parsing
// =============================================================================

fn parse_chart_ex_data_labels(xml: &[u8]) -> ChartExDataLabels {
    let mut labels = ChartExDataLabels::default();
    let tag_end = find_gt_simd(xml, 0).unwrap_or(xml.len());
    let tag_bytes = &xml[..tag_end];

    labels.pos = parse_attr_str(tag_bytes, b"pos=\"");

    // Parse visibility
    if let Some(vis_start) = find_tag_simd(xml, b"visibility", 0) {
        let vis_tag_end = find_gt_simd(xml, vis_start).unwrap_or(xml.len());
        let vis_bytes = &xml[vis_start..vis_tag_end];
        labels.visibility = Some(ChartExDataLabelVisibility {
            series_name: parse_attr_bool(vis_bytes, b"seriesName=\""),
            category_name: parse_attr_bool(vis_bytes, b"categoryName=\""),
            value: parse_attr_bool(vis_bytes, b"value=\""),
        });
    }

    // Parse txPr
    if let Some(txpr_start) = find_tag_simd(xml, b"txPr", 0) {
        let txpr_end = find_closing_tag(xml, b"txPr", txpr_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        labels.tx_pr = Some(parse_text_body(&xml[txpr_start..txpr_end]));
    }

    // Parse numFmt
    if let Some(nf_start) = find_tag_simd(xml, b"numFmt", 0) {
        let nf_tag_end = find_gt_simd(xml, nf_start).unwrap_or(xml.len());
        let nf_bytes = &xml[nf_start..nf_tag_end];
        labels.num_fmt = Some(ChartExNumberFormat {
            format_code: parse_attr_str(nf_bytes, b"formatCode=\"").unwrap_or_default(),
            source_linked: parse_attr_bool(nf_bytes, b"sourceLinked=\""),
        });
    }

    // Parse spPr
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
        let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
        labels.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
    }

    // Parse separator
    if let Some(sep_start) = find_tag_simd(xml, b"separator", 0) {
        let sep_tag_end = find_gt_simd(xml, sep_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let sep_close = find_closing_tag(xml, b"separator", sep_start).unwrap_or(xml.len());
        if sep_tag_end < sep_close {
            labels.separator = Some(
                std::str::from_utf8(&xml[sep_tag_end..sep_close])
                    .unwrap_or("")
                    .to_string(),
            );
        }
    }

    labels
}

// =============================================================================
// Layout properties parsing
// =============================================================================

fn parse_chart_ex_layout_props(xml: &[u8]) -> ChartExLayoutProperties {
    let mut props = ChartExLayoutProperties::default();

    // Parse visibility (inside layoutPr, not the top-level one)
    if let Some(vis_start) = find_tag_simd(xml, b"visibility", 0) {
        let vis_tag_end = find_gt_simd(xml, vis_start).unwrap_or(xml.len());
        let vis_bytes = &xml[vis_start..vis_tag_end];
        props.visibility = Some(ChartExLayoutVisibility {
            connector_lines: parse_attr_bool(vis_bytes, b"connectorLines=\""),
            mean_line: parse_attr_bool(vis_bytes, b"meanLine=\""),
            mean_marker: parse_attr_bool(vis_bytes, b"meanMarker=\""),
            non_outlier_points: parse_attr_bool(vis_bytes, b"nonoutlierPoints=\""),
            outlier_points: parse_attr_bool(vis_bytes, b"outlierPoints=\""),
        });
    }

    // Parse subtotals
    if find_tag_simd(xml, b"subtotals", 0).is_some() {
        let mut subtotals = ChartExSubtotals::default();
        // Parse idx children
        let mut pos = 0;
        while let Some(idx_start) = find_tag_simd(xml, b"idx", pos) {
            let idx_tag_end = find_gt_simd(xml, idx_start).unwrap_or(xml.len());
            if let Some(val) = parse_attr_u32(&xml[idx_start..idx_tag_end], b"val=\"") {
                subtotals.idx.push(val);
            }
            pos = idx_tag_end + 1;
        }
        props.subtotals = Some(subtotals);
    }

    // Parse parentLabelLayout
    if let Some(pll_start) = find_tag_simd(xml, b"parentLabelLayout", 0) {
        let pll_tag_end = find_gt_simd(xml, pll_start).unwrap_or(xml.len());
        props.parent_label_layout = parse_attr_str(&xml[pll_start..pll_tag_end], b"val=\"");
    }

    // Parse binning
    if let Some(bin_start) = find_tag_simd(xml, b"binning", 0) {
        let bin_end = find_closing_tag(xml, b"binning", bin_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        props.binning = Some(parse_chart_ex_binning(&xml[bin_start..bin_end]));
    }

    // Parse statistics
    if let Some(stat_start) = find_tag_simd(xml, b"statistics", 0) {
        let stat_tag_end = find_gt_simd(xml, stat_start).unwrap_or(xml.len());
        let stat_bytes = &xml[stat_start..stat_tag_end];
        props.statistics = Some(ChartExStatistics {
            quartile_method: parse_attr_str(stat_bytes, b"quartileMethod=\""),
        });
    }

    props
}

fn parse_chart_ex_binning(xml: &[u8]) -> ChartExBinning {
    let mut binning = ChartExBinning::default();
    let tag_end = find_gt_simd(xml, 0).unwrap_or(xml.len());
    let tag_bytes = &xml[..tag_end];

    binning.interval_closed = parse_attr_str(tag_bytes, b"intervalClosed=\"");

    // Parse underflow
    if let Some(attr) = parse_attr_str(tag_bytes, b"underflow=\"") {
        binning.underflow = Some(if attr == "auto" {
            ChartExBoundValue::Auto
        } else {
            ChartExBoundValue::Value(attr.parse().unwrap_or(0.0))
        });
    }

    // Parse overflow
    if let Some(attr) = parse_attr_str(tag_bytes, b"overflow=\"") {
        binning.overflow = Some(if attr == "auto" {
            ChartExBoundValue::Auto
        } else {
            ChartExBoundValue::Value(attr.parse().unwrap_or(0.0))
        });
    }

    // Parse binSize child element
    if let Some(bs_start) = find_tag_simd(xml, b"binSize", 0) {
        let bs_tag_end = find_gt_simd(xml, bs_start).unwrap_or(xml.len());
        if let Some(val_str) = parse_attr_str(&xml[bs_start..bs_tag_end], b"val=\"") {
            binning.bin_size = val_str.parse().ok();
        }
    }

    // Parse binCount child element
    if let Some(bc_start) = find_tag_simd(xml, b"binCount", 0) {
        let bc_tag_end = find_gt_simd(xml, bc_start).unwrap_or(xml.len());
        binning.bin_count = parse_attr_u32(&xml[bc_start..bc_tag_end], b"val=\"");
    }

    binning
}

// =============================================================================
// Axis parsing
// =============================================================================

fn parse_chart_ex_axis(xml: &[u8]) -> ChartExAxis {
    let mut axis = ChartExAxis::default();
    let tag_end = find_gt_simd(xml, 0).unwrap_or(xml.len());
    let tag_bytes = &xml[..tag_end];

    axis.id = parse_attr_u32(tag_bytes, b"id=\"");
    axis.hidden = parse_attr_bool(tag_bytes, b"hidden=\"");

    // Parse catScaling or valScaling
    if let Some(cs_start) = find_tag_simd(xml, b"catScaling", 0) {
        let cs_tag_end = find_gt_simd(xml, cs_start).unwrap_or(xml.len());
        let cs_bytes = &xml[cs_start..cs_tag_end];
        axis.scaling = Some(ChartExScaling::Category {
            gap_width: parse_attr_str(cs_bytes, b"gapWidth=\""),
        });
    } else if let Some(vs_start) = find_tag_simd(xml, b"valScaling", 0) {
        let vs_tag_end = find_gt_simd(xml, vs_start).unwrap_or(xml.len());
        let vs_bytes = &xml[vs_start..vs_tag_end];
        axis.scaling = Some(ChartExScaling::Value {
            max: parse_attr_str(vs_bytes, b"max=\""),
            min: parse_attr_str(vs_bytes, b"min=\""),
        });
    }

    // Parse title
    if let Some(t_start) = find_tag_simd(xml, b"title", 0) {
        let t_end = find_closing_tag(xml, b"title", t_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        axis.title = Some(parse_chart_ex_title(&xml[t_start..t_end]));
    }

    // Parse majorGridlines
    if let Some(mg_start) = find_tag_simd(xml, b"majorGridlines", 0) {
        let mg_end = find_closing_tag(xml, b"majorGridlines", mg_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        let mg_bytes = &xml[mg_start..mg_end];
        let sp = if let Some(sp_start) = find_tag_simd(mg_bytes, b"spPr", 0) {
            let sp_end = find_closing_tag(mg_bytes, b"spPr", sp_start).unwrap_or(mg_bytes.len());
            Some(parse_shape_properties(&mg_bytes[sp_start..sp_end]))
        } else {
            None
        };
        axis.major_gridlines = Some(ChartExGridlines { sp_pr: sp });
    }

    // Parse minorGridlines
    if let Some(mg_start) = find_tag_simd(xml, b"minorGridlines", 0) {
        let mg_end = find_closing_tag(xml, b"minorGridlines", mg_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        let mg_bytes = &xml[mg_start..mg_end];
        let sp = if let Some(sp_start) = find_tag_simd(mg_bytes, b"spPr", 0) {
            let sp_end = find_closing_tag(mg_bytes, b"spPr", sp_start).unwrap_or(mg_bytes.len());
            Some(parse_shape_properties(&mg_bytes[sp_start..sp_end]))
        } else {
            None
        };
        axis.minor_gridlines = Some(ChartExGridlines { sp_pr: sp });
    }

    // Parse majorTickMarks
    if let Some(mt_start) = find_tag_simd(xml, b"majorTickMarks", 0) {
        let mt_tag_end = find_gt_simd(xml, mt_start).unwrap_or(xml.len());
        let mt_bytes = &xml[mt_start..mt_tag_end];
        axis.major_tick_marks = Some(ChartExTickMarks {
            tick_type: parse_attr_str(mt_bytes, b"type=\""),
        });
    }

    // Parse minorTickMarks
    if let Some(mt_start) = find_tag_simd(xml, b"minorTickMarks", 0) {
        let mt_tag_end = find_gt_simd(xml, mt_start).unwrap_or(xml.len());
        let mt_bytes = &xml[mt_start..mt_tag_end];
        axis.minor_tick_marks = Some(ChartExTickMarks {
            tick_type: parse_attr_str(mt_bytes, b"type=\""),
        });
    }

    // Parse tickLabels
    if find_tag_simd(xml, b"tickLabels", 0).is_some() {
        axis.tick_labels = true;
    }

    // Parse numFmt
    if let Some(nf_start) = find_tag_simd(xml, b"numFmt", 0) {
        let nf_tag_end = find_gt_simd(xml, nf_start).unwrap_or(xml.len());
        let nf_bytes = &xml[nf_start..nf_tag_end];
        axis.num_fmt = Some(ChartExNumberFormat {
            format_code: parse_attr_str(nf_bytes, b"formatCode=\"").unwrap_or_default(),
            source_linked: parse_attr_bool(nf_bytes, b"sourceLinked=\""),
        });
    }

    // Parse spPr (axis line formatting) — find spPr not inside gridlines or title
    // Search after scaling/title/gridlines/tickLabels
    let sp_search_start = {
        let mut s = tag_end + 1;
        // Skip past major/minor gridlines and tickLabels
        if let Some(tl) = find_tag_simd(xml, b"tickLabels", 0) {
            let tl_end = find_gt_simd(xml, tl).map(|p| p + 1).unwrap_or(xml.len());
            if tl_end > s {
                s = tl_end;
            }
        }
        // Skip past numFmt
        if let Some(nf) = find_tag_simd(xml, b"numFmt", s) {
            let nf_end = find_gt_simd(xml, nf).map(|p| p + 1).unwrap_or(xml.len());
            if nf_end > s {
                s = nf_end;
            }
        }
        s
    };
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", sp_search_start) {
        let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
        axis.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
    }

    // Parse txPr
    if let Some(txpr_start) = find_tag_simd(xml, b"txPr", sp_search_start) {
        let txpr_end = find_closing_tag(xml, b"txPr", txpr_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        axis.tx_pr = Some(parse_text_body(&xml[txpr_start..txpr_end]));
    }

    axis
}

// =============================================================================
// Legend parsing
// =============================================================================

fn parse_chart_ex_legend(xml: &[u8]) -> ChartExLegend {
    let mut legend = ChartExLegend::default();
    let tag_end = find_gt_simd(xml, 0).unwrap_or(xml.len());
    let tag_bytes = &xml[..tag_end];

    legend.pos = parse_attr_str(tag_bytes, b"pos=\"");
    legend.align = parse_attr_str(tag_bytes, b"align=\"");
    legend.overlay = parse_attr_bool(tag_bytes, b"overlay=\"");

    // Parse spPr
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
        let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
        legend.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
    }

    // Parse txPr
    if let Some(txpr_start) = find_tag_simd(xml, b"txPr", 0) {
        let txpr_end = find_closing_tag(xml, b"txPr", txpr_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        legend.tx_pr = Some(parse_text_body(&xml[txpr_start..txpr_end]));
    }

    legend
}

// =============================================================================
// Format Overrides
// =============================================================================

fn parse_fmt_ovrs(xml: &[u8]) -> Vec<ChartExFormatOverride> {
    let mut overrides = Vec::new();
    let mut pos = 0;

    while let Some(fmtovr_start) = find_tag_simd(xml, b"fmtOvr", pos) {
        // Skip the container tag <cx:fmtOvrs> — only process <cx:fmtOvr>
        let tag_end = find_gt_simd(xml, fmtovr_start).unwrap_or(xml.len());
        let tag_bytes = &xml[fmtovr_start..tag_end];

        // Must be <cx:fmtOvr (not <cx:fmtOvrs)
        // Check that the character after "fmtOvr" is not 's'
        let tag_name_end = fmtovr_start + b"<cx:fmtOvr".len();
        if tag_name_end < xml.len() && xml[tag_name_end] == b's' {
            pos = tag_end + 1;
            continue;
        }

        let idx = parse_attr_u32(tag_bytes, b"idx=\"").unwrap_or(0);

        let fmtovr_end = find_closing_tag(xml, b"fmtOvr", fmtovr_start)
            .and_then(|p| find_gt_simd(xml, p).map(|g| g + 1))
            .unwrap_or(xml.len());
        let inner = &xml[fmtovr_start..fmtovr_end];

        let sp_pr = if let Some(sp_start) = find_tag_simd(inner, b"spPr", 0) {
            let sp_end = find_closing_tag(inner, b"spPr", sp_start).unwrap_or(inner.len());
            Some(parse_shape_properties(&inner[sp_start..sp_end]))
        } else {
            None
        };

        overrides.push(ChartExFormatOverride { idx, sp_pr });
        pos = fmtovr_end;
    }

    overrides
}

// =============================================================================
// Attribute parsing helpers
// =============================================================================

fn parse_attr_str(xml: &[u8], attr_prefix: &[u8]) -> Option<String> {
    let pos = find_attr_simd(xml, attr_prefix, 0)?;
    let val_start = pos + attr_prefix.len();
    let (start, end) = extract_quoted_value(xml, val_start)?;
    Some(crate::infra::xml::decode_xml_entities(&xml[start..end]))
}

fn parse_attr_u32(xml: &[u8], attr_prefix: &[u8]) -> Option<u32> {
    parse_attr_str(xml, attr_prefix)?.parse().ok()
}

fn parse_attr_bool(xml: &[u8], attr_prefix: &[u8]) -> Option<bool> {
    let s = parse_attr_str(xml, attr_prefix)?;
    match s.as_str() {
        "1" | "true" => Some(true),
        "0" | "false" => Some(false),
        _ => None,
    }
}
