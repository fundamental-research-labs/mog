//! Chart series parsing for XLSX charts
//!
//! This module parses chart data series from OOXML chart XML.
//! Series contain the actual data displayed in charts.
//!
//! # OOXML Structure
//!
//! Series elements (c:ser) contain:
//! - idx: Series index
//! - order: Plot order
//! - tx: Series name (title text)
//! - cat: Category data (X-axis labels)
//! - val: Value data (Y-axis values)
//! - Data point customization
//! - Data labels
//! - Error bars
//! - Trendlines

use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_lt_simd,
    find_tag_simd,
};
use crate::infra::xml::decode_xml_entities;

use super::types::MarkerStyle;
use super::{parse_shape_properties, parse_text_body};

// Re-export series-related enums from ooxml-types.
pub use ooxml_types::charts::{
    DataLabelPosition, ErrorBarDirection, ErrorBarType, ErrorValueType, LayoutMode, LayoutTarget,
    ManualLayout, TrendlineLabel, TrendlineType,
};
// NumFmt is pub-use'd by axes.rs; import privately for local use.
use ooxml_types::charts::NumFmt;

// Re-export chart data source types from ooxml-types (canonical definitions).
pub use ooxml_types::charts::{
    NumData, NumPoint, NumRef, SeriesTextSource, StrData, StrPoint, StrRef,
};

// Re-export canonical series-level types from ooxml-types.
pub use ooxml_types::charts::{
    CatDataSource, ChartSeries, DataLabel, DataLabelOptions, DataPointOverride, ErrorBars, Marker,
    NumDataSource, Trendline,
};

// =============================================================================
// Chart Extension List (extLst) parsing — reusable across all chart elements
// =============================================================================

/// Parse `<c:extLst>` from an XML fragment and return a `Vec<ExtensionEntry>`.
///
/// Each `<c:ext uri="...">...</c:ext>` child is captured with the URI attribute
/// extracted and the full raw XML stored for lossless round-trip.
/// Find the position of the top-level `<c:extLst>` in an XML fragment.
///
/// Scans through the fragment tracking element nesting depth.  Returns
/// the position of the `<c:extLst>` that is a direct child of the root
/// element (depth 1), ignoring nested extLst elements inside child
/// elements like dLbls, dPt, or inside extensions (filteredSeriesTitle).
pub fn find_top_level_ext_lst(xml: &[u8]) -> Option<usize> {
    // Skip past the root element's opening tag (e.g. <c:ser>)
    let root_gt = find_gt_simd(xml, 0)?;
    if root_gt > 0 && xml[root_gt - 1] == b'/' {
        return None; // self-closing root
    }
    let mut pos = root_gt + 1;
    let mut depth = 1u32; // we're inside the root element

    while pos < xml.len() {
        if let Some(lt) = find_lt_simd(xml, pos) {
            let after_lt = lt + 1;
            if after_lt >= xml.len() {
                break;
            }

            if xml[after_lt] == b'/' {
                // Closing tag — decrement depth
                let tag_start = after_lt + 1;
                let _name_end = xml[tag_start..]
                    .iter()
                    .position(|&b| matches!(b, b'>' | b' ' | b'\t' | b'\n' | b'\r'))
                    .map(|p| tag_start + p)
                    .unwrap_or(xml.len());
                depth -= 1;
                if depth == 0 {
                    break; // Closed root element
                }
                pos = find_gt_simd(xml, lt).map(|p| p + 1).unwrap_or(xml.len());
            } else {
                // Opening tag
                let mut name_end = after_lt;
                while name_end < xml.len() {
                    let b = xml[name_end];
                    if matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
                        break;
                    }
                    name_end += 1;
                }
                let gt = find_gt_simd(xml, lt).unwrap_or(xml.len());
                let is_self_closing = gt > 0 && xml[gt - 1] == b'/';

                // At depth 1, check if this is extLst
                if depth == 1 && tag_name_matches(&xml[after_lt..name_end], b"extLst") {
                    return Some(lt);
                }

                if !is_self_closing {
                    depth += 1;
                }
                pos = gt + 1;
            }
        } else {
            break;
        }
    }
    None
}

/// Check if a tag name matches `target` exactly or with any namespace prefix
/// (e.g., "ext" matches "ext", "c:ext", "c15:ext" but NOT "extLst" or "c:extLst").
fn tag_name_matches(name: &[u8], target: &[u8]) -> bool {
    // Exact match (no namespace prefix)
    if name == target {
        return true;
    }
    // Match "*:target" — the target must be at the end, preceded by ":"
    if name.len() > target.len() + 1 {
        let prefix_end = name.len() - target.len();
        if name[prefix_end - 1] == b':' && &name[prefix_end..] == target {
            return true;
        }
    }
    false
}

/// Depth-aware closing tag search: find the `</tag>` that matches the opening
/// `<tag>` at `start`, correctly handling nested elements with the same local name.
///
/// Returns `Some(lt_pos)` pointing to the `<` of the matching closing tag, or `None`.
fn find_closing_tag_nested(bytes: &[u8], tag: &[u8], start: usize) -> Option<usize> {
    let mut pos = find_gt_simd(bytes, start)
        .map(|p| p + 1)
        .unwrap_or(start + 1);

    // Self-closing check
    if pos >= 2 && bytes[pos - 2] == b'/' {
        return None;
    }

    let mut depth = 1u32;
    while pos < bytes.len() && depth > 0 {
        if let Some(lt) = find_lt_simd(bytes, pos) {
            let after_lt = lt + 1;
            if after_lt >= bytes.len() {
                break;
            }
            if bytes[after_lt] == b'/' {
                // Closing tag
                let tag_start = after_lt + 1;
                let name_end = bytes[tag_start..]
                    .iter()
                    .position(|&b| matches!(b, b'>' | b' ' | b'\t' | b'\n' | b'\r'))
                    .map(|p| tag_start + p)
                    .unwrap_or(bytes.len());
                if tag_name_matches(&bytes[tag_start..name_end], tag) {
                    depth -= 1;
                    if depth == 0 {
                        return Some(lt);
                    }
                }
                pos = name_end;
            } else {
                // Opening tag
                let mut name_end = after_lt;
                while name_end < bytes.len() {
                    let b = bytes[name_end];
                    if matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
                        break;
                    }
                    name_end += 1;
                }
                if tag_name_matches(&bytes[after_lt..name_end], tag) {
                    // Check if self-closing
                    let gt = find_gt_simd(bytes, lt).unwrap_or(bytes.len());
                    if gt > 0 && bytes[gt - 1] == b'/' {
                        // Self-closing, no depth change
                    } else {
                        depth += 1;
                    }
                    pos = gt + 1;
                } else {
                    pos = name_end;
                }
            }
        } else {
            break;
        }
    }
    None
}

/// Parse `<c:extLst>` starting from a known position and return a `Vec<ExtensionEntry>`.
///
/// Uses depth-aware tag matching because extensions can contain nested
/// `<c:extLst><c:ext>...</c:ext></c:extLst>` (e.g. filteredSeriesTitle).
pub fn parse_chart_ext_lst_at(
    xml: &[u8],
    ext_lst_start: usize,
) -> Vec<ooxml_types::charts::ExtensionEntry> {
    // Use depth-aware search for extLst close (handles nested <c:extLst> inside extensions)
    let ext_lst_end = find_closing_tag_nested(xml, b"extLst", ext_lst_start)
        .unwrap_or_else(|| find_closing_tag(xml, b"extLst", ext_lst_start).unwrap_or(xml.len()));
    let ext_lst_bytes = &xml[ext_lst_start..ext_lst_end];
    let mut extensions = Vec::new();
    let mut ext_pos = 0;
    while let Some(ext_start) = find_tag_simd(ext_lst_bytes, b"ext", ext_pos) {
        // Check for self-closing <c:ext ... />
        let tag_gt = find_gt_simd(ext_lst_bytes, ext_start).unwrap_or(ext_lst_bytes.len());
        let is_self_closing = tag_gt > 0 && ext_lst_bytes.get(tag_gt - 1) == Some(&b'/');

        let close_gt = if is_self_closing {
            tag_gt + 1
        } else {
            // Use depth-aware search for nested <c:ext> elements
            let ext_end = find_closing_tag_nested(ext_lst_bytes, b"ext", ext_start)
                .unwrap_or(ext_lst_bytes.len());
            find_gt_simd(ext_lst_bytes, ext_end)
                .map(|p| p + 1)
                .unwrap_or(ext_lst_bytes.len())
        };

        let ext_elem = &ext_lst_bytes[ext_start..close_gt];
        let uri = if let Some(uri_pos) = find_attr_simd(ext_elem, b"uri=\"", 0) {
            let value_start = uri_pos + 5;
            if let Some((s, e)) = extract_quoted_value(ext_elem, value_start) {
                String::from_utf8_lossy(&ext_elem[s..e]).to_string()
            } else {
                String::new()
            }
        } else {
            String::new()
        };
        let raw_xml = String::from_utf8_lossy(ext_elem).to_string();
        extensions.push(ooxml_types::charts::ExtensionEntry { uri, xml: raw_xml });
        ext_pos = close_gt;
    }
    extensions
}

pub fn parse_chart_ext_lst(xml: &[u8]) -> Vec<ooxml_types::charts::ExtensionEntry> {
    let ext_lst_start = match find_tag_simd(xml, b"extLst", 0) {
        Some(pos) => pos,
        None => return Vec::new(),
    };
    parse_chart_ext_lst_at(xml, ext_lst_start)
}

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

    // Parse error bars → Vec<ErrorBars>
    if let Some(err_start) = find_tag_simd(child_xml, b"errBars", 0) {
        let err_end = find_closing_tag(xml, b"errBars", err_start).unwrap_or(child_end);
        series.err_bars = vec![parse_error_bars(&xml[err_start..err_end])];
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

/// Parse series text element (CT_SerTx) into a `SeriesTextSource`.
///
/// Returns `Some(SeriesTextSource::StrRef(...))` if a string reference is found,
/// `Some(SeriesTextSource::Value(...))` if a direct value is found,
/// or `None` if neither is present.
pub fn parse_series_text(xml: &[u8]) -> Option<SeriesTextSource> {
    // Parse string reference
    if let Some(strref_start) = find_tag_simd(xml, b"strRef", 0) {
        let strref_end = find_closing_tag(xml, b"strRef", strref_start).unwrap_or(xml.len());
        return Some(SeriesTextSource::StrRef(parse_str_ref(
            &xml[strref_start..strref_end],
        )));
    }

    // Parse direct value — decode XML entities for correct round-trip
    if let Some(v_start) = find_tag_simd(xml, b"v", 0) {
        let v_content_start = find_gt_simd(xml, v_start).map(|p| p + 1);
        let v_end = find_closing_tag(xml, b"v", v_start);

        if let (Some(start), Some(end)) = (v_content_start, v_end) {
            if start < end {
                return Some(SeriesTextSource::Value(decode_xml_entities(
                    &xml[start..end],
                )));
            }
        }
    }

    None
}

// =============================================================================
// Data References
// =============================================================================

/// Axis data (category or value data).
#[derive(Debug, Clone, Default)]
pub struct AxisData {
    /// Numeric reference
    pub num_ref: Option<NumRef>,
    /// String reference
    pub str_ref: Option<StrRef>,
    /// Numeric literal values
    pub num_lit: Option<NumData>,
    /// String literal values
    pub str_lit: Option<StrData>,
}

impl AxisData {
    /// Convert to a `CatDataSource` (numeric ref, string ref, numeric lit, or string lit).
    pub fn to_cat_source(self) -> Option<CatDataSource> {
        if let Some(nr) = self.num_ref {
            Some(CatDataSource::NumRef(nr))
        } else if let Some(sr) = self.str_ref {
            Some(CatDataSource::StrRef(sr))
        } else if let Some(nl) = self.num_lit {
            Some(CatDataSource::NumLit(nl))
        } else {
            self.str_lit.map(CatDataSource::StrLit)
        }
    }

    /// Convert to a `NumDataSource` (numeric ref or numeric lit only).
    pub fn to_num_source(self) -> Option<NumDataSource> {
        if let Some(nr) = self.num_ref {
            Some(NumDataSource::Ref(nr))
        } else {
            self.num_lit.map(NumDataSource::Lit)
        }
    }

    /// Parse axis data element.
    pub fn parse(xml: &[u8]) -> Self {
        let mut data = AxisData::default();

        // Parse numeric reference
        if let Some(numref_start) = find_tag_simd(xml, b"numRef", 0) {
            let numref_end = find_closing_tag(xml, b"numRef", numref_start).unwrap_or(xml.len());
            data.num_ref = Some(parse_num_ref(&xml[numref_start..numref_end]));
        }

        // Parse string reference
        if let Some(strref_start) = find_tag_simd(xml, b"strRef", 0) {
            let strref_end = find_closing_tag(xml, b"strRef", strref_start).unwrap_or(xml.len());
            data.str_ref = Some(parse_str_ref(&xml[strref_start..strref_end]));
        }

        // Parse numeric literal
        if let Some(numlit_start) = find_tag_simd(xml, b"numLit", 0) {
            let numlit_end = find_closing_tag(xml, b"numLit", numlit_start).unwrap_or(xml.len());
            data.num_lit = Some(parse_num_data(&xml[numlit_start..numlit_end]));
        }

        // Parse string literal
        if let Some(strlit_start) = find_tag_simd(xml, b"strLit", 0) {
            let strlit_end = find_closing_tag(xml, b"strLit", strlit_start).unwrap_or(xml.len());
            data.str_lit = Some(parse_str_data(&xml[strlit_start..strlit_end]));
        }

        data
    }
}

/// Parse numeric reference element (CT_NumRef).
pub fn parse_num_ref(xml: &[u8]) -> NumRef {
    let mut num_ref = NumRef::default();

    // Parse formula
    if let Some(f_start) = find_tag_simd(xml, b"f", 0) {
        let f_content_start = find_gt_simd(xml, f_start).map(|p| p + 1);
        let f_end = find_closing_tag(xml, b"f", f_start);

        if let (Some(start), Some(end)) = (f_content_start, f_end) {
            if start < end {
                num_ref.f = decode_xml_entities(&xml[start..end]);
            }
        }
    }

    // Parse cached values
    if let Some(cache_start) = find_tag_simd(xml, b"numCache", 0) {
        let cache_end = find_closing_tag(xml, b"numCache", cache_start).unwrap_or(xml.len());
        num_ref.num_cache = Some(parse_num_data(&xml[cache_start..cache_end]));
    }
    num_ref.extensions = parse_chart_ext_lst(xml);
    num_ref
}

/// Parse string reference element (CT_StrRef).
pub fn parse_str_ref(xml: &[u8]) -> StrRef {
    let mut str_ref = StrRef::default();

    // Parse formula
    if let Some(f_start) = find_tag_simd(xml, b"f", 0) {
        let f_content_start = find_gt_simd(xml, f_start).map(|p| p + 1);
        let f_end = find_closing_tag(xml, b"f", f_start);

        if let (Some(start), Some(end)) = (f_content_start, f_end) {
            if start < end {
                str_ref.f = decode_xml_entities(&xml[start..end]);
            }
        }
    }

    // Parse cached values
    if let Some(cache_start) = find_tag_simd(xml, b"strCache", 0) {
        let cache_end = find_closing_tag(xml, b"strCache", cache_start).unwrap_or(xml.len());
        str_ref.str_cache = Some(parse_str_data(&xml[cache_start..cache_end]));
    }
    str_ref.extensions = parse_chart_ext_lst(xml);
    str_ref
}

/// Parse numeric cache/data element (CT_NumData).
pub fn parse_num_data(xml: &[u8]) -> NumData {
    let mut data = NumData::default();

    // Parse format code
    if let Some(fmt_start) = find_tag_simd(xml, b"formatCode", 0) {
        let fmt_content_start = find_gt_simd(xml, fmt_start).map(|p| p + 1);
        let fmt_end = find_closing_tag(xml, b"formatCode", fmt_start);

        if let (Some(start), Some(end)) = (fmt_content_start, fmt_end) {
            if start < end {
                data.format_code = Some(decode_xml_entities(&xml[start..end]));
            }
        }
    }

    // Parse point count
    if let Some(ptcount_start) = find_tag_simd(xml, b"ptCount", 0) {
        data.pt_count = Some(parse_val_attr_u32(&xml[ptcount_start..]));
    }

    // Parse points
    let mut pos = 0;
    while let Some(pt_start) = find_tag_simd(xml, b"pt", pos) {
        let pt_end = find_closing_tag(xml, b"pt", pt_start).unwrap_or(xml.len());
        let pt_bytes = &xml[pt_start..pt_end];

        let mut idx = 0u32;
        let mut v = String::new();

        // Parse index
        if let Some(attr_pos) = find_attr_simd(pt_bytes, b"idx=\"", 0) {
            let value_start = attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(pt_bytes, value_start) {
                idx = parse_bytes_u32(&pt_bytes[start..end]);
            }
        }

        // Parse per-point formatCode attribute (override for this data point)
        let mut pt_format_code = None;
        if let Some(attr_pos) = find_attr_simd(pt_bytes, b"formatCode=\"", 0) {
            let value_start = attr_pos + 12;
            if let Some((start, end)) = extract_quoted_value(pt_bytes, value_start) {
                if start < end {
                    pt_format_code = Some(decode_xml_entities(&pt_bytes[start..end]));
                }
            }
        }

        // Parse value — decode XML entities so the writer's escaping round-trips correctly
        if let Some(v_start) = find_tag_simd(pt_bytes, b"v", 0) {
            let v_content_start = find_gt_simd(pt_bytes, v_start).map(|p| p + 1);
            let v_end = find_closing_tag(pt_bytes, b"v", v_start);

            if let (Some(start), Some(end)) = (v_content_start, v_end) {
                if start < end {
                    v = decode_xml_entities(&pt_bytes[start..end]);
                }
            }
        }

        data.pts.push(NumPoint {
            idx,
            v,
            format_code: pt_format_code,
        });
        pos = pt_end;
    }

    data
}

/// Parse string cache/data element (CT_StrData).
pub fn parse_str_data(xml: &[u8]) -> StrData {
    let mut data = StrData::default();

    // Parse point count
    if let Some(ptcount_start) = find_tag_simd(xml, b"ptCount", 0) {
        data.pt_count = Some(parse_val_attr_u32(&xml[ptcount_start..]));
    }

    // Parse points
    let mut pos = 0;
    while let Some(pt_start) = find_tag_simd(xml, b"pt", pos) {
        let pt_end = find_closing_tag(xml, b"pt", pt_start).unwrap_or(xml.len());
        let pt_bytes = &xml[pt_start..pt_end];

        let mut idx = 0u32;
        let mut v = String::new();

        // Parse index
        if let Some(attr_pos) = find_attr_simd(pt_bytes, b"idx=\"", 0) {
            let value_start = attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(pt_bytes, value_start) {
                idx = parse_bytes_u32(&pt_bytes[start..end]);
            }
        }

        // Parse value — decode XML entities so the writer's escaping round-trips correctly
        if let Some(v_start) = find_tag_simd(pt_bytes, b"v", 0) {
            let v_content_start = find_gt_simd(pt_bytes, v_start).map(|p| p + 1);
            let v_end = find_closing_tag(pt_bytes, b"v", v_start);

            if let (Some(start), Some(end)) = (v_content_start, v_end) {
                if start < end {
                    v = decode_xml_entities(&pt_bytes[start..end]);
                }
            }
        }

        data.pts.push(StrPoint { idx, v });
        pos = pt_end;
    }

    data
}

/// Parse a val="N" attribute as u32 (shared helper for parse_num_data / parse_str_data).
pub(crate) fn parse_val_attr_u32(xml: &[u8]) -> u32 {
    if let Some(attr_pos) = find_attr_simd(xml, b"val=\"", 0) {
        let value_start = attr_pos + 5;
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            return parse_bytes_u32(&xml[start..end]);
        }
    }
    0
}

/// Parse bytes as u32 (shared helper).
fn parse_bytes_u32(bytes: &[u8]) -> u32 {
    let mut result: u32 = 0;
    for &b in bytes {
        if b.is_ascii_digit() {
            result = result.saturating_mul(10).saturating_add((b - b'0') as u32);
        } else {
            break;
        }
    }
    result
}

// =============================================================================
// Data Point Customization (parsing into ooxml_types::charts::DataPointOverride)
// =============================================================================

/// Parse all data points from series element.
pub fn parse_all_data_points(xml: &[u8]) -> Vec<DataPointOverride> {
    let mut points = Vec::new();
    let mut pos = 0;

    while let Some(dpt_start) = find_tag_simd(xml, b"dPt", pos) {
        let dpt_end = find_closing_tag(xml, b"dPt", dpt_start).unwrap_or(xml.len());
        let dpt_bytes = &xml[dpt_start..dpt_end];

        points.push(parse_data_point(dpt_bytes));
        pos = dpt_end;
    }

    points
}

/// Parse a single data point element into a `DataPointOverride`.
pub fn parse_data_point(xml: &[u8]) -> DataPointOverride {
    let mut point = DataPointOverride::default();

    // Parse index
    if let Some(idx_start) = find_tag_simd(xml, b"idx", 0) {
        point.idx = parse_val_attr_u32(&xml[idx_start..]);
    }

    // Parse invertIfNegative → Option<bool>
    if let Some(inv_start) = find_tag_simd(xml, b"invertIfNegative", 0) {
        point.invert_if_negative = Some(parse_bool_val(&xml[inv_start..]));
    }

    // Parse explosion → Option<u32>
    if let Some(exp_start) = find_tag_simd(xml, b"explosion", 0) {
        let val = parse_val_attr_u32(&xml[exp_start..]);
        if val > 0 {
            point.explosion = Some(val);
        }
    }

    // Parse marker → Option<Marker>
    if let Some(marker_start) = find_tag_simd(xml, b"marker", 0) {
        let marker_end = find_closing_tag(xml, b"marker", marker_start).unwrap_or(xml.len());
        point.marker = Some(parse_marker(&xml[marker_start..marker_end]));
    }

    // Parse bubble3D → Option<bool>
    if let Some(b3d_start) = find_tag_simd(xml, b"bubble3D", 0) {
        point.bubble_3d = Some(parse_bool_val(&xml[b3d_start..]));
    }

    // Parse spPr
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
        let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
        point.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
    }

    // Parse extLst
    point.extensions = parse_chart_ext_lst(xml);

    point
}

/// Parse marker element into an `Marker`.
pub fn parse_marker(xml: &[u8]) -> Marker {
    let mut marker = Marker::default();

    // Parse symbol → Option<MarkerStyle>
    if let Some(sym_start) = find_tag_simd(xml, b"symbol", 0) {
        if let Some(attr_pos) = find_attr_simd(&xml[sym_start..], b"val=\"", 0) {
            let value_start = sym_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                marker.symbol = Some(MarkerStyle::from_ooxml(&val));
            }
        }
    }

    // Parse size → Option<u32>
    if let Some(size_start) = find_tag_simd(xml, b"size", 0) {
        if let Some(attr_pos) = find_attr_simd(&xml[size_start..], b"val=\"", 0) {
            let value_start = size_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = parse_bytes_u32(&xml[start..end]);
                if val > 0 {
                    marker.size = Some(val);
                }
            }
        }
    }

    // Parse spPr
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
        let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
        marker.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
    }

    // Parse extLst
    marker.extensions = parse_chart_ext_lst(xml);

    marker
}

// =============================================================================
// Data Labels (parsing into ooxml_types::charts::DataLabelOptions)
// =============================================================================

/// Parse data labels element into a `DataLabelOptions`.
pub fn parse_data_labels(xml: &[u8]) -> DataLabelOptions {
    let mut labels = DataLabelOptions::default();

    // ---------------------------------------------------------------
    // Step 1: parse individual <c:dLbl> overrides FIRST and track
    // where they end.  In the OOXML schema for CT_DLbls, dLbl children
    // come before the choice (delete | group-content) and extLst.
    // We must search for dLbls-level elements only AFTER the last dLbl,
    // otherwise find_tag_simd matches elements INSIDE dLbl children
    // (e.g. <c:delete> or <c:showVal> within a child dLbl would be
    // incorrectly attributed to the parent dLbls).
    // ---------------------------------------------------------------
    let mut dlbl_pos = 0;
    let mut group_content_start = 0usize;
    while let Some(dlbl_start) = find_tag_simd(xml, b"dLbl", dlbl_pos) {
        // find_tag_simd already disambiguates: it won't match <c:dLblPos>
        // or <c:dLbls>.  But it DOES match closing tags </c:dLbl>, so skip those.
        if dlbl_start + 1 < xml.len() && xml[dlbl_start + 1] == b'/' {
            dlbl_pos = dlbl_start + 1;
            continue;
        }
        let dlbl_end = find_closing_tag(xml, b"dLbl", dlbl_start).unwrap_or(xml.len());
        labels
            .d_lbl
            .push(parse_individual_data_label(&xml[dlbl_start..dlbl_end]));
        // Move past </c:dLbl> closing tag
        let close_gt = find_gt_simd(xml, dlbl_end)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        group_content_start = close_gt;
        dlbl_pos = dlbl_end;
    }

    // ---------------------------------------------------------------
    // Step 2: parse dLbls-level content from the region AFTER all
    // dLbl children.  This is the choice (delete | group) + extLst.
    //
    // IMPORTANT: Restrict child element parsing to BEFORE the extLst.
    // Extensions like {CE6537A1} can contain <c15:showLeaderLines>
    // and <c15:leaderLines> which find_tag_simd would otherwise match
    // as top-level elements, causing duplicate emission on round-trip.
    // ---------------------------------------------------------------
    let tail = &xml[group_content_start..];

    // Find the dLbls-level extLst position within tail
    let tail_ext_pos = find_tag_simd(tail, b"extLst", 0);
    let tail_child_end = tail_ext_pos.unwrap_or(tail.len());
    let tail_children = &tail[..tail_child_end];

    // Parse show flags — only before extLst
    if let Some(start) = find_tag_simd(tail_children, b"showLegendKey", 0) {
        labels.show_legend_key = parse_bool_val(&tail[start..]);
    }
    if let Some(start) = find_tag_simd(tail_children, b"showVal", 0) {
        labels.show_value = parse_bool_val(&tail[start..]);
    }
    if let Some(start) = find_tag_simd(tail_children, b"showCatName", 0) {
        labels.show_category = parse_bool_val(&tail[start..]);
    }
    if let Some(start) = find_tag_simd(tail_children, b"showSerName", 0) {
        labels.show_series_name = parse_bool_val(&tail[start..]);
    }
    if let Some(start) = find_tag_simd(tail_children, b"showPercent", 0) {
        labels.show_percent = parse_bool_val(&tail[start..]);
    }
    if let Some(start) = find_tag_simd(tail_children, b"showBubbleSize", 0) {
        labels.show_bubble_size = parse_bool_val(&tail[start..]);
    }
    if let Some(start) = find_tag_simd(tail_children, b"showLeaderLines", 0) {
        labels.show_leader_lines = Some(parse_bool_val(&tail[start..]));
    }

    // Parse leaderLines element (CT_ChartLines — contains optional spPr)
    if let Some(ll_start) = find_tag_simd(tail_children, b"leaderLines", 0) {
        let ll_end = find_closing_tag(tail, b"leaderLines", ll_start).unwrap_or(tail_child_end);
        let ll_xml = &tail[ll_start..ll_end];
        let sp_pr = if let Some(sp_start) = find_tag_simd(ll_xml, b"spPr", 0) {
            let sp_end = find_closing_tag(ll_xml, b"spPr", sp_start).unwrap_or(ll_xml.len());
            Some(parse_shape_properties(&ll_xml[sp_start..sp_end]))
        } else {
            None
        };
        labels.leader_lines = Some(ooxml_types::charts::ChartLines { sp_pr });
    }

    // Parse position
    if let Some(pos_start) = find_tag_simd(tail_children, b"dLblPos", 0) {
        if let Some(attr_pos) = find_attr_simd(&tail[pos_start..], b"val=\"", 0) {
            let value_start = pos_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(tail, value_start) {
                let val = String::from_utf8_lossy(&tail[start..end]);
                labels.position = DataLabelPosition::from_ooxml(&val);
            }
        }
    }

    // Parse separator
    if let Some(sep_start) = find_tag_simd(tail_children, b"separator", 0) {
        let sep_content_start = find_gt_simd(tail, sep_start).map(|p| p + 1);
        let sep_end = find_closing_tag(tail, b"separator", sep_start);

        if let (Some(start), Some(end)) = (sep_content_start, sep_end) {
            if start < end {
                labels.separator = Some(String::from_utf8_lossy(&tail[start..end]).to_string());
            }
        }
    }

    // Parse number format into structured NumFmt (preserves sourceLinked attribute)
    if let Some(numfmt_start) = find_tag_simd(tail_children, b"numFmt", 0) {
        if let Some(attr_pos) = find_attr_simd(&tail[numfmt_start..], b"formatCode=\"", 0) {
            let value_start = numfmt_start + attr_pos + 12;
            if let Some((start, end)) = extract_quoted_value(tail, value_start) {
                let format_code = decode_xml_entities(&tail[start..end]);
                let source_linked = if let Some(sl_pos) =
                    find_attr_simd(&tail[numfmt_start..], b"sourceLinked=\"", 0)
                {
                    let sl_start = numfmt_start + sl_pos + 14;
                    if let Some((s, e)) = extract_quoted_value(tail, sl_start) {
                        let val = &tail[s..e];
                        Some(val == b"1" || val == b"true")
                    } else {
                        None
                    }
                } else {
                    None
                };
                labels.num_fmt_obj = Some(ooxml_types::charts::NumFmt {
                    format_code: format_code.clone(),
                    source_linked,
                });
                // Also set legacy field for backward compatibility
                labels.num_fmt = Some(format_code);
            }
        }
    }

    // Parse spPr — only before extLst
    if let Some(sp_start) = find_tag_simd(tail_children, b"spPr", 0) {
        let sp_end = find_closing_tag(tail, b"spPr", sp_start).unwrap_or(tail_child_end);
        labels.sp_pr = Some(parse_shape_properties(&tail[sp_start..sp_end]));
    }

    // Parse txPr — only before extLst
    if let Some(txpr_start) = find_tag_simd(tail_children, b"txPr", 0) {
        let txpr_end = find_closing_tag(tail, b"txPr", txpr_start).unwrap_or(tail_child_end);
        labels.tx_pr = Some(parse_text_body(&tail[txpr_start..txpr_end]));
    }

    // Parse delete flag (CT_DLbls choice: delete OR group content)
    if let Some(del_start) = find_tag_simd(tail_children, b"delete", 0) {
        labels.delete = Some(parse_bool_val(&tail[del_start..]));
    }

    // Parse extLst
    labels.extensions = parse_chart_ext_lst(tail);

    labels
}

/// Parse an individual data label override (CT_DLbl).
pub(crate) fn parse_individual_data_label(xml: &[u8]) -> ooxml_types::charts::DataLabel {
    let mut label = ooxml_types::charts::DataLabel::default();

    // Parse idx
    if let Some(idx_start) = find_tag_simd(xml, b"idx", 0) {
        label.idx = parse_val_attr_u32(&xml[idx_start..]);
    }

    // Parse delete
    if let Some(del_start) = find_tag_simd(xml, b"delete", 0) {
        label.delete = Some(parse_bool_val(&xml[del_start..]));
    }

    // Parse numFmt
    if let Some(nf_start) = find_tag_simd(xml, b"numFmt", 0) {
        let mut num_fmt = ooxml_types::charts::NumFmt::default();
        if let Some(attr_pos) = find_attr_simd(&xml[nf_start..], b"formatCode=\"", 0) {
            let value_start = nf_start + attr_pos + 12;
            if let Some((s, e)) = extract_quoted_value(xml, value_start) {
                num_fmt.format_code = crate::infra::xml::decode_xml_entities(&xml[s..e]);
            }
        }
        if let Some(attr_pos) = find_attr_simd(&xml[nf_start..], b"sourceLinked=\"", 0) {
            let value_start = nf_start + attr_pos + 14;
            if let Some((s, e)) = extract_quoted_value(xml, value_start) {
                let val = &xml[s..e];
                num_fmt.source_linked = Some(val == b"1" || val == b"true");
            }
        }
        label.num_fmt = Some(num_fmt);
    }

    // Parse show flags
    if let Some(start) = find_tag_simd(xml, b"showVal", 0) {
        label.show_value = Some(parse_bool_val(&xml[start..]));
    }
    if let Some(start) = find_tag_simd(xml, b"showCatName", 0) {
        label.show_category = Some(parse_bool_val(&xml[start..]));
    }
    if let Some(start) = find_tag_simd(xml, b"showSerName", 0) {
        label.show_series_name = Some(parse_bool_val(&xml[start..]));
    }
    if let Some(start) = find_tag_simd(xml, b"showPercent", 0) {
        label.show_percent = Some(parse_bool_val(&xml[start..]));
    }
    if let Some(start) = find_tag_simd(xml, b"showLegendKey", 0) {
        label.show_legend_key = Some(parse_bool_val(&xml[start..]));
    }
    if let Some(start) = find_tag_simd(xml, b"showBubbleSize", 0) {
        label.show_bubble_size = Some(parse_bool_val(&xml[start..]));
    }

    // Parse position
    if let Some(pos_start) = find_tag_simd(xml, b"dLblPos", 0) {
        if let Some(attr_pos) = find_attr_simd(&xml[pos_start..], b"val=\"", 0) {
            let value_start = pos_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                label.position = Some(ooxml_types::charts::DataLabelPosition::from_ooxml(&val));
            }
        }
    }

    // Parse separator
    if let Some(sep_start) = find_tag_simd(xml, b"separator", 0) {
        let sep_content_start = find_gt_simd(xml, sep_start).map(|p| p + 1);
        let sep_end = find_closing_tag(xml, b"separator", sep_start);
        if let (Some(start), Some(end)) = (sep_content_start, sep_end) {
            if start < end {
                label.separator = Some(String::from_utf8_lossy(&xml[start..end]).to_string());
            }
        }
    }

    // Parse layout
    if let Some(layout_start) = find_tag_simd(xml, b"layout", 0) {
        let gt_pos = find_gt_simd(xml, layout_start).unwrap_or(xml.len());
        let is_self_closing = gt_pos > 0 && xml[gt_pos - 1] == b'/';
        if !is_self_closing {
            let layout_end = find_closing_tag(xml, b"layout", layout_start).unwrap_or(xml.len());
            label.layout = Some(crate::domain::charts::Chart::parse_layout(
                &xml[layout_start..layout_end],
            ));
        }
    }

    // Parse spPr
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
        let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
        label.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
    }

    // Parse txPr
    if let Some(txpr_start) = find_tag_simd(xml, b"txPr", 0) {
        let txpr_end = find_closing_tag(xml, b"txPr", txpr_start).unwrap_or(xml.len());
        label.tx_pr = Some(parse_text_body(&xml[txpr_start..txpr_end]));
    }

    // Parse extLst
    label.extensions = parse_chart_ext_lst(xml);

    label
}

// =============================================================================
// Error Bars (parsing into ooxml_types::charts::ErrorBars)
// =============================================================================

/// Parse error bars element into an `ErrorBars`.
pub fn parse_error_bars(xml: &[u8]) -> ErrorBars {
    let mut err_bars = ErrorBars::default();

    // Parse direction
    if let Some(dir_start) = find_tag_simd(xml, b"errDir", 0) {
        if let Some(attr_pos) = find_attr_simd(&xml[dir_start..], b"val=\"", 0) {
            let value_start = dir_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                err_bars.err_dir = Some(ErrorBarDirection::from_ooxml(&val));
            }
        }
    }

    // Parse error bar type
    if let Some(type_start) = find_tag_simd(xml, b"errBarType", 0) {
        if let Some(attr_pos) = find_attr_simd(&xml[type_start..], b"val=\"", 0) {
            let value_start = type_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                err_bars.err_bar_type = ErrorBarType::from_ooxml(&val);
            }
        }
    }

    // Parse error value type
    if let Some(valtype_start) = find_tag_simd(xml, b"errValType", 0) {
        if let Some(attr_pos) = find_attr_simd(&xml[valtype_start..], b"val=\"", 0) {
            let value_start = valtype_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                err_bars.err_val_type = ErrorValueType::from_ooxml(&val);
            }
        }
    }

    // Parse fixed value
    if let Some(val_start) = find_tag_simd(xml, b"val", 0) {
        if let Some(attr_pos) = find_attr_simd(&xml[val_start..], b"val=\"", 0) {
            let value_start = val_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let s = std::str::from_utf8(&xml[start..end]).unwrap_or("0");
                err_bars.val = s.parse().ok();
            }
        }
    }

    // Parse plus values → Option<NumDataSource>
    if let Some(plus_start) = find_tag_simd(xml, b"plus", 0) {
        let plus_end = find_closing_tag(xml, b"plus", plus_start).unwrap_or(xml.len());
        if let Some(numref_start) = find_tag_simd(&xml[plus_start..plus_end], b"numRef", 0) {
            let numref_end = find_closing_tag(&xml[plus_start..plus_end], b"numRef", numref_start)
                .unwrap_or(plus_end - plus_start);
            err_bars.plus = Some(NumDataSource::Ref(parse_num_ref(
                &xml[plus_start + numref_start..plus_start + numref_end],
            )));
        }
    }

    // Parse minus values → Option<NumDataSource>
    if let Some(minus_start) = find_tag_simd(xml, b"minus", 0) {
        let minus_end = find_closing_tag(xml, b"minus", minus_start).unwrap_or(xml.len());
        if let Some(numref_start) = find_tag_simd(&xml[minus_start..minus_end], b"numRef", 0) {
            let numref_end =
                find_closing_tag(&xml[minus_start..minus_end], b"numRef", numref_start)
                    .unwrap_or(minus_end - minus_start);
            err_bars.minus = Some(NumDataSource::Ref(parse_num_ref(
                &xml[minus_start + numref_start..minus_start + numref_end],
            )));
        }
    }

    // Parse no end cap → Option<bool>
    if let Some(cap_start) = find_tag_simd(xml, b"noEndCap", 0) {
        if parse_bool_val(&xml[cap_start..]) {
            err_bars.no_end_cap = Some(true);
        }
    }

    // Parse spPr
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
        let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
        err_bars.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
    }

    // Parse extLst
    err_bars.extensions = parse_chart_ext_lst(xml);

    err_bars
}

// =============================================================================
// Trendline (parsing into ooxml_types::charts::Trendline)
// =============================================================================

/// Parse trendline element into an `Trendline`.
pub fn parse_trendline(xml: &[u8]) -> Trendline {
    let mut trendline = Trendline::default();

    // Parse name
    if let Some(name_start) = find_tag_simd(xml, b"name", 0) {
        let name_content_start = find_gt_simd(xml, name_start).map(|p| p + 1);
        let name_end = find_closing_tag(xml, b"name", name_start);

        if let (Some(start), Some(end)) = (name_content_start, name_end) {
            if start < end {
                trendline.name = Some(String::from_utf8_lossy(&xml[start..end]).to_string());
            }
        }
    }

    // Parse trendline type
    if let Some(type_start) = find_tag_simd(xml, b"trendlineType", 0) {
        if let Some(attr_pos) = find_attr_simd(&xml[type_start..], b"val=\"", 0) {
            let value_start = type_start + attr_pos + 5;
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                let val = String::from_utf8_lossy(&xml[start..end]);
                trendline.trendline_type = TrendlineType::from_ooxml(&val);
            }
        }
    }

    // Parse order → Option<u32>
    if let Some(order_start) = find_tag_simd(xml, b"order", 0) {
        let val = parse_val_attr_u32(&xml[order_start..]);
        if val > 0 {
            trendline.order = Some(val);
        }
    }

    // Parse period → Option<u32>
    if let Some(period_start) = find_tag_simd(xml, b"period", 0) {
        let val = parse_val_attr_u32(&xml[period_start..]);
        if val > 0 {
            trendline.period = Some(val);
        }
    }

    // Parse forward → Option<f64>
    if let Some(fwd_start) = find_tag_simd(xml, b"forward", 0) {
        let val = parse_val_f64(&xml[fwd_start..]);
        if val != 0.0 {
            trendline.forward = Some(val);
        }
    }

    // Parse backward → Option<f64>
    if let Some(bwd_start) = find_tag_simd(xml, b"backward", 0) {
        let val = parse_val_f64(&xml[bwd_start..]);
        if val != 0.0 {
            trendline.backward = Some(val);
        }
    }

    // Parse intercept → Option<f64>
    if let Some(int_start) = find_tag_simd(xml, b"intercept", 0) {
        trendline.intercept = Some(parse_val_f64(&xml[int_start..]));
    }

    // Parse display equation → Option<bool>
    if let Some(eq_start) = find_tag_simd(xml, b"dispEq", 0) {
        if parse_bool_val(&xml[eq_start..]) {
            trendline.disp_eq = Some(true);
        }
    }

    // Parse display R-squared → Option<bool>
    if let Some(rsq_start) = find_tag_simd(xml, b"dispRSqr", 0) {
        if parse_bool_val(&xml[rsq_start..]) {
            trendline.disp_r_sqr = Some(true);
        }
    }

    // Parse spPr
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
        let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
        trendline.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
    }

    // Parse trendlineLbl
    if let Some(lbl_start) = find_tag_simd(xml, b"trendlineLbl", 0) {
        let lbl_end = find_closing_tag(xml, b"trendlineLbl", lbl_start).unwrap_or(xml.len());
        let lbl_xml = &xml[lbl_start..lbl_end];
        trendline.trendline_lbl = Some(parse_trendline_label_element(lbl_xml));
    }

    // Parse extLst
    trendline.extensions = parse_chart_ext_lst(xml);

    trendline
}

/// Parse a trendlineLbl element.
fn parse_trendline_label_element(xml: &[u8]) -> TrendlineLabel {
    let mut label = TrendlineLabel::default();

    // Parse layout > manualLayout
    if let Some(layout_start) = find_tag_simd(xml, b"layout", 0) {
        let layout_end = find_closing_tag(xml, b"layout", layout_start).unwrap_or(xml.len());
        let layout_xml = &xml[layout_start..layout_end];

        if let Some(ml_start) = find_tag_simd(layout_xml, b"manualLayout", 0) {
            let ml_end =
                find_closing_tag(layout_xml, b"manualLayout", ml_start).unwrap_or(layout_xml.len());
            let ml = &layout_xml[ml_start..ml_end];
            let mut manual = ManualLayout::default();

            if let Some(start) = find_tag_simd(ml, b"layoutTarget", 0) {
                if let Some(attr_pos) = find_attr_simd(&ml[start..], b"val=\"", 0) {
                    let value_start = start + attr_pos + 5;
                    if let Some((s, e)) = extract_quoted_value(ml, value_start) {
                        let val = String::from_utf8_lossy(&ml[s..e]);
                        manual.layout_target = Some(LayoutTarget::from_ooxml(&val));
                    }
                }
            }
            if let Some(start) = find_tag_simd(ml, b"xMode", 0) {
                if let Some(attr_pos) = find_attr_simd(&ml[start..], b"val=\"", 0) {
                    let value_start = start + attr_pos + 5;
                    if let Some((s, e)) = extract_quoted_value(ml, value_start) {
                        let val = String::from_utf8_lossy(&ml[s..e]);
                        manual.x_mode = Some(LayoutMode::from_ooxml(&val));
                    }
                }
            }
            if let Some(start) = find_tag_simd(ml, b"yMode", 0) {
                if let Some(attr_pos) = find_attr_simd(&ml[start..], b"val=\"", 0) {
                    let value_start = start + attr_pos + 5;
                    if let Some((s, e)) = extract_quoted_value(ml, value_start) {
                        let val = String::from_utf8_lossy(&ml[s..e]);
                        manual.y_mode = Some(LayoutMode::from_ooxml(&val));
                    }
                }
            }
            // Parse x, y positions
            if let Some(start) = find_tag_simd(ml, b"x", 0) {
                manual.x = Some(parse_val_f64(&ml[start..]));
            }
            if let Some(start) = find_tag_simd(ml, b"y", 0) {
                manual.y = Some(parse_val_f64(&ml[start..]));
            }

            label.layout = Some(manual);
        }
    }

    // Parse numFmt
    if let Some(nf_start) = find_tag_simd(xml, b"numFmt", 0) {
        let mut num_fmt = NumFmt::default();
        if let Some(attr_pos) = find_attr_simd(&xml[nf_start..], b"formatCode=\"", 0) {
            let value_start = nf_start + attr_pos + 12;
            if let Some((s, e)) = extract_quoted_value(xml, value_start) {
                num_fmt.format_code = crate::infra::xml::decode_xml_entities(&xml[s..e]);
            }
        }
        if let Some(attr_pos) = find_attr_simd(&xml[nf_start..], b"sourceLinked=\"", 0) {
            let value_start = nf_start + attr_pos + 14;
            if let Some((s, e)) = extract_quoted_value(xml, value_start) {
                let val = &xml[s..e];
                num_fmt.source_linked = Some(val == b"1" || val == b"true");
            }
        }
        label.num_fmt = Some(num_fmt);
    }

    // Parse text (tx > rich > a:p > a:r > a:t)
    if let Some(tx_start) = find_tag_simd(xml, b"<c:tx", 0) {
        let tx_end = find_closing_tag(xml, b"c:tx", tx_start).unwrap_or(xml.len());
        let tx_xml = &xml[tx_start..tx_end];
        // Extract text from rich text runs
        let mut text_parts = Vec::new();
        let mut pos = 0;
        while let Some(t_start) = find_tag_simd(tx_xml, b"a:t", pos) {
            let t_content_start = find_gt_simd(tx_xml, t_start).map(|p| p + 1);
            let t_end = find_closing_tag(tx_xml, b"a:t", t_start);
            if let (Some(start), Some(end)) = (t_content_start, t_end) {
                if start < end {
                    text_parts.push(String::from_utf8_lossy(&tx_xml[start..end]).to_string());
                }
            }
            pos = t_end.unwrap_or(tx_xml.len());
        }
        if !text_parts.is_empty() {
            let combined_text = text_parts.join("");
            let text_body = ooxml_types::drawings::TextBody {
                paragraphs: vec![ooxml_types::drawings::Paragraph {
                    runs: vec![ooxml_types::drawings::TextRunContent::Run(
                        ooxml_types::drawings::TextRun {
                            text: combined_text,
                            ..Default::default()
                        },
                    )],
                    ..Default::default()
                }],
                ..Default::default()
            };
            label.tx = Some(ooxml_types::charts::ChartText::Rich(text_body));
        }
    }

    // Parse spPr
    if let Some(sp_start) = find_tag_simd(xml, b"spPr", 0) {
        let sp_end = find_closing_tag(xml, b"spPr", sp_start).unwrap_or(xml.len());
        label.sp_pr = Some(parse_shape_properties(&xml[sp_start..sp_end]));
    }

    // Parse txPr
    if let Some(tp_start) = find_tag_simd(xml, b"txPr", 0) {
        let tp_end = find_closing_tag(xml, b"txPr", tp_start).unwrap_or(xml.len());
        label.tx_pr = Some(parse_text_body(&xml[tp_start..tp_end]));
    }

    label
}

/// Parse a val="N" attribute as f64.
fn parse_val_f64(xml: &[u8]) -> f64 {
    if let Some(attr_pos) = find_attr_simd(xml, b"val=\"", 0) {
        let value_start = attr_pos + 5;
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            let s = std::str::from_utf8(&xml[start..end]).unwrap_or("0");
            return s.parse().unwrap_or(0.0);
        }
    }
    0.0
}

/// Parse a val="0/1" or val="true/false" attribute as bool.
fn parse_bool_val(xml: &[u8]) -> bool {
    if let Some(attr_pos) = find_attr_simd(xml, b"val=\"", 0) {
        let value_start = attr_pos + 5;
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            let val = &xml[start..end];
            return val == b"1" || val == b"true" || val == b"True";
        }
    }
    false
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_empty_series() {
        let xml = b"<c:ser></c:ser>";
        let series = parse_series(xml);
        assert_eq!(series.idx, 0);
        assert_eq!(series.order, 0);
    }

    #[test]
    fn test_parse_series_basic() {
        let xml = br#"<c:ser>
            <c:idx val="0"/>
            <c:order val="0"/>
        </c:ser>"#;

        let series = parse_series(xml);
        assert_eq!(series.idx, 0);
        assert_eq!(series.order, 0);
    }

    #[test]
    fn test_parse_series_with_text() {
        let xml = br#"<c:ser>
            <c:idx val="0"/>
            <c:order val="0"/>
            <c:tx>
                <c:v>Sales</c:v>
            </c:tx>
        </c:ser>"#;

        let series = parse_series(xml);
        assert!(series.tx.is_some());
        match series.tx.unwrap() {
            SeriesTextSource::Value(v) => assert_eq!(v, "Sales"),
            other => panic!("Expected SeriesTextSource::Value, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_series_all() {
        let xml = br#"<c:barChart>
            <c:ser>
                <c:idx val="0"/>
                <c:order val="0"/>
            </c:ser>
            <c:ser>
                <c:idx val="1"/>
                <c:order val="1"/>
            </c:ser>
        </c:barChart>"#;

        let series = parse_all_series(xml);
        assert_eq!(series.len(), 2);
        assert_eq!(series[0].idx, 0);
        assert_eq!(series[1].idx, 1);
    }

    #[test]
    fn test_parse_num_ref() {
        let xml = br#"<c:numRef>
            <c:f>Sheet1!$B$2:$B$5</c:f>
            <c:numCache>
                <c:formatCode>General</c:formatCode>
                <c:ptCount val="4"/>
                <c:pt idx="0"><c:v>10</c:v></c:pt>
                <c:pt idx="1"><c:v>20</c:v></c:pt>
            </c:numCache>
        </c:numRef>"#;

        let num_ref = parse_num_ref(xml);
        assert_eq!(num_ref.f, "Sheet1!$B$2:$B$5");
        assert!(num_ref.num_cache.is_some());

        let cache = num_ref.num_cache.unwrap();
        assert_eq!(cache.format_code, Some("General".to_string()));
        assert_eq!(cache.pt_count, Some(4));
        assert_eq!(cache.pts.len(), 2);
        assert_eq!(cache.pts[0].idx, 0);
        assert_eq!(cache.pts[0].v, "10");
        assert_eq!(cache.pts[1].idx, 1);
        assert_eq!(cache.pts[1].v, "20");
    }

    #[test]
    fn test_parse_str_ref() {
        let xml = br#"<c:strRef>
            <c:f>Sheet1!$A$2:$A$5</c:f>
            <c:strCache>
                <c:ptCount val="4"/>
                <c:pt idx="0"><c:v>Q1</c:v></c:pt>
                <c:pt idx="1"><c:v>Q2</c:v></c:pt>
            </c:strCache>
        </c:strRef>"#;

        let str_ref = parse_str_ref(xml);
        assert_eq!(str_ref.f, "Sheet1!$A$2:$A$5");
        assert!(str_ref.str_cache.is_some());

        let cache = str_ref.str_cache.unwrap();
        assert_eq!(cache.pt_count, Some(4));
        assert_eq!(cache.pts.len(), 2);
        assert_eq!(cache.pts[0].v, "Q1");
        assert_eq!(cache.pts[1].v, "Q2");
    }

    #[test]
    fn test_parse_data_point() {
        let xml = br#"<c:dPt>
            <c:idx val="2"/>
            <c:explosion val="25"/>
        </c:dPt>"#;

        let point = parse_data_point(xml);
        assert_eq!(point.idx, 2);
        assert_eq!(point.explosion, Some(25));
    }

    #[test]
    fn test_parse_data_labels() {
        let xml = br#"<c:dLbls>
            <c:showVal val="1"/>
            <c:showCatName val="0"/>
            <c:showSerName val="1"/>
            <c:dLblPos val="outEnd"/>
        </c:dLbls>"#;

        let labels = parse_data_labels(xml);
        assert!(labels.show_value);
        assert!(!labels.show_category);
        assert!(labels.show_series_name);
        assert_eq!(labels.position, DataLabelPosition::OutsideEnd);
    }

    #[test]
    fn test_data_label_position_from_ooxml() {
        assert_eq!(
            DataLabelPosition::from_ooxml("bestFit"),
            DataLabelPosition::BestFit
        );
        assert_eq!(
            DataLabelPosition::from_ooxml("ctr"),
            DataLabelPosition::Center
        );
        assert_eq!(
            DataLabelPosition::from_ooxml("outEnd"),
            DataLabelPosition::OutsideEnd
        );
        assert_eq!(
            DataLabelPosition::from_ooxml("inEnd"),
            DataLabelPosition::InsideEnd
        );
    }

    #[test]
    fn test_parse_error_bars() {
        let xml = br#"<c:errBars>
            <c:errDir val="y"/>
            <c:errBarType val="both"/>
            <c:errValType val="percentage"/>
            <c:val val="5"/>
        </c:errBars>"#;

        let err_bars = parse_error_bars(xml);
        assert_eq!(err_bars.err_dir, Some(ErrorBarDirection::Y));
        assert_eq!(err_bars.err_bar_type, ErrorBarType::Both);
        assert_eq!(err_bars.err_val_type, ErrorValueType::Percentage);
        assert_eq!(err_bars.val, Some(5.0));
    }

    #[test]
    fn test_error_bar_types() {
        assert_eq!(ErrorBarDirection::from_ooxml("x"), ErrorBarDirection::X);
        assert_eq!(ErrorBarDirection::from_ooxml("y"), ErrorBarDirection::Y);
        assert_eq!(ErrorBarType::from_ooxml("plus"), ErrorBarType::Plus);
        assert_eq!(ErrorBarType::from_ooxml("minus"), ErrorBarType::Minus);
        assert_eq!(
            ErrorValueType::from_ooxml("fixedVal"),
            ErrorValueType::FixedVal
        );
        assert_eq!(ErrorValueType::from_ooxml("stdDev"), ErrorValueType::StdDev);
    }

    #[test]
    fn test_parse_trendline() {
        let xml = br#"<c:trendline>
            <c:name>Linear Trend</c:name>
            <c:trendlineType val="linear"/>
            <c:forward val="2"/>
            <c:backward val="1"/>
            <c:dispEq val="1"/>
            <c:dispRSqr val="1"/>
        </c:trendline>"#;

        let trendline = parse_trendline(xml);
        assert_eq!(trendline.name, Some("Linear Trend".to_string()));
        assert_eq!(trendline.trendline_type, TrendlineType::Linear);
        assert_eq!(trendline.forward, Some(2.0));
        assert_eq!(trendline.backward, Some(1.0));
        assert_eq!(trendline.disp_eq, Some(true));
        assert_eq!(trendline.disp_r_sqr, Some(true));
    }

    #[test]
    fn test_parse_polynomial_trendline() {
        let xml = br#"<c:trendline>
            <c:trendlineType val="poly"/>
            <c:order val="3"/>
        </c:trendline>"#;

        let trendline = parse_trendline(xml);
        assert_eq!(trendline.trendline_type, TrendlineType::Polynomial);
        assert_eq!(trendline.order, Some(3));
    }

    #[test]
    fn test_parse_moving_average_trendline() {
        let xml = br#"<c:trendline>
            <c:trendlineType val="movingAvg"/>
            <c:period val="5"/>
        </c:trendline>"#;

        let trendline = parse_trendline(xml);
        assert_eq!(trendline.trendline_type, TrendlineType::MovingAverage);
        assert_eq!(trendline.period, Some(5));
    }

    #[test]
    fn test_trendline_type_from_ooxml() {
        assert_eq!(TrendlineType::from_ooxml("exp"), TrendlineType::Exponential);
        assert_eq!(TrendlineType::from_ooxml("linear"), TrendlineType::Linear);
        assert_eq!(TrendlineType::from_ooxml("log"), TrendlineType::Logarithmic);
        assert_eq!(
            TrendlineType::from_ooxml("movingAvg"),
            TrendlineType::MovingAverage
        );
        assert_eq!(TrendlineType::from_ooxml("poly"), TrendlineType::Polynomial);
        assert_eq!(TrendlineType::from_ooxml("power"), TrendlineType::Power);
    }

    #[test]
    fn test_parse_marker() {
        let xml = br#"<c:marker>
            <c:symbol val="circle"/>
            <c:size val="7"/>
        </c:marker>"#;

        let marker = parse_marker(xml);
        assert_eq!(marker.symbol, Some(MarkerStyle::Circle));
        assert_eq!(marker.size, Some(7));
    }

    #[test]
    fn test_parse_series_with_values() {
        let xml = br#"<c:ser>
            <c:idx val="0"/>
            <c:order val="0"/>
            <c:val>
                <c:numRef>
                    <c:f>Sheet1!$B$2:$B$5</c:f>
                </c:numRef>
            </c:val>
            <c:cat>
                <c:strRef>
                    <c:f>Sheet1!$A$2:$A$5</c:f>
                </c:strRef>
            </c:cat>
        </c:ser>"#;

        let series = parse_series(xml);
        assert!(series.val.is_some());
        assert!(series.cat.is_some());

        match series.val.unwrap() {
            NumDataSource::Ref(nr) => assert_eq!(nr.f, "Sheet1!$B$2:$B$5"),
            other => panic!("Expected NumDataSource::Ref, got {:?}", other),
        }

        match series.cat.unwrap() {
            CatDataSource::StrRef(sr) => assert_eq!(sr.f, "Sheet1!$A$2:$A$5"),
            other => panic!("Expected CatDataSource::StrRef, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_smooth_series() {
        let xml = br#"<c:ser>
            <c:idx val="0"/>
            <c:smooth val="1"/>
        </c:ser>"#;

        let series = parse_series(xml);
        assert_eq!(series.smooth, Some(true));
    }

    #[test]
    fn test_parse_exploded_pie_series() {
        let xml = br#"<c:ser>
            <c:idx val="0"/>
            <c:explosion val="25"/>
        </c:ser>"#;

        let series = parse_series(xml);
        assert_eq!(series.explosion, Some(25));
    }

    #[test]
    fn test_parse_multiple_trendlines() {
        let xml = br#"<c:ser>
            <c:idx val="0"/>
            <c:order val="0"/>
            <c:trendline>
                <c:name>Linear Trend</c:name>
                <c:trendlineType val="linear"/>
                <c:dispEq val="1"/>
            </c:trendline>
            <c:trendline>
                <c:name>Exponential Trend</c:name>
                <c:trendlineType val="exp"/>
                <c:dispRSqr val="1"/>
            </c:trendline>
            <c:trendline>
                <c:name>Polynomial Trend</c:name>
                <c:trendlineType val="poly"/>
                <c:order val="2"/>
            </c:trendline>
        </c:ser>"#;

        let series = parse_series(xml);
        assert_eq!(series.trendline.len(), 3);

        // First trendline: Linear
        assert_eq!(series.trendline[0].name, Some("Linear Trend".to_string()));
        assert_eq!(series.trendline[0].trendline_type, TrendlineType::Linear);
        assert_eq!(series.trendline[0].disp_eq, Some(true));

        // Second trendline: Exponential
        assert_eq!(
            series.trendline[1].name,
            Some("Exponential Trend".to_string())
        );
        assert_eq!(
            series.trendline[1].trendline_type,
            TrendlineType::Exponential
        );
        assert_eq!(series.trendline[1].disp_r_sqr, Some(true));

        // Third trendline: Polynomial
        assert_eq!(
            series.trendline[2].name,
            Some("Polynomial Trend".to_string())
        );
        assert_eq!(
            series.trendline[2].trendline_type,
            TrendlineType::Polynomial
        );
        assert_eq!(series.trendline[2].order, Some(2));
    }

    #[test]
    fn test_parse_single_trendline() {
        let xml = br#"<c:ser>
            <c:idx val="0"/>
            <c:trendline>
                <c:trendlineType val="linear"/>
            </c:trendline>
        </c:ser>"#;

        let series = parse_series(xml);
        assert_eq!(series.trendline.len(), 1);
        assert_eq!(series.trendline[0].trendline_type, TrendlineType::Linear);
    }

    #[test]
    fn test_parse_no_trendlines() {
        let xml = br#"<c:ser>
            <c:idx val="0"/>
        </c:ser>"#;

        let series = parse_series(xml);
        assert!(series.trendline.is_empty());
    }

    #[test]
    fn test_parse_series_with_solid_fill_sp_pr() {
        let xml = br#"<c:ser>
            <c:idx val="0"/>
            <c:order val="0"/>
            <c:spPr>
                <a:solidFill>
                    <a:srgbClr val="FF0000"/>
                </a:solidFill>
                <a:ln w="25400">
                    <a:solidFill>
                        <a:srgbClr val="0000FF"/>
                    </a:solidFill>
                </a:ln>
            </c:spPr>
        </c:ser>"#;

        let series = parse_series(xml);
        assert!(series.sp_pr.is_some());
        let sp = series.sp_pr.unwrap();
        // Should have a solid fill
        assert!(sp.fill.is_some());
        // Should have an outline
        assert!(sp.ln.is_some());
        let outline = sp.ln.unwrap();
        assert_eq!(outline.width, Some(25400));
    }

    #[test]
    fn test_parse_data_point_with_sp_pr() {
        let xml = br#"<c:dPt>
            <c:idx val="2"/>
            <c:spPr>
                <a:solidFill>
                    <a:srgbClr val="00FF00"/>
                </a:solidFill>
            </c:spPr>
        </c:dPt>"#;

        let point = parse_data_point(xml);
        assert_eq!(point.idx, 2);
        assert!(point.sp_pr.is_some());
    }

    #[test]
    fn test_parse_data_labels_with_sp_pr_and_tx_pr() {
        let xml = br#"<c:dLbls>
            <c:showVal val="1"/>
            <c:spPr>
                <a:solidFill>
                    <a:srgbClr val="FFFFFF"/>
                </a:solidFill>
            </c:spPr>
            <c:txPr>
                <a:bodyPr rot="0"/>
                <a:p>
                    <a:pPr>
                        <a:defRPr sz="1000" b="1"/>
                    </a:pPr>
                </a:p>
            </c:txPr>
        </c:dLbls>"#;

        let labels = parse_data_labels(xml);
        assert!(labels.show_value);
        assert!(labels.sp_pr.is_some());
        assert!(labels.tx_pr.is_some());
    }

    #[test]
    fn test_parse_trendline_with_label() {
        let xml = br#"<c:trendline>
            <c:trendlineType val="linear"/>
            <c:dispEq val="1"/>
            <c:trendlineLbl>
                <c:layout>
                    <c:manualLayout>
                        <c:x val="0.1"/>
                        <c:y val="0.2"/>
                    </c:manualLayout>
                </c:layout>
                <c:numFmt formatCode="0.00" sourceLinked="0"/>
                <c:spPr>
                    <a:solidFill>
                        <a:srgbClr val="FFFFFF"/>
                    </a:solidFill>
                </c:spPr>
                <c:txPr>
                    <a:bodyPr rot="0"/>
                    <a:p>
                        <a:pPr>
                            <a:defRPr sz="900"/>
                        </a:pPr>
                    </a:p>
                </c:txPr>
            </c:trendlineLbl>
        </c:trendline>"#;

        let trendline = parse_trendline(xml);
        assert_eq!(trendline.trendline_type, TrendlineType::Linear);
        assert_eq!(trendline.disp_eq, Some(true));
        assert!(trendline.trendline_lbl.is_some());
        let label = trendline.trendline_lbl.unwrap();
        assert!(label.layout.is_some());
        let layout = label.layout.unwrap();
        assert_eq!(layout.x, Some(0.1));
        assert_eq!(layout.y, Some(0.2));
        assert!(label.num_fmt.is_some());
        let num_fmt = label.num_fmt.unwrap();
        assert_eq!(num_fmt.format_code, "0.00");
        assert_eq!(num_fmt.source_linked, Some(false));
        assert!(label.sp_pr.is_some());
        assert!(label.tx_pr.is_some());
    }
}
