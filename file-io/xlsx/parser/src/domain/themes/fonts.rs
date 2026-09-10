//! Font scheme types and parsing for Excel themes.
//!
//! This module handles the font scheme portion of Excel themes, which defines
//! major (heading) and minor (body) font collections for different scripts.
//!
//! Type definitions come from `ooxml_types::themes`; this module adds parsing logic.

use crate::infra::scanner::{
    StartTagEnd, find_closing_tag, find_start_tag_end_quoted, find_tag_simd,
};
use crate::infra::xml::parse_string_attr;

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

        if let StartTagEnd::Found(end) = find_start_tag_end_quoted(font_xml, 0) {
            scheme.name = parse_attr(&font_xml[..=end], b"name");
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
        let StartTagEnd::Found(font_end) = find_start_tag_end_quoted(xml, font_start) else {
            break;
        };
        let font_xml = &xml[font_start..font_end + 1];

        let script = parse_attr(font_xml, b"script");
        let typeface = parse_attr(font_xml, b"typeface");

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
    // Attribute lookup must stay inside this element: an omitted attribute
    // must not pick up a later script/font definition's value.
    let StartTagEnd::Found(end) = find_start_tag_end_quoted(xml, start) else {
        return ThemeFontDef::new("");
    };
    let element = &xml[start..=end];
    let typeface = parse_attr(element, b"typeface");
    let panose = parse_optional_attr(element, b"panose");
    ThemeFontDef {
        typeface,
        panose,
        pitch_family: None,
        charset: None,
    }
}

/// Read semantic attribute text, decoding XML entities exactly once.
fn parse_optional_attr(xml: &[u8], attr: &[u8]) -> Option<String> {
    parse_string_attr(xml, attr).filter(|value| !value.is_empty())
}

/// Parse a string attribute value, defaulting missing/empty attributes to empty.
fn parse_attr(xml: &[u8], attr: &[u8]) -> String {
    parse_optional_attr(xml, attr).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_font_scheme() {
        let xml = br#"
        <a:theme name="Test">
            <a:themeElements>
                <a:clrScheme name="Test"></a:clrScheme>
                <a:fontScheme name="Office">
                    <a:majorFont>
                        <a:latin typeface="Calibri Light"/>
                        <a:ea typeface=""/>
                        <a:cs typeface=""/>
                    </a:majorFont>
                    <a:minorFont>
                        <a:latin typeface="Calibri"/>
                        <a:ea typeface=""/>
                        <a:cs typeface=""/>
                    </a:minorFont>
                </a:fontScheme>
            </a:themeElements>
        </a:theme>
        "#;

        let scheme = parse_font_scheme(xml);
        assert_eq!(scheme.name, "Office");
        assert_eq!(scheme.major_font.latin.typeface, "Calibri Light");
        assert_eq!(scheme.minor_font.latin.typeface, "Calibri");
    }

    #[test]
    fn test_parse_font_scheme_decodes_name_and_bounds_major_minor() {
        let xml = br#"
        <a:fontScheme name="Major &amp; Minor">
            <a:majorFont>
                <a:latin typeface="Major Latin"/>
            </a:majorFont>
            <a:minorFont>
                <a:latin typeface="Minor Latin"/>
            </a:minorFont>
        </a:fontScheme>
        "#;

        let scheme = parse_font_scheme(xml);
        assert_eq!(scheme.name, "Major & Minor");
        assert_eq!(scheme.major_font.latin.typeface, "Major Latin");
        assert_eq!(scheme.minor_font.latin.typeface, "Minor Latin");
    }

    #[test]
    fn test_parse_font_collection_preserves_script_order_panose_and_empty_typefaces() {
        let xml = br#"
        <a:majorFont>
            <a:latin typeface="Aptos Display" panose="020F0302020204030204"/>
            <a:ea typeface=""/>
            <a:cs typeface=""/>
            <a:font script="Jpan" typeface="Yu Gothic"/>
            <a:font script="Hang" typeface="Malgun Gothic"/>
        </a:majorFont>
        "#;

        let collection = parse_font_collection(xml);
        assert_eq!(collection.latin.typeface, "Aptos Display");
        assert_eq!(
            collection.latin.panose.as_deref(),
            Some("020F0302020204030204")
        );
        assert_eq!(collection.ea.typeface, "");
        assert_eq!(collection.cs.typeface, "");
        assert_eq!(collection.script_fonts.len(), 2);
        assert_eq!(collection.script_fonts[0].script, "Jpan");
        assert_eq!(collection.script_fonts[1].script, "Hang");
    }

    #[test]
    fn test_font_attributes_do_not_leak_from_later_elements() {
        let collection = parse_font_collection(
            br#"<a:majorFont><a:latin/><a:ea typeface="East"/><a:cs typeface="Complex" panose="&#48;2"/></a:majorFont>"#,
        );
        assert_eq!(collection.latin.typeface, "");
        assert_eq!(collection.latin.panose, None);
        assert_eq!(collection.ea.typeface, "East");
        assert_eq!(collection.ea.panose, None);
        assert_eq!(collection.cs.panose.as_deref(), Some("02"));
    }

    #[test]
    fn test_parse_font_scheme_tolerates_missing_sections() {
        let xml = br#"<a:fontScheme name="Sparse"><a:majorFont/></a:fontScheme>"#;

        let scheme = parse_font_scheme(xml);
        assert_eq!(scheme.name, "Sparse");
        assert_eq!(scheme.major_font.latin.typeface, "");
        assert_eq!(scheme.minor_font.latin.typeface, "");
    }
}
