use super::enums::{HorizontalAlign, VerticalAlign};

// =============================================================================
// Alignment Definition
// =============================================================================

/// Cell alignment definition (ECMA-376 CT_CellAlignment).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AlignmentDef {
    /// Horizontal alignment.
    pub horizontal: Option<HorizontalAlign>,
    /// Vertical alignment.
    pub vertical: Option<VerticalAlign>,
    /// Wrap text. `None` = not specified (distinct from `Some(false)` for style inheritance).
    pub wrap_text: Option<bool>,
    /// Text rotation (0-180, or 255 for vertical text).
    pub text_rotation: Option<u32>,
    /// Indent level.
    pub indent: Option<u32>,
    /// Shrink to fit. `None` = not specified (distinct from `Some(false)` for style inheritance).
    pub shrink_to_fit: Option<bool>,
    /// Reading order (0=context, 1=left-to-right, 2=right-to-left).
    pub reading_order: Option<u32>,
    /// Relative indent adjustment (CT_CellAlignment.relativeIndent, xsd:int).
    pub relative_indent: Option<i32>,
    /// Whether to justify the last line of text (CT_CellAlignment.justifyLastLine).
    pub justify_last_line: Option<bool>,
    /// Auto-indent flag (CT_CellAlignment.autoIndent).
    pub auto_indent: Option<bool>,
}

// =============================================================================
// Protection Definition
// =============================================================================

/// Cell protection definition (ECMA-376 CT_CellProtection).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, Default)]
pub struct ProtectionDef {
    /// Cell is locked. `None` = not specified (Excel defaults to locked when sheet is protected).
    pub locked: Option<bool>,
    /// Formula is hidden. `None` = not specified.
    pub hidden: Option<bool>,
}

// =============================================================================
// Cell XF Definition
// =============================================================================

/// Cell XF (eXtended Format) — a combination of style component indices plus
/// inline alignment and protection overrides (ECMA-376 CT_Xf).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CellXfDef {
    /// Number format ID (references numFmts or built-in). Optional per XSD.
    pub num_fmt_id: Option<u32>,
    /// Font ID (index into fonts array). Optional per XSD.
    pub font_id: Option<u32>,
    /// Fill ID (index into fills array). Optional per XSD.
    pub fill_id: Option<u32>,
    /// Border ID (index into borders array). Optional per XSD.
    pub border_id: Option<u32>,
    /// Reference to cellStyleXf (parent style).
    pub xf_id: Option<u32>,
    /// Cell alignment.
    pub alignment: Option<AlignmentDef>,
    /// Cell protection.
    pub protection: Option<ProtectionDef>,
    /// Apply number format from this xf. `None` = not specified (distinct from `Some(false)`).
    pub apply_number_format: Option<bool>,
    /// Apply font from this xf. `None` = not specified.
    pub apply_font: Option<bool>,
    /// Apply fill from this xf. `None` = not specified.
    pub apply_fill: Option<bool>,
    /// Apply border from this xf. `None` = not specified.
    pub apply_border: Option<bool>,
    /// Apply alignment from this xf. `None` = not specified.
    pub apply_alignment: Option<bool>,
    /// Apply protection from this xf. `None` = not specified.
    pub apply_protection: Option<bool>,
    /// Quote prefix — display leading apostrophe.
    pub quote_prefix: bool,
    /// Pivot button — cell contains pivot table dropdown.
    pub pivot_button: bool,
    /// Extension list for vendor-specific data (CT_ExtensionList).
    pub ext_lst: Option<crate::ExtensionList>,
}
