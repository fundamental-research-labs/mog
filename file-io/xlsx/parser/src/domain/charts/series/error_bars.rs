use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_tag_simd,
};

use super::data_sources::parse_num_ref;
use super::xml_values::parse_bool_val;
use super::{
    ErrorBarDirection, ErrorBarType, ErrorBars, ErrorValueType, NumDataSource,
    find_top_level_ext_lst, parse_chart_ext_lst_at,
};
use crate::domain::charts::parse_shape_properties;

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

    // Parse direct-child extLst
    if let Some(ext_start) = find_top_level_ext_lst(xml) {
        err_bars.extensions = parse_chart_ext_lst_at(xml, ext_start);
    }

    err_bars
}

// =============================================================================
// Trendline (parsing into ooxml_types::charts::Trendline)
