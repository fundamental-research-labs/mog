//! Rich text public data contracts.

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
            Some(_) | None => UnderlineStyle::Single,
        }
    }
}

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
