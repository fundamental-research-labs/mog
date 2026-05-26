use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThemeData {
    pub colors: Vec<ThemeColor>,
    pub major_font: Option<String>,
    pub minor_font: Option<String>,
    /// Original theme name (e.g., "Tema do Office", "Office Theme").
    /// Preserved for round-trip fidelity — localized names must not be clobbered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
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
