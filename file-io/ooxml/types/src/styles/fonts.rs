use super::colors::{ColorDef, colors_eq};
use super::enums::{FontScheme, UnderlineStyle};
use crate::shared::VerticalAlignRun;

// =============================================================================
// Font Definition
// =============================================================================

/// Font definition (ECMA-376 CT_Font).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct FontDef {
    /// Font name (e.g., "Calibri", "Arial"). Optional per XSD (all CT_Font children are optional).
    pub name: Option<String>,
    /// Font size in points. Optional per XSD (DXF fonts may omit size).
    pub size: Option<f64>,
    /// Bold. `None` = element absent, `Some(false)` = `<b val="0"/>`, `Some(true)` = `<b/>`.
    pub bold: Option<bool>,
    /// Italic. `None` = element absent, `Some(false)` = `<i val="0"/>`, `Some(true)` = `<i/>`.
    pub italic: Option<bool>,
    /// Underline style.
    pub underline: Option<UnderlineStyle>,
    /// Strikethrough. `None` = element absent, `Some(false)` = `<strike val="0"/>`, `Some(true)` = `<strike/>`.
    pub strikethrough: Option<bool>,
    /// Font colour.
    pub color: Option<ColorDef>,
    /// Font family (1=Roman, 2=Swiss, 3=Modern, 4=Script, 5=Decorative).
    pub family: Option<u32>,
    /// Character set.
    pub charset: Option<u32>,
    /// Theme scheme.
    pub scheme: Option<FontScheme>,
    /// Condense (East Asian). `None` = absent, `Some(false)` = `<condense val="0"/>`, `Some(true)` = `<condense/>`.
    pub condense: Option<bool>,
    /// Extend (East Asian). `None` = absent, `Some(false)` = `<extend val="0"/>`, `Some(true)` = `<extend/>`.
    pub extend: Option<bool>,
    /// Vertical alignment for text runs (superscript/subscript).
    pub vert_align: Option<VerticalAlignRun>,
    /// Outline font effect. `None` = absent, `Some(false)` = `<outline val="0"/>`, `Some(true)` = `<outline/>`.
    pub outline: Option<bool>,
    /// Shadow font effect. `None` = absent, `Some(false)` = `<shadow val="0"/>`, `Some(true)` = `<shadow/>`.
    pub shadow: Option<bool>,
}

impl FontDef {
    /// Semantic equality: all fields use structural `==` except `color` which
    /// uses `ColorDef::semantically_eq`.
    pub fn semantically_eq(&self, other: &FontDef) -> bool {
        self.name == other.name
            && self.size == other.size
            && self.bold == other.bold
            && self.italic == other.italic
            && self.underline == other.underline
            && self.strikethrough == other.strikethrough
            && colors_eq(&self.color, &other.color)
            && self.family == other.family
            && self.charset == other.charset
            && self.scheme == other.scheme
            && self.condense == other.condense
            && self.extend == other.extend
            && self.vert_align == other.vert_align
            && self.outline == other.outline
            && self.shadow == other.shadow
    }
}
