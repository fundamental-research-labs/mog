use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_tag_simd,
};

use super::xml_values::{parse_bool_val, parse_bytes_u32, parse_val_attr_u32};
use super::{DataPointOverride, Marker, parse_chart_ext_lst};
use crate::domain::charts::parse_shape_properties;
use crate::domain::charts::types::MarkerStyle;

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
