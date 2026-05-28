//! Depth-aware chart extension-list parsing helpers.
//!
//! These helpers intentionally stay byte-scanner based because they sit on the
//! production chart parser path. They centralize the fragile parts: namespace
//! tolerant tag matching, direct-child extLst lookup, and nested extLst closing
//! detection.

use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_lt_simd,
    find_tag_simd,
};

/// Check if the XML tag starting at `pos` (the `<` position) is self-closing (`<tag ... />`).
pub(crate) fn is_self_closing_tag(xml: &[u8], pos: usize) -> bool {
    if let Some(gt) = find_gt_simd(xml, pos) {
        gt > 0 && xml[gt - 1] == b'/'
    } else {
        false
    }
}

/// Check if a tag name matches `target` exactly or with any namespace prefix
/// (e.g. `ext` matches `ext`, `c:ext`, `c15:ext`, but not `extLst`).
pub(crate) fn tag_name_matches(name: &[u8], target: &[u8]) -> bool {
    if name == target {
        return true;
    }

    if name.len() > target.len() + 1 {
        let prefix_end = name.len() - target.len();
        return name[prefix_end - 1] == b':' && &name[prefix_end..] == target;
    }

    false
}

/// Find the direct-child `<c:extLst>` of a root XML fragment.
pub(crate) fn find_top_level_ext_lst(xml: &[u8]) -> Option<usize> {
    let root_gt = find_gt_simd(xml, 0)?;
    if root_gt > 0 && xml[root_gt - 1] == b'/' {
        return None;
    }

    let mut pos = root_gt + 1;
    let mut depth = 1u32;

    while pos < xml.len() {
        let lt = match find_lt_simd(xml, pos) {
            Some(lt) => lt,
            None => break,
        };
        let after_lt = lt + 1;
        if after_lt >= xml.len() {
            break;
        }

        if xml[after_lt] == b'/' {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                break;
            }
            pos = find_gt_simd(xml, lt).map(|p| p + 1).unwrap_or(xml.len());
            continue;
        }

        let name_end = tag_name_end(xml, after_lt);
        let gt = find_gt_simd(xml, lt).unwrap_or(xml.len());
        let is_self_closing = gt > 0 && xml[gt - 1] == b'/';

        if depth == 1 && tag_name_matches(&xml[after_lt..name_end], b"extLst") {
            return Some(lt);
        }

        if !is_self_closing {
            depth += 1;
        }
        pos = gt + 1;
    }

    None
}

/// Depth-aware closing tag search for an opening tag at `start`.
pub(crate) fn find_closing_tag_nested(bytes: &[u8], tag: &[u8], start: usize) -> Option<usize> {
    let mut pos = find_gt_simd(bytes, start)
        .map(|p| p + 1)
        .unwrap_or(start + 1);

    if pos >= 2 && bytes[pos - 2] == b'/' {
        return None;
    }

    let mut depth = 1u32;
    while pos < bytes.len() && depth > 0 {
        let lt = match find_lt_simd(bytes, pos) {
            Some(lt) => lt,
            None => break,
        };
        let after_lt = lt + 1;
        if after_lt >= bytes.len() {
            break;
        }

        if bytes[after_lt] == b'/' {
            let tag_start = after_lt + 1;
            let name_end = tag_name_end(bytes, tag_start);
            if tag_name_matches(&bytes[tag_start..name_end], tag) {
                depth -= 1;
                if depth == 0 {
                    return Some(lt);
                }
            }
            pos = name_end;
        } else {
            let name_end = tag_name_end(bytes, after_lt);
            if tag_name_matches(&bytes[after_lt..name_end], tag) {
                let gt = find_gt_simd(bytes, lt).unwrap_or(bytes.len());
                if gt == 0 || bytes[gt - 1] != b'/' {
                    depth += 1;
                }
                pos = gt + 1;
            } else {
                pos = name_end;
            }
        }
    }

    None
}

/// Parse `<c:extLst>` starting at a known position.
pub(crate) fn parse_chart_ext_lst_at(
    xml: &[u8],
    ext_lst_start: usize,
) -> Vec<ooxml_types::charts::ExtensionEntry> {
    let ext_lst_end = find_closing_tag_nested(xml, b"extLst", ext_lst_start)
        .unwrap_or_else(|| find_closing_tag(xml, b"extLst", ext_lst_start).unwrap_or(xml.len()));
    let ext_lst_bytes = &xml[ext_lst_start..ext_lst_end];
    let mut extensions = Vec::new();
    let mut ext_pos = 0;

    while let Some(ext_start) = find_tag_simd(ext_lst_bytes, b"ext", ext_pos) {
        let tag_gt = find_gt_simd(ext_lst_bytes, ext_start).unwrap_or(ext_lst_bytes.len());
        let is_self_closing = tag_gt > 0 && ext_lst_bytes.get(tag_gt - 1) == Some(&b'/');

        let close_gt = if is_self_closing {
            tag_gt + 1
        } else {
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

/// Parse the first `<c:extLst>` in an XML fragment.
pub(crate) fn parse_chart_ext_lst(xml: &[u8]) -> Vec<ooxml_types::charts::ExtensionEntry> {
    let ext_lst_start = match find_tag_simd(xml, b"extLst", 0) {
        Some(pos) => pos,
        None => return Vec::new(),
    };
    parse_chart_ext_lst_at(xml, ext_lst_start)
}

/// Parse the chart-type-level `<c:extLst>` that appears after `<c:axId>` children.
///
/// Chart-type extensions can contain filtered series with nested `extLst`, so
/// this preserves the whole outer extension list as a raw blob.
pub(crate) fn parse_chart_type_ext_lst(xml: &[u8]) -> Vec<ooxml_types::charts::ExtensionEntry> {
    let mut pos = 0;
    let mut after_last_ax_id = 0;
    while let Some(ax_start) = find_tag_simd(xml, b"axId", pos) {
        let gt = find_gt_simd(xml, ax_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        after_last_ax_id = gt;
        pos = ax_start + 1;
    }
    let search_start = if after_last_ax_id == 0 {
        match find_top_level_ext_lst(xml) {
            Some(p) => p,
            None => return Vec::new(),
        }
    } else {
        after_last_ax_id
    };

    let ext_lst_start = match find_tag_simd(xml, b"extLst", search_start) {
        Some(p) => p,
        None => return Vec::new(),
    };
    let close_lt = match find_closing_tag_nested(xml, b"extLst", ext_lst_start) {
        Some(close_lt) => close_lt,
        None => return Vec::new(),
    };
    let close_gt = find_gt_simd(xml, close_lt)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let raw = String::from_utf8_lossy(&xml[ext_lst_start..close_gt]).to_string();

    vec![ooxml_types::charts::ExtensionEntry {
        uri: "__raw_ext_lst__".to_string(),
        xml: raw,
    }]
}

fn tag_name_end(bytes: &[u8], start: usize) -> usize {
    bytes[start..]
        .iter()
        .position(|&b| matches!(b, b'>' | b'/' | b' ' | b'\t' | b'\n' | b'\r'))
        .map(|p| start + p)
        .unwrap_or(bytes.len())
}
