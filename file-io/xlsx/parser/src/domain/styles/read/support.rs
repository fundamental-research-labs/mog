use crate::infra::scanner::{find_gt_simd, find_lt_simd, find_tag_simd};
use crate::infra::xml::{
    parse_bool_attr, parse_bool_attr_with_default, parse_string_attr, parse_u32_attr,
};
use crate::infra::xml_fragment::extract_element_bounds;

use super::super::types::*;

/// Parse a color element from tag bytes, returning a `ColorDef`.
pub(super) fn parse_color(tag_bytes: &[u8]) -> Option<ColorDef> {
    let tint = parse_string_attr(tag_bytes, b"tint=\"");

    if let Some(theme_id) = parse_u32_attr(tag_bytes, b"theme=\"") {
        return Some(ColorDef::Theme { id: theme_id, tint });
    }
    if let Some(rgb) = parse_string_attr(tag_bytes, b"rgb=\"") {
        return Some(ColorDef::Rgb { val: rgb, tint });
    }
    if let Some(idx) = parse_u32_attr(tag_bytes, b"indexed=\"") {
        return Some(ColorDef::Indexed { id: idx, tint });
    }
    if parse_bool_attr(tag_bytes, b"auto=\"") {
        return Some(ColorDef::Auto { tint });
    }
    None
}

/// Find a <color> child element and parse it into a `ColorDef`.
pub(super) fn parse_color_ref(xml: &[u8]) -> Option<ColorDef> {
    let color_start = find_tag_simd(xml, b"color", 0)?;
    let color_end = find_gt_simd(xml, color_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let element = &xml[color_start..color_end];
    parse_color(element)
}

/// Parse a named color element (e.g. <fgColor>, <bgColor>) into a `ColorDef`.
pub(super) fn parse_named_color_ref(xml: &[u8], tag: &[u8]) -> Option<ColorDef> {
    let tag_start = find_tag_simd(xml, tag, 0)?;
    let tag_end = find_gt_simd(xml, tag_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let element = &xml[tag_start..tag_end];
    parse_color(element)
}

/// Parse a boolean element like `<strike/>`, `<strike val="0"/>`, or `<strike val="1"/>`.
/// Returns `Some(true)` for bare element or `val="1"/"true"`, `Some(false)` for `val="0"/"false"`,
/// `None` if the element is absent.
pub(super) fn parse_optional_bool_element(xml: &[u8], tag: &[u8]) -> Option<bool> {
    let pos = find_tag_simd(xml, tag, 0)?;
    let el_end = find_gt_simd(xml, pos).map(|g| g + 1).unwrap_or(xml.len());
    Some(parse_bool_attr_with_default(
        &xml[pos..el_end],
        b"val=\"",
        true,
    ))
}

/// Extract a direct child element by local name from an XML content slice.
pub(super) fn extract_direct_child_element_xml(xml: &[u8], tag: &[u8]) -> Option<String> {
    let mut pos = 0;

    while let Some(start) = find_lt_simd(xml, pos) {
        let name_start = start + 1;
        if name_start >= xml.len() {
            return None;
        }

        if matches!(xml[name_start], b'/' | b'!' | b'?') {
            pos = find_gt_simd(xml, name_start).map_or(xml.len(), |p| p + 1);
            continue;
        }

        let mut name_end = name_start;
        while name_end < xml.len()
            && !matches!(xml[name_end], b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/')
        {
            name_end += 1;
        }

        let name = &xml[name_start..name_end];
        let local_name = name
            .iter()
            .position(|&b| b == b':')
            .map(|i| &name[i + 1..])
            .unwrap_or(name);

        let (_, end) = extract_element_bounds(xml, start)?;
        if local_name == tag {
            return String::from_utf8(xml[start..end].to_vec()).ok();
        }
        pos = end;
    }

    None
}
