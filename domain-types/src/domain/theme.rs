use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThemeData {
    pub colors: Vec<ThemeColor>,
    pub major_font: Option<String>,
    pub minor_font: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_part_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_relationship_id_hint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_relationship_type: Option<String>,
    /// Original theme name (e.g., "Tema do Office", "Office Theme").
    /// Preserved for round-trip fidelity — localized names must not be clobbered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Full OOXML color scheme. This is the modeled source of truth for
    /// theme color serialization when present; `colors` remains the public
    /// palette projection used by API callers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_scheme: Option<ooxml_types::themes::ColorScheme>,
    /// Full OOXML font scheme. Preserves script fonts and attributes that the
    /// major/minor font projection does not model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_scheme: Option<ooxml_types::themes::FontScheme>,
    /// Full OOXML format scheme. This owns theme fill, line, effect, and
    /// background fill styles such as gradient theme backgrounds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format_scheme: Option<ooxml_types::themes::FormatScheme>,
    /// Current theme-owned inner XML for `<a:objectDefaults>`.
    /// `None` means absent; `Some(vec![])` means present empty/self-closing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_defaults_xml: Option<Vec<u8>>,
    /// Current theme-owned inner XML for `<a:extraClrSchemeLst>`.
    /// `None` means absent; `Some(vec![])` means present empty/self-closing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_clr_scheme_lst_xml: Option<Vec<u8>>,
    /// Current theme-owned raw XML of `<a:extLst>`, including the root element.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<Vec<u8>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cust_clr_lst_xml: Option<Vec<u8>>,
    /// Current order of modeled root siblings after `themeElements`.
    /// `None` uses generated-theme defaults; `Some(vec![])` means no siblings.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_sibling_order: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeColor {
    /// "dk1", "lt1", "dk2", "lt2", "accent1"-"accent6", "hlink", "folHlink"
    pub name: String,
    /// Resolved RGB "#RRGGBB"
    pub color: String,
    /// How this color was defined in the original OOXML.
    /// When `None`, treated as `Srgb` (default).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<ThemeColorSource>,
}

/// How a theme color was defined in OOXML — needed for lossless round-tripping.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ThemeColorSource {
    /// `<a:srgbClr val="RRGGBB"/>` — explicit sRGB color.
    Srgb,
    /// `<a:sysClr val="..." lastClr="RRGGBB"/>` — Windows system color.
    SysClr {
        /// System color name, e.g. "windowText", "window"
        val: String,
        /// The last resolved color value
        last_clr: String,
    },
}

// IterativeCalcSettings has been replaced by CalculationProperties in domain::workbook.
