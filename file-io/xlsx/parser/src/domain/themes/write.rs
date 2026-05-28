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
use ooxml_types::drawings::{
    Backdrop, Bevel, BlurEffect, ColorTransform, DagEffect, DrawingColor, DrawingFill,
    EffectContainer, EffectList, EffectProperties, FillOverlayEffect, Glow, GradientFill,
    GradientStop, InnerShadow, LineDash, LineFill, LineJoin, OuterShadow, Outline, PatternFill,
    PresetShadow, Reflection, RelativeRect, Scene3D, Shape3D, SoftEdge, SolidFill,
};
use ooxml_types::themes::EffectStyleItem;
pub use ooxml_types::themes::{
    ColorScheme, FontCollection, FontScheme, FormatScheme, ScriptFont, ThemeColorIndex,
    ThemeFontDef,
};

/// RGB color as hex string (RRGGBB format, 6 characters).
pub type RgbHexColor = String;

/// DrawingML namespace URI
const DRAWINGML_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";

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
    /// Raw XML content inside <a:objectDefaults>...</a:objectDefaults>
    object_defaults_xml: Option<Vec<u8>>,
    /// Raw XML content inside <a:extraClrSchemeLst>...</a:extraClrSchemeLst>
    extra_clr_scheme_lst_xml: Option<Vec<u8>>,
    /// Raw XML of <a:extLst>...</a:extLst> (full element including tags)
    ext_lst_xml: Option<Vec<u8>>,
}

impl Default for ThemeWriter {
    fn default() -> Self {
        Self::new()
    }
}

/// Build the standard Office default format scheme.
///
/// This matches the hardcoded XML that was previously in `write_format_scheme()`:
/// - 3 solid phClr fills
/// - 3 lines with widths 6350, 12700, 19050 EMU and solid phClr fill
/// - 3 empty effect styles
/// - 3 solid phClr background fills
fn default_format_scheme() -> FormatScheme {
    use ooxml_types::drawings::Emu;
    use ooxml_types::drawings::SchemeColor;

    let ph_clr_fill = || {
        DrawingFill::Solid(SolidFill {
            color: DrawingColor::SchemeClr {
                val: SchemeColor::PhClr,
                transforms: vec![],
            },
        })
    };

    let line_style = |width: Emu| Outline {
        width: Some(width),
        fill: Some(LineFill::Solid(SolidFill {
            color: DrawingColor::SchemeClr {
                val: SchemeColor::PhClr,
                transforms: vec![],
            },
        })),
        dash: None,
        compound: None,
        cap: None,
        head_end: None,
        tail_end: None,
        join: None,
        align: None,
    };

    let empty_effect_style = || EffectStyleItem {
        effect_properties: Some(EffectProperties::EffectList(EffectList::default())),
        scene_3d: None,
        sp_3d: None,
    };

    FormatScheme {
        name: "Office".to_string(),
        fill_style_lst: vec![ph_clr_fill(), ph_clr_fill(), ph_clr_fill()],
        ln_style_lst: vec![line_style(6350), line_style(12700), line_style(19050)],
        effect_style_lst: vec![
            empty_effect_style(),
            empty_effect_style(),
            empty_effect_style(),
        ],
        bg_fill_style_lst: vec![ph_clr_fill(), ph_clr_fill(), ph_clr_fill()],
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

    /// Set raw XML content for <a:objectDefaults> (inner content only).
    pub fn set_object_defaults_xml(&mut self, xml: Vec<u8>) -> &mut Self {
        self.object_defaults_xml = Some(xml);
        self
    }

    /// Set raw XML content for <a:extraClrSchemeLst> (inner content only).
    pub fn set_extra_clr_scheme_lst_xml(&mut self, xml: Vec<u8>) -> &mut Self {
        self.extra_clr_scheme_lst_xml = Some(xml);
        self
    }

    /// Set raw XML for <a:extLst> (full element including tags).
    pub fn set_ext_lst_xml(&mut self, xml: Vec<u8>) -> &mut Self {
        self.ext_lst_xml = Some(xml);
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
            .attr("name", &self.name)
            .end_attrs();

        // Theme elements container
        xml.start_element_ns("a", "themeElements").end_attrs();

        // Write color scheme
        self.write_color_scheme(&mut xml);

        // Write font scheme
        self.write_font_scheme(&mut xml);

        // Write format scheme
        self.write_format_scheme(&mut xml);

        xml.end_element_ns("a", "themeElements");

        // objectDefaults: write content if available, otherwise empty self-closing tag
        match &self.object_defaults_xml {
            Some(content) if !content.is_empty() => {
                xml.start_element_ns("a", "objectDefaults").end_attrs();
                xml.raw(content);
                xml.end_element_ns("a", "objectDefaults");
            }
            _ => {
                xml.start_element_ns("a", "objectDefaults").self_close();
            }
        }

        // extraClrSchemeLst: write content if available, otherwise empty self-closing tag
        match &self.extra_clr_scheme_lst_xml {
            Some(content) if !content.is_empty() => {
                xml.start_element_ns("a", "extraClrSchemeLst").end_attrs();
                xml.raw(content);
                xml.end_element_ns("a", "extraClrSchemeLst");
            }
            _ => {
                xml.start_element_ns("a", "extraClrSchemeLst").self_close();
            }
        }

        // extLst: write full element verbatim if available (includes its own tags)
        if let Some(ref ext_lst) = self.ext_lst_xml {
            xml.raw(ext_lst);
        }

        xml.end_element_ns("a", "theme");

        xml.finish()
    }

    /// Write the color scheme section.
    fn write_color_scheme(&self, xml: &mut XmlWriter) {
        xml.start_element_ns("a", "clrScheme")
            .attr("name", &self.color_scheme.name)
            .end_attrs();

        self.write_slot_color(xml, "dk1", &self.color_scheme.dk1);
        self.write_slot_color(xml, "lt1", &self.color_scheme.lt1);
        self.write_slot_color(xml, "dk2", &self.color_scheme.dk2);
        self.write_slot_color(xml, "lt2", &self.color_scheme.lt2);
        self.write_slot_color(xml, "accent1", &self.color_scheme.accent1);
        self.write_slot_color(xml, "accent2", &self.color_scheme.accent2);
        self.write_slot_color(xml, "accent3", &self.color_scheme.accent3);
        self.write_slot_color(xml, "accent4", &self.color_scheme.accent4);
        self.write_slot_color(xml, "accent5", &self.color_scheme.accent5);
        self.write_slot_color(xml, "accent6", &self.color_scheme.accent6);
        self.write_slot_color(xml, "hlink", &self.color_scheme.hlink);
        self.write_slot_color(xml, "folHlink", &self.color_scheme.fol_hlink);

        xml.end_element_ns("a", "clrScheme");
    }

    /// Write a DrawingColor inside a named slot element (e.g., `<a:dk1>...<a:sysClr .../></a:dk1>`).
    ///
    /// This is used for color scheme slots where the color is wrapped in a named element.
    fn write_slot_color(&self, xml: &mut XmlWriter, slot_name: &str, color: &DrawingColor) {
        xml.start_element_ns("a", slot_name).end_attrs();
        self.write_drawing_color(xml, color);
        xml.end_element_ns("a", slot_name);
    }

    // ========================================================================
    // DrawingColor serializer
    // ========================================================================

    /// Write a `DrawingColor` to XML (ECMA-376 EG_ColorChoice).
    fn write_drawing_color(&self, xml: &mut XmlWriter, color: &DrawingColor) {
        match color {
            DrawingColor::SrgbClr { val, transforms } => {
                if transforms.is_empty() {
                    xml.start_element_ns("a", "srgbClr")
                        .attr("val", val)
                        .self_close();
                } else {
                    xml.start_element_ns("a", "srgbClr")
                        .attr("val", val)
                        .end_attrs();
                    self.write_color_transforms(xml, transforms);
                    xml.end_element_ns("a", "srgbClr");
                }
            }
            DrawingColor::SchemeClr { val, transforms } => {
                if transforms.is_empty() {
                    xml.start_element_ns("a", "schemeClr")
                        .attr("val", val.to_ooxml())
                        .self_close();
                } else {
                    xml.start_element_ns("a", "schemeClr")
                        .attr("val", val.to_ooxml())
                        .end_attrs();
                    self.write_color_transforms(xml, transforms);
                    xml.end_element_ns("a", "schemeClr");
                }
            }
            DrawingColor::SysClr {
                val,
                last_clr,
                transforms,
            } => {
                let elem = xml.start_element_ns("a", "sysClr");
                elem.attr("val", val.to_ooxml());
                if let Some(lc) = last_clr {
                    elem.attr("lastClr", lc);
                }
                if transforms.is_empty() {
                    elem.self_close();
                } else {
                    elem.end_attrs();
                    self.write_color_transforms(xml, transforms);
                    xml.end_element_ns("a", "sysClr");
                }
            }
            DrawingColor::HslClr {
                hue,
                sat,
                lum,
                transforms,
            } => {
                let elem = xml.start_element_ns("a", "hslClr");
                elem.attr("hue", &hue.to_string());
                elem.attr("sat", &sat.to_string());
                elem.attr("lum", &lum.to_string());
                if transforms.is_empty() {
                    elem.self_close();
                } else {
                    elem.end_attrs();
                    self.write_color_transforms(xml, transforms);
                    xml.end_element_ns("a", "hslClr");
                }
            }
            DrawingColor::PrstClr { val, transforms } => {
                if transforms.is_empty() {
                    xml.start_element_ns("a", "prstClr")
                        .attr("val", val.to_ooxml())
                        .self_close();
                } else {
                    xml.start_element_ns("a", "prstClr")
                        .attr("val", val.to_ooxml())
                        .end_attrs();
                    self.write_color_transforms(xml, transforms);
                    xml.end_element_ns("a", "prstClr");
                }
            }
            DrawingColor::ScrgbClr {
                r,
                g,
                b,
                transforms,
            } => {
                let elem = xml.start_element_ns("a", "scrgbClr");
                elem.attr("r", &r.to_string());
                elem.attr("g", &g.to_string());
                elem.attr("b", &b.to_string());
                if transforms.is_empty() {
                    elem.self_close();
                } else {
                    elem.end_attrs();
                    self.write_color_transforms(xml, transforms);
                    xml.end_element_ns("a", "scrgbClr");
                }
            }
        }
    }

    /// Write color transform children.
    fn write_color_transforms(&self, xml: &mut XmlWriter, transforms: &[ColorTransform]) {
        for t in transforms {
            let name = t.to_ooxml_name();
            match t.val() {
                Some(v) => {
                    xml.start_element_ns("a", name)
                        .attr("val", &v.to_string())
                        .self_close();
                }
                None => {
                    // Value-less transforms: comp, inv, gray, gamma, invGamma
                    xml.start_element_ns("a", name).self_close();
                }
            }
        }
    }

    // ========================================================================
    // DrawingFill serializer
    // ========================================================================

    /// Write a `DrawingFill` to XML (ECMA-376 EG_FillProperties).
    fn write_drawing_fill(&self, xml: &mut XmlWriter, fill: &DrawingFill) {
        match fill {
            DrawingFill::NoFill => {
                xml.start_element_ns("a", "noFill").self_close();
            }
            DrawingFill::Solid(s) => {
                xml.start_element_ns("a", "solidFill").end_attrs();
                self.write_drawing_color(xml, &s.color);
                xml.end_element_ns("a", "solidFill");
            }
            DrawingFill::Gradient(g) => {
                self.write_gradient_fill(xml, g);
            }
            DrawingFill::Pattern(p) => {
                self.write_pattern_fill(xml, p);
            }
            DrawingFill::Blip(_) | DrawingFill::Group => {
                // Blip and Group fills are not used in theme format schemes; skip.
            }
        }
    }

    /// Write a gradient fill.
    fn write_gradient_fill(&self, xml: &mut XmlWriter, g: &GradientFill) {
        let elem = xml.start_element_ns("a", "gradFill");
        if let Some(flip) = &g.flip {
            elem.attr("flip", flip.to_ooxml());
        }
        if let Some(rws) = g.rotate_with_shape {
            elem.attr("rotWithShape", if rws { "1" } else { "0" });
        }
        elem.end_attrs();

        // Gradient stop list
        if !g.stops.is_empty() {
            xml.start_element_ns("a", "gsLst").end_attrs();
            for stop in &g.stops {
                self.write_gradient_stop(xml, stop);
            }
            xml.end_element_ns("a", "gsLst");
        }

        // Linear or path shade
        if let Some(lin_ang) = g.lin_ang {
            let elem = xml.start_element_ns("a", "lin");
            elem.attr("ang", &lin_ang.value().to_string());
            if let Some(scaled) = g.lin_scaled {
                elem.attr("scaled", if scaled { "1" } else { "0" });
            }
            elem.self_close();
        } else if let Some(path_type) = &g.path {
            xml.start_element_ns("a", "path")
                .attr("path", path_type.to_ooxml())
                .end_attrs();
            if let Some(rect) = &g.fill_to_rect {
                self.write_relative_rect(xml, "a:fillToRect", rect);
            }
            xml.end_element_ns("a", "path");
        }

        // Tile rect
        if let Some(rect) = &g.tile_rect {
            self.write_relative_rect(xml, "a:tileRect", rect);
        }

        xml.end_element_ns("a", "gradFill");
    }

    /// Write a gradient stop.
    fn write_gradient_stop(&self, xml: &mut XmlWriter, stop: &GradientStop) {
        xml.start_element_ns("a", "gs")
            .attr("pos", &stop.position.value().to_string())
            .end_attrs();
        self.write_drawing_color(xml, &stop.color);
        xml.end_element_ns("a", "gs");
    }

    /// Write a relative rectangle element.
    fn write_relative_rect(&self, xml: &mut XmlWriter, tag: &str, rect: &RelativeRect) {
        // Split "a:fillToRect" -> ("a", "fillToRect")
        let (ns, local) = tag.split_once(':').unwrap_or(("a", tag));
        let elem = xml.start_element_ns(ns, local);
        if let Some(l) = rect.l {
            elem.attr("l", &l.value().to_string());
        }
        if let Some(t) = rect.t {
            elem.attr("t", &t.value().to_string());
        }
        if let Some(r) = rect.r {
            elem.attr("r", &r.value().to_string());
        }
        if let Some(b) = rect.b {
            elem.attr("b", &b.value().to_string());
        }
        elem.self_close();
    }

    /// Write a pattern fill.
    fn write_pattern_fill(&self, xml: &mut XmlWriter, p: &PatternFill) {
        let elem = xml.start_element_ns("a", "pattFill");
        if let Some(prst) = &p.preset {
            elem.attr("prst", prst.to_ooxml());
        }
        elem.end_attrs();

        if let Some(fg) = &p.fg_color {
            xml.start_element_ns("a", "fgClr").end_attrs();
            self.write_drawing_color(xml, fg);
            xml.end_element_ns("a", "fgClr");
        }
        if let Some(bg) = &p.bg_color {
            xml.start_element_ns("a", "bgClr").end_attrs();
            self.write_drawing_color(xml, bg);
            xml.end_element_ns("a", "bgClr");
        }

        xml.end_element_ns("a", "pattFill");
    }

    // ========================================================================
    // Outline (line) serializer
    // ========================================================================

    /// Write an `Outline` to XML (ECMA-376 CT_LineProperties).
    fn write_outline(&self, xml: &mut XmlWriter, ln: &Outline) {
        let elem = xml.start_element_ns("a", "ln");
        if let Some(w) = ln.width {
            elem.attr("w", &w.to_string());
        }
        if let Some(cap) = &ln.cap {
            elem.attr("cap", cap.to_ooxml());
        }
        if let Some(cmpd) = &ln.compound {
            elem.attr("cmpd", cmpd.to_ooxml());
        }
        if let Some(algn) = &ln.align {
            elem.attr("algn", algn.to_ooxml());
        }
        elem.end_attrs();

        // Line fill
        if let Some(fill) = &ln.fill {
            self.write_line_fill(xml, fill);
        }

        // Dash
        if let Some(dash) = &ln.dash {
            self.write_line_dash(xml, dash);
        }

        // Join
        if let Some(join) = &ln.join {
            self.write_line_join(xml, join);
        }

        // Head end
        if let Some(head) = &ln.head_end {
            self.write_line_end(xml, "headEnd", head);
        }

        // Tail end
        if let Some(tail) = &ln.tail_end {
            self.write_line_end(xml, "tailEnd", tail);
        }

        xml.end_element_ns("a", "ln");
    }

    /// Write line fill (EG_LineFillProperties).
    fn write_line_fill(&self, xml: &mut XmlWriter, fill: &LineFill) {
        match fill {
            LineFill::NoFill => {
                xml.start_element_ns("a", "noFill").self_close();
            }
            LineFill::Solid(s) => {
                xml.start_element_ns("a", "solidFill").end_attrs();
                self.write_drawing_color(xml, &s.color);
                xml.end_element_ns("a", "solidFill");
            }
            LineFill::Gradient(g) => {
                self.write_gradient_fill(xml, g);
            }
            LineFill::Pattern(p) => {
                self.write_pattern_fill(xml, p);
            }
        }
    }

    /// Write line dash (preset or custom).
    fn write_line_dash(&self, xml: &mut XmlWriter, dash: &LineDash) {
        match dash {
            LineDash::Preset(style) => {
                xml.start_element_ns("a", "prstDash")
                    .attr("val", style.to_ooxml())
                    .self_close();
            }
            LineDash::Custom(stops) => {
                xml.start_element_ns("a", "custDash").end_attrs();
                for stop in stops {
                    xml.start_element_ns("a", "ds")
                        .attr("d", &stop.d.to_string())
                        .attr("sp", &stop.sp.to_string())
                        .self_close();
                }
                xml.end_element_ns("a", "custDash");
            }
        }
    }

    /// Write line join.
    fn write_line_join(&self, xml: &mut XmlWriter, join: &LineJoin) {
        match join {
            LineJoin::Round => {
                xml.start_element_ns("a", "round").self_close();
            }
            LineJoin::Bevel => {
                xml.start_element_ns("a", "bevel").self_close();
            }
            LineJoin::Miter { limit } => {
                let elem = xml.start_element_ns("a", "miter");
                if let Some(lim) = limit {
                    elem.attr("lim", &lim.to_string());
                }
                elem.self_close();
            }
        }
    }

    /// Write a line end (head or tail arrowhead).
    fn write_line_end(
        &self,
        xml: &mut XmlWriter,
        tag: &str,
        props: &ooxml_types::drawings::LineEndProperties,
    ) {
        let elem = xml.start_element_ns("a", tag);
        if let Some(t) = &props.end_type {
            elem.attr("type", t.to_ooxml());
        }
        if let Some(w) = &props.width {
            elem.attr("w", w.to_ooxml());
        }
        if let Some(len) = &props.length {
            elem.attr("len", len.to_ooxml());
        }
        elem.self_close();
    }

    // ========================================================================
    // Effect serializers
    // ========================================================================

    /// Write an `EffectStyleItem` to XML (CT_EffectStyleItem).
    fn write_effect_style_item(&self, xml: &mut XmlWriter, item: &EffectStyleItem) {
        xml.start_element_ns("a", "effectStyle").end_attrs();

        // Effect properties (required per spec; write empty effectLst if None)
        match &item.effect_properties {
            Some(props) => self.write_effect_properties(xml, props),
            None => {
                xml.start_element_ns("a", "effectLst").self_close();
            }
        }

        // Optional scene3d
        if let Some(scene) = &item.scene_3d {
            self.write_scene_3d(xml, scene);
        }

        // Optional sp3d
        if let Some(sp3d) = &item.sp_3d {
            self.write_shape_3d(xml, sp3d);
        }

        xml.end_element_ns("a", "effectStyle");
    }

    /// Write effect properties (effectLst or effectDag).
    fn write_effect_properties(&self, xml: &mut XmlWriter, props: &EffectProperties) {
        match props {
            EffectProperties::EffectList(list) => {
                self.write_effect_list(xml, list);
            }
            EffectProperties::EffectDag(container) => {
                self.write_effect_container(xml, "effectDag", container);
            }
        }
    }

    /// Write an effect list (CT_EffectList).
    fn write_effect_list(&self, xml: &mut XmlWriter, list: &EffectList) {
        let is_empty = list.blur.is_none()
            && list.fill_overlay.is_none()
            && list.glow.is_none()
            && list.inner_shadow.is_none()
            && list.outer_shadow.is_none()
            && list.preset_shadow.is_none()
            && list.reflection.is_none()
            && list.soft_edge.is_none();

        if is_empty {
            xml.start_element_ns("a", "effectLst").self_close();
            return;
        }

        xml.start_element_ns("a", "effectLst").end_attrs();

        // Write effects in OOXML spec order
        if let Some(blur) = &list.blur {
            self.write_blur(xml, blur);
        }
        if let Some(fo) = &list.fill_overlay {
            self.write_fill_overlay(xml, fo);
        }
        if let Some(glow) = &list.glow {
            self.write_glow(xml, glow);
        }
        if let Some(inner) = &list.inner_shadow {
            self.write_inner_shadow(xml, inner);
        }
        if let Some(outer) = &list.outer_shadow {
            self.write_outer_shadow(xml, outer);
        }
        if let Some(preset) = &list.preset_shadow {
            self.write_preset_shadow(xml, preset);
        }
        if let Some(refl) = &list.reflection {
            self.write_reflection(xml, refl);
        }
        if let Some(se) = &list.soft_edge {
            self.write_soft_edge(xml, se);
        }

        xml.end_element_ns("a", "effectLst");
    }

    /// Write a blur effect.
    fn write_blur(&self, xml: &mut XmlWriter, blur: &BlurEffect) {
        let elem = xml.start_element_ns("a", "blur");
        elem.attr("rad", &blur.rad.value().to_string());
        elem.attr("grow", if blur.grow { "1" } else { "0" });
        elem.self_close();
    }

    /// Write a fill overlay effect.
    fn write_fill_overlay(&self, xml: &mut XmlWriter, fo: &FillOverlayEffect) {
        xml.start_element_ns("a", "fillOverlay")
            .attr("blend", fo.blend.to_ooxml())
            .end_attrs();
        if let Some(fill) = &fo.fill {
            self.write_drawing_fill(xml, fill);
        }
        xml.end_element_ns("a", "fillOverlay");
    }

    /// Write a glow effect.
    fn write_glow(&self, xml: &mut XmlWriter, glow: &Glow) {
        xml.start_element_ns("a", "glow")
            .attr("rad", &glow.rad.value().to_string())
            .end_attrs();
        if let Some(color) = &glow.color {
            self.write_drawing_color(xml, color);
        }
        xml.end_element_ns("a", "glow");
    }

    /// Write an inner shadow effect.
    fn write_inner_shadow(&self, xml: &mut XmlWriter, s: &InnerShadow) {
        xml.start_element_ns("a", "innerShdw")
            .attr("blurRad", &s.blur_rad.value().to_string())
            .attr("dist", &s.dist.value().to_string())
            .attr("dir", &s.dir.value().to_string())
            .end_attrs();
        if let Some(color) = &s.color {
            self.write_drawing_color(xml, color);
        }
        xml.end_element_ns("a", "innerShdw");
    }

    /// Write an outer shadow effect.
    fn write_outer_shadow(&self, xml: &mut XmlWriter, s: &OuterShadow) {
        let elem = xml.start_element_ns("a", "outerShdw");
        // Only emit optional attributes when they differ from XSD defaults
        if s.blur_rad.value() != 0 {
            elem.attr("blurRad", &s.blur_rad.value().to_string());
        }
        if s.dist.value() != 0 {
            elem.attr("dist", &s.dist.value().to_string());
        }
        if s.dir.value() != 0 {
            elem.attr("dir", &s.dir.value().to_string());
        }
        if s.sx.value() != 100_000 {
            elem.attr("sx", &s.sx.value().to_string());
        }
        if s.sy.value() != 100_000 {
            elem.attr("sy", &s.sy.value().to_string());
        }
        if s.kx.value() != 0 {
            elem.attr("kx", &s.kx.value().to_string());
        }
        if s.ky.value() != 0 {
            elem.attr("ky", &s.ky.value().to_string());
        }
        if let Some(algn) = &s.align {
            elem.attr("algn", algn.to_ooxml());
        }
        if !s.rot_with_shape {
            elem.attr("rotWithShape", "0");
        }
        elem.end_attrs();
        if let Some(color) = &s.color {
            self.write_drawing_color(xml, color);
        }
        xml.end_element_ns("a", "outerShdw");
    }

    /// Write a preset shadow effect.
    fn write_preset_shadow(&self, xml: &mut XmlWriter, s: &PresetShadow) {
        xml.start_element_ns("a", "prstShdw")
            .attr("prst", s.preset.to_ooxml())
            .attr("dist", &s.dist.value().to_string())
            .attr("dir", &s.dir.value().to_string())
            .end_attrs();
        if let Some(color) = &s.color {
            self.write_drawing_color(xml, color);
        }
        xml.end_element_ns("a", "prstShdw");
    }

    /// Write a reflection effect.
    fn write_reflection(&self, xml: &mut XmlWriter, r: &Reflection) {
        let elem = xml.start_element_ns("a", "reflection");
        elem.attr("blurRad", &r.blur_rad.value().to_string());
        elem.attr("stA", &r.start_alpha.value().to_string());
        elem.attr("stPos", &r.start_pos.value().to_string());
        elem.attr("endA", &r.end_alpha.value().to_string());
        elem.attr("endPos", &r.end_pos.value().to_string());
        elem.attr("dist", &r.dist.value().to_string());
        elem.attr("dir", &r.dir.value().to_string());
        elem.attr("fadeDir", &r.fade_dir.value().to_string());
        elem.attr("sx", &r.sx.value().to_string());
        elem.attr("sy", &r.sy.value().to_string());
        elem.attr("kx", &r.kx.value().to_string());
        elem.attr("ky", &r.ky.value().to_string());
        if let Some(algn) = &r.align {
            elem.attr("algn", algn.to_ooxml());
        }
        elem.attr("rotWithShape", if r.rot_with_shape { "1" } else { "0" });
        elem.self_close();
    }

    /// Write a soft edge effect.
    fn write_soft_edge(&self, xml: &mut XmlWriter, se: &SoftEdge) {
        xml.start_element_ns("a", "softEdge")
            .attr("rad", &se.rad.value().to_string())
            .self_close();
    }

    /// Write an effect container (effectDag or nested cont).
    fn write_effect_container(&self, xml: &mut XmlWriter, tag: &str, container: &EffectContainer) {
        let elem = xml.start_element_ns("a", tag);
        if let Some(ct) = &container.container_type {
            elem.attr("type", ct.to_ooxml());
        }
        if let Some(name) = &container.name {
            elem.attr("name", name);
        }
        if container.effects.is_empty() {
            elem.self_close();
        } else {
            elem.end_attrs();
            // DAG effects are complex; for now serialize what we can
            for effect in &container.effects {
                self.write_dag_effect(xml, effect);
            }
            xml.end_element_ns("a", tag);
        }
    }

    /// Write a single DAG effect (EG_Effect).
    fn write_dag_effect(&self, xml: &mut XmlWriter, effect: &DagEffect) {
        match effect {
            DagEffect::Container(c) => {
                self.write_effect_container(xml, "cont", c);
            }
            DagEffect::EffectRef(r) => {
                xml.start_element_ns("a", "effect")
                    .attr("ref", &r.ref_token)
                    .self_close();
            }
            DagEffect::Blur(b) => {
                self.write_blur(xml, b);
            }
            DagEffect::Glow(g) => {
                self.write_glow(xml, g);
            }
            DagEffect::InnerShadow(s) => {
                self.write_inner_shadow(xml, s);
            }
            DagEffect::OuterShadow(s) => {
                self.write_outer_shadow(xml, s);
            }
            DagEffect::PresetShadow(s) => {
                self.write_preset_shadow(xml, s);
            }
            DagEffect::Reflection(r) => {
                self.write_reflection(xml, r);
            }
            DagEffect::SoftEdge(se) => {
                self.write_soft_edge(xml, se);
            }
            DagEffect::FillOverlay(fo) => {
                self.write_fill_overlay(xml, fo);
            }
            // Remaining DAG-only effects
            DagEffect::AlphaBiLevel(e) => {
                xml.start_element_ns("a", "alphaBiLevel")
                    .attr("thresh", &e.thresh.value().to_string())
                    .self_close();
            }
            DagEffect::AlphaCeiling(_) => {
                xml.start_element_ns("a", "alphaCeiling").self_close();
            }
            DagEffect::AlphaFloor(_) => {
                xml.start_element_ns("a", "alphaFloor").self_close();
            }
            DagEffect::AlphaInverse(e) => {
                if let Some(color) = &e.color {
                    xml.start_element_ns("a", "alphaInv").end_attrs();
                    self.write_drawing_color(xml, color);
                    xml.end_element_ns("a", "alphaInv");
                } else {
                    xml.start_element_ns("a", "alphaInv").self_close();
                }
            }
            DagEffect::AlphaModulate(e) => {
                xml.start_element_ns("a", "alphaMod").end_attrs();
                self.write_effect_container(xml, "cont", &e.cont);
                xml.end_element_ns("a", "alphaMod");
            }
            DagEffect::AlphaModulateFixed(e) => {
                xml.start_element_ns("a", "alphaModFix")
                    .attr("amt", &e.amt.value().to_string())
                    .self_close();
            }
            DagEffect::AlphaOutset(e) => {
                xml.start_element_ns("a", "alphaOutset")
                    .attr("rad", &e.rad.value().to_string())
                    .self_close();
            }
            DagEffect::AlphaReplace(e) => {
                xml.start_element_ns("a", "alphaRepl")
                    .attr("a", &e.a.value().to_string())
                    .self_close();
            }
            DagEffect::BiLevel(e) => {
                xml.start_element_ns("a", "biLevel")
                    .attr("thresh", &e.thresh.value().to_string())
                    .self_close();
            }
            DagEffect::Blend(e) => {
                xml.start_element_ns("a", "blend")
                    .attr("blend", e.blend.to_ooxml())
                    .end_attrs();
                self.write_effect_container(xml, "cont", &e.cont);
                xml.end_element_ns("a", "blend");
            }
            DagEffect::ColorChange(e) => {
                let elem = xml.start_element_ns("a", "clrChange");
                if let Some(ua) = e.use_a {
                    elem.attr("useA", if ua { "1" } else { "0" });
                }
                elem.end_attrs();
                if let Some(from) = &e.clr_from {
                    xml.start_element_ns("a", "clrFrom").end_attrs();
                    self.write_drawing_color(xml, from);
                    xml.end_element_ns("a", "clrFrom");
                }
                if let Some(to) = &e.clr_to {
                    xml.start_element_ns("a", "clrTo").end_attrs();
                    self.write_drawing_color(xml, to);
                    xml.end_element_ns("a", "clrTo");
                }
                xml.end_element_ns("a", "clrChange");
            }
            DagEffect::ColorReplace(e) => {
                if let Some(color) = &e.color {
                    xml.start_element_ns("a", "clrRepl").end_attrs();
                    self.write_drawing_color(xml, color);
                    xml.end_element_ns("a", "clrRepl");
                } else {
                    xml.start_element_ns("a", "clrRepl").self_close();
                }
            }
            DagEffect::Duotone(e) => {
                xml.start_element_ns("a", "duotone").end_attrs();
                for color in &e.colors {
                    self.write_drawing_color(xml, color);
                }
                xml.end_element_ns("a", "duotone");
            }
            DagEffect::Fill(e) => {
                if let Some(fill) = &e.fill {
                    xml.start_element_ns("a", "fill").end_attrs();
                    self.write_drawing_fill(xml, fill);
                    xml.end_element_ns("a", "fill");
                } else {
                    xml.start_element_ns("a", "fill").self_close();
                }
            }
            DagEffect::Grayscale(_) => {
                xml.start_element_ns("a", "grayscl").self_close();
            }
            DagEffect::Hsl(e) => {
                xml.start_element_ns("a", "hsl")
                    .attr("hue", &e.hue.value().to_string())
                    .attr("sat", &e.sat.value().to_string())
                    .attr("lum", &e.lum.value().to_string())
                    .self_close();
            }
            DagEffect::Luminance(e) => {
                xml.start_element_ns("a", "lum")
                    .attr("bright", &e.bright.value().to_string())
                    .attr("contrast", &e.contrast.value().to_string())
                    .self_close();
            }
            DagEffect::RelativeOffset(e) => {
                xml.start_element_ns("a", "relOff")
                    .attr("tx", &e.tx.value().to_string())
                    .attr("ty", &e.ty.value().to_string())
                    .self_close();
            }
            DagEffect::Tint(e) => {
                xml.start_element_ns("a", "tint")
                    .attr("hue", &e.hue.value().to_string())
                    .attr("amt", &e.amt.value().to_string())
                    .self_close();
            }
            DagEffect::Transform(e) => {
                xml.start_element_ns("a", "xfrm")
                    .attr("sx", &e.sx.value().to_string())
                    .attr("sy", &e.sy.value().to_string())
                    .attr("kx", &e.kx.value().to_string())
                    .attr("ky", &e.ky.value().to_string())
                    .attr("tx", &e.tx.value().to_string())
                    .attr("ty", &e.ty.value().to_string())
                    .self_close();
            }
        }
    }

    // ========================================================================
    // 3D serializers
    // ========================================================================

    /// Write a Scene3D element (CT_Scene3D).
    fn write_scene_3d(&self, xml: &mut XmlWriter, scene: &Scene3D) {
        xml.start_element_ns("a", "scene3d").end_attrs();

        // Camera
        {
            let cam = &scene.camera;
            let elem = xml.start_element_ns("a", "camera");
            elem.attr("prst", cam.prst.to_ooxml());
            if let Some(fov) = cam.fov {
                elem.attr("fov", &fov.value().to_string());
            }
            if let Some(zoom) = cam.zoom {
                elem.attr("zoom", &zoom.to_string());
            }
            if let Some(rot) = &cam.rot {
                elem.end_attrs();
                xml.start_element_ns("a", "rot")
                    .attr("lat", &rot.lat.value().to_string())
                    .attr("lon", &rot.lon.value().to_string())
                    .attr("rev", &rot.rev.value().to_string())
                    .self_close();
                xml.end_element_ns("a", "camera");
            } else {
                elem.self_close();
            }
        }

        // Light rig
        {
            let rig = &scene.light_rig;
            let elem = xml.start_element_ns("a", "lightRig");
            elem.attr("rig", rig.rig.to_ooxml());
            elem.attr("dir", rig.dir.to_ooxml());
            if let Some(rot) = &rig.rot {
                elem.end_attrs();
                xml.start_element_ns("a", "rot")
                    .attr("lat", &rot.lat.value().to_string())
                    .attr("lon", &rot.lon.value().to_string())
                    .attr("rev", &rot.rev.value().to_string())
                    .self_close();
                xml.end_element_ns("a", "lightRig");
            } else {
                elem.self_close();
            }
        }

        // Optional backdrop
        if let Some(backdrop) = &scene.backdrop {
            self.write_backdrop(xml, backdrop);
        }

        xml.end_element_ns("a", "scene3d");
    }

    /// Write a backdrop (CT_Backdrop).
    fn write_backdrop(&self, xml: &mut XmlWriter, backdrop: &Backdrop) {
        xml.start_element_ns("a", "backdrop").end_attrs();

        // Anchor point
        xml.start_element_ns("a", "anchor")
            .attr("x", &backdrop.anchor.x.value().to_string())
            .attr("y", &backdrop.anchor.y.value().to_string())
            .attr("z", &backdrop.anchor.z.value().to_string())
            .self_close();

        // Normal vector
        xml.start_element_ns("a", "norm")
            .attr("dx", &backdrop.norm.x.value().to_string())
            .attr("dy", &backdrop.norm.y.value().to_string())
            .attr("dz", &backdrop.norm.z.value().to_string())
            .self_close();

        // Up vector
        xml.start_element_ns("a", "up")
            .attr("dx", &backdrop.up.x.value().to_string())
            .attr("dy", &backdrop.up.y.value().to_string())
            .attr("dz", &backdrop.up.z.value().to_string())
            .self_close();

        xml.end_element_ns("a", "backdrop");
    }

    /// Write Shape3D properties (CT_Shape3D).
    fn write_shape_3d(&self, xml: &mut XmlWriter, sp3d: &Shape3D) {
        let elem = xml.start_element_ns("a", "sp3d");
        if let Some(eh) = sp3d.extrusion_h {
            elem.attr("extrusionH", &eh.value().to_string());
        }
        if let Some(cw) = sp3d.contour_w {
            elem.attr("contourW", &cw.value().to_string());
        }
        if let Some(mat) = &sp3d.prst_material {
            elem.attr("prstMaterial", mat.to_ooxml());
        }
        if let Some(z) = sp3d.z {
            elem.attr("z", &z.value().to_string());
        }

        let has_children = sp3d.bevel_t.is_some()
            || sp3d.bevel_b.is_some()
            || sp3d.extrusion_clr.is_some()
            || sp3d.contour_clr.is_some();

        if !has_children {
            elem.self_close();
            return;
        }

        elem.end_attrs();

        // Top bevel
        if let Some(bevel) = &sp3d.bevel_t {
            self.write_bevel(xml, "bevelT", bevel);
        }

        // Bottom bevel
        if let Some(bevel) = &sp3d.bevel_b {
            self.write_bevel(xml, "bevelB", bevel);
        }

        // Extrusion color
        if let Some(color) = &sp3d.extrusion_clr {
            xml.start_element_ns("a", "extrusionClr").end_attrs();
            self.write_drawing_color(xml, color);
            xml.end_element_ns("a", "extrusionClr");
        }

        // Contour color
        if let Some(color) = &sp3d.contour_clr {
            xml.start_element_ns("a", "contourClr").end_attrs();
            self.write_drawing_color(xml, color);
            xml.end_element_ns("a", "contourClr");
        }

        xml.end_element_ns("a", "sp3d");
    }

    /// Write a bevel element (CT_Bevel).
    fn write_bevel(&self, xml: &mut XmlWriter, tag: &str, bevel: &Bevel) {
        let elem = xml.start_element_ns("a", tag);
        if let Some(w) = bevel.w {
            elem.attr("w", &w.value().to_string());
        }
        if let Some(h) = bevel.h {
            elem.attr("h", &h.value().to_string());
        }
        if let Some(prst) = &bevel.prst {
            elem.attr("prst", prst.to_ooxml());
        }
        elem.self_close();
    }

    // ========================================================================
    // Font scheme
    // ========================================================================

    /// Write the font scheme section.
    fn write_font_scheme(&self, xml: &mut XmlWriter) {
        xml.start_element_ns("a", "fontScheme")
            .attr("name", &self.font_scheme.name)
            .end_attrs();

        // Major font (headings)
        self.write_font_collection(xml, "majorFont", &self.font_scheme.major_font);

        // Minor font (body)
        self.write_font_collection(xml, "minorFont", &self.font_scheme.minor_font);

        xml.end_element_ns("a", "fontScheme");
    }

    /// Write a font collection (majorFont or minorFont).
    fn write_font_collection(&self, xml: &mut XmlWriter, name: &str, collection: &FontCollection) {
        xml.start_element_ns("a", name).end_attrs();

        // Latin font (required)
        self.write_font_def(xml, "latin", &collection.latin);

        // East Asian font
        self.write_font_def(xml, "ea", &collection.ea);

        // Complex script font
        self.write_font_def(xml, "cs", &collection.cs);

        // Script-specific fonts
        for sf in &collection.script_fonts {
            xml.start_element_ns("a", "font")
                .attr("script", &sf.script)
                .attr("typeface", &sf.typeface)
                .self_close();
        }

        xml.end_element_ns("a", name);
    }

    /// Write a font definition element.
    fn write_font_def(&self, xml: &mut XmlWriter, name: &str, font: &ThemeFontDef) {
        xml.start_element_ns("a", name)
            .attr("typeface", &font.typeface);

        if let Some(ref panose) = font.panose {
            xml.attr("panose", panose);
        }
        if let Some(pitch_family) = font.pitch_family {
            xml.attr("pitchFamily", &pitch_family.to_string());
        }
        if let Some(charset) = font.charset {
            xml.attr("charset", &charset.to_string());
        }

        xml.self_close();
    }

    // ========================================================================
    // Format scheme (top-level)
    // ========================================================================

    /// Write the format scheme section from the `format_scheme` model.
    fn write_format_scheme(&self, xml: &mut XmlWriter) {
        xml.start_element_ns("a", "fmtScheme")
            .attr("name", &self.format_scheme.name)
            .end_attrs();

        // Fill style list
        xml.start_element_ns("a", "fillStyleLst").end_attrs();
        for fill in &self.format_scheme.fill_style_lst {
            self.write_drawing_fill(xml, fill);
        }
        xml.end_element_ns("a", "fillStyleLst");

        // Line style list
        xml.start_element_ns("a", "lnStyleLst").end_attrs();
        for ln in &self.format_scheme.ln_style_lst {
            self.write_outline(xml, ln);
        }
        xml.end_element_ns("a", "lnStyleLst");

        // Effect style list
        xml.start_element_ns("a", "effectStyleLst").end_attrs();
        for item in &self.format_scheme.effect_style_lst {
            self.write_effect_style_item(xml, item);
        }
        xml.end_element_ns("a", "effectStyleLst");

        // Background fill style list
        xml.start_element_ns("a", "bgFillStyleLst").end_attrs();
        for fill in &self.format_scheme.bg_fill_style_lst {
            self.write_drawing_fill(xml, fill);
        }
        xml.end_element_ns("a", "bgFillStyleLst");

        xml.end_element_ns("a", "fmtScheme");
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

/// Build theme XML from a `domain_types::ThemeData`.
pub fn theme_writer_from_domain(theme: &domain_types::ThemeData) -> Vec<u8> {
    use ooxml_types::drawings::{DrawingColor, SystemColorVal};

    let mut tw = ThemeWriter::default_office_theme();

    // Apply theme name from ThemeData (parsed from original file).
    if let Some(ref name) = theme.name {
        tw.set_name(name);
    }

    if let Some(ref color_scheme) = theme.color_scheme {
        tw.set_color_scheme(color_scheme.clone());
    } else {
        for tc in &theme.colors {
            let index = match tc.name.as_str() {
                "dk1" => ThemeColorIndex::Dark1,
                "lt1" => ThemeColorIndex::Light1,
                "dk2" => ThemeColorIndex::Dark2,
                "lt2" => ThemeColorIndex::Light2,
                "accent1" => ThemeColorIndex::Accent1,
                "accent2" => ThemeColorIndex::Accent2,
                "accent3" => ThemeColorIndex::Accent3,
                "accent4" => ThemeColorIndex::Accent4,
                "accent5" => ThemeColorIndex::Accent5,
                "accent6" => ThemeColorIndex::Accent6,
                "hlink" => ThemeColorIndex::Hyperlink,
                "folHlink" => ThemeColorIndex::FollowedHyperlink,
                _ => continue,
            };
            match &tc.source {
                Some(domain_types::ThemeColorSource::SysClr { val, last_clr }) => {
                    let sys_val = SystemColorVal::from_ooxml(val);
                    tw.color_scheme_mut().set(
                        index,
                        DrawingColor::SysClr {
                            val: sys_val,
                            last_clr: Some(last_clr.clone()),
                            transforms: vec![],
                        },
                    );
                }
                _ => {
                    let hex = tc.color.strip_prefix('#').unwrap_or(&tc.color);
                    tw.set_color(index, hex);
                }
            }
        }
    }

    if let Some(ref font_scheme) = theme.font_scheme {
        tw.set_font_scheme(font_scheme.clone());
    } else {
        if let Some(ref major) = theme.major_font {
            tw.set_major_font(major);
        }
        if let Some(ref minor) = theme.minor_font {
            tw.set_minor_font(minor);
        }
    }

    if let Some(ref format_scheme) = theme.format_scheme {
        tw.set_format_scheme(format_scheme.clone());
    }
    if let Some(ref object_defaults_xml) = theme.object_defaults_xml {
        tw.set_object_defaults_xml(object_defaults_xml.clone());
    }
    if let Some(ref extra_clr_scheme_lst_xml) = theme.extra_clr_scheme_lst_xml {
        tw.set_extra_clr_scheme_lst_xml(extra_clr_scheme_lst_xml.clone());
    }
    if let Some(ref ext_lst_xml) = theme.ext_lst_xml {
        tw.set_ext_lst_xml(ext_lst_xml.clone());
    }

    tw.to_xml()
}
