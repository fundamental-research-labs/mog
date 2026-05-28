use crate::infra::scanner;
use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_gt_simd, find_tag_simd};

pub(super) fn element_slice<'a>(xml: &'a [u8], tag: &[u8], start: usize) -> Option<&'a [u8]> {
    let tag_start = find_tag_simd(xml, tag, start)?;
    let tag_end = find_gt_simd(xml, tag_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    Some(&xml[tag_start..tag_end])
}

pub(super) fn section_slice<'a>(xml: &'a [u8], tag: &[u8]) -> Option<&'a [u8]> {
    let start = find_tag_simd(xml, tag, 0)?;
    let end = scanner::find_closing_tag(xml, tag, start).unwrap_or(xml.len());
    Some(&xml[start..end])
}

pub(super) fn attr_str(element: &[u8], attr: &[u8]) -> Option<String> {
    let pos = find_attr_simd(element, attr, 0)?;
    let value_start = pos + attr.len();
    let (start, end) = extract_quoted_value(element, value_start)?;
    std::str::from_utf8(&element[start..end])
        .ok()
        .map(|s| s.to_string())
}

pub(super) fn attr_parse<T: std::str::FromStr>(element: &[u8], attr: &[u8]) -> Option<T> {
    let pos = find_attr_simd(element, attr, 0)?;
    let value_start = pos + attr.len();
    let (start, end) = extract_quoted_value(element, value_start)?;
    std::str::from_utf8(&element[start..end]).ok()?.parse().ok()
}

pub(super) fn attr_bool(element: &[u8], attr: &[u8]) -> Option<bool> {
    let pos = find_attr_simd(element, attr, 0)?;
    let value_start = pos + attr.len();
    let (start, end) = extract_quoted_value(element, value_start)?;
    match &element[start..end] {
        b"1" | b"true" => Some(true),
        b"0" | b"false" => Some(false),
        _ => None,
    }
}

pub(super) fn complete_element_end(xml: &[u8], tag: &[u8], tag_start: usize) -> Option<usize> {
    let tag_end = find_gt_simd(xml, tag_start)?;
    if tag_end > tag_start && xml[tag_end - 1] == b'/' {
        return Some(tag_end + 1);
    }
    let closing = scanner::find_closing_tag(xml, tag, tag_start)?;
    Some(
        memchr::memchr(b'>', &xml[closing..])
            .map(|offset| closing + offset + 1)
            .unwrap_or(xml.len()),
    )
}

pub(super) fn complete_element_xml(xml: &[u8], tag: &[u8]) -> Option<String> {
    let tag_start = find_tag_simd(xml, tag, 0)?;
    let end = complete_element_end(xml, tag, tag_start)?;
    std::str::from_utf8(&xml[tag_start..end])
        .ok()
        .map(|s| s.to_string())
}

pub(super) fn find_auto_filter_end(post_sd: &[u8]) -> Option<usize> {
    let tag_start = find_tag_simd(post_sd, b"autoFilter", 0)?;
    complete_element_end(post_sd, b"autoFilter", tag_start)
}
