//! Scalar XML attribute and element-text helpers for chart parsing.

use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd};

pub(super) fn parse_bool_attr(xml: &[u8], attr: &[u8]) -> bool {
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

pub(super) fn parse_string_attr(xml: &[u8], attr: &[u8]) -> Option<String> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();
    let (start, end) = extract_quoted_value(xml, value_start)?;
    Some(String::from_utf8_lossy(&xml[start..end]).to_string())
}

pub(super) fn parse_u32_attr(xml: &[u8], attr: &[u8]) -> Option<u32> {
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

pub(super) fn parse_i32_attr(xml: &[u8], attr: &[u8]) -> Option<i32> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();
    let (start, end) = extract_quoted_value(xml, value_start)?;
    let s = std::str::from_utf8(&xml[start..end]).ok()?;
    s.parse().ok()
}

pub(super) fn parse_f64_attr(xml: &[u8], attr: &[u8]) -> Option<f64> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();
    let (start, end) = extract_quoted_value(xml, value_start)?;
    let s = std::str::from_utf8(&xml[start..end]).ok()?;
    s.parse().ok()
}

pub(super) fn parse_element_text(xml: &[u8], tag: &[u8]) -> Option<String> {
    let gt = find_gt_simd(xml, 0)?;
    let text_start = gt + 1;
    let close_lt = find_closing_tag(xml, tag, 0)?;
    if close_lt <= text_start {
        return None;
    }
    std::str::from_utf8(&xml[text_start..close_lt])
        .ok()
        .map(|s| s.to_string())
}
