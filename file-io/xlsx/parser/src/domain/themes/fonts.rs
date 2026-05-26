//! Font scheme types and parsing for Excel themes.
//!
//! This module handles the font scheme portion of Excel themes, which defines
//! major (heading) and minor (body) font collections for different scripts.
//!
//! Type definitions come from `ooxml_types::themes`; this module adds parsing logic.

use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd,
};
use crate::infra::xml::decode_xml_entities;

// Re-export canonical types
pub use ooxml_types::themes::{FontCollection, FontScheme, ScriptFont, ThemeFontDef};

// =============================================================================
// Parsing extensions
// =============================================================================

/// Parse a `FontScheme` from theme XML bytes.
pub fn parse_font_scheme(xml: &[u8]) -> FontScheme {
    let mut scheme = FontScheme {
        name: String::new(),
        major_font: FontCollection::default(),
        minor_font: FontCollection::default(),
        ext_lst: None,
    };

    // Find fontScheme element
    if let Some(font_start) = find_tag_simd(xml, b"fontScheme", 0) {
        let font_end = find_closing_tag(xml, b"fontScheme", font_start).unwrap_or(xml.len());
        let font_xml = &xml[font_start..font_end];

        // Parse scheme name (decode XML entities so we don't double-escape on write)
        if let Some(name_pos) = find_attr_simd(font_xml, b"name=\"", 0) {
            let value_start = name_pos + 6;
            if let Some((start, end)) = extract_quoted_value(font_xml, value_start) {
                scheme.name = decode_xml_entities(&font_xml[start..end]);
            }
        }

        // Parse major font
        if let Some(major_start) = find_tag_simd(font_xml, b"majorFont", 0) {
            let major_end =
                find_closing_tag(font_xml, b"majorFont", major_start).unwrap_or(font_xml.len());
            scheme.major_font = parse_font_collection(&font_xml[major_start..major_end]);
        }

        // Parse minor font
        if let Some(minor_start) = find_tag_simd(font_xml, b"minorFont", 0) {
            let minor_end =
                find_closing_tag(font_xml, b"minorFont", minor_start).unwrap_or(font_xml.len());
            scheme.minor_font = parse_font_collection(&font_xml[minor_start..minor_end]);
        }
    }

    scheme
}

/// Parse a `FontCollection` from XML bytes.
pub fn parse_font_collection(xml: &[u8]) -> FontCollection {
    let mut collection = FontCollection::default();

    // Parse latin font
    if let Some(latin_start) = find_tag_simd(xml, b"latin", 0) {
        collection.latin = parse_font_def(xml, latin_start);
    }

    // Parse ea (East Asian) font
    if let Some(ea_start) = find_tag_simd(xml, b"ea", 0) {
        collection.ea = parse_font_def(xml, ea_start);
    }

    // Parse cs (Complex Script) font
    if let Some(cs_start) = find_tag_simd(xml, b"cs", 0) {
        collection.cs = parse_font_def(xml, cs_start);
    }

    // Parse additional script fonts (<a:font script="..." typeface="..."/>)
    let mut pos = 0;
    while let Some(font_start) = find_tag_simd(xml, b"font", pos) {
        let font_end = find_gt_simd(xml, font_start).unwrap_or(xml.len());
        let font_xml = &xml[font_start..font_end + 1];

        let script = parse_attr(font_xml, b"script=\"");
        let typeface = parse_attr(font_xml, b"typeface=\"");

        if !script.is_empty() && !typeface.is_empty() {
            collection
                .script_fonts
                .push(ScriptFont { script, typeface });
        }

        pos = font_end + 1;
    }

    collection
}

/// Parse a `ThemeFontDef` from the XML element starting at `start`.
fn parse_font_def(xml: &[u8], start: usize) -> ThemeFontDef {
    let typeface = parse_typeface(xml, start);
    let panose = parse_optional_attr(xml, b"panose=\"", start);
    ThemeFontDef {
        typeface,
        panose,
        pitch_family: None,
        charset: None,
    }
}

/// Parse the typeface attribute from a font element.
fn parse_typeface(xml: &[u8], start: usize) -> String {
    if let Some(type_pos) = find_attr_simd(xml, b"typeface=\"", start) {
        let value_start = type_pos + 10; // len of b"typeface=\""
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            if let Ok(typeface) = std::str::from_utf8(&xml[start..end]) {
                return typeface.to_string();
            }
        }
    }
    String::new()
}

/// Parse an optional string attribute.
fn parse_optional_attr(xml: &[u8], attr: &[u8], search_start: usize) -> Option<String> {
    if let Some(attr_pos) = find_attr_simd(xml, attr, search_start) {
        let value_start = attr_pos + attr.len();
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            if let Ok(val) = std::str::from_utf8(&xml[start..end]) {
                if !val.is_empty() {
                    return Some(val.to_string());
                }
            }
        }
    }
    None
}

/// Parse a string attribute value.
fn parse_attr(xml: &[u8], attr: &[u8]) -> String {
    if let Some(attr_pos) = find_attr_simd(xml, attr, 0) {
        let value_start = attr_pos + attr.len();
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            if let Ok(val) = std::str::from_utf8(&xml[start..end]) {
                return val.to_string();
            }
        }
    }
    String::new()
}
