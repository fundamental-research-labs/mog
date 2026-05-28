use super::borders::BorderDef;
use super::cell_formats::CellXfDef;
use super::colors::ColorsDef;
use super::fills::FillDef;
use super::fonts::FontDef;
use super::number_formats::NumberFormatDef;
use super::records::{CellStyleDef, DxfDef};
use super::table_style_types::TableStyleDef;

// =============================================================================
// Stylesheet
// =============================================================================

/// Root stylesheet container (ECMA-376 CT_Stylesheet).
///
/// This is the top-level type corresponding to `xl/styles.xml`.
/// The parser produces this, the writer consumes it.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Stylesheet {
    /// Custom number formats (IDs >= 164).
    pub num_fmts: Vec<NumberFormatDef>,
    /// Font definitions.
    pub fonts: Vec<FontDef>,
    /// Whether `x14ac:knownFonts="1"` was present on the `<fonts>` element.
    /// Indicates the producing application verified all referenced fonts are
    /// available on the system.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub known_fonts: bool,
    /// Fill definitions.
    pub fills: Vec<FillDef>,
    /// Border definitions.
    pub borders: Vec<BorderDef>,
    /// Cell style XFs (base styles referenced by named styles).
    pub cell_style_xfs: Vec<CellXfDef>,
    /// Cell XFs (the style index in cell `s` attribute references this).
    pub cell_xfs: Vec<CellXfDef>,
    /// Named cell styles.
    pub cell_styles: Vec<CellStyleDef>,
    /// Differential formatting records (for CF and tables).
    pub dxfs: Vec<DxfDef>,
    /// Custom color palette and MRU colors.
    pub colors: Option<ColorsDef>,
    /// Table style definitions.
    pub table_styles: Vec<TableStyleDef>,
    /// Default table style name.
    pub default_table_style: Option<String>,
    /// Default pivot table style name.
    pub default_pivot_style: Option<String>,
    /// Extension list for vendor-specific data (CT_ExtensionList).
    pub ext_lst: Option<crate::ExtensionList>,
}
