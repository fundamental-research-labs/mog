//! Helper functions for drawings parsing.
//!
//! This module contains common utility functions used across the drawings
//! submodules for parsing values, extracting attributes, and decoding entities.

use crate::infra::scanner::{extract_quoted_value, find_attr_simd};

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
