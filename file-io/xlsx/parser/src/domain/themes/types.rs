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

    /// Raw XML content inside <a:objectDefaults>...</a:objectDefaults> (inner content only, no wrapper tags)
    pub object_defaults_xml: Option<Vec<u8>>,
    /// Raw XML content inside <a:extraClrSchemeLst>...</a:extraClrSchemeLst>
    pub extra_clr_scheme_lst_xml: Option<Vec<u8>>,
    /// Raw XML of <a:extLst>...</a:extLst> (full element including tags)
    pub ext_lst_xml: Option<Vec<u8>>,
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

            // Also produce the canonical color scheme (hex strings)
            theme.color_scheme = theme.runtime_colors.to_canonical();

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

            // Extract objectDefaults (inner content only)
            if let Some(od_start) = find_tag_simd(xml, b"objectDefaults", after_elements) {
                // Check if it's a self-closing tag
                let mut is_self_closing = false;
                if let Some(gt_pos) = xml[od_start..].iter().position(|&b| b == b'>') {
                    if gt_pos > 0 && xml[od_start + gt_pos - 1] == b'/' {
                        is_self_closing = true;
                    }
                }
                if !is_self_closing {
                    // Find the end of the opening tag '>'
                    if let Some(gt_offset) = xml[od_start..].iter().position(|&b| b == b'>') {
                        let inner_start = od_start + gt_offset + 1;
                        if let Some(close_pos) = find_closing_tag(xml, b"objectDefaults", od_start)
                        {
                            if close_pos > inner_start {
                                theme.object_defaults_xml =
                                    Some(xml[inner_start..close_pos].to_vec());
                            }
                        }
                    }
                }
            }

            // Extract extraClrSchemeLst (inner content only)
            if let Some(ecsl_start) = find_tag_simd(xml, b"extraClrSchemeLst", after_elements) {
                let mut is_self_closing = false;
                if let Some(gt_pos) = xml[ecsl_start..].iter().position(|&b| b == b'>') {
                    if gt_pos > 0 && xml[ecsl_start + gt_pos - 1] == b'/' {
                        is_self_closing = true;
                    }
                }
                if !is_self_closing {
                    if let Some(gt_offset) = xml[ecsl_start..].iter().position(|&b| b == b'>') {
                        let inner_start = ecsl_start + gt_offset + 1;
                        if let Some(close_pos) =
                            find_closing_tag(xml, b"extraClrSchemeLst", ecsl_start)
                        {
                            if close_pos > inner_start {
                                theme.extra_clr_scheme_lst_xml =
                                    Some(xml[inner_start..close_pos].to_vec());
                            }
                        }
                    }
                }
            }

            // Extract extLst (full element including tags)
            if let Some(ext_start) = find_tag_simd(xml, b"extLst", after_elements) {
                // Check if it's a self-closing tag
                let mut is_self_closing = false;
                if let Some(gt_pos) = xml[ext_start..].iter().position(|&b| b == b'>') {
                    if gt_pos > 0 && xml[ext_start + gt_pos - 1] == b'/' {
                        is_self_closing = true;
                    }
                }
                if is_self_closing {
                    // Include the full self-closing tag
                    if let Some(gt_pos) = xml[ext_start..].iter().position(|&b| b == b'>') {
                        theme.ext_lst_xml = Some(xml[ext_start..ext_start + gt_pos + 1].to_vec());
                    }
                } else if let Some(close_pos) = find_closing_tag(xml, b"extLst", ext_start) {
                    // Include from '<a:extLst' through '</a:extLst>'
                    if let Some(gt_pos) = xml[close_pos..].iter().position(|&b| b == b'>') {
                        theme.ext_lst_xml = Some(xml[ext_start..close_pos + gt_pos + 1].to_vec());
                    }
                }
            }
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
