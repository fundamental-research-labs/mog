//! RowHeight descriptor.

/// Row height descriptor.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RowHeight {
    /// Row index (0-based).
    pub row: u32,
    /// Height in points.
    pub height: f64,
    /// Original string representation of the height attribute from XML.
    /// Preserved for round-trip fidelity when the f64 parse is lossy
    /// (e.g., "17.399999999999999" parses to the same f64 as "17.4").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height_str: Option<String>,
    /// Cell spans optimization hint (ST_CellSpans).
    /// Format: space-delimited "min:max" pairs (e.g., "1:5 8:12").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spans: Option<String>,
    /// Whether this is a custom height.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub custom_height: bool,
    /// Whether the row is hidden.
    /// `None` = attribute not present in XML, `Some(false)` = explicitly `hidden="0"`,
    /// `Some(true)` = `hidden="1"`.  Using `Option<bool>` preserves round-trip fidelity
    /// for files that explicitly write `hidden="0"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    /// Style index (references cellXfs in styles.xml).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<u32>,
    /// Whether the row has a custom format applied (customFormat="1").
    /// Set to `true` when `style` is present.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub custom_format: bool,
    /// Outline (group) level (0-7).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline_level: Option<u8>,
    /// Whether the outline group is collapsed.
    /// `None` = attribute not present in XML, `Some(false)` = explicitly `collapsed="0"`,
    /// `Some(true)` = `collapsed="1"`.  Using `Option<bool>` preserves round-trip fidelity
    /// for files that explicitly write `collapsed="0"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collapsed: Option<bool>,
    /// Whether a thick top border should be drawn.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub thick_top: bool,
    /// Whether a thick bottom border should be drawn.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub thick_bot: bool,
    /// Whether the row has phonetic information (CJK).
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub ph: bool,
}

impl RowHeight {
    /// Create with default flags (not custom, not hidden).
    pub fn new(row: u32, height: f64) -> Self {
        Self {
            row,
            height,
            height_str: None,
            spans: None,
            custom_height: false,
            hidden: None,
            style: None,
            custom_format: false,
            outline_level: None,
            collapsed: None,
            thick_top: false,
            thick_bot: false,
            ph: false,
        }
    }

    /// Create with `custom_height = true`.
    pub fn custom(row: u32, height: f64) -> Self {
        Self {
            row,
            height,
            height_str: None,
            spans: None,
            custom_height: true,
            hidden: None,
            style: None,
            custom_format: false,
            outline_level: None,
            collapsed: None,
            thick_top: false,
            thick_bot: false,
            ph: false,
        }
    }

    /// Builder: set the original height string for round-trip fidelity.
    pub fn with_height_str(mut self, s: String) -> Self {
        self.height_str = Some(s);
        self
    }

    /// Builder: set the `hidden` flag.
    pub fn with_hidden(mut self, hidden: bool) -> Self {
        self.hidden = Some(hidden);
        self
    }

    /// Builder: set the style index (also sets custom_format = true).
    pub fn with_style(mut self, style: u32) -> Self {
        self.style = Some(style);
        self.custom_format = true;
        self
    }

    /// Builder: set the outline level (0-7).
    pub fn with_outline_level(mut self, level: u8) -> Self {
        self.outline_level = Some(level.min(7));
        self
    }

    /// Builder: set the collapsed flag.
    pub fn with_collapsed(mut self, collapsed: bool) -> Self {
        self.collapsed = Some(collapsed);
        self
    }

    /// Builder: set the thick top border flag.
    pub fn with_thick_top(mut self, thick_top: bool) -> Self {
        self.thick_top = thick_top;
        self
    }

    /// Builder: set the thick bottom border flag.
    pub fn with_thick_bot(mut self, thick_bot: bool) -> Self {
        self.thick_bot = thick_bot;
        self
    }
}
