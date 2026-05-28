//! Color scheme types and parsing for Excel themes.
//!
//! This module handles the color scheme portion of Excel themes, which defines
//! the 12 named colors used throughout a workbook.
//!
//! Type definitions come from `ooxml_types::themes`; this module adds parsing logic
//! and the runtime `ThemeColor` representation used for color resolution.

use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_tag_simd,
};
use crate::infra::xml::decode_xml_entities;

use super::formats::parse_drawing_color;
use super::types::{RgbColor, ThemeColor};

use ooxml_types::drawings::{DrawingColor, SystemColorVal};

// Re-export the canonical ColorScheme type
pub use ooxml_types::themes::ColorScheme;

// =============================================================================
// Runtime Color Scheme (for theme resolution)
// =============================================================================

/// Runtime color scheme that preserves full `ThemeColor` variants for resolution.
///
/// This is an internal type used by `Theme` for resolving theme color references.
/// It stores the original `ThemeColor` values (which may be `System`, `Rgb`, etc.)
/// rather than just hex strings.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct RuntimeColorScheme {
    /// Scheme name (e.g., "Office")
    pub name: String,

    /// Dark 1 - Primary dark color (usually black for text)
    pub dk1: Option<ThemeColor>,

    /// Light 1 - Primary light color (usually white for background)
    pub lt1: Option<ThemeColor>,

    /// Dark 2 - Secondary dark color
    pub dk2: Option<ThemeColor>,

    /// Light 2 - Secondary light color
    pub lt2: Option<ThemeColor>,

    /// Accent color 1
    pub accent1: Option<ThemeColor>,

    /// Accent color 2
    pub accent2: Option<ThemeColor>,

    /// Accent color 3
    pub accent3: Option<ThemeColor>,

    /// Accent color 4
    pub accent4: Option<ThemeColor>,

    /// Accent color 5
    pub accent5: Option<ThemeColor>,

    /// Accent color 6
    pub accent6: Option<ThemeColor>,

    /// Hyperlink color
    pub hlink: Option<ThemeColor>,

    /// Followed hyperlink color
    pub fol_hlink: Option<ThemeColor>,
}

impl RuntimeColorScheme {
    /// Parse color scheme from theme XML.
    pub fn parse(xml: &[u8]) -> Self {
        let mut scheme = RuntimeColorScheme::default();

        // Find clrScheme element
        if let Some(clr_start) = find_tag_simd(xml, b"clrScheme", 0) {
            let clr_end = find_closing_tag(xml, b"clrScheme", clr_start).unwrap_or(xml.len());
            let clr_xml = &xml[clr_start..clr_end];

            // Parse scheme name (decode XML entities like &amp; → &)
            if let Some(name_pos) = find_attr_simd(clr_xml, b"name=\"", 0) {
                let value_start = name_pos + 6;
                if let Some((start, end)) = extract_quoted_value(clr_xml, value_start) {
                    scheme.name = decode_xml_entities(&clr_xml[start..end]);
                }
            }

            // Parse each color element
            scheme.dk1 = Self::parse_color_element(clr_xml, b"dk1");
            scheme.lt1 = Self::parse_color_element(clr_xml, b"lt1");
            scheme.dk2 = Self::parse_color_element(clr_xml, b"dk2");
            scheme.lt2 = Self::parse_color_element(clr_xml, b"lt2");
            scheme.accent1 = Self::parse_color_element(clr_xml, b"accent1");
            scheme.accent2 = Self::parse_color_element(clr_xml, b"accent2");
            scheme.accent3 = Self::parse_color_element(clr_xml, b"accent3");
            scheme.accent4 = Self::parse_color_element(clr_xml, b"accent4");
            scheme.accent5 = Self::parse_color_element(clr_xml, b"accent5");
            scheme.accent6 = Self::parse_color_element(clr_xml, b"accent6");
            scheme.hlink = Self::parse_color_element(clr_xml, b"hlink");
            scheme.fol_hlink = Self::parse_color_element(clr_xml, b"folHlink");
        }

        scheme
    }

    /// Parse a single color element (dk1, lt1, accent1, etc.)
    fn parse_color_element(xml: &[u8], tag: &[u8]) -> Option<ThemeColor> {
        let tag_start = find_tag_simd(xml, tag, 0)?;
        let tag_end = find_closing_tag(xml, tag, tag_start).unwrap_or(xml.len());
        let color_xml = &xml[tag_start..tag_end];

        // Try parsing as srgbClr (direct RGB)
        if let Some(srgb_start) = find_tag_simd(color_xml, b"srgbClr", 0) {
            if let Some(val_pos) = find_attr_simd(color_xml, b"val=\"", srgb_start) {
                let value_start = val_pos + 5; // len of b"val=\""
                if let Some((start, end)) = extract_quoted_value(color_xml, value_start) {
                    if let Ok(hex) = std::str::from_utf8(&color_xml[start..end]) {
                        if let Some(rgb) = RgbColor::from_hex(hex) {
                            return Some(ThemeColor::Rgb(rgb));
                        }
                    }
                }
            }
        }

        // Try parsing as sysClr (system color)
        if let Some(sys_start) = find_tag_simd(color_xml, b"sysClr", 0) {
            let mut name = String::new();
            let mut last_color = None;

            // Parse val attribute (system color name)
            if let Some(val_pos) = find_attr_simd(color_xml, b"val=\"", sys_start) {
                let value_start = val_pos + 5;
                if let Some((start, end)) = extract_quoted_value(color_xml, value_start) {
                    if let Ok(val) = std::str::from_utf8(&color_xml[start..end]) {
                        name = val.to_string();
                    }
                }
            }

            // Parse lastClr attribute (last known RGB value)
            if let Some(last_pos) = find_attr_simd(color_xml, b"lastClr=\"", sys_start) {
                let value_start = last_pos + 9; // len of b"lastClr=\""
                if let Some((start, end)) = extract_quoted_value(color_xml, value_start) {
                    if let Ok(hex) = std::str::from_utf8(&color_xml[start..end]) {
                        last_color = RgbColor::from_hex(hex);
                    }
                }
            }

            return Some(ThemeColor::System { name, last_color });
        }

        None
    }

    /// Get a color by theme index.
    pub fn get_by_index(&self, index: u8) -> Option<&ThemeColor> {
        match index {
            0 => self.dk1.as_ref(),
            1 => self.lt1.as_ref(),
            2 => self.dk2.as_ref(),
            3 => self.lt2.as_ref(),
            4 => self.accent1.as_ref(),
            5 => self.accent2.as_ref(),
            6 => self.accent3.as_ref(),
            7 => self.accent4.as_ref(),
            8 => self.accent5.as_ref(),
            9 => self.accent6.as_ref(),
            10 => self.hlink.as_ref(),
            11 => self.fol_hlink.as_ref(),
            _ => None,
        }
    }

    /// Convert to a canonical `ColorScheme` by resolving all colors to `DrawingColor` values.
    pub fn to_canonical(&self) -> ColorScheme {
        ColorScheme {
            name: self.name.clone(),
            dk1: Self::to_drawing_color(&self.dk1),
            lt1: Self::to_drawing_color(&self.lt1),
            dk2: Self::to_drawing_color(&self.dk2),
            lt2: Self::to_drawing_color(&self.lt2),
            accent1: Self::to_drawing_color(&self.accent1),
            accent2: Self::to_drawing_color(&self.accent2),
            accent3: Self::to_drawing_color(&self.accent3),
            accent4: Self::to_drawing_color(&self.accent4),
            accent5: Self::to_drawing_color(&self.accent5),
            accent6: Self::to_drawing_color(&self.accent6),
            hlink: Self::to_drawing_color(&self.hlink),
            fol_hlink: Self::to_drawing_color(&self.fol_hlink),
            ext_lst: None,
        }
    }

    /// Convert an `Option<ThemeColor>` to a `DrawingColor`.
    fn to_drawing_color(color: &Option<ThemeColor>) -> DrawingColor {
        match color {
            Some(ThemeColor::Rgb(rgb)) => DrawingColor::SrgbClr {
                val: rgb.to_hex(),
                transforms: vec![],
            },
            Some(ThemeColor::System { name, last_color }) => DrawingColor::SysClr {
                val: SystemColorVal::from_ooxml(name),
                last_clr: last_color.map(|c| c.to_hex()),
                transforms: vec![],
            },
            _ => DrawingColor::SrgbClr {
                val: String::new(),
                transforms: vec![],
            },
        }
    }
}

pub fn parse_color_scheme_canonical(xml: &[u8]) -> ColorScheme {
    let mut scheme = ColorScheme::office_default();

    let Some(clr_start) = find_tag_simd(xml, b"clrScheme", 0) else {
        return scheme;
    };
    let clr_end = find_closing_tag(xml, b"clrScheme", clr_start).unwrap_or(xml.len());
    let clr_xml = &xml[clr_start..clr_end];

    if let Some(name_pos) = find_attr_simd(clr_xml, b"name=\"", 0) {
        let value_start = name_pos + 6;
        if let Some((start, end)) = extract_quoted_value(clr_xml, value_start) {
            scheme.name = decode_xml_entities(&clr_xml[start..end]);
        }
    }

    for (index, tag) in [
        (0, b"dk1".as_slice()),
        (1, b"lt1".as_slice()),
        (2, b"dk2".as_slice()),
        (3, b"lt2".as_slice()),
        (4, b"accent1".as_slice()),
        (5, b"accent2".as_slice()),
        (6, b"accent3".as_slice()),
        (7, b"accent4".as_slice()),
        (8, b"accent5".as_slice()),
        (9, b"accent6".as_slice()),
        (10, b"hlink".as_slice()),
        (11, b"folHlink".as_slice()),
    ] {
        if let Some(color) = parse_slot_drawing_color(clr_xml, tag) {
            scheme.set_by_index(index, color);
        }
    }

    scheme
}

fn parse_slot_drawing_color(xml: &[u8], tag: &[u8]) -> Option<DrawingColor> {
    let tag_start = find_tag_simd(xml, tag, 0)?;
    let tag_end = find_closing_tag(xml, tag, tag_start).unwrap_or(xml.len());
    parse_drawing_color(&xml[tag_start..tag_end])
}

#[cfg(test)]
mod tests {
    use super::super::types::{RgbColor, ThemeColor};
    use super::*;

    #[test]
    fn test_color_scheme_get_by_index() {
        use ooxml_types::themes::ColorScheme;

        // Test canonical ColorScheme (DrawingColor fields, resolved via resolve_hex)
        let scheme = ColorScheme::office_default();
        assert_eq!(scheme.resolve_hex(0).as_deref(), Some("000000"));
        assert_eq!(scheme.resolve_hex(1).as_deref(), Some("FFFFFF"));
        assert_eq!(scheme.resolve_hex(4).as_deref(), Some("4472C4"));
        assert_eq!(scheme.resolve_hex(12), None); // Out of range

        // Test runtime color scheme (ThemeColor variants)
        let mut runtime = RuntimeColorScheme::default();
        runtime.dk1 = Some(ThemeColor::Rgb(RgbColor::new(0, 0, 0)));
        runtime.lt1 = Some(ThemeColor::Rgb(RgbColor::new(255, 255, 255)));
        runtime.accent1 = Some(ThemeColor::Rgb(RgbColor::new(68, 114, 196)));

        assert!(runtime.get_by_index(0).is_some());
        assert!(runtime.get_by_index(1).is_some());
        assert!(runtime.get_by_index(4).is_some());
        assert!(runtime.get_by_index(2).is_none()); // dk2 not set
        assert!(runtime.get_by_index(12).is_none()); // Out of range
    }

    #[test]
    fn test_runtime_color_scheme_index_mapping_all_slots() {
        let mut runtime = RuntimeColorScheme::default();
        runtime.dk1 = Some(ThemeColor::Rgb(RgbColor::new(0, 0, 0)));
        runtime.lt1 = Some(ThemeColor::Rgb(RgbColor::new(1, 1, 1)));
        runtime.dk2 = Some(ThemeColor::Rgb(RgbColor::new(2, 2, 2)));
        runtime.lt2 = Some(ThemeColor::Rgb(RgbColor::new(3, 3, 3)));
        runtime.accent1 = Some(ThemeColor::Rgb(RgbColor::new(4, 4, 4)));
        runtime.accent2 = Some(ThemeColor::Rgb(RgbColor::new(5, 5, 5)));
        runtime.accent3 = Some(ThemeColor::Rgb(RgbColor::new(6, 6, 6)));
        runtime.accent4 = Some(ThemeColor::Rgb(RgbColor::new(7, 7, 7)));
        runtime.accent5 = Some(ThemeColor::Rgb(RgbColor::new(8, 8, 8)));
        runtime.accent6 = Some(ThemeColor::Rgb(RgbColor::new(9, 9, 9)));
        runtime.hlink = Some(ThemeColor::Rgb(RgbColor::new(10, 10, 10)));
        runtime.fol_hlink = Some(ThemeColor::Rgb(RgbColor::new(11, 11, 11)));

        for index in 0..=11 {
            assert!(
                runtime.get_by_index(index).is_some(),
                "missing index {index}"
            );
        }
        assert!(runtime.get_by_index(12).is_none());
    }

    #[test]
    fn test_runtime_color_scheme_parse_decodes_name_and_preserves_variants() {
        let xml = br#"
        <a:clrScheme name="A&amp;B">
            <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
            <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
        </a:clrScheme>
        "#;

        let runtime = RuntimeColorScheme::parse(xml);
        assert_eq!(runtime.name, "A&B");
        assert!(matches!(&runtime.dk1, Some(ThemeColor::System { .. })));
        assert!(matches!(&runtime.accent1, Some(ThemeColor::Rgb(_))));
    }

    #[test]
    fn test_runtime_color_scheme_to_canonical_maps_supported_colors_and_fallbacks() {
        use ooxml_types::drawings::DrawingColor;

        let mut runtime = RuntimeColorScheme::default();
        runtime.name = "Runtime".to_string();
        runtime.dk1 = Some(ThemeColor::Rgb(RgbColor::new(0x44, 0x72, 0xC4)));
        runtime.lt1 = Some(ThemeColor::System {
            name: "window".to_string(),
            last_color: Some(RgbColor::new(0xFF, 0xFF, 0xFF)),
        });
        runtime.dk2 = Some(ThemeColor::Indexed(2));

        let canonical = runtime.to_canonical();
        assert_eq!(canonical.name, "Runtime");
        assert!(matches!(
            &canonical.dk1,
            DrawingColor::SrgbClr { val, .. } if val == "4472C4"
        ));
        assert!(matches!(
            &canonical.lt1,
            DrawingColor::SysClr { last_clr, .. } if last_clr.as_deref() == Some("FFFFFF")
        ));
        assert!(matches!(
            &canonical.dk2,
            DrawingColor::SrgbClr { val, .. } if val.is_empty()
        ));
    }
}
