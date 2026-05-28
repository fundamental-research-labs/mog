use domain_types::RichTextRun as DtRichTextRun;

/// A single run of rich text with optional formatting.
#[derive(Debug, Clone, PartialEq)]
pub struct RichTextRun {
    /// The text content of this run
    pub text: String,
    /// Bold formatting
    pub bold: Option<bool>,
    /// Italic formatting
    pub italic: Option<bool>,
    /// Underline formatting
    pub underline: Option<bool>,
    /// Strikethrough formatting
    pub strike: Option<bool>,
    /// Font name (e.g., "Arial", "Calibri")
    pub font_name: Option<String>,
    /// Font size in points
    pub font_size: Option<f64>,
    /// Font color as RGB hex (e.g., "FF0000" for red)
    pub color: Option<String>,
}

impl Default for RichTextRun {
    fn default() -> Self {
        Self {
            text: String::new(),
            bold: None,
            italic: None,
            underline: None,
            strike: None,
            font_name: None,
            font_size: None,
            color: None,
        }
    }
}

impl RichTextRun {
    /// Create a new rich text run with just text.
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            ..Default::default()
        }
    }

    /// Check if this run has any formatting properties.
    pub fn has_formatting(&self) -> bool {
        self.bold.is_some()
            || self.italic.is_some()
            || self.underline.is_some()
            || self.strike.is_some()
            || self.font_name.is_some()
            || self.font_size.is_some()
            || self.color.is_some()
    }
}

/// A shared string value - either plain text or rich text with formatting.
#[derive(Debug, Clone, PartialEq)]
pub enum SharedStringValue {
    /// Plain text string
    Plain(String),
    /// Rich text with multiple formatted runs (simple writer types)
    RichText(Vec<RichTextRun>),
    /// Rich text with full domain types (preserves family, charset, scheme, color variants)
    DomainRichText(Vec<DtRichTextRun>),
    /// Cell-owned rich/phonetic shared string.
    RichSharedString(domain_types::RichSharedString),
}

impl SharedStringValue {
    /// Get the plain text content (concatenates all runs for rich text).
    pub fn to_plain_text(&self) -> String {
        match self {
            SharedStringValue::Plain(s) => s.clone(),
            SharedStringValue::RichText(runs) => runs.iter().map(|r| r.text.as_str()).collect(),
            SharedStringValue::DomainRichText(runs) => {
                runs.iter().map(|r| r.text.as_str()).collect()
            }
            SharedStringValue::RichSharedString(rich) => rich.plain_text.clone(),
        }
    }
}

/// Internal entry for tracking string values and their reference counts.
#[derive(Debug, Clone)]
pub(super) struct StringEntry {
    /// The string value
    pub(super) value: SharedStringValue,
    /// Reference count (how many times this string is used)
    pub(super) count: usize,
    /// Raw phonetic XML (`<rPh>...</rPh>` + `<phoneticPr .../>`) for this entry.
    pub(super) phonetic_xml: Option<Vec<u8>>,
}
