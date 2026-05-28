use super::borders::BorderDef;
use super::cell_formats::{AlignmentDef, ProtectionDef};
use super::fills::FillDef;
use super::fonts::FontDef;
use super::number_formats::NumberFormatDef;

// =============================================================================
// CellStyleDef
// =============================================================================

/// Named cell style (ECMA-376 CT_CellStyle).
///
/// Defines a named style like "Normal", "Percent", "Heading 1", etc.
/// Each named style references a cellStyleXf by index.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CellStyleDef {
    /// Display name (e.g., "Normal", "Percent"). XSD optional.
    pub name: Option<String>,
    /// Index into cellStyleXfs array.
    pub xf_id: u32,
    /// Built-in style ID (0 = Normal, 3 = Comma, 4 = Currency, etc.).
    pub builtin_id: Option<u32>,
    /// Custom style flag (XSD optional, default false).
    pub custom_builtin: Option<bool>,
    /// Outline level for built-in styles (CT_CellStyle.iLevel).
    pub i_level: Option<u32>,
    /// Whether the style is hidden from the UI (CT_CellStyle.hidden).
    pub hidden: Option<bool>,
    /// Extension list for vendor-specific data (CT_ExtensionList).
    pub ext_lst: Option<crate::ExtensionList>,
    /// Revision UID (xr:uid attribute) for co-authoring / revision tracking.
    pub xr_uid: Option<String>,
}

impl CellStyleDef {
    /// Effective display name (returns empty string when absent).
    #[must_use]
    pub fn effective_name(&self) -> &str {
        self.name.as_deref().unwrap_or("")
    }

    /// Effective custom_builtin flag (defaults to `false` when absent per XSD).
    #[must_use]
    pub fn effective_custom_builtin(&self) -> bool {
        self.custom_builtin.unwrap_or(false)
    }
}

// =============================================================================
// DxfDef
// =============================================================================

/// Differential formatting record (ECMA-376 CT_Dxf).
///
/// Used by conditional formatting rules and table styles to specify
/// partial formatting overrides (only the fields that differ from the base).
/// Every field is optional — only set fields are applied.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DxfDef {
    /// Font overrides.
    pub font: Option<FontDef>,
    /// Number format override.
    pub num_fmt: Option<NumberFormatDef>,
    /// Fill override.
    pub fill: Option<FillDef>,
    /// Border override.
    pub border: Option<BorderDef>,
    /// Alignment override.
    pub alignment: Option<AlignmentDef>,
    /// Protection override.
    pub protection: Option<ProtectionDef>,
    /// Extension list for vendor-specific data (CT_ExtensionList).
    pub ext_lst: Option<crate::ExtensionList>,
}
