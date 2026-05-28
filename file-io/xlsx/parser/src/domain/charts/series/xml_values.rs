use crate::infra::scanner::{extract_quoted_value, find_attr_simd};

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
pub(super) fn parse_bytes_u32(bytes: &[u8]) -> u32 {
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

/// Parse a val="N" attribute as f64.
pub(super) fn parse_val_f64(xml: &[u8]) -> f64 {
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
pub(super) fn parse_bool_val(xml: &[u8]) -> bool {
    if let Some(attr_pos) = find_attr_simd(xml, b"val=\"", 0) {
        let value_start = attr_pos + 5;
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            let val = &xml[start..end];
            return val == b"1" || val == b"true" || val == b"True";
        }
    }
    false
}
