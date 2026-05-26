//! Sheet property types (ECMA-376 CT_SheetPr, CT_SheetFormatPr, CT_SheetDimension).

// ---------------------------------------------------------------------------
// Serde helpers for SheetFormatProperties numeric defaults
// ---------------------------------------------------------------------------

fn is_zero_u8(v: &u8) -> bool {
    *v == 0
}

/// Sheet properties (ECMA-376 CT_SheetPr, 18.3.1.82).
///
/// Includes both attributes and child elements (tabColor, outlinePr, pageSetUpPr).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SheetProperties {
    // --- Attributes ---
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub sync_horizontal: bool,
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub sync_vertical: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_ref: Option<String>,
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub transition_evaluation: bool,
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub transition_entry: bool,
    /// Whether the sheet is published (default: true per XSD).
    #[serde(
        default = "super::default_true",
        skip_serializing_if = "super::is_true"
    )]
    pub published: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_name: Option<String>,
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub filter_mode: bool,
    /// Whether conditional formatting calculations are enabled (default: true per XSD).
    #[serde(
        default = "super::default_true",
        skip_serializing_if = "super::is_true"
    )]
    pub enable_format_conditions_calculation: bool,

    // --- Child elements ---
    /// Tab color (reuses ColorDef from styles module).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab_color: Option<crate::styles::ColorDef>,
    /// Outline (grouping) properties.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline_pr: Option<OutlineProperties>,
    /// Page setup properties.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_set_up_pr: Option<PageSetupProperties>,
}

impl Default for SheetProperties {
    fn default() -> Self {
        Self {
            sync_horizontal: false,
            sync_vertical: false,
            sync_ref: None,
            transition_evaluation: false,
            transition_entry: false,
            published: true,
            code_name: None,
            filter_mode: false,
            enable_format_conditions_calculation: true,
            tab_color: None,
            outline_pr: None,
            page_set_up_pr: None,
        }
    }
}

/// Outline properties (ECMA-376 CT_OutlinePr, 18.3.1.64).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct OutlineProperties {
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub apply_styles: bool,
    /// Default: true per spec.
    #[serde(
        default = "super::default_true",
        skip_serializing_if = "super::is_true"
    )]
    pub summary_below: bool,
    /// Default: true per spec.
    #[serde(
        default = "super::default_true",
        skip_serializing_if = "super::is_true"
    )]
    pub summary_right: bool,
    /// Default: true per spec.
    #[serde(
        default = "super::default_true",
        skip_serializing_if = "super::is_true"
    )]
    pub show_outline_symbols: bool,
}

impl Default for OutlineProperties {
    fn default() -> Self {
        Self {
            apply_styles: false,
            summary_below: true,
            summary_right: true,
            show_outline_symbols: true,
        }
    }
}

/// Page setup properties (ECMA-376 CT_PageSetUpPr, 18.3.1.65).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PageSetupProperties {
    /// Default: true per spec.
    #[serde(
        default = "super::default_true",
        skip_serializing_if = "super::is_true"
    )]
    pub auto_page_breaks: bool,
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub fit_to_page: bool,
}

impl Default for PageSetupProperties {
    fn default() -> Self {
        Self {
            auto_page_breaks: true,
            fit_to_page: false,
        }
    }
}

/// Sheet format properties (ECMA-376 CT_SheetFormatPr, 18.3.1.81).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SheetFormatProperties {
    /// Base column width (XSD optional, default 8).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_col_width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_col_width: Option<f64>,
    /// Required by spec (xsd use="required").
    pub default_row_height: f64,
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub custom_height: bool,
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub zero_height: bool,
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub thick_top: bool,
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub thick_bottom: bool,
    #[serde(default, skip_serializing_if = "is_zero_u8")]
    pub outline_level_row: u8,
    #[serde(default, skip_serializing_if = "is_zero_u8")]
    pub outline_level_col: u8,
}

impl SheetFormatProperties {
    /// Effective base column width (defaults to 8 when absent per XSD).
    #[must_use]
    pub fn effective_base_col_width(&self) -> u32 {
        self.base_col_width.unwrap_or(8)
    }
}

/// Sheet dimension (ECMA-376 CT_SheetDimension, 18.3.1.35).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SheetDimension {
    /// Cell reference range (e.g., "A1:F10" or "A1").
    pub ref_range: String,
}

impl SheetDimension {
    pub fn new(ref_range: &str) -> Self {
        Self {
            ref_range: ref_range.to_string(),
        }
    }
}
