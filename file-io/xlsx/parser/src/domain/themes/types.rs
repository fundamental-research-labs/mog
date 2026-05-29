//! Core theme types for Excel themes.
//!
//! This module contains the fundamental types used throughout the theme system:
//! - `RgbColor`: ARGB color representation with HSL conversion utilities
//! - `ThemeColor`: Color reference types (RGB, Theme index, Indexed palette, System)
//! - `Theme`: The main theme container struct
//!
//! UTF-8 boundary guard: every `&s[n..]` / `&s[..n]` in this file slices
//! hex-color strings and XML tag fragments at byte offsets produced
//! by ASCII-only syntax (`#`, `<`, `>`, hex digits). Char-boundary
//! by construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_tag_simd,
};
use crate::infra::xml::decode_xml_entities;

use super::colors::RuntimeColorScheme;
use super::fonts::parse_font_scheme;
use super::formats::parse_format_scheme_canonical;

// Re-export canonical types used by Theme
pub use ooxml_types::themes::{ColorScheme, FontScheme, FormatScheme};

// =============================================================================
// RGB Color
// =============================================================================

/// RGB color with alpha channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize)]
pub struct RgbColor {
    /// Alpha channel (0-255, 255 = fully opaque)
    pub a: u8,
    /// Red channel (0-255)
    pub r: u8,
    /// Green channel (0-255)
    pub g: u8,
    /// Blue channel (0-255)
    pub b: u8,
}

impl RgbColor {
    /// Create a new RGB color with full opacity.
    #[inline]
    pub fn new(r: u8, g: u8, b: u8) -> Self {
        Self { a: 255, r, g, b }
    }

    /// Create a new ARGB color.
    #[inline]
    pub fn new_argb(a: u8, r: u8, g: u8, b: u8) -> Self {
        Self { a, r, g, b }
    }

    /// Parse from a hex string (6 or 8 characters).
    pub fn from_hex(hex: &str) -> Option<Self> {
        let hex = hex.trim();
        match hex.len() {
            6 => {
                let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
                let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
                let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
                Some(Self::new(r, g, b))
            }
            8 => {
                let a = u8::from_str_radix(&hex[0..2], 16).ok()?;
                let r = u8::from_str_radix(&hex[2..4], 16).ok()?;
                let g = u8::from_str_radix(&hex[4..6], 16).ok()?;
                let b = u8::from_str_radix(&hex[6..8], 16).ok()?;
                Some(Self::new_argb(a, r, g, b))
            }
            _ => None,
        }
    }

    /// Convert to a 6-character hex string (RGB only).
    pub fn to_hex(&self) -> String {
        format!("{:02X}{:02X}{:02X}", self.r, self.g, self.b)
    }

    /// Convert to an 8-character hex string (ARGB).
    pub fn to_hex_argb(&self) -> String {
        format!("{:02X}{:02X}{:02X}{:02X}", self.a, self.r, self.g, self.b)
    }

    /// Convert RGB to HSL color space.
    ///
    /// Returns (H, S, L) where:
    /// - H is in range [0.0, 360.0)
    /// - S is in range [0.0, 1.0]
    /// - L is in range [0.0, 1.0]
    pub(crate) fn to_hsl(&self) -> (f64, f64, f64) {
        let r = self.r as f64 / 255.0;
        let g = self.g as f64 / 255.0;
        let b = self.b as f64 / 255.0;

        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let delta = max - min;

        // Lightness
        let l = (max + min) / 2.0;

        if delta == 0.0 {
            // Achromatic (gray)
            return (0.0, 0.0, l);
        }

        // Saturation
        let s = if l < 0.5 {
            delta / (max + min)
        } else {
            delta / (2.0 - max - min)
        };

        // Hue
        let h = if (max - r).abs() < f64::EPSILON {
            let mut h = (g - b) / delta;
            if g < b {
                h += 6.0;
            }
            h * 60.0
        } else if (max - g).abs() < f64::EPSILON {
            ((b - r) / delta + 2.0) * 60.0
        } else {
            ((r - g) / delta + 4.0) * 60.0
        };

        (h, s, l)
    }

    /// Convert HSL to RGB color space.
    ///
    /// # Arguments
    /// * `h` - Hue in range [0.0, 360.0)
    /// * `s` - Saturation in range [0.0, 1.0]
    /// * `l` - Lightness in range [0.0, 1.0]
    /// * `a` - Alpha channel to preserve
    pub(crate) fn from_hsl(h: f64, s: f64, l: f64, a: u8) -> Self {
        if s == 0.0 {
            // Achromatic (gray)
            let gray = (l * 255.0).round().clamp(0.0, 255.0) as u8;
            return Self::new_argb(a, gray, gray, gray);
        }

        let q = if l < 0.5 {
            l * (1.0 + s)
        } else {
            l + s - l * s
        };
        let p = 2.0 * l - q;

        let hue_to_rgb = |p: f64, q: f64, mut t: f64| -> f64 {
            if t < 0.0 {
                t += 1.0;
            }
            if t > 1.0 {
                t -= 1.0;
            }
            if t < 1.0 / 6.0 {
                return p + (q - p) * 6.0 * t;
            }
            if t < 1.0 / 2.0 {
                return q;
            }
            if t < 2.0 / 3.0 {
                return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
            }
            p
        };

        let h_normalized = h / 360.0;
        let r = (hue_to_rgb(p, q, h_normalized + 1.0 / 3.0) * 255.0)
            .round()
            .clamp(0.0, 255.0) as u8;
        let g = (hue_to_rgb(p, q, h_normalized) * 255.0)
            .round()
            .clamp(0.0, 255.0) as u8;
        let b = (hue_to_rgb(p, q, h_normalized - 1.0 / 3.0) * 255.0)
            .round()
            .clamp(0.0, 255.0) as u8;

        Self::new_argb(a, r, g, b)
    }

    /// Apply a tint to this color per ECMA-376 specification.
    ///
    /// Tint values range from -1.0 (fully dark) to 1.0 (fully light).
    /// The calculation is done in HSL color space:
    /// - If tint < 0: L' = L * (1 + tint)
    /// - If tint > 0: L' = L * (1 - tint) + tint
    ///
    /// This ensures proper color blending that matches Excel's behavior.
    pub fn apply_tint(&self, tint: f64) -> Self {
        let tint = tint.clamp(-1.0, 1.0);

        if tint == 0.0 {
            return *self;
        }

        // Convert to HSL
        let (h, s, l) = self.to_hsl();

        // Apply tint to lightness per ECMA-376 spec
        let new_l = if tint < 0.0 {
            // Darken: L' = L * (1 + tint)
            l * (1.0 + tint)
        } else {
            // Lighten: L' = L * (1 - tint) + tint
            l * (1.0 - tint) + tint
        };

        // Convert back to RGB
        Self::from_hsl(h, s, new_l.clamp(0.0, 1.0), self.a)
    }
}

// =============================================================================
// Theme Color
// =============================================================================

/// Represents a color reference in Excel themes and cell formatting.
///
/// Colors can be specified as direct RGB values, theme indices, or legacy
/// indexed palette references. Tints can modify the base color.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub enum ThemeColor {
    /// Direct ARGB color value (8 hex digits, e.g., "FF4472C4")
    /// or RGB color value (6 hex digits, e.g., "4472C4")
    Rgb(RgbColor),

    /// Reference to a theme color by index (0-11)
    /// - 0: dk1 (dark 1)
    /// - 1: lt1 (light 1)
    /// - 2: dk2 (dark 2)
    /// - 3: lt2 (light 2)
    /// - 4-9: accent1-6
    /// - 10: hlink
    /// - 11: folHlink
    Theme {
        /// Theme color index (0-11)
        index: u8,
        /// Optional tint value (-1.0 to 1.0, where negative = darker, positive = lighter)
        tint: Option<f64>,
    },

    /// Legacy indexed palette color (0-63)
    /// Used for backward compatibility with older Excel formats.
    Indexed(u8),

    /// System color reference (e.g., "windowText", "window")
    System {
        /// System color name
        name: String,
        /// Last known RGB value
        last_color: Option<RgbColor>,
    },
}

impl Default for ThemeColor {
    fn default() -> Self {
        ThemeColor::Rgb(RgbColor::default())
    }
}

// =============================================================================
// Theme Struct
// =============================================================================

/// Complete Excel theme definition.
///
/// Contains all theme elements: color scheme, font scheme, and format scheme.
/// The `color_scheme` field holds the canonical `ColorScheme` (hex strings) from
/// `ooxml_types`, while `runtime_colors` preserves the full `ThemeColor` variants
/// needed for color resolution.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct Theme {
    /// Theme name (e.g., "Office Theme")
    pub name: String,

    /// Canonical color scheme (hex strings, shared with write side)
    pub color_scheme: ColorScheme,

    /// Font scheme for major and minor fonts (canonical type from ooxml_types)
    pub font_scheme: FontScheme,

    /// Format scheme for fills, lines, and effects
    pub format_scheme: FormatScheme,

    /// Runtime color scheme preserving full ThemeColor variants for resolution
    pub(crate) runtime_colors: RuntimeColorScheme,

    /// Current theme-owned inner XML for `<a:objectDefaults>`.
    /// `None` means absent; `Some(vec![])` means present empty/self-closing.
    pub object_defaults_xml: Option<Vec<u8>>,
    /// Current theme-owned inner XML for `<a:extraClrSchemeLst>`.
    /// `None` means absent; `Some(vec![])` means present empty/self-closing.
    pub extra_clr_scheme_lst_xml: Option<Vec<u8>>,
    /// Current theme-owned raw XML of `<a:extLst>`, including the root element.
    pub ext_lst_xml: Option<Vec<u8>>,
    /// Current theme-owned raw XML of `<a:custClrLst>`, including the root element.
    pub cust_clr_lst_xml: Option<Vec<u8>>,
    /// Current order of modeled root siblings after `themeElements`.
    /// `None` uses generated-theme defaults; `Some(vec![])` means no siblings.
    pub root_sibling_order: Option<Vec<String>>,
}

impl Theme {
    /// Parse theme XML content.
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the theme XML file (xl/theme/theme1.xml)
    ///
    /// # Returns
    /// Parsed Theme struct
    pub fn parse(xml: &[u8]) -> Self {
        let mut theme = Theme::default();

        // Parse theme name (decode XML entities so we don't double-escape on write)
        if let Some(name_pos) = find_attr_simd(xml, b"name=\"", 0) {
            let value_start = name_pos + 6; // len of b"name=\""
            if let Some((start, end)) = extract_quoted_value(xml, value_start) {
                theme.name = decode_xml_entities(&xml[start..end]);
            }
        }

        // Find themeElements
        if let Some(elements_start) = find_tag_simd(xml, b"themeElements", 0) {
            let elements_end =
                find_closing_tag(xml, b"themeElements", elements_start).unwrap_or(xml.len());
            let elements_xml = &xml[elements_start..elements_end];

            // Parse runtime color scheme (preserves ThemeColor variants)
            theme.runtime_colors = RuntimeColorScheme::parse(elements_xml);

            // Also produce the canonical color scheme, preserving every
            // DrawingML color choice variant and transform where supported.
            theme.color_scheme = super::colors::parse_color_scheme_canonical(elements_xml);

            // Parse font scheme (using canonical type directly)
            theme.font_scheme = parse_font_scheme(elements_xml);

            // Parse format scheme (canonical types directly)
            theme.format_scheme = parse_format_scheme_canonical(elements_xml);

            // Find the end of </a:themeElements> to search for sibling elements after it
            let elements_close_pos =
                find_closing_tag(xml, b"themeElements", elements_start).unwrap_or(xml.len());
            // Skip past the closing tag ">" to get the search start for siblings
            let after_elements =
                if let Some(gt) = xml[elements_close_pos..].iter().position(|&b| b == b'>') {
                    elements_close_pos + gt + 1
                } else {
                    xml.len()
                };

            let root_siblings = collect_theme_root_siblings(xml, after_elements);
            for sibling in &root_siblings {
                match sibling.name.as_str() {
                    "objectDefaults" => {
                        theme.object_defaults_xml = Some(
                            sibling
                                .inner_range()
                                .map_or_else(Vec::new, |range| xml[range].to_vec()),
                        );
                    }
                    "extraClrSchemeLst" => {
                        theme.extra_clr_scheme_lst_xml = Some(
                            sibling
                                .inner_range()
                                .map_or_else(Vec::new, |range| xml[range].to_vec()),
                        );
                    }
                    "custClrLst" => {
                        theme.cust_clr_lst_xml = Some(xml[sibling.full_range()].to_vec());
                    }
                    "extLst" => {
                        theme.ext_lst_xml = Some(xml[sibling.full_range()].to_vec());
                    }
                    _ => {}
                }
            }
            theme.root_sibling_order = Some(
                root_siblings
                    .into_iter()
                    .map(|sibling| sibling.name)
                    .collect(),
            );
        }

        theme
    }

    /// Get a theme color by index.
    ///
    /// # Arguments
    /// * `index` - Theme color index (0-11)
    ///
    /// # Returns
    /// The theme color if the index is valid
    pub fn get_color(&self, index: u8) -> Option<&ThemeColor> {
        self.runtime_colors.get_by_index(index)
    }

    /// Resolve a ThemeColor reference to an RGB value.
    ///
    /// # Arguments
    /// * `color` - The color reference to resolve
    ///
    /// # Returns
    /// The resolved RGB color
    pub fn resolve_color(&self, color: &ThemeColor) -> Option<RgbColor> {
        match color {
            ThemeColor::Rgb(rgb) => Some(*rgb),
            ThemeColor::Theme { index, tint } => {
                let theme_color = self.get_color(*index)?;
                let rgb = match theme_color {
                    ThemeColor::Rgb(rgb) => *rgb,
                    ThemeColor::System { last_color, .. } => (*last_color)?,
                    _ => return None,
                };
                Some(if let Some(t) = tint {
                    rgb.apply_tint(*t)
                } else {
                    rgb
                })
            }
            ThemeColor::System { last_color, .. } => *last_color,
            ThemeColor::Indexed(idx) => Self::indexed_color(*idx),
        }
    }

    /// Get an indexed palette color (legacy Excel colors).
    pub(crate) fn indexed_color(index: u8) -> Option<RgbColor> {
        // Standard Excel indexed colors (0-63)
        // Only the most commonly used colors are defined here
        let rgb = match index {
            0 => (0, 0, 0),        // Black
            1 => (255, 255, 255),  // White
            2 => (255, 0, 0),      // Red
            3 => (0, 255, 0),      // Bright Green
            4 => (0, 0, 255),      // Blue
            5 => (255, 255, 0),    // Yellow
            6 => (255, 0, 255),    // Magenta
            7 => (0, 255, 255),    // Cyan
            8 => (0, 0, 0),        // Black (duplicate)
            9 => (255, 255, 255),  // White (duplicate)
            10 => (255, 0, 0),     // Red (duplicate)
            11 => (0, 255, 0),     // Bright Green (duplicate)
            12 => (0, 0, 255),     // Blue (duplicate)
            13 => (255, 255, 0),   // Yellow (duplicate)
            14 => (255, 0, 255),   // Magenta (duplicate)
            15 => (0, 255, 255),   // Cyan (duplicate)
            16 => (128, 0, 0),     // Dark Red
            17 => (0, 128, 0),     // Green
            18 => (0, 0, 128),     // Dark Blue
            19 => (128, 128, 0),   // Dark Yellow / Olive
            20 => (128, 0, 128),   // Purple
            21 => (0, 128, 128),   // Teal
            22 => (192, 192, 192), // Silver
            23 => (128, 128, 128), // Gray
            24 => (153, 153, 255), // Periwinkle
            25 => (153, 51, 102),  // Plum
            26 => (255, 255, 204), // Ivory
            27 => (204, 255, 255), // Light Turquoise
            28 => (102, 0, 102),   // Dark Purple
            29 => (255, 128, 128), // Coral
            30 => (0, 102, 204),   // Ocean Blue
            31 => (204, 204, 255), // Ice Blue
            64 => (0, 0, 0),       // System foreground (black)
            65 => (255, 255, 255), // System background (white)
            _ => return None,
        };
        Some(RgbColor::new(rgb.0, rgb.1, rgb.2))
    }
}

#[derive(Debug)]
struct ThemeRootSibling {
    name: String,
    start: usize,
    open_end: usize,
    close_start: Option<usize>,
    end: usize,
}

impl ThemeRootSibling {
    fn full_range(&self) -> std::ops::Range<usize> {
        self.start..self.end
    }

    fn inner_range(&self) -> Option<std::ops::Range<usize>> {
        self.close_start
            .map(|close_start| self.open_end..close_start)
    }
}

#[derive(Debug)]
struct ElementStart<'a> {
    gt_pos: usize,
    local_name: &'a [u8],
    is_closing: bool,
    is_special: bool,
    is_self_closing: bool,
}

fn collect_theme_root_siblings(xml: &[u8], after_elements: usize) -> Vec<ThemeRootSibling> {
    let mut siblings = Vec::new();
    let mut pos = after_elements;

    while let Some(rel_lt) = xml[pos..].iter().position(|&b| b == b'<') {
        let start = pos + rel_lt;
        let Some(element) = parse_element_start(xml, start) else {
            break;
        };

        if element.is_special {
            pos = element.gt_pos + 1;
            continue;
        }

        if element.is_closing {
            break;
        }

        let Some(name) = theme_root_sibling_name(element.local_name) else {
            pos = element_end(
                xml,
                element.local_name,
                start,
                element.gt_pos,
                element.is_self_closing,
            )
            .unwrap_or(element.gt_pos + 1);
            continue;
        };

        let open_end = element.gt_pos + 1;
        if element.is_self_closing {
            siblings.push(ThemeRootSibling {
                name: name.to_string(),
                start,
                open_end,
                close_start: None,
                end: open_end,
            });
            pos = open_end;
        } else if let Some(close_start) = find_closing_tag(xml, element.local_name, start) {
            if let Some(close_gt_rel) = xml[close_start..].iter().position(|&b| b == b'>') {
                let end = close_start + close_gt_rel + 1;
                siblings.push(ThemeRootSibling {
                    name: name.to_string(),
                    start,
                    open_end,
                    close_start: Some(close_start),
                    end,
                });
                pos = end;
            } else {
                break;
            }
        } else {
            pos = open_end;
        }
    }

    siblings
}

fn element_end(
    xml: &[u8],
    local_name: &[u8],
    start: usize,
    gt_pos: usize,
    is_self_closing: bool,
) -> Option<usize> {
    if is_self_closing {
        return Some(gt_pos + 1);
    }
    let close_start = find_closing_tag(xml, local_name, start)?;
    let close_gt = xml[close_start..].iter().position(|&b| b == b'>')?;
    Some(close_start + close_gt + 1)
}

fn parse_element_start(xml: &[u8], start: usize) -> Option<ElementStart<'_>> {
    if xml.get(start) != Some(&b'<') {
        return None;
    }

    let gt_pos = start + xml[start..].iter().position(|&b| b == b'>')?;
    let mut name_start = start + 1;
    let first = *xml.get(name_start)?;
    let is_closing = first == b'/';
    let is_special = first == b'!' || first == b'?';
    if is_closing {
        name_start += 1;
    }
    if is_special {
        return Some(ElementStart {
            gt_pos,
            local_name: &[],
            is_closing,
            is_special,
            is_self_closing: false,
        });
    }

    while name_start < gt_pos && is_xml_space(xml[name_start]) {
        name_start += 1;
    }
    let mut name_end = name_start;
    while name_end < gt_pos
        && !is_xml_space(xml[name_end])
        && xml[name_end] != b'/'
        && xml[name_end] != b'>'
    {
        name_end += 1;
    }

    let local_name = local_name(&xml[name_start..name_end]);
    let is_self_closing = xml[start..gt_pos]
        .iter()
        .rev()
        .find(|&&b| !is_xml_space(b))
        .is_some_and(|&b| b == b'/');

    Some(ElementStart {
        gt_pos,
        local_name,
        is_closing,
        is_special,
        is_self_closing,
    })
}

fn local_name(name: &[u8]) -> &[u8] {
    name.iter()
        .rposition(|&b| b == b':')
        .map_or(name, |colon| &name[colon + 1..])
}

fn theme_root_sibling_name(local_name: &[u8]) -> Option<&'static str> {
    match local_name {
        b"objectDefaults" => Some("objectDefaults"),
        b"extraClrSchemeLst" => Some("extraClrSchemeLst"),
        b"custClrLst" => Some("custClrLst"),
        b"extLst" => Some("extLst"),
        _ => None,
    }
}

fn is_xml_space(byte: u8) -> bool {
    matches!(byte, b' ' | b'\n' | b'\r' | b'\t')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rgb_color_new() {
        let color = RgbColor::new(255, 128, 64);
        assert_eq!(color.a, 255);
        assert_eq!(color.r, 255);
        assert_eq!(color.g, 128);
        assert_eq!(color.b, 64);
    }

    #[test]
    fn test_rgb_color_new_argb() {
        let color = RgbColor::new_argb(128, 255, 128, 64);
        assert_eq!(color.a, 128);
        assert_eq!(color.r, 255);
        assert_eq!(color.g, 128);
        assert_eq!(color.b, 64);
    }

    #[test]
    fn test_rgb_color_from_hex_6() {
        let color = RgbColor::from_hex("4472C4").unwrap();
        assert_eq!(color.a, 255);
        assert_eq!(color.r, 0x44);
        assert_eq!(color.g, 0x72);
        assert_eq!(color.b, 0xC4);
    }

    #[test]
    fn test_rgb_color_from_hex_8() {
        let color = RgbColor::from_hex("FF4472C4").unwrap();
        assert_eq!(color.a, 0xFF);
        assert_eq!(color.r, 0x44);
        assert_eq!(color.g, 0x72);
        assert_eq!(color.b, 0xC4);
    }

    #[test]
    fn test_rgb_color_from_hex_invalid() {
        assert!(RgbColor::from_hex("123").is_none());
        assert!(RgbColor::from_hex("12345").is_none());
        assert!(RgbColor::from_hex("GGGGGG").is_none());
    }

    #[test]
    fn test_rgb_color_to_hex() {
        let color = RgbColor::new(0x44, 0x72, 0xC4);
        assert_eq!(color.to_hex(), "4472C4");
    }

    #[test]
    fn test_rgb_color_to_hex_argb() {
        let color = RgbColor::new_argb(0xFF, 0x44, 0x72, 0xC4);
        assert_eq!(color.to_hex_argb(), "FF4472C4");
    }

    #[test]
    fn test_rgb_color_apply_tint_positive() {
        let color = RgbColor::new(128, 128, 128);
        let tinted = color.apply_tint(0.5);
        // Should lighten toward white
        assert!(tinted.r > 128);
        assert!(tinted.g > 128);
        assert!(tinted.b > 128);
    }

    #[test]
    fn test_rgb_color_apply_tint_negative() {
        let color = RgbColor::new(128, 128, 128);
        let tinted = color.apply_tint(-0.5);
        // Should darken
        assert!(tinted.r < 128);
        assert!(tinted.g < 128);
        assert!(tinted.b < 128);
    }

    #[test]
    fn test_rgb_color_apply_tint_zero() {
        let color = RgbColor::new(128, 128, 128);
        let tinted = color.apply_tint(0.0);
        assert_eq!(tinted, color);
    }

    #[test]
    fn test_rgb_to_hsl_red() {
        let color = RgbColor::new(255, 0, 0);
        let (h, s, l) = color.to_hsl();
        assert!((h - 0.0).abs() < 0.01, "Hue should be 0 for red, got {}", h);
        assert!(
            (s - 1.0).abs() < 0.01,
            "Saturation should be 1 for pure red, got {}",
            s
        );
        assert!(
            (l - 0.5).abs() < 0.01,
            "Lightness should be 0.5 for pure red, got {}",
            l
        );
    }

    #[test]
    fn test_rgb_to_hsl_green() {
        let color = RgbColor::new(0, 255, 0);
        let (h, s, l) = color.to_hsl();
        assert!(
            (h - 120.0).abs() < 0.01,
            "Hue should be 120 for green, got {}",
            h
        );
        assert!(
            (s - 1.0).abs() < 0.01,
            "Saturation should be 1 for pure green, got {}",
            s
        );
        assert!(
            (l - 0.5).abs() < 0.01,
            "Lightness should be 0.5 for pure green, got {}",
            l
        );
    }

    #[test]
    fn test_rgb_to_hsl_blue() {
        let color = RgbColor::new(0, 0, 255);
        let (h, s, l) = color.to_hsl();
        assert!(
            (h - 240.0).abs() < 0.01,
            "Hue should be 240 for blue, got {}",
            h
        );
        assert!(
            (s - 1.0).abs() < 0.01,
            "Saturation should be 1 for pure blue, got {}",
            s
        );
        assert!(
            (l - 0.5).abs() < 0.01,
            "Lightness should be 0.5 for pure blue, got {}",
            l
        );
    }

    #[test]
    fn test_rgb_to_hsl_white() {
        let color = RgbColor::new(255, 255, 255);
        let (_h, s, l) = color.to_hsl();
        // For achromatic colors, hue is undefined (we return 0)
        assert!(
            (s - 0.0).abs() < 0.01,
            "Saturation should be 0 for white, got {}",
            s
        );
        assert!(
            (l - 1.0).abs() < 0.01,
            "Lightness should be 1 for white, got {}",
            l
        );
    }

    #[test]
    fn test_rgb_to_hsl_black() {
        let color = RgbColor::new(0, 0, 0);
        let (_h, s, l) = color.to_hsl();
        // For achromatic colors, hue is undefined (we return 0)
        assert!(
            (s - 0.0).abs() < 0.01,
            "Saturation should be 0 for black, got {}",
            s
        );
        assert!(
            (l - 0.0).abs() < 0.01,
            "Lightness should be 0 for black, got {}",
            l
        );
    }

    #[test]
    fn test_rgb_to_hsl_gray() {
        let color = RgbColor::new(128, 128, 128);
        let (_h, s, l) = color.to_hsl();
        assert!(
            (s - 0.0).abs() < 0.01,
            "Saturation should be 0 for gray, got {}",
            s
        );
        assert!(
            (l - 0.502).abs() < 0.01,
            "Lightness should be ~0.5 for mid gray, got {}",
            l
        );
    }

    #[test]
    fn test_hsl_to_rgb_roundtrip() {
        // Test that RGB -> HSL -> RGB preserves the color
        let colors = vec![
            RgbColor::new(255, 0, 0),        // Red
            RgbColor::new(0, 255, 0),        // Green
            RgbColor::new(0, 0, 255),        // Blue
            RgbColor::new(255, 255, 0),      // Yellow
            RgbColor::new(255, 0, 255),      // Magenta
            RgbColor::new(0, 255, 255),      // Cyan
            RgbColor::new(128, 128, 128),    // Gray
            RgbColor::new(0x44, 0x72, 0xC4), // Excel accent color
        ];

        for original in colors {
            let (h, s, l) = original.to_hsl();
            let converted = RgbColor::from_hsl(h, s, l, original.a);
            assert_eq!(converted.r, original.r, "Red mismatch for {:?}", original);
            assert_eq!(converted.g, original.g, "Green mismatch for {:?}", original);
            assert_eq!(converted.b, original.b, "Blue mismatch for {:?}", original);
        }
    }

    #[test]
    fn test_apply_tint_ecma376_darken() {
        // Test ECMA-376 darkening formula: L' = L * (1 + tint)
        // For gray (L=0.5) with tint=-0.5: L' = 0.5 * (1 + (-0.5)) = 0.5 * 0.5 = 0.25
        let color = RgbColor::new(128, 128, 128);
        let tinted = color.apply_tint(-0.5);

        // Gray with L=0.25 should be around RGB(64, 64, 64)
        assert!(
            tinted.r < 80,
            "Darkened red should be < 80, got {}",
            tinted.r
        );
        assert!(
            tinted.g < 80,
            "Darkened green should be < 80, got {}",
            tinted.g
        );
        assert!(
            tinted.b < 80,
            "Darkened blue should be < 80, got {}",
            tinted.b
        );
    }

    #[test]
    fn test_apply_tint_ecma376_lighten() {
        // Test ECMA-376 lightening formula: L' = L * (1 - tint) + tint
        // For gray (L=0.5) with tint=0.5: L' = 0.5 * (1 - 0.5) + 0.5 = 0.5 * 0.5 + 0.5 = 0.75
        let color = RgbColor::new(128, 128, 128);
        let tinted = color.apply_tint(0.5);

        // Gray with L=0.75 should be around RGB(191, 191, 191)
        assert!(
            tinted.r > 180,
            "Lightened red should be > 180, got {}",
            tinted.r
        );
        assert!(
            tinted.g > 180,
            "Lightened green should be > 180, got {}",
            tinted.g
        );
        assert!(
            tinted.b > 180,
            "Lightened blue should be > 180, got {}",
            tinted.b
        );
    }

    #[test]
    fn test_apply_tint_extreme_darken() {
        // tint = -1.0 should make the color black (L' = L * 0 = 0)
        let color = RgbColor::new(255, 128, 64);
        let tinted = color.apply_tint(-1.0);

        assert_eq!(tinted.r, 0, "Full darken should result in black");
        assert_eq!(tinted.g, 0, "Full darken should result in black");
        assert_eq!(tinted.b, 0, "Full darken should result in black");
    }

    #[test]
    fn test_apply_tint_extreme_lighten() {
        // tint = 1.0 should make the color white (L' = L * 0 + 1 = 1)
        let color = RgbColor::new(255, 128, 64);
        let tinted = color.apply_tint(1.0);

        assert_eq!(tinted.r, 255, "Full lighten should result in white");
        assert_eq!(tinted.g, 255, "Full lighten should result in white");
        assert_eq!(tinted.b, 255, "Full lighten should result in white");
    }

    #[test]
    fn test_apply_tint_preserves_hue() {
        // Tint should only affect lightness, not hue or saturation
        let color = RgbColor::new(255, 0, 0); // Pure red
        let tinted = color.apply_tint(0.3);

        // The tinted color should still be reddish (R > G, R > B)
        assert!(
            tinted.r > tinted.g,
            "Red should still be dominant, r={} g={}",
            tinted.r,
            tinted.g
        );
        assert!(
            tinted.r > tinted.b,
            "Red should still be dominant, r={} b={}",
            tinted.r,
            tinted.b
        );
    }

    #[test]
    fn test_apply_tint_preserves_alpha() {
        let color = RgbColor::new_argb(128, 255, 128, 64);
        let tinted = color.apply_tint(0.5);

        assert_eq!(tinted.a, 128, "Alpha channel should be preserved");
    }

    #[test]
    fn test_apply_tint_clamps_out_of_range() {
        let color = RgbColor::new(128, 128, 128);

        // tint > 1.0 should be clamped to 1.0
        let tinted_over = color.apply_tint(2.0);
        let tinted_one = color.apply_tint(1.0);
        assert_eq!(
            tinted_over, tinted_one,
            "tint=2.0 should be clamped to tint=1.0"
        );

        // tint < -1.0 should be clamped to -1.0
        let tinted_under = color.apply_tint(-2.0);
        let tinted_neg_one = color.apply_tint(-1.0);
        assert_eq!(
            tinted_under, tinted_neg_one,
            "tint=-2.0 should be clamped to tint=-1.0"
        );
    }

    #[test]
    fn test_apply_tint_excel_accent_color() {
        // Test with actual Excel accent1 color (4472C4)
        // This is a known value that Excel uses
        let color = RgbColor::from_hex("4472C4").unwrap();

        // Test a common tint value used in Excel (-0.249977111117893)
        let tinted = color.apply_tint(-0.25);

        // The result should be darker
        let (_, _, orig_l) = color.to_hsl();
        let (_, _, new_l) = tinted.to_hsl();
        assert!(new_l < orig_l, "Negative tint should decrease lightness");
    }

    #[test]
    fn test_apply_tint_white_remains_white_on_lighten() {
        // White (L=1.0) with positive tint should remain white
        // L' = 1.0 * (1 - tint) + tint = 1.0 - tint + tint = 1.0
        let color = RgbColor::new(255, 255, 255);
        let tinted = color.apply_tint(0.5);

        assert_eq!(tinted.r, 255, "White should remain white when lightened");
        assert_eq!(tinted.g, 255, "White should remain white when lightened");
        assert_eq!(tinted.b, 255, "White should remain white when lightened");
    }

    #[test]
    fn test_apply_tint_black_lightens_correctly() {
        // Black (L=0.0) with positive tint should become gray
        // L' = 0.0 * (1 - tint) + tint = tint
        let color = RgbColor::new(0, 0, 0);
        let tinted = color.apply_tint(0.5);

        // L'=0.5 for achromatic should give us mid-gray
        assert!(
            tinted.r > 100 && tinted.r < 140,
            "Black with tint=0.5 should be mid-gray, got r={}",
            tinted.r
        );
        assert_eq!(tinted.r, tinted.g, "Should remain achromatic");
        assert_eq!(tinted.g, tinted.b, "Should remain achromatic");
    }

    #[test]
    fn test_parse_empty_theme() {
        let xml = br#"<?xml version="1.0"?><a:theme name="Test"></a:theme>"#;
        let theme = Theme::parse(xml);
        assert_eq!(theme.name, "Test");
    }

    #[test]
    fn test_parse_theme_with_color_scheme() {
        let xml = br#"
        <a:theme name="Office Theme">
            <a:themeElements>
                <a:clrScheme name="Office">
                    <a:dk1><a:srgbClr val="000000"/></a:dk1>
                    <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
                    <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
                </a:clrScheme>
            </a:themeElements>
        </a:theme>
        "#;

        let theme = Theme::parse(xml);
        assert_eq!(theme.name, "Office Theme");
        assert_eq!(theme.color_scheme.name, "Office");

        // Check canonical color scheme (hex strings via resolve_hex)
        assert_eq!(theme.color_scheme.resolve_hex(0).as_deref(), Some("000000"));
        assert_eq!(theme.color_scheme.resolve_hex(1).as_deref(), Some("FFFFFF"));
        assert_eq!(theme.color_scheme.resolve_hex(4).as_deref(), Some("4472C4"));

        // Check runtime colors (ThemeColor variants)
        if let Some(ThemeColor::Rgb(rgb)) = &theme.runtime_colors.dk1 {
            assert_eq!(rgb.r, 0);
            assert_eq!(rgb.g, 0);
            assert_eq!(rgb.b, 0);
        } else {
            panic!("Expected RGB color for dk1");
        }

        if let Some(ThemeColor::Rgb(rgb)) = &theme.runtime_colors.accent1 {
            assert_eq!(rgb.r, 0x44);
            assert_eq!(rgb.g, 0x72);
            assert_eq!(rgb.b, 0xC4);
        } else {
            panic!("Expected RGB color for accent1");
        }
    }

    #[test]
    fn test_parse_system_color() {
        let xml = br#"
        <a:theme name="Test">
            <a:themeElements>
                <a:clrScheme name="Test">
                    <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
                    <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
                </a:clrScheme>
            </a:themeElements>
        </a:theme>
        "#;

        let theme = Theme::parse(xml);

        // Canonical color scheme resolves system colors to hex
        assert_eq!(theme.color_scheme.resolve_hex(0).as_deref(), Some("000000"));
        assert_eq!(theme.color_scheme.resolve_hex(1).as_deref(), Some("FFFFFF"));

        // Runtime colors preserve the system color variant
        if let Some(ThemeColor::System { name, last_color }) = &theme.runtime_colors.dk1 {
            assert_eq!(name, "windowText");
            assert_eq!(last_color.unwrap().r, 0);
            assert_eq!(last_color.unwrap().g, 0);
            assert_eq!(last_color.unwrap().b, 0);
        } else {
            panic!("Expected system color for dk1");
        }
    }

    #[test]
    fn test_theme_resolve_rgb_color() {
        let theme = Theme::default();
        let color = ThemeColor::Rgb(RgbColor::new(128, 128, 128));
        let resolved = theme.resolve_color(&color);
        assert!(resolved.is_some());
        assert_eq!(resolved.unwrap().r, 128);
    }

    #[test]
    fn test_theme_resolve_indexed_color() {
        let theme = Theme::default();
        let color = ThemeColor::Indexed(0); // Black
        let resolved = theme.resolve_color(&color);
        assert!(resolved.is_some());
        assert_eq!(resolved.unwrap().r, 0);
        assert_eq!(resolved.unwrap().g, 0);
        assert_eq!(resolved.unwrap().b, 0);
    }

    #[test]
    fn test_indexed_color_table() {
        // Test standard colors
        assert_eq!(Theme::indexed_color(0), Some(RgbColor::new(0, 0, 0))); // Black
        assert_eq!(Theme::indexed_color(1), Some(RgbColor::new(255, 255, 255))); // White
        assert_eq!(Theme::indexed_color(2), Some(RgbColor::new(255, 0, 0))); // Red
        assert_eq!(Theme::indexed_color(3), Some(RgbColor::new(0, 255, 0))); // Green
        assert_eq!(Theme::indexed_color(4), Some(RgbColor::new(0, 0, 255))); // Blue

        // Test out of range
        assert_eq!(Theme::indexed_color(100), None);
    }

    #[test]
    fn test_parse_theme_name_decodes_xml_entities() {
        let xml = br#"<a:theme name="A&amp;B Theme"><a:themeElements/></a:theme>"#;
        let theme = Theme::parse(xml);
        assert_eq!(theme.name, "A&B Theme");
    }

    #[test]
    fn test_parse_preserves_root_siblings_after_theme_elements() {
        let xml = br#"
        <a:theme name="Test">
            <a:themeElements></a:themeElements>
            <a:objectDefaults><a:spDef><a:spPr/></a:spDef></a:objectDefaults>
            <a:extraClrSchemeLst><a:extraClrScheme name="Extra"/></a:extraClrSchemeLst>
            <a:extLst><a:ext uri="{test}"><a16:creationId id="1"/></a:ext></a:extLst>
        </a:theme>
        "#;

        let theme = Theme::parse(xml);
        assert_eq!(
            theme.object_defaults_xml.as_deref(),
            Some(br#"<a:spDef><a:spPr/></a:spDef>"#.as_slice())
        );
        assert_eq!(
            theme.extra_clr_scheme_lst_xml.as_deref(),
            Some(br#"<a:extraClrScheme name="Extra"/>"#.as_slice())
        );
        assert_eq!(
            theme.ext_lst_xml.as_deref(),
            Some(
                br#"<a:extLst><a:ext uri="{test}"><a16:creationId id="1"/></a:ext></a:extLst>"#
                    .as_slice()
            )
        );
        assert_eq!(
            theme.root_sibling_order.as_deref(),
            Some(
                [
                    "objectDefaults".to_string(),
                    "extraClrSchemeLst".to_string(),
                    "extLst".to_string()
                ]
                .as_slice()
            )
        );
    }

    #[test]
    fn test_parse_preserves_self_closing_root_siblings_as_empty_present() {
        let xml = br#"
        <a:theme name="Test">
            <a:themeElements></a:themeElements>
            <a:objectDefaults/>
            <a:extraClrSchemeLst/>
            <a:custClrLst/>
            <a:extLst/>
        </a:theme>
        "#;

        let theme = Theme::parse(xml);
        assert_eq!(theme.object_defaults_xml.as_deref(), Some(b"".as_slice()));
        assert_eq!(
            theme.extra_clr_scheme_lst_xml.as_deref(),
            Some(b"".as_slice())
        );
        assert_eq!(
            theme.cust_clr_lst_xml.as_deref(),
            Some(br#"<a:custClrLst/>"#.as_slice())
        );
        assert_eq!(
            theme.ext_lst_xml.as_deref(),
            Some(br#"<a:extLst/>"#.as_slice())
        );
        assert_eq!(
            theme.root_sibling_order.as_deref(),
            Some(
                [
                    "objectDefaults".to_string(),
                    "extraClrSchemeLst".to_string(),
                    "custClrLst".to_string(),
                    "extLst".to_string()
                ]
                .as_slice()
            )
        );
    }

    #[test]
    fn test_parse_preserves_explicit_empty_root_siblings_as_empty_present() {
        let xml = br#"
        <a:theme name="Test">
            <a:themeElements></a:themeElements>
            <a:objectDefaults></a:objectDefaults>
            <a:extraClrSchemeLst></a:extraClrSchemeLst>
        </a:theme>
        "#;

        let theme = Theme::parse(xml);
        assert_eq!(theme.object_defaults_xml.as_deref(), Some(b"".as_slice()));
        assert_eq!(
            theme.extra_clr_scheme_lst_xml.as_deref(),
            Some(b"".as_slice())
        );
        assert_eq!(
            theme.root_sibling_order.as_deref(),
            Some(
                [
                    "objectDefaults".to_string(),
                    "extraClrSchemeLst".to_string()
                ]
                .as_slice()
            )
        );
    }

    #[test]
    fn test_parse_root_siblings_ignores_nested_matches_after_theme_elements() {
        let xml = br#"
        <a:theme name="Test">
            <a:themeElements></a:themeElements>
            <a:extLst>
                <a:ext uri="{test}">
                    <a:objectDefaults/>
                    <a:extraClrSchemeLst/>
                    <a:custClrLst/>
                </a:ext>
            </a:extLst>
        </a:theme>
        "#;

        let theme = Theme::parse(xml);
        assert!(theme.object_defaults_xml.is_none());
        assert!(theme.extra_clr_scheme_lst_xml.is_none());
        assert!(theme.cust_clr_lst_xml.is_none());
        assert!(theme.ext_lst_xml.is_some());
        assert_eq!(
            theme.root_sibling_order.as_deref(),
            Some(["extLst".to_string()].as_slice())
        );
    }

    #[test]
    fn test_theme_resolve_system_without_last_color_returns_none() {
        let theme = Theme::default();
        let color = ThemeColor::System {
            name: "windowText".to_string(),
            last_color: None,
        };

        assert_eq!(theme.resolve_color(&color), None);
    }

    #[test]
    fn test_theme_resolve_unset_runtime_color_returns_none() {
        let theme = Theme::default();
        let color = ThemeColor::Theme {
            index: 4,
            tint: None,
        };

        assert_eq!(theme.resolve_color(&color), None);
    }

    #[test]
    fn test_indexed_color_system_entries() {
        assert_eq!(Theme::indexed_color(64), Some(RgbColor::new(0, 0, 0)));
        assert_eq!(Theme::indexed_color(65), Some(RgbColor::new(255, 255, 255)));
        assert_eq!(Theme::indexed_color(66), None);
    }
}
