//! Theme Writer for XLSX files
//!
//! This module provides writing of Office theme definitions (xl/theme/theme1.xml).
//! Themes define the visual appearance of workbooks including color schemes, fonts,
//! and format schemes.
//!
//! # Theme Structure
//!
//! A theme contains:
//!
//! - **Color Scheme** (`clrScheme`): 12 named colors used throughout the document
//!   - dk1, lt1: Dark and light text/background colors
//!   - dk2, lt2: Secondary dark and light colors
//!   - accent1-6: Six accent colors
//!   - hlink, folHlink: Hyperlink and followed hyperlink colors
//!
//! - **Font Scheme** (`fontScheme`): Major (headings) and minor (body) font definitions
//!   - latin: Latin script font (e.g., "Calibri Light")
//!   - ea: East Asian script font
//!   - cs: Complex script font
//!
//! - **Format Scheme** (`fmtScheme`): Fill, line, and effect styles
//!
//! # Example
//!
//! ```ignore
//! use xlsx_parser::write::ThemeWriter;
//!
//! // Use default Office theme
//! let theme = ThemeWriter::default_office_theme();
//! let xml = theme.to_xml();
//!
//! // Or customize
//! let mut theme = ThemeWriter::new();
//! theme.set_color(ThemeColorIndex::Accent1, "4472C4")
//!      .set_major_font("Arial")
//!      .set_minor_font("Calibri");
//! let xml = theme.to_xml();
//! ```

use crate::write::xml_writer::XmlWriter;

// Re-export canonical theme types from ooxml_types
use ooxml_types::drawings::DrawingColor;
pub use ooxml_types::themes::{
    ColorScheme, FontCollection, FontScheme, FormatScheme, ScriptFont, ThemeColorIndex,
    ThemeFontDef,
};

/// RGB color as hex string (RRGGBB format, 6 characters).
pub type RgbHexColor = String;

/// DrawingML namespace URI
const DRAWINGML_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const REL_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

mod color;
mod defaults;
mod effects;
mod fill;
mod fonts;
mod formats;
mod from_domain;
mod line;
mod three_d;

use defaults::default_format_scheme;

// ============================================================================
// ColorScheme convenience methods for ThemeColorIndex
// ============================================================================

/// Extension trait adding `ThemeColorIndex`-based get/set to `ColorScheme`.
pub trait ColorSchemeExt {
    /// Get a color by `ThemeColorIndex`.
    fn get(&self, index: ThemeColorIndex) -> &DrawingColor;
    /// Set a color by `ThemeColorIndex`.
    fn set(&mut self, index: ThemeColorIndex, color: DrawingColor);
    /// Get the resolved hex color string for a `ThemeColorIndex`.
    fn get_hex(&self, index: ThemeColorIndex) -> Option<String>;
    /// Set a color by `ThemeColorIndex` using a hex string, wrapping it as `DrawingColor::SrgbClr`.
    fn set_hex(&mut self, index: ThemeColorIndex, hex: &str);
}

impl ColorSchemeExt for ColorScheme {
    fn get(&self, index: ThemeColorIndex) -> &DrawingColor {
        // ThemeColorIndex is now in spec order (Dark1=0, Light1=1, etc.),
        // matching get_by_index directly.
        self.get_by_index(index.as_index())
            .expect("ThemeColorIndex always valid (0-11)")
    }

    fn set(&mut self, index: ThemeColorIndex, color: DrawingColor) {
        self.set_by_index(index.as_index(), color);
    }

    fn get_hex(&self, index: ThemeColorIndex) -> Option<String> {
        self.resolve_hex(index.as_index())
    }

    fn set_hex(&mut self, index: ThemeColorIndex, hex: &str) {
        self.set_by_index(
            index.as_index(),
            DrawingColor::SrgbClr {
                val: hex.to_string(),
                transforms: vec![],
            },
        );
    }
}

// ============================================================================
// ThemeWriter
// ============================================================================

/// Writer for Excel theme files (xl/theme/theme1.xml).
///
/// Generates complete theme XML with color scheme, font scheme, and format scheme.
///
/// # Example
///
/// ```ignore
/// use xlsx_parser::write::ThemeWriter;
///
/// // Create default Office theme
/// let theme = ThemeWriter::default_office_theme();
/// let xml = theme.to_xml();
///
/// // Customize theme
/// let mut theme = ThemeWriter::new();
/// theme.set_name("Custom Theme")
///      .set_color(ThemeColorIndex::Accent1, "FF0000")
///      .set_major_font("Arial");
/// ```
#[derive(Debug, Clone)]
pub struct ThemeWriter {
    /// Theme name
    name: String,
    /// Color scheme
    color_scheme: ColorScheme,
    /// Font scheme
    font_scheme: FontScheme,
    /// Format scheme (fill, line, effect, and background fill styles)
    format_scheme: FormatScheme,
    /// Current theme-owned inner XML for `<a:objectDefaults>`.
    /// `None` means absent; `Some(vec![])` means present empty/self-closing.
    object_defaults_xml: Option<Vec<u8>>,
    /// Current theme-owned inner XML for `<a:extraClrSchemeLst>`.
    /// `None` means absent; `Some(vec![])` means present empty/self-closing.
    extra_clr_scheme_lst_xml: Option<Vec<u8>>,
    /// Current theme-owned raw XML of `<a:extLst>`, including the root element.
    ext_lst_xml: Option<Vec<u8>>,
    /// Current theme-owned raw XML of `<a:custClrLst>`, including the root element.
    cust_clr_lst_xml: Option<Vec<u8>>,
    /// Current order of modeled root siblings after `themeElements`.
    /// `None` uses generated-theme defaults; `Some(vec![])` means no siblings.
    root_sibling_order: Option<Vec<String>>,
}

impl Default for ThemeWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl ThemeWriter {
    /// Create a new theme writer with minimal defaults.
    pub fn new() -> Self {
        Self {
            name: "Office Theme".to_string(),
            color_scheme: ColorScheme::default(),
            font_scheme: FontScheme::default(),
            format_scheme: default_format_scheme(),
            object_defaults_xml: None,
            extra_clr_scheme_lst_xml: None,
            ext_lst_xml: None,
            cust_clr_lst_xml: None,
            root_sibling_order: None,
        }
    }

    /// Create a theme writer with default Office theme settings.
    ///
    /// This creates a complete Office-compatible theme with all standard
    /// colors and fonts.
    pub fn default_office_theme() -> Self {
        Self {
            name: "Office Theme".to_string(),
            color_scheme: ColorScheme::office_default(),
            font_scheme: FontScheme::office_default(),
            format_scheme: default_format_scheme(),
            object_defaults_xml: None,
            extra_clr_scheme_lst_xml: None,
            ext_lst_xml: None,
            cust_clr_lst_xml: None,
            root_sibling_order: None,
        }
    }

    /// Set the theme name.
    pub fn set_name(&mut self, name: &str) -> &mut Self {
        self.name = name.to_string();
        self
    }

    /// Set the entire color scheme.
    pub fn set_color_scheme(&mut self, scheme: ColorScheme) -> &mut Self {
        self.color_scheme = scheme;
        self
    }

    /// Set an individual theme color by index.
    ///
    /// # Arguments
    /// * `index` - The theme color index (0-11)
    /// * `color` - The RGB hex color value (6 characters, e.g., "4472C4")
    pub fn set_color(&mut self, index: ThemeColorIndex, color: &str) -> &mut Self {
        self.color_scheme.set_hex(index, color);
        self
    }

    /// Get mutable access to the color scheme for direct DrawingColor manipulation.
    pub fn color_scheme_mut(&mut self) -> &mut ColorScheme {
        &mut self.color_scheme
    }

    /// Set the entire font scheme.
    pub fn set_font_scheme(&mut self, scheme: FontScheme) -> &mut Self {
        self.font_scheme = scheme;
        self
    }

    /// Set the entire format scheme.
    pub fn set_format_scheme(&mut self, scheme: FormatScheme) -> &mut Self {
        self.format_scheme = scheme;
        self
    }

    /// Set current inner XML for `<a:objectDefaults>`.
    /// Pass an empty vector to emit a present empty/self-closing element.
    pub fn set_object_defaults_xml(&mut self, xml: Vec<u8>) -> &mut Self {
        self.object_defaults_xml = Some(xml);
        self
    }

    /// Set current inner XML for `<a:extraClrSchemeLst>`.
    /// Pass an empty vector to emit a present empty/self-closing element.
    pub fn set_extra_clr_scheme_lst_xml(&mut self, xml: Vec<u8>) -> &mut Self {
        self.extra_clr_scheme_lst_xml = Some(xml);
        self
    }

    /// Set raw XML for <a:extLst> (full element including tags).
    pub fn set_ext_lst_xml(&mut self, xml: Vec<u8>) -> &mut Self {
        self.ext_lst_xml = Some(xml);
        self
    }

    pub fn set_cust_clr_lst_xml(&mut self, xml: Vec<u8>) -> &mut Self {
        self.cust_clr_lst_xml = Some(xml);
        self
    }

    pub fn set_root_sibling_order(&mut self, order: Vec<String>) -> &mut Self {
        self.root_sibling_order = Some(order);
        self
    }

    /// Set the major (heading) font typeface.
    pub fn set_major_font(&mut self, typeface: &str) -> &mut Self {
        self.font_scheme.major_font.latin.typeface = typeface.to_string();
        self
    }

    /// Set the minor (body) font typeface.
    pub fn set_minor_font(&mut self, typeface: &str) -> &mut Self {
        self.font_scheme.minor_font.latin.typeface = typeface.to_string();
        self
    }

    /// Generate the theme XML content.
    ///
    /// Returns the complete xl/theme/theme1.xml content as bytes.
    pub fn to_xml(&self) -> Vec<u8> {
        let mut xml = XmlWriter::new();

        // XML declaration
        xml.write_declaration();

        // Root theme element with namespace
        xml.start_element_ns("a", "theme")
            .attr("xmlns:a", DRAWINGML_NS)
            .attr("xmlns:r", REL_NS)
            .attr("name", &self.name)
            .end_attrs();

        // Theme elements container
        xml.start_element_ns("a", "themeElements").end_attrs();

        // Write color scheme
        color::write_color_scheme(&mut xml, &self.color_scheme);

        // Write font scheme
        fonts::write_font_scheme(&mut xml, &self.font_scheme);

        // Write format scheme
        formats::write_format_scheme(&mut xml, &self.format_scheme);

        xml.end_element_ns("a", "themeElements");

        if let Some(order) = &self.root_sibling_order {
            for sibling in order {
                self.write_root_sibling(&mut xml, sibling);
            }
        } else {
            self.write_root_sibling(&mut xml, "objectDefaults");
            self.write_root_sibling(&mut xml, "extraClrSchemeLst");
            self.write_root_sibling(&mut xml, "custClrLst");
            self.write_root_sibling(&mut xml, "extLst");
        }

        xml.end_element_ns("a", "theme");

        xml.finish()
    }

    fn write_root_sibling(&self, xml: &mut XmlWriter, sibling: &str) {
        match sibling {
            "objectDefaults" => match &self.object_defaults_xml {
                Some(content) if !content.is_empty() => {
                    xml.start_element_ns("a", "objectDefaults").end_attrs();
                    xml.raw(content);
                    xml.end_element_ns("a", "objectDefaults");
                }
                Some(_) | None if self.root_sibling_order.is_none() => {
                    xml.start_element_ns("a", "objectDefaults").self_close();
                }
                Some(_) => {
                    xml.start_element_ns("a", "objectDefaults").self_close();
                }
                None => {}
            },
            "extraClrSchemeLst" => match &self.extra_clr_scheme_lst_xml {
                Some(content) if !content.is_empty() => {
                    xml.start_element_ns("a", "extraClrSchemeLst").end_attrs();
                    xml.raw(content);
                    xml.end_element_ns("a", "extraClrSchemeLst");
                }
                Some(_) | None if self.root_sibling_order.is_none() => {
                    xml.start_element_ns("a", "extraClrSchemeLst").self_close();
                }
                Some(_) => {
                    xml.start_element_ns("a", "extraClrSchemeLst").self_close();
                }
                None => {}
            },
            "custClrLst" => {
                if let Some(cust) = &self.cust_clr_lst_xml {
                    xml.raw(cust);
                }
            }
            "extLst" => {
                if let Some(ext_lst) = &self.ext_lst_xml {
                    xml.raw(ext_lst);
                }
            }
            _ => {}
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests;

// ============================================================================
// Domain bridge: domain_types::ThemeData → ThemeWriter → XML bytes
// ============================================================================

pub use from_domain::theme_writer_from_domain;
