use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd,
};

use super::series;

/// Find the byte position just past the last `</c:ser>` closing tag in `xml`.
/// Returns 0 if no `<c:ser>` is found, so callers can safely search from the
/// returned position without special-casing.
pub(crate) fn find_pos_after_last_ser(xml: &[u8]) -> usize {
    let mut pos = 0;
    let mut last_end = 0;
    while let Some(ser_start) = find_tag_simd(xml, b"ser", pos) {
        // Skip closing tags </c:ser>
        if ser_start + 1 < xml.len() && xml[ser_start + 1] == b'/' {
            pos = ser_start + 1;
            continue;
        }
        // Skip filtered series (c15:ser) — only count standard <c:ser>
        if !series::is_standard_ser_tag(xml, ser_start) {
            let ser_end = find_closing_tag(xml, b"ser", ser_start).unwrap_or(xml.len());
            pos = ser_end;
            continue;
        }
        let ser_end = find_closing_tag(xml, b"ser", ser_start).unwrap_or(xml.len());
        let close_gt = find_gt_simd(xml, ser_end)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        last_end = close_gt;
        pos = ser_end;
    }
    last_end
}

/// Parse `<c:axId>` elements from a chart type element, preserving their original order.
pub(crate) fn parse_ax_ids(xml: &[u8]) -> Vec<u32> {
    let mut ids = Vec::new();
    let mut pos = 0;
    while let Some(ax_start) = find_tag_simd(xml, b"axId", pos) {
        if let Some(val) = find_attr_simd(xml, b"val=\"", ax_start) {
            let value_start = val + 5; // Skip `val="`
            if let Some((_start, _end)) = extract_quoted_value(xml, value_start) {
                if let Ok(s) = std::str::from_utf8(&xml[_start.._end]) {
                    if let Ok(id) = s.parse::<u32>() {
                        ids.push(id);
                    }
                }
            }
        }
        pos = ax_start + 1;
    }
    ids
}
