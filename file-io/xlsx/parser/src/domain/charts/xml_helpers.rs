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

pub(crate) fn find_direct_child_tag(xml: &[u8], parent: &[u8], child: &[u8]) -> Option<usize> {
    let parent_start = find_tag_simd(xml, parent, 0)?;
    let parent_close = find_closing_tag(xml, parent, parent_start).unwrap_or(xml.len());
    let mut pos = find_gt_simd(xml, parent_start).map(|gt| gt + 1)?;
    let mut depth = 0usize;

    while pos < parent_close {
        let lt = find_next_byte(xml, b'<', pos, parent_close)?;
        if lt + 1 >= parent_close {
            return None;
        }

        let marker = xml[lt + 1];
        if marker == b'!' || marker == b'?' {
            pos = find_gt_simd(xml, lt)
                .map(|gt| gt + 1)
                .unwrap_or(parent_close);
            continue;
        }

        let closing = marker == b'/';
        let name_start = lt + if closing { 2 } else { 1 };
        let name_end = tag_name_end(xml, name_start, parent_close);
        let gt = find_gt_simd(xml, lt).unwrap_or(parent_close);

        if closing {
            depth = depth.saturating_sub(1);
            pos = gt.saturating_add(1);
            continue;
        }

        if depth == 0 && local_tag_name_eq(&xml[name_start..name_end], child) {
            return Some(lt);
        }

        if !is_self_closing_tag(xml, lt, gt) {
            depth += 1;
        }
        pos = gt.saturating_add(1);
    }

    None
}

fn find_next_byte(xml: &[u8], needle: u8, start: usize, end: usize) -> Option<usize> {
    xml.get(start..end)?
        .iter()
        .position(|byte| *byte == needle)
        .map(|offset| start + offset)
}

fn tag_name_end(xml: &[u8], start: usize, end: usize) -> usize {
    let mut pos = start;
    while pos < end {
        match xml[pos] {
            b' ' | b'\t' | b'\n' | b'\r' | b'/' | b'>' => break,
            _ => pos += 1,
        }
    }
    pos
}

fn local_tag_name_eq(tag_name: &[u8], expected: &[u8]) -> bool {
    let local = tag_name
        .iter()
        .rposition(|byte| *byte == b':')
        .map(|index| &tag_name[index + 1..])
        .unwrap_or(tag_name);
    local == expected
}

fn is_self_closing_tag(xml: &[u8], lt: usize, gt: usize) -> bool {
    xml.get(lt..gt).and_then(|tag| {
        tag.iter()
            .rev()
            .find(|byte| !(**byte).is_ascii_whitespace())
    }) == Some(&b'/')
}
