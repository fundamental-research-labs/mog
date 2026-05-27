use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_lt_simd,
    find_tag_simd,
};

use super::series;

/// Check if the XML tag starting at `pos` (the `<` position) is self-closing (`<tag ... />`).
pub(crate) fn is_self_closing_tag(xml: &[u8], pos: usize) -> bool {
    if let Some(gt) = find_gt_simd(xml, pos) {
        gt > 0 && xml[gt - 1] == b'/'
    } else {
        false
    }
}

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

/// Parse the chart-type-level `<c:extLst>` that appears after all `<c:axId>` elements.
///
/// This extLst may contain deeply nested content (`c15:filteredBarSeries` →
/// `c15:ser` → `c:extLst`) so we capture the entire `<c:extLst>...</c:extLst>`
/// block as a single raw blob for lossless round-trip, using nesting-aware
/// closing-tag detection.
pub(crate) fn parse_chart_type_ext_lst(xml: &[u8]) -> Vec<ooxml_types::charts::ExtensionEntry> {
    // Find position after the last <c:axId> — the chart-type extLst comes after these.
    let mut pos = 0;
    let mut after_last_ax_id = 0;
    while let Some(ax_start) = find_tag_simd(xml, b"axId", pos) {
        let gt = find_gt_simd(xml, ax_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        after_last_ax_id = gt;
        pos = ax_start + 1;
    }
    if after_last_ax_id == 0 {
        return Vec::new();
    }
    // Find the <c:extLst> opening tag after last axId
    let ext_lst_start = match find_tag_simd(xml, b"extLst", after_last_ax_id) {
        Some(p) => p,
        None => return Vec::new(),
    };
    // Use nesting-aware search: count open/close extLst tags to find the true end
    let content_start = find_gt_simd(xml, ext_lst_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let mut depth = 1i32;
    let mut scan = content_start;
    while scan < xml.len() && depth > 0 {
        if let Some(lt) = find_lt_simd(xml, scan) {
            if lt + 1 < xml.len() && xml[lt + 1] == b'/' {
                // Closing tag — check if it's extLst
                if is_ext_lst_tag(&xml[lt + 2..]) {
                    depth -= 1;
                    if depth == 0 {
                        // Found the matching </c:extLst>
                        let close_gt = find_gt_simd(xml, lt).map(|p| p + 1).unwrap_or(xml.len());
                        // Capture everything from <c:extLst> to </c:extLst> inclusive
                        let raw =
                            String::from_utf8_lossy(&xml[ext_lst_start..close_gt]).to_string();
                        // Store as a single entry with special uri "__raw_ext_lst__"
                        return vec![ooxml_types::charts::ExtensionEntry {
                            uri: "__raw_ext_lst__".to_string(),
                            xml: raw,
                        }];
                    }
                }
                scan = lt + 1;
            } else {
                // Opening tag — check if it's extLst
                if is_ext_lst_tag(&xml[lt + 1..]) {
                    // Check it's not self-closing
                    if let Some(gt) = find_gt_simd(xml, lt) {
                        if gt > 0 && xml[gt - 1] != b'/' {
                            depth += 1;
                        }
                    }
                }
                scan = lt + 1;
            }
        } else {
            break;
        }
    }
    Vec::new()
}

/// Check if bytes start with "extLst" (possibly with a namespace prefix like "c:extLst").
pub(crate) fn is_ext_lst_tag(bytes: &[u8]) -> bool {
    if bytes.starts_with(b"extLst") {
        let after = bytes.get(6).copied().unwrap_or(b'>');
        return matches!(after, b' ' | b'>' | b'/' | b'\t' | b'\n' | b'\r');
    }
    // Check for namespace prefix (e.g., "c:extLst")
    if let Some(colon) = bytes.iter().position(|&b| b == b':') {
        if colon < 10 && bytes[colon + 1..].starts_with(b"extLst") {
            let after = bytes.get(colon + 7).copied().unwrap_or(b'>');
            return matches!(after, b' ' | b'>' | b'/' | b'\t' | b'\n' | b'\r');
        }
    }
    false
}
