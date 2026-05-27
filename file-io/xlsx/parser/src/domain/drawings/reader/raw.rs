//! Raw XML preservation helpers for drawing passthrough cases.

use super::elements::direct_child_slice;
use crate::infra::scanner::{find_closing_tag, find_element_end, find_tag_simd};

/// Extract a complete element as UTF-8 raw XML.
pub(crate) fn extract_element_raw_string(
    xml: &[u8],
    local_name: &[u8],
    start: usize,
) -> Option<(String, usize)> {
    let open_end = find_element_end(xml, start)?;
    let end = if is_self_closing_open_tag(xml, open_end) {
        open_end + 1
    } else {
        let close_lt = find_closing_tag(xml, local_name, start)?;
        find_element_end(xml, close_lt)? + 1
    };
    let raw = std::str::from_utf8(xml.get(start..end)?).ok()?.to_string();
    Some((raw, end))
}

/// Extract raw `<extLst>...</extLst>` XML from a scoped element.
pub(crate) fn extract_ext_lst_raw(xml: &[u8]) -> Option<String> {
    direct_child_raw(xml, b"extLst")
}

/// Extract a direct child `mc:AlternateContent` block from a scoped element.
pub(crate) fn direct_alternate_content_raw(xml: &[u8]) -> Option<String> {
    direct_child_raw(xml, b"AlternateContent")
}

/// Whether a scoped XML block contains a graphic frame element.
pub(crate) fn contains_graphic_frame(xml: &[u8]) -> bool {
    find_tag_simd(xml, b"graphicFrame", 0).is_some()
}

fn direct_child_raw(xml: &[u8], local_name: &[u8]) -> Option<String> {
    let child = direct_child_slice(xml, local_name)?;
    std::str::from_utf8(child).ok().map(ToOwned::to_owned)
}

fn is_self_closing_open_tag(xml: &[u8], open_end: usize) -> bool {
    xml[..open_end]
        .iter()
        .rposition(|b| !b.is_ascii_whitespace())
        .is_some_and(|pos| xml[pos] == b'/')
}
