//! Helper functions for drawings parsing.
//!
//! This module contains common utility functions used across the drawings
//! submodules for parsing values, extracting attributes, and decoding entities.

use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_tag_simd,
};

use super::types::EditAs;

/// Extract attribute value within an element
pub fn extract_attr_value_in_element<'a>(bytes: &'a [u8], attr: &[u8]) -> Option<&'a [u8]> {
    let attr_pos = find_attr_simd(bytes, attr, 0)?;
    let value_start = attr_pos + attr.len();
    let (start, end) = extract_quoted_value(bytes, value_start)?;
    Some(&bytes[start..end])
}

/// Parse u32 from bytes
pub fn parse_u32(bytes: &[u8]) -> Option<u32> {
    std::str::from_utf8(bytes).ok()?.trim().parse().ok()
}

/// Parse i32 from bytes
pub fn parse_i32(bytes: &[u8]) -> Option<i32> {
    std::str::from_utf8(bytes).ok()?.trim().parse().ok()
}

/// Parse i64 from bytes
pub fn parse_i64(bytes: &[u8]) -> Option<i64> {
    std::str::from_utf8(bytes).ok()?.trim().parse().ok()
}

/// Parse editAs attribute, delegating to `EditAs::from_ooxml()`.
pub fn parse_edit_as(bytes: &[u8]) -> Option<EditAs> {
    let s = std::str::from_utf8(bytes).ok()?;
    let parsed = EditAs::from_ooxml(s);
    // from_ooxml defaults to TwoCell for unknown inputs; we return None instead.
    if s == "twoCell" || s == "oneCell" || s == "absolute" {
        Some(parsed)
    } else {
        None
    }
}

/// Extract raw `<extLst>...</extLst>` XML from a slice, including the opening `<` and closing `>`.
///
/// `xml` should be a slice that may contain an `<a:extLst>` (or `<extLst>`) element.
/// Returns the complete element as a `String`, or `None` if no extLst is found.
pub fn extract_ext_lst_raw(xml: &[u8]) -> Option<String> {
    // find_tag_simd returns the position of the '<' character in '<a:extLst>'.
    let open = find_tag_simd(xml, b"extLst", 0)?;
    // find_closing_tag returns the position of '<' in '</a:extLst>'.
    let close_lt = find_closing_tag(xml, b"extLst", open)?;
    // Walk forward past the closing '>' of '</a:extLst>'.
    let mut close_end = close_lt;
    while close_end < xml.len() && xml[close_end] != b'>' {
        close_end += 1;
    }
    if close_end < xml.len() {
        close_end += 1;
    }
    std::str::from_utf8(&xml[open..close_end])
        .ok()
        .map(|s| s.to_string())
}

/// Decode XML entities in bytes
pub fn decode_xml_entities(bytes: &[u8]) -> String {
    let s = String::from_utf8_lossy(bytes);
    decode_xml_entities_string(&s)
}

/// Decode XML entities in a string
pub fn decode_xml_entities_string(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }

    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}
