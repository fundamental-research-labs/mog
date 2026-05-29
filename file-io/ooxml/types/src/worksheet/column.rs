//! ColWidth descriptor.

/// Column width descriptor.
///
/// Captures the full set of OOXML attributes for a `<col>` element so that
/// round-tripping through read -> write preserves all data.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ColWidth {
    /// Column index (0-based).
    pub col: u32,
    /// Width in character units.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    /// Original string representation of the width attribute from XML.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width_str: Option<String>,
    /// Start column (1-indexed, required per XSD).
    pub min: u32,
    /// End column (1-indexed, required per XSD).
    pub max: u32,
    /// Whether this is a custom width.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub custom_width: bool,
    /// Authored customWidth attribute. `Some(false)` preserves customWidth="0".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_width_attr: Option<bool>,
    /// Whether the column is hidden.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub hidden: bool,
    /// Authored hidden attribute. `Some(false)` preserves hidden="0".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden_attr: Option<bool>,
    /// Style index for the column.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<u32>,
    /// Whether width was calculated for best fit.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub best_fit: bool,
    /// Authored bestFit attribute. `Some(false)` preserves bestFit="0".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub best_fit_attr: Option<bool>,
    /// Outline (group) level (0-7).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline_level: Option<u8>,
    /// Whether the outline group is collapsed.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub collapsed: bool,
    /// Authored collapsed attribute. `Some(false)` preserves collapsed="0".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collapsed_attr: Option<bool>,
    /// Whether phonetic information should be displayed.
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub phonetic: bool,
    /// Authored phonetic attribute. `Some(false)` preserves phonetic="0".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phonetic_attr: Option<bool>,
}

impl ColWidth {
    /// Create a minimal column width entry.
    pub fn simple(col: u32, width: f64) -> Self {
        let one_based = col + 1;
        Self {
            col,
            width: Some(width),
            width_str: None,
            min: one_based,
            max: one_based,
            custom_width: false,
            custom_width_attr: None,
            hidden: false,
            hidden_attr: None,
            style: None,
            best_fit: false,
            best_fit_attr: None,
            outline_level: None,
            collapsed: false,
            collapsed_attr: None,
            phonetic: false,
            phonetic_attr: None,
        }
    }

    /// Create from a 1-indexed OOXML column range.
    ///
    /// `min` and `max` are 1-indexed as in the OOXML `<col>` element. The
    /// 0-based `col` field is set to `min - 1`.
    pub fn range(min: u32, max: u32, width: f64) -> Self {
        Self {
            col: min.saturating_sub(1),
            width: Some(width),
            width_str: None,
            min,
            max,
            custom_width: false,
            custom_width_attr: None,
            hidden: false,
            hidden_attr: None,
            style: None,
            best_fit: false,
            best_fit_attr: None,
            outline_level: None,
            collapsed: false,
            collapsed_attr: None,
            phonetic: false,
            phonetic_attr: None,
        }
    }

    /// Builder: set the `hidden` flag.
    pub fn with_hidden(mut self, hidden: bool) -> Self {
        self.hidden = hidden;
        self.hidden_attr = Some(hidden);
        self
    }

    /// Builder: set the `style` index.
    pub fn with_style(mut self, style: u32) -> Self {
        self.style = Some(style);
        self
    }

    /// Builder: set the `best_fit` flag.
    pub fn with_best_fit(mut self, best_fit: bool) -> Self {
        self.best_fit = best_fit;
        self.best_fit_attr = Some(best_fit);
        self
    }

    /// Builder: set the outline level (0-7).
    pub fn with_outline_level(mut self, level: u8) -> Self {
        self.outline_level = Some(level.min(7));
        self
    }

    /// Builder: set the collapsed flag.
    pub fn with_collapsed(mut self, collapsed: bool) -> Self {
        self.collapsed = collapsed;
        self.collapsed_attr = Some(collapsed);
        self
    }

    /// Builder: set the phonetic flag.
    pub fn with_phonetic(mut self, phonetic: bool) -> Self {
        self.phonetic = phonetic;
        self.phonetic_attr = Some(phonetic);
        self
    }
}
