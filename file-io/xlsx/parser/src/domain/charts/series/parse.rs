use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_tag_simd,
};

use super::data_sources::{AxisData, parse_series_text};
use super::error_bars::parse_error_bars;
use super::labels::parse_data_labels;
use super::points::{parse_all_data_points, parse_marker};
use super::trendlines::parse_trendline;
use super::xml_values::{parse_bool_val, parse_val_attr_u32};
use super::{ChartSeries, find_top_level_ext_lst, parse_chart_ext_lst_at};
use crate::domain::charts::parse_shape_properties;

// =============================================================================
// Series (parsing into ooxml_types::charts::ChartSeries)
// =============================================================================

/// Parse all series from a chart type element.
///
/// Skips `<c15:ser>` tags inside filtered-series wrappers
/// (`c15:filteredBarSeries`, `c15:filteredLineSeries`, etc.) that live in
/// the chart-type-level `<c:extLst>`.  Those are preserved via raw extLst
/// round-tripping, not as regular series.
pub fn parse_all_series(xml: &[u8]) -> Vec<ChartSeries> {
    let mut series = Vec::new();
    let mut pos = 0;

    while let Some(ser_start) = find_tag_simd(xml, b"ser", pos) {
        // Make sure this is <c:ser> not </c:ser>
        if ser_start > 0 && xml.get(ser_start.saturating_sub(1)) == Some(&b'/') {
            pos = ser_start + 1;
            continue;
        }

        // Skip filtered series: <c15:ser> (or any non-standard prefixed ser).
        // find_tag_simd returns the '<' position.  Accept only <c:ser> or bare <ser>.
        if !is_standard_ser_tag(xml, ser_start) {
            let ser_end = find_closing_tag(xml, b"ser", ser_start).unwrap_or(xml.len());
            pos = ser_end;
            continue;
        }

        let ser_end = find_closing_tag(xml, b"ser", ser_start).unwrap_or(xml.len());
        let ser_bytes = &xml[ser_start..ser_end];

        series.push(parse_series(ser_bytes));
        pos = ser_end;
    }

    series
}

/// Check if a `<...ser ...>` tag at `lt_pos` is a standard chart series (`<c:ser>` or `<ser>`)
/// rather than a filtered extension series like `<c15:ser>`.
pub(crate) fn is_standard_ser_tag(xml: &[u8], lt_pos: usize) -> bool {
    let after_lt = lt_pos + 1;
    if after_lt >= xml.len() {
        return false;
    }
    let rest = &xml[after_lt..];
    // <ser ...>  (no namespace prefix)
    if rest.starts_with(b"ser") {
        let after = rest.get(3).copied().unwrap_or(b'>');
        if matches!(after, b' ' | b'>' | b'/' | b'\t' | b'\n' | b'\r') {
            return true;
        }
    }
    // <c:ser ...>  (standard chart namespace)
    if rest.starts_with(b"c:ser") {
        let after = rest.get(5).copied().unwrap_or(b'>');
        if matches!(after, b' ' | b'>' | b'/' | b'\t' | b'\n' | b'\r') {
            return true;
        }
    }
    false
}

/// Parse a single series element into a `ChartSeries`.
pub fn parse_series(xml: &[u8]) -> ChartSeries {
    let mut series = ChartSeries::default();

    // ---------------------------------------------------------------
    // Find the series-level extLst FIRST.  A series can contain nested
    // children (dPt, dLbls, marker, errBars, trendline) that each have
    // their own extLst.  The series-level extLst is always the LAST
    // one (per OOXML spec, extLst is the final child).  We restrict
    // child element parsing to the region BEFORE the series-level
    // extLst so that tags inside extensions (e.g. <c15:tx> from
    // filteredSeriesTitle, or <c15:showLeaderLines>) are not
    // mistakenly matched as series-level elements.
    // ---------------------------------------------------------------
    let ser_ext_lst_pos = find_top_level_ext_lst(xml);
    let child_end = ser_ext_lst_pos.unwrap_or(xml.len());
    let child_xml = &xml[..child_end];

    // Parse idx
    if let Some(idx_start) = find_tag_simd(child_xml, b"idx", 0) {
        series.idx = parse_val_attr_u32(&xml[idx_start..]);
    }

    // Parse order
    if let Some(order_start) = find_tag_simd(child_xml, b"order", 0) {
        series.order = parse_val_attr_u32(&xml[order_start..]);
    }

    // Parse series text (tx) — only in the child region, not inside extensions
    if let Some(tx_start) = find_tag_simd(child_xml, b"tx", 0) {
        let tx_end = find_closing_tag(xml, b"tx", tx_start).unwrap_or(child_end);
        series.tx = parse_series_text(&xml[tx_start..tx_end]);
    }

    // Parse category data (cat) → CatDataSource — only in the child region
    if let Some(cat_start) = find_tag_simd(child_xml, b"cat", 0) {
        let cat_end = find_closing_tag(xml, b"cat", cat_start).unwrap_or(child_end);
        series.cat = AxisData::parse(&xml[cat_start..cat_end]).to_cat_source();
    }

    // Parse value data (val) → NumDataSource — only in the child region
    if let Some(val_start) = find_tag_simd(child_xml, b"val", 0) {
        let val_end = find_closing_tag(xml, b"val", val_start).unwrap_or(child_end);
        series.val = AxisData::parse(&xml[val_start..val_end]).to_num_source();
    }

    // Parse X values (xVal) for scatter charts → CatDataSource
    if let Some(xval_start) = find_tag_simd(child_xml, b"xVal", 0) {
        let xval_end = find_closing_tag(xml, b"xVal", xval_start).unwrap_or(child_end);
        series.x_val = AxisData::parse(&xml[xval_start..xval_end]).to_cat_source();
    }

    // Parse Y values (yVal) for scatter charts → NumDataSource
    if let Some(yval_start) = find_tag_simd(child_xml, b"yVal", 0) {
        let yval_end = find_closing_tag(xml, b"yVal", yval_start).unwrap_or(child_end);
        series.y_val = AxisData::parse(&xml[yval_start..yval_end]).to_num_source();
    }

    // Parse bubble size → NumDataSource
    if let Some(bubble_start) = find_tag_simd(child_xml, b"bubbleSize", 0) {
        let bubble_end = find_closing_tag(xml, b"bubbleSize", bubble_start).unwrap_or(child_end);
        series.bubble_size = AxisData::parse(&xml[bubble_start..bubble_end]).to_num_source();
    }

    // Parse smooth → Option<bool>
    // Search full xml because some files place smooth after the series-level extLst.
    if let Some(smooth_start) = find_tag_simd(xml, b"smooth", 0) {
        series.smooth = Some(parse_bool_val(&xml[smooth_start..]));
    }

    // Parse invertIfNegative → Option<bool>
    // Search full xml because some files place invertIfNegative after the series-level extLst.
    if let Some(inv_start) = find_tag_simd(xml, b"invertIfNegative", 0) {
        series.invert_if_negative = Some(parse_bool_val(&xml[inv_start..]));
    }

    // Parse explosion → Option<u32>
    if let Some(exp_start) = find_tag_simd(child_xml, b"explosion", 0) {
        let val = parse_val_attr_u32(&xml[exp_start..]);
        if val > 0 {
            series.explosion = Some(val);
        }
    }

    // Parse per-series bar shape → Option<BarShape> (CT_BarSer / CT_Bar3DSer)
    if let Some(shape_start) = find_tag_simd(child_xml, b"shape", 0) {
        if let Some(attr_pos) = find_attr_simd(&xml[shape_start..], b"val=\"", 0) {
            let value_start = shape_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                series.shape = Some(ooxml_types::charts::BarShape::from_ooxml(&val));
            }
        }
    }

    // Parse data points → Vec<DataPointOverride>
    series.d_pt = parse_all_data_points(child_xml);

    // Parse data labels → Option<DataLabelOptions>
    if let Some(dlbls_start) = find_tag_simd(child_xml, b"dLbls", 0) {
        let dlbls_end = find_closing_tag(xml, b"dLbls", dlbls_start).unwrap_or(child_end);
        series.d_lbls = Some(parse_data_labels(&xml[dlbls_start..dlbls_end]));
    }

    // Parse all direct child error bars. Scatter, area, and bubble series can
    // carry separate X and Y definitions, and order is significant.
    let mut err_pos = 0;
    while let Some(err_start) = find_tag_simd(child_xml, b"errBars", err_pos) {
        let err_close = find_closing_tag(xml, b"errBars", err_start).unwrap_or(child_end);
        let err_end = crate::infra::scanner::find_gt_simd(xml, err_close)
            .map(|gt| gt + 1)
            .unwrap_or(err_close);
        series
            .err_bars
            .push(parse_error_bars(&xml[err_start..err_end.min(child_end)]));
        err_pos = err_end.min(child_end);
    }

    // Parse all trendlines (Excel supports multiple trendlines per series)
    let mut trend_pos = 0;
    while let Some(trend_start) = find_tag_simd(child_xml, b"trendline", trend_pos) {
        let trend_end = find_closing_tag(xml, b"trendline", trend_start).unwrap_or(child_end);
        series
            .trendline
            .push(parse_trendline(&xml[trend_start..trend_end]));
        trend_pos = trend_end;
    }

    // Parse marker → Option<Marker>
    // Search full xml because some files place marker after the series-level extLst.
    if let Some(marker_start) = find_tag_simd(xml, b"marker", 0) {
        let marker_end = find_closing_tag(xml, b"marker", marker_start).unwrap_or(xml.len());
        series.marker = Some(parse_marker(&xml[marker_start..marker_end]));
    }

    // Parse spPr — search only before the first nested container element that could
    // have its own spPr (dPt, dLbls, marker, trendline, errBars).  Without this limit,
    // find_tag_simd would match a nested spPr inside e.g. <c:dPt> for pie chart series
    // that don't have a top-level spPr.
    {
        let sp_pr_limit = [
            b"dPt" as &[u8],
            b"dLbls",
            b"marker",
            b"trendline",
            b"errBars",
        ]
        .iter()
        .filter_map(|tag| find_tag_simd(child_xml, tag, 0))
        .min()
        .unwrap_or(child_end);
        let sp_pr_region = &xml[..sp_pr_limit];
        if let Some(sp_start) = find_tag_simd(sp_pr_region, b"spPr", 0) {
            let sp_end = find_closing_tag(sp_pr_region, b"spPr", sp_start).unwrap_or(sp_pr_limit);
            series.sp_pr = Some(parse_shape_properties(&sp_pr_region[sp_start..sp_end]));
        }
    }

    // Parse series-level extLst from the position we found above.
    if let Some(start) = ser_ext_lst_pos {
        series.extensions = parse_chart_ext_lst_at(xml, start);
        if series.extensions.is_empty() {
            series.has_empty_ext_lst = true;
        }
    }

    // Parse non-standard seriesType attribute (Google Sheets)
    if let Some(attr_pos) = find_attr_simd(xml, b"seriesType=\"", 0) {
        let value_start = attr_pos + b"seriesType=\"".len();
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            series.raw_series_type_attr =
                Some(String::from_utf8_lossy(&xml[start..end]).to_string());
        }
    }

    series
}

// =============================================================================
// Series Text
// =============================================================================

// Parse series text element (CT_SerTx) into a `SeriesTextSource`.
//
// Returns `Some(SeriesTextSource::StrRef(...))` if a string reference is found,
// `Some(SeriesTextSource::Value(...))` if a direct value is found,
