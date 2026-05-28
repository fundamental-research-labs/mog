use crate::drawings::ExtensionList;

use super::colors::ColorScheme;
use super::fonts::FontScheme;
use super::format::FormatScheme;

// =============================================================================
// Base Styles (CT_BaseStyles)
// =============================================================================

/// Theme elements: color scheme, font scheme, and format scheme (ECMA-376 CT_BaseStyles).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct BaseStyles {
    /// Color scheme
    pub clr_scheme: ColorScheme,
    /// Font scheme
    pub font_scheme: FontScheme,
    /// Format scheme
    pub fmt_scheme: FormatScheme,
    /// Extension list
    pub ext_lst: Option<ExtensionList>,
}

// =============================================================================
// Base Styles Override (CT_BaseStylesOverride)
// =============================================================================

/// Override for base styles, allowing partial replacement (ECMA-376 CT_BaseStylesOverride).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct BaseStylesOverride {
    /// Optional color scheme override
    pub clr_scheme: Option<ColorScheme>,
    /// Optional font scheme override
    pub font_scheme: Option<FontScheme>,
    /// Optional format scheme override
    pub fmt_scheme: Option<FormatScheme>,
}
