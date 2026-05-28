use crate::drawings::ExtensionList;

use super::base::BaseStyles;
use super::custom_colors::CustomColorList;
use super::mapping::{ColorMapping, ColorSchemeList};
use super::object_defaults::ObjectStyleDefaults;

// =============================================================================
// Office Style Sheet (CT_OfficeStyleSheet)
// =============================================================================

/// Root theme element (ECMA-376 CT_OfficeStyleSheet).
///
/// Represents the `<a:theme>` root element in a theme part (e.g., `xl/theme/theme1.xml`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct OfficeStyleSheet {
    /// Theme name
    pub name: String,
    /// Theme elements (color, font, format schemes)
    pub theme_elements: BaseStyles,
    /// Default styles for objects
    pub object_defaults: Option<ObjectStyleDefaults>,
    /// Extra color scheme list
    pub extra_clr_scheme_lst: Option<ColorSchemeList>,
    /// Custom color list
    pub cust_clr_lst: Option<CustomColorList>,
    /// Extension list
    pub ext_lst: Option<ExtensionList>,
}

// =============================================================================
// Clipboard Style Sheet (CT_ClipboardStyleSheet)
// =============================================================================

/// Clipboard style sheet for paste operations (ECMA-376 CT_ClipboardStyleSheet).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ClipboardStyleSheet {
    /// Theme elements (color, font, format schemes)
    pub theme_elements: BaseStyles,
    /// Color mapping
    pub clr_map: ColorMapping,
}
