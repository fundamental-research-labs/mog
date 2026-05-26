//! Rich Text parser for XLSX files.
//!
//! This module parses rich text runs used in cells, comments, and text boxes.
//! Rich text in XLSX allows different formatting (bold, italic, font, color, etc.)
//! to be applied to portions of a single cell's text content.
//!
//! # Rich Text XML Structure
//!
//! Rich text in XLSX is represented using `<r>` (run) elements within an `<si>` (string item)
//! or directly in a cell. Each run can have optional run properties (`<rPr>`) followed by
//! the text content (`<t>`).
//!
//! ## Example XML
//!
//! ```xml
//! <si>
//!   <r>
//!     <rPr>
//!       <b/>                    <!-- Bold -->
//!       <sz val="11"/>          <!-- Font size -->
//!       <color theme="1"/>      <!-- Theme color -->
//!       <rFont val="Calibri"/>  <!-- Font name -->
//!     </rPr>
//!     <t>Bold Text</t>
//!   </r>
//!   <r>
//!     <t> Normal Text</t>
//!   </r>
//! </si>
//! ```
//!
//! # Phonetic Runs
//!
//! For Asian languages (Japanese, Chinese, Korean), phonetic annotations can be
//! included using `<rPh>` (phonetic run) elements with `<t>` text content.
//! These provide pronunciation guides (furigana/ruby text) for characters.
//!
//! ## Phonetic Run Example
//!
//! ```xml
//! <si>
//!   <t>東京</t>
//!   <rPh sb="0" eb="1">
//!     <t>とう</t>
//!   </rPh>
//!   <rPh sb="1" eb="2">
//!     <t>きょう</t>
//!   </rPh>
//!   <phoneticPr fontId="1"/>
//! </si>
//! ```

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{
    decode_xml_entities, parse_bool_attr, parse_bool_attr_with_default, parse_f64_attr,
    parse_string_attr, parse_u8_attr, parse_u32_attr,
};

// ============================================================================
// Color Types
// ============================================================================

/// Represents a color value in XLSX, which can be specified in multiple ways.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Color {
    /// ARGB color value (8 hex digits: AARRGGBB)
    pub rgb: Option<String>,
    /// Theme color index (0-based)
    pub theme: Option<u8>,
    /// Tint value (-1.0 to 1.0, modifies theme color)
    pub tint: Option<f64>,
    /// Indexed color (legacy Excel color palette index)
    pub indexed: Option<u8>,
    /// Auto color flag (system window text/background)
    pub auto: bool,
}

impl Color {
    /// Parse a color from XML element bytes.
    ///
    /// Expects bytes starting with `<color` and ending with `>` or `/>`.
    pub fn parse(xml: &[u8]) -> Self {
        let mut color = Color::default();

        // Parse rgb="AARRGGBB"
        if let Some(rgb) = parse_string_attr(xml, b"rgb=\"") {
            color.rgb = Some(rgb);
        }

        // Parse theme="N"
        if let Some(theme) = parse_u8_attr(xml, b"theme=\"") {
            color.theme = Some(theme);
        }

        // Parse tint="N.N"
        if let Some(tint) = parse_f64_attr(xml, b"tint=\"") {
            color.tint = Some(tint);
        }

        // Parse indexed="N"
        if let Some(indexed) = parse_u8_attr(xml, b"indexed=\"") {
            color.indexed = Some(indexed);
        }

        // Parse auto="1" or auto="true"
        color.auto = parse_bool_attr(xml, b"auto=\"");

        color
    }

    /// Check if this color has any value set.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.rgb.is_none()
            && self.theme.is_none()
            && self.tint.is_none()
            && self.indexed.is_none()
            && !self.auto
    }
}

// ============================================================================
// Vertical Alignment (Subscript/Superscript)
// ============================================================================

/// Vertical text alignment for subscript/superscript.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum VerticalAlign {
    /// Normal baseline alignment
    #[default]
    Baseline,
    /// Superscript (raised)
    Superscript,
    /// Subscript (lowered)
    Subscript,
}

impl VerticalAlign {
    /// Parse from string value.
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "superscript" => VerticalAlign::Superscript,
            "subscript" => VerticalAlign::Subscript,
            _ => VerticalAlign::Baseline,
        }
    }
}

// ============================================================================
// Underline Style
// ============================================================================

/// Underline style for text.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum UnderlineStyle {
    /// No underline
    #[default]
    None,
    /// Single underline
    Single,
    /// Double underline
    Double,
    /// Single accounting underline (extends under entire cell width)
    SingleAccounting,
    /// Double accounting underline
    DoubleAccounting,
}

impl UnderlineStyle {
    /// Parse from string value or presence of `<u/>` tag.
    ///
    /// If `val` is None but tag is present, defaults to Single.
    pub fn from_str(val: Option<&str>) -> Self {
        match val {
            Some("double") => UnderlineStyle::Double,
            Some("singleAccounting") => UnderlineStyle::SingleAccounting,
            Some("doubleAccounting") => UnderlineStyle::DoubleAccounting,
            Some("none") => UnderlineStyle::None,
            Some(_) | None => UnderlineStyle::Single, // Default when <u/> present
        }
    }
}

// ============================================================================
// Font Properties
// ============================================================================

/// Font properties for a text run.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FontProperties {
    /// Font name (e.g., "Calibri", "Arial")
    pub name: Option<String>,
    /// Font size in points
    pub size: Option<f64>,
    /// Font color
    pub color: Option<Color>,
    /// Character set (0 = ANSI, 1 = default, etc.)
    pub charset: Option<u8>,
    /// Font family (1 = Roman, 2 = Swiss, 3 = Modern, etc.)
    pub family: Option<u8>,
    /// Font scheme (major = headings, minor = body text)
    pub scheme: Option<String>,
}

impl FontProperties {
    /// Parse font properties from run properties XML.
    ///
    /// Looks for: `<rFont>`, `<sz>`, `<color>`, `<charset>`, `<family>`, `<scheme>`.
    pub fn parse(xml: &[u8]) -> Self {
        let mut font = FontProperties::default();

        // Parse <rFont val="..."/>
        if let Some(name_start) = find_tag_simd(xml, b"rFont", 0) {
            let name_end = find_gt_simd(xml, name_start).unwrap_or(xml.len());
            if let Some(val) = parse_string_attr(&xml[name_start..name_end], b"val=\"") {
                font.name = Some(val);
            }
        }

        // Parse <sz val="..."/>
        if let Some(sz_start) = find_tag_simd(xml, b"sz", 0) {
            let sz_end = find_gt_simd(xml, sz_start).unwrap_or(xml.len());
            if let Some(val) = parse_f64_attr(&xml[sz_start..sz_end], b"val=\"") {
                font.size = Some(val);
            }
        }

        // Parse <color .../>
        if let Some(color_start) = find_tag_simd(xml, b"color", 0) {
            let color_end = find_gt_simd(xml, color_start).unwrap_or(xml.len());
            let color = Color::parse(&xml[color_start..=color_end]);
            if !color.is_empty() {
                font.color = Some(color);
            }
        }

        // Parse <charset val="..."/>
        if let Some(charset_start) = find_tag_simd(xml, b"charset", 0) {
            let charset_end = find_gt_simd(xml, charset_start).unwrap_or(xml.len());
            if let Some(val) = parse_u8_attr(&xml[charset_start..charset_end], b"val=\"") {
                font.charset = Some(val);
            }
        }

        // Parse <family val="..."/>
        if let Some(family_start) = find_tag_simd(xml, b"family", 0) {
            let family_end = find_gt_simd(xml, family_start).unwrap_or(xml.len());
            if let Some(val) = parse_u8_attr(&xml[family_start..family_end], b"val=\"") {
                font.family = Some(val);
            }
        }

        // Parse <scheme val="..."/>
        if let Some(scheme_start) = find_tag_simd(xml, b"scheme", 0) {
            let scheme_end = find_gt_simd(xml, scheme_start).unwrap_or(xml.len());
            if let Some(val) = parse_string_attr(&xml[scheme_start..scheme_end], b"val=\"") {
                font.scheme = Some(val);
            }
        }

        font
    }
}

// ============================================================================
// Run Properties
// ============================================================================

/// Run properties (rPr) - formatting applied to a text run.
///
/// Contains all formatting attributes that can be applied to a portion of text.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RunProperties {
    /// Bold formatting
    pub bold: bool,
    /// Italic formatting
    pub italic: bool,
    /// Underline style
    pub underline: UnderlineStyle,
    /// Strikethrough formatting
    pub strikethrough: bool,
    /// Vertical alignment (superscript/subscript)
    pub vert_align: VerticalAlign,
    /// Font properties
    pub font: FontProperties,
    /// Outline text effect
    pub outline: bool,
    /// Shadow text effect
    pub shadow: bool,
    /// Condense text (CJK)
    pub condense: bool,
    /// Extend text (CJK)
    pub extend: bool,
}

impl RunProperties {
    /// Parse run properties from `<rPr>...</rPr>` XML bytes.
    pub fn parse(xml: &[u8]) -> Self {
        let mut props = RunProperties::default();

        // Find the rPr element boundaries
        let rpr_start = match find_tag_simd(xml, b"rPr", 0) {
            Some(pos) => pos,
            None => return props, // No rPr found
        };

        let rpr_end = find_closing_tag(xml, b"rPr", rpr_start).unwrap_or(xml.len());
        let rpr_content = &xml[rpr_start..rpr_end];

        // Parse boolean flags: bare <b/> = true, <b val="0"/> = false, <b val="1"/> = true
        props.bold = find_tag_simd(rpr_content, b"b", 0)
            .map(|p| {
                let el_end = find_gt_simd(rpr_content, p)
                    .map(|g| g + 1)
                    .unwrap_or(rpr_content.len());
                parse_bool_attr_with_default(&rpr_content[p..el_end], b"val=\"", true)
            })
            .unwrap_or(false);
        props.italic = find_tag_simd(rpr_content, b"i", 0)
            .map(|p| {
                let el_end = find_gt_simd(rpr_content, p)
                    .map(|g| g + 1)
                    .unwrap_or(rpr_content.len());
                parse_bool_attr_with_default(&rpr_content[p..el_end], b"val=\"", true)
            })
            .unwrap_or(false);
        props.strikethrough = find_tag_simd(rpr_content, b"strike", 0).is_some();
        props.outline = find_tag_simd(rpr_content, b"outline", 0).is_some();
        props.shadow = find_tag_simd(rpr_content, b"shadow", 0).is_some();
        props.condense = find_tag_simd(rpr_content, b"condense", 0).is_some();
        props.extend = find_tag_simd(rpr_content, b"extend", 0).is_some();

        // Parse underline (<u/> or <u val="..."/>)
        if let Some(u_start) = find_tag_simd(rpr_content, b"u", 0) {
            let u_end = find_gt_simd(rpr_content, u_start).unwrap_or(rpr_content.len());
            let u_content = &rpr_content[u_start..=u_end];
            let val = parse_string_attr(u_content, b"val=\"");
            props.underline = UnderlineStyle::from_str(val.as_deref());
        }

        // Parse vertical align (<vertAlign val="..."/>)
        if let Some(va_start) = find_tag_simd(rpr_content, b"vertAlign", 0) {
            let va_end = find_gt_simd(rpr_content, va_start).unwrap_or(rpr_content.len());
            if let Some(val) = parse_string_attr(&rpr_content[va_start..va_end], b"val=\"") {
                props.vert_align = VerticalAlign::from_str(&val);
            }
        }

        // Parse font properties
        props.font = FontProperties::parse(rpr_content);

        props
    }
}

// ============================================================================
// Text Run
// ============================================================================

/// A text run - a portion of text with consistent formatting.
///
/// Rich text is composed of multiple text runs, each with its own formatting.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TextRun {
    /// The text content of this run
    pub text: String,
    /// Optional formatting properties (None = inherit from cell style)
    pub properties: Option<RunProperties>,
}

impl TextRun {
    /// Parse a text run from `<r>...</r>` XML bytes.
    pub fn parse(xml: &[u8]) -> Self {
        let mut run = TextRun::default();

        // Parse run properties if present
        if find_tag_simd(xml, b"rPr", 0).is_some() {
            run.properties = Some(RunProperties::parse(xml));
        }

        // Parse text content from <t>...</t>
        if let Some(t_start) = find_tag_simd(xml, b"t", 0) {
            // Skip past <t> or <t xml:space="preserve">
            let content_start = find_gt_simd(xml, t_start)
                .map(|p| p + 1)
                .unwrap_or(xml.len());

            // Find </t>
            if let Some(t_end) = find_closing_tag(xml, b"t", content_start) {
                if content_start < t_end {
                    let content = &xml[content_start..t_end];
                    run.text = decode_xml_entities(content);
                }
            }
        }

        run
    }

    /// Create a new text run with just text content.
    #[inline]
    pub fn text_only(text: String) -> Self {
        TextRun {
            text,
            properties: None,
        }
    }

    /// Create a new text run with text and properties.
    #[inline]
    pub fn with_properties(text: String, properties: RunProperties) -> Self {
        TextRun {
            text,
            properties: Some(properties),
        }
    }
}

// ============================================================================
// Phonetic Run
// ============================================================================

/// A phonetic run - pronunciation guide for Asian language text.
///
/// Used for furigana (Japanese), pinyin (Chinese), etc.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PhoneticRun {
    /// The phonetic text (pronunciation guide)
    pub text: String,
    /// Start character index (0-based) in the base text
    pub start_index: u32,
    /// End character index (exclusive) in the base text
    pub end_index: u32,
}

impl PhoneticRun {
    /// Parse a phonetic run from `<rPh>...</rPh>` XML bytes.
    pub fn parse(xml: &[u8]) -> Self {
        let mut phonetic = PhoneticRun::default();

        // Parse sb (start base) and eb (end base) attributes
        if let Some(sb) = parse_u32_attr(xml, b"sb=\"") {
            phonetic.start_index = sb;
        }
        if let Some(eb) = parse_u32_attr(xml, b"eb=\"") {
            phonetic.end_index = eb;
        }

        // Parse text content from <t>...</t>
        if let Some(t_start) = find_tag_simd(xml, b"t", 0) {
            let content_start = find_gt_simd(xml, t_start)
                .map(|p| p + 1)
                .unwrap_or(xml.len());
            if let Some(t_end) = find_closing_tag(xml, b"t", content_start) {
                if content_start < t_end {
                    let content = &xml[content_start..t_end];
                    phonetic.text = decode_xml_entities(content);
                }
            }
        }

        phonetic
    }
}

// ============================================================================
// Phonetic Properties
// ============================================================================

/// Phonetic properties - settings for phonetic text display.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PhoneticProperties {
    /// Font ID for phonetic text
    pub font_id: Option<u32>,
    /// Phonetic type (fullwidthKatakana, halfwidthKatakana, Hiragana, noConversion)
    pub phonetic_type: Option<String>,
    /// Alignment (noControl, left, center, distributed)
    pub alignment: Option<String>,
}

impl PhoneticProperties {
    /// Parse phonetic properties from `<phoneticPr .../>` XML bytes.
    pub fn parse(xml: &[u8]) -> Self {
        let mut props = PhoneticProperties::default();

        if let Some(font_id) = parse_u32_attr(xml, b"fontId=\"") {
            props.font_id = Some(font_id);
        }
        if let Some(t) = parse_string_attr(xml, b"type=\"") {
            props.phonetic_type = Some(t);
        }
        if let Some(a) = parse_string_attr(xml, b"alignment=\"") {
            props.alignment = Some(a);
        }

        props
    }
}

// ============================================================================
// Rich Text
// ============================================================================

/// Rich text - a collection of text runs with formatting.
///
/// Represents the complete rich text content of a cell, comment, or text box.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RichText {
    /// The text runs that make up the rich text
    pub runs: Vec<TextRun>,
    /// Optional phonetic runs (for Asian languages)
    pub phonetic_runs: Vec<PhoneticRun>,
    /// Optional phonetic properties
    pub phonetic_properties: Option<PhoneticProperties>,
}

impl RichText {
    /// Parse rich text from `<si>...</si>` or `<is>...</is>` XML bytes.
    ///
    /// Handles both simple text (`<t>text</t>`) and rich text (`<r>...</r>`).
    pub fn parse(xml: &[u8]) -> Self {
        let mut rich_text = RichText::default();

        // Check if this is rich text (has <r> elements) or plain text
        let has_runs = find_tag_simd(xml, b"r", 0)
            .map(|pos| {
                // Make sure it's <r> not <rPh> or other tags starting with 'r'
                pos + 2 < xml.len()
                    && (xml[pos + 2] == b'>' || xml[pos + 2] == b' ' || xml[pos + 2] == b'/')
            })
            .unwrap_or(false);

        if has_runs {
            // Parse rich text runs
            rich_text.parse_runs(xml);
        } else {
            // Plain text - single run with no formatting
            if let Some(text) = Self::parse_plain_text(xml) {
                if !text.is_empty() {
                    rich_text.runs.push(TextRun::text_only(text));
                }
            }
        }

        // Parse phonetic runs
        rich_text.parse_phonetic_runs(xml);

        // Parse phonetic properties
        if let Some(pp_start) = find_tag_simd(xml, b"phoneticPr", 0) {
            let pp_end = find_gt_simd(xml, pp_start).unwrap_or(xml.len());
            rich_text.phonetic_properties =
                Some(PhoneticProperties::parse(&xml[pp_start..=pp_end]));
        }

        rich_text
    }

    /// Parse text runs from XML.
    fn parse_runs(&mut self, xml: &[u8]) {
        let mut pos = 0;

        while let Some(r_start) = find_tag_simd(xml, b"r", pos) {
            // Verify this is <r> not <rPh> or <rPr>
            if r_start + 2 < xml.len() {
                let next_char = xml[r_start + 2];
                if next_char != b'>' && next_char != b' ' && next_char != b'/' {
                    pos = r_start + 2;
                    continue;
                }
            }

            // Find end of this run
            let r_end = find_closing_tag(xml, b"r", r_start).unwrap_or(xml.len());

            if r_start < r_end {
                let run = TextRun::parse(&xml[r_start..r_end]);
                self.runs.push(run);
            }

            pos = r_end + 4; // Skip past </r>
        }
    }

    /// Parse phonetic runs from XML.
    fn parse_phonetic_runs(&mut self, xml: &[u8]) {
        let mut pos = 0;

        while let Some(rph_start) = find_tag_simd(xml, b"rPh", pos) {
            let rph_end = find_closing_tag(xml, b"rPh", rph_start).unwrap_or(xml.len());

            if rph_start < rph_end {
                let phonetic = PhoneticRun::parse(&xml[rph_start..rph_end]);
                self.phonetic_runs.push(phonetic);
            }

            pos = rph_end + 5; // Skip past </rPh>
        }
    }

    /// Parse plain text content from `<t>...</t>`.
    fn parse_plain_text(xml: &[u8]) -> Option<String> {
        let t_start = find_tag_simd(xml, b"t", 0)?;
        let content_start = find_gt_simd(xml, t_start).map(|p| p + 1)?;
        let t_end = find_closing_tag(xml, b"t", content_start)?;

        if content_start < t_end {
            Some(decode_xml_entities(&xml[content_start..t_end]))
        } else {
            Some(String::new())
        }
    }

    /// Get the plain text content (all runs concatenated, formatting stripped).
    #[inline]
    pub fn to_plain_text(&self) -> String {
        let total_len: usize = self.runs.iter().map(|r| r.text.len()).sum();
        let mut result = String::with_capacity(total_len);
        for run in &self.runs {
            result.push_str(&run.text);
        }
        result
    }

    /// Check if this rich text is empty.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.runs.is_empty() || self.runs.iter().all(|r| r.text.is_empty())
    }

    /// Get the number of text runs.
    #[inline]
    pub fn run_count(&self) -> usize {
        self.runs.len()
    }
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // Color tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_color_parse_rgb() {
        let xml = br#"<color rgb="FF0000FF"/>"#;
        let color = Color::parse(xml);
        assert_eq!(color.rgb, Some("FF0000FF".to_string()));
        assert!(color.theme.is_none());
        assert!(!color.is_empty());
    }

    #[test]
    fn test_color_parse_theme() {
        let xml = br#"<color theme="1" tint="-0.25"/>"#;
        let color = Color::parse(xml);
        assert_eq!(color.theme, Some(1));
        assert_eq!(color.tint, Some(-0.25));
    }

    #[test]
    fn test_color_parse_indexed() {
        let xml = br#"<color indexed="64"/>"#;
        let color = Color::parse(xml);
        assert_eq!(color.indexed, Some(64));
    }

    #[test]
    fn test_color_parse_auto() {
        let xml = br#"<color auto="1"/>"#;
        let color = Color::parse(xml);
        assert!(color.auto);
    }

    #[test]
    fn test_color_empty() {
        let color = Color::default();
        assert!(color.is_empty());
    }

    // -------------------------------------------------------------------------
    // VerticalAlign tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_vertical_align_from_str() {
        assert_eq!(
            VerticalAlign::from_str("superscript"),
            VerticalAlign::Superscript
        );
        assert_eq!(
            VerticalAlign::from_str("subscript"),
            VerticalAlign::Subscript
        );
        assert_eq!(VerticalAlign::from_str("baseline"), VerticalAlign::Baseline);
        assert_eq!(VerticalAlign::from_str("unknown"), VerticalAlign::Baseline);
    }

    // -------------------------------------------------------------------------
    // UnderlineStyle tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_underline_style_from_str() {
        assert_eq!(UnderlineStyle::from_str(None), UnderlineStyle::Single);
        assert_eq!(
            UnderlineStyle::from_str(Some("double")),
            UnderlineStyle::Double
        );
        assert_eq!(
            UnderlineStyle::from_str(Some("singleAccounting")),
            UnderlineStyle::SingleAccounting
        );
        assert_eq!(UnderlineStyle::from_str(Some("none")), UnderlineStyle::None);
    }

    // -------------------------------------------------------------------------
    // FontProperties tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_font_properties_parse() {
        let xml = br#"<rPr>
            <rFont val="Arial"/>
            <sz val="12"/>
            <color rgb="FF000000"/>
            <family val="2"/>
            <charset val="0"/>
            <scheme val="minor"/>
        </rPr>"#;

        let font = FontProperties::parse(xml);
        assert_eq!(font.name, Some("Arial".to_string()));
        assert_eq!(font.size, Some(12.0));
        assert!(font.color.is_some());
        assert_eq!(
            font.color.as_ref().unwrap().rgb,
            Some("FF000000".to_string())
        );
        assert_eq!(font.family, Some(2));
        assert_eq!(font.charset, Some(0));
        assert_eq!(font.scheme, Some("minor".to_string()));
    }

    // -------------------------------------------------------------------------
    // RunProperties tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_run_properties_parse_bold_italic() {
        let xml = br#"<rPr><b/><i/></rPr>"#;
        let props = RunProperties::parse(xml);
        assert!(props.bold);
        assert!(props.italic);
        assert!(!props.strikethrough);
    }

    #[test]
    fn test_run_properties_parse_underline() {
        let xml = br#"<rPr><u/></rPr>"#;
        let props = RunProperties::parse(xml);
        assert_eq!(props.underline, UnderlineStyle::Single);

        let xml = br#"<rPr><u val="double"/></rPr>"#;
        let props = RunProperties::parse(xml);
        assert_eq!(props.underline, UnderlineStyle::Double);
    }

    #[test]
    fn test_run_properties_parse_strikethrough() {
        let xml = br#"<rPr><strike/></rPr>"#;
        let props = RunProperties::parse(xml);
        assert!(props.strikethrough);
    }

    #[test]
    fn test_run_properties_parse_vert_align() {
        let xml = br#"<rPr><vertAlign val="superscript"/></rPr>"#;
        let props = RunProperties::parse(xml);
        assert_eq!(props.vert_align, VerticalAlign::Superscript);

        let xml = br#"<rPr><vertAlign val="subscript"/></rPr>"#;
        let props = RunProperties::parse(xml);
        assert_eq!(props.vert_align, VerticalAlign::Subscript);
    }

    #[test]
    fn test_run_properties_parse_complete() {
        let xml = br#"<rPr>
            <b/>
            <i/>
            <u val="double"/>
            <strike/>
            <outline/>
            <shadow/>
            <vertAlign val="superscript"/>
            <rFont val="Calibri"/>
            <sz val="11"/>
        </rPr>"#;

        let props = RunProperties::parse(xml);
        assert!(props.bold);
        assert!(props.italic);
        assert_eq!(props.underline, UnderlineStyle::Double);
        assert!(props.strikethrough);
        assert!(props.outline);
        assert!(props.shadow);
        assert_eq!(props.vert_align, VerticalAlign::Superscript);
        assert_eq!(props.font.name, Some("Calibri".to_string()));
        assert_eq!(props.font.size, Some(11.0));
    }

    // -------------------------------------------------------------------------
    // TextRun tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_text_run_parse_simple() {
        let xml = br#"<r><t>Hello World</t></r>"#;
        let run = TextRun::parse(xml);
        assert_eq!(run.text, "Hello World");
        assert!(run.properties.is_none());
    }

    #[test]
    fn test_text_run_parse_with_properties() {
        let xml = br#"<r><rPr><b/><sz val="14"/></rPr><t>Bold Text</t></r>"#;
        let run = TextRun::parse(xml);
        assert_eq!(run.text, "Bold Text");
        assert!(run.properties.is_some());
        let props = run.properties.unwrap();
        assert!(props.bold);
        assert_eq!(props.font.size, Some(14.0));
    }

    #[test]
    fn test_text_run_parse_with_entities() {
        let xml = br#"<r><t>A &amp; B &lt; C</t></r>"#;
        let run = TextRun::parse(xml);
        assert_eq!(run.text, "A & B < C");
    }

    #[test]
    fn test_text_run_parse_preserved_space() {
        let xml = br#"<r><t xml:space="preserve">  spaces  </t></r>"#;
        let run = TextRun::parse(xml);
        assert_eq!(run.text, "  spaces  ");
    }

    // -------------------------------------------------------------------------
    // PhoneticRun tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_phonetic_run_parse() {
        let xml = r#"<rPh sb="0" eb="2"><t>とうきょう</t></rPh>"#.as_bytes();
        let phonetic = PhoneticRun::parse(xml);
        assert_eq!(phonetic.text, "とうきょう");
        assert_eq!(phonetic.start_index, 0);
        assert_eq!(phonetic.end_index, 2);
    }

    // -------------------------------------------------------------------------
    // PhoneticProperties tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_phonetic_properties_parse() {
        let xml = br#"<phoneticPr fontId="1" type="fullwidthKatakana" alignment="left"/>"#;
        let props = PhoneticProperties::parse(xml);
        assert_eq!(props.font_id, Some(1));
        assert_eq!(props.phonetic_type, Some("fullwidthKatakana".to_string()));
        assert_eq!(props.alignment, Some("left".to_string()));
    }

    // -------------------------------------------------------------------------
    // RichText tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_rich_text_parse_plain() {
        let xml = br#"<si><t>Plain text</t></si>"#;
        let rich_text = RichText::parse(xml);
        assert_eq!(rich_text.runs.len(), 1);
        assert_eq!(rich_text.runs[0].text, "Plain text");
        assert!(rich_text.runs[0].properties.is_none());
    }

    #[test]
    fn test_rich_text_parse_multiple_runs() {
        let xml = br#"<si>
            <r><rPr><b/></rPr><t>Bold</t></r>
            <r><t> and </t></r>
            <r><rPr><i/></rPr><t>Italic</t></r>
        </si>"#;

        let rich_text = RichText::parse(xml);
        assert_eq!(rich_text.runs.len(), 3);

        assert_eq!(rich_text.runs[0].text, "Bold");
        assert!(rich_text.runs[0].properties.as_ref().unwrap().bold);

        assert_eq!(rich_text.runs[1].text, " and ");
        // No <rPr> element, so properties should be None (inherit from cell style)
        assert!(rich_text.runs[1].properties.is_none());

        assert_eq!(rich_text.runs[2].text, "Italic");
        assert!(rich_text.runs[2].properties.as_ref().unwrap().italic);
    }

    #[test]
    fn test_rich_text_to_plain_text() {
        let xml = br#"<si>
            <r><rPr><b/></rPr><t>Hello</t></r>
            <r><t> </t></r>
            <r><rPr><i/></rPr><t>World</t></r>
        </si>"#;

        let rich_text = RichText::parse(xml);
        assert_eq!(rich_text.to_plain_text(), "Hello World");
    }

    #[test]
    fn test_rich_text_with_phonetic() {
        let xml = r#"<si>
            <t>東京</t>
            <rPh sb="0" eb="1"><t>とう</t></rPh>
            <rPh sb="1" eb="2"><t>きょう</t></rPh>
            <phoneticPr fontId="1"/>
        </si>"#
            .as_bytes();

        let rich_text = RichText::parse(xml);
        assert_eq!(rich_text.runs.len(), 1);
        assert_eq!(rich_text.runs[0].text, "東京");
        assert_eq!(rich_text.phonetic_runs.len(), 2);
        assert_eq!(rich_text.phonetic_runs[0].text, "とう");
        assert_eq!(rich_text.phonetic_runs[1].text, "きょう");
        assert!(rich_text.phonetic_properties.is_some());
    }

    #[test]
    fn test_rich_text_empty() {
        let xml = br#"<si></si>"#;
        let rich_text = RichText::parse(xml);
        assert!(rich_text.is_empty());
    }

    #[test]
    fn test_rich_text_run_count() {
        let xml = br#"<si>
            <r><t>One</t></r>
            <r><t>Two</t></r>
            <r><t>Three</t></r>
        </si>"#;

        let rich_text = RichText::parse(xml);
        assert_eq!(rich_text.run_count(), 3);
    }

    // -------------------------------------------------------------------------
    // XML entity decoding tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_decode_xml_entities() {
        assert_eq!(decode_xml_entities(b"hello"), "hello");
        assert_eq!(decode_xml_entities(b"&lt;tag&gt;"), "<tag>");
        assert_eq!(decode_xml_entities(b"&amp;"), "&");
        assert_eq!(decode_xml_entities(b"&quot;text&quot;"), "\"text\"");
        assert_eq!(decode_xml_entities(b"&apos;"), "'");
        assert_eq!(
            decode_xml_entities(b"a &lt; b &amp;&amp; c &gt; d"),
            "a < b && c > d"
        );
    }

    #[test]
    fn test_decode_numeric_entities() {
        assert_eq!(decode_xml_entities(b"&#65;"), "A");
        assert_eq!(decode_xml_entities(b"&#x41;"), "A");
        assert_eq!(decode_xml_entities(b"&#x1F600;"), "\u{1F600}");
        assert_eq!(decode_xml_entities(b"Hello&#10;World"), "Hello\nWorld");
    }

    #[test]
    fn test_decode_unicode_content() {
        // Japanese text
        assert_eq!(decode_xml_entities("日本語".as_bytes()), "日本語");
        // Mixed content
        assert_eq!(decode_xml_entities("Hello 世界".as_bytes()), "Hello 世界");
        // Emoji
        assert_eq!(decode_xml_entities("🎉🎊".as_bytes()), "🎉🎊");
    }

    // -------------------------------------------------------------------------
    // Integration tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_realistic_rich_text() {
        // Example from a real XLSX file
        let xml = br#"<si>
            <r>
                <rPr>
                    <b/>
                    <sz val="11"/>
                    <color theme="1"/>
                    <rFont val="Calibri"/>
                    <family val="2"/>
                    <scheme val="minor"/>
                </rPr>
                <t>Revenue</t>
            </r>
            <r>
                <rPr>
                    <sz val="11"/>
                    <color theme="1"/>
                    <rFont val="Calibri"/>
                    <family val="2"/>
                    <scheme val="minor"/>
                </rPr>
                <t> (in millions)</t>
            </r>
        </si>"#;

        let rich_text = RichText::parse(xml);
        assert_eq!(rich_text.runs.len(), 2);

        // First run: bold "Revenue"
        let run1 = &rich_text.runs[0];
        assert_eq!(run1.text, "Revenue");
        let props1 = run1.properties.as_ref().unwrap();
        assert!(props1.bold);
        assert_eq!(props1.font.name, Some("Calibri".to_string()));
        assert_eq!(props1.font.size, Some(11.0));

        // Second run: normal " (in millions)"
        let run2 = &rich_text.runs[1];
        assert_eq!(run2.text, " (in millions)");
        let props2 = run2.properties.as_ref().unwrap();
        assert!(!props2.bold);

        // Plain text extraction
        assert_eq!(rich_text.to_plain_text(), "Revenue (in millions)");
    }

    #[test]
    fn test_complex_formatting() {
        let xml = br#"<si>
            <r>
                <rPr>
                    <b/>
                    <i/>
                    <u val="double"/>
                    <strike/>
                    <vertAlign val="superscript"/>
                    <sz val="14"/>
                    <color rgb="FFFF0000"/>
                    <rFont val="Times New Roman"/>
                </rPr>
                <t>Complex</t>
            </r>
        </si>"#;

        let rich_text = RichText::parse(xml);
        let run = &rich_text.runs[0];
        let props = run.properties.as_ref().unwrap();

        assert!(props.bold);
        assert!(props.italic);
        assert_eq!(props.underline, UnderlineStyle::Double);
        assert!(props.strikethrough);
        assert_eq!(props.vert_align, VerticalAlign::Superscript);
        assert_eq!(props.font.size, Some(14.0));
        assert_eq!(
            props.font.color.as_ref().unwrap().rgb,
            Some("FFFF0000".to_string())
        );
        assert_eq!(props.font.name, Some("Times New Roman".to_string()));
    }
}
