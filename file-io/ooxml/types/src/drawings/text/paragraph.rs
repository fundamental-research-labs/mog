use super::super::primitives::{Emu, StTextIndentLevelType};
use super::{BulletProperties, ExtensionList, RunProperties, TextAlign, TextFontAlignType};

/// Text paragraph (ECMA-376 CT_TextParagraph).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Paragraph {
    /// Paragraph properties.
    pub props: ParagraphProperties,
    /// Text run content within the paragraph (runs, line breaks, fields).
    pub runs: Vec<TextRunContent>,
    /// End-of-paragraph run properties (ECMA-376 `<a:endParaRPr>`).
    pub end_para_rpr: Option<RunProperties>,
}

/// Paragraph properties (ECMA-376 CT_TextParagraphProperties).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ParagraphProperties {
    /// Horizontal alignment.
    pub align: Option<TextAlign>,
    /// Left margin in EMUs.
    pub margin_l: Option<Emu>,
    /// Right margin in EMUs.
    pub margin_r: Option<Emu>,
    /// Indent in EMUs.
    pub indent: Option<Emu>,
    /// Line spacing.
    pub line_spacing: Option<TextSpacing>,
    /// Space before paragraph.
    pub space_before: Option<TextSpacing>,
    /// Space after paragraph.
    pub space_after: Option<TextSpacing>,
    /// Bullet properties.
    pub bullet: Option<BulletProperties>,
    /// Default run properties for this paragraph.
    pub def_run_props: Option<Box<RunProperties>>,
    /// Tab stop list.
    pub tab_list: Option<Vec<TextTabStop>>,
    /// Paragraph level (0-8).
    pub level: Option<StTextIndentLevelType>,
    /// Right-to-left text.
    pub rtl: Option<bool>,
    /// Default tab size in EMUs.
    pub def_tab_sz: Option<Emu>,
    /// East Asian line break flag.
    pub ea_ln_brk: Option<bool>,
    /// Latin line break flag.
    pub latin_ln_brk: Option<bool>,
    /// Hanging punctuation flag.
    pub hanging_punct: Option<bool>,
    /// Font alignment.
    pub font_align: Option<TextFontAlignType>,
    /// Extension list for future compatibility.
    pub ext_lst: Option<ExtensionList>,
}

/// A styled text segment within a paragraph (ECMA-376 CT_RegularTextRun).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TextRun {
    /// The text content.
    pub text: String,
    /// Run formatting properties.
    pub props: RunProperties,
}
// TextSpacing
// =============================================================================

/// Text spacing (line spacing, space before/after) (ECMA-376 CT_TextSpacing).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum TextSpacing {
    /// Spacing as percentage (hundredths of a percent, e.g., 100000 = 100%).
    Percent(u32),
    /// Spacing in points (hundredths of a point, e.g., 1200 = 12pt).
    Points(u32),
}

// =============================================================================
// TextTabStop and TextTabAlignType
// =============================================================================

/// Tab alignment type (ECMA-376 ST_TextTabAlignType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TextTabAlignType {
    /// Left tab stop.
    #[default]
    Left,
    /// Centre tab stop.
    Center,
    /// Right tab stop.
    Right,
    /// Decimal tab stop.
    Decimal,
}

impl TextTabAlignType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "l" => Self::Left,
            "ctr" => Self::Center,
            "r" => Self::Right,
            "dec" => Self::Decimal,
            _ => Self::Left,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Left => "l",
            Self::Center => "ctr",
            Self::Right => "r",
            Self::Decimal => "dec",
        }
    }
}

/// A tab stop within a paragraph (ECMA-376 CT_TextTabStop).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TextTabStop {
    /// Tab position in EMUs.
    pub position: Option<Emu>,
    /// Tab alignment.
    pub align: Option<TextTabAlignType>,
}

// TextRunContent
// =============================================================================

/// Content within a paragraph: runs, line breaks, or fields (ECMA-376 CT_TextParagraph children).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum TextRunContent {
    /// A regular text run (ECMA-376 `<a:r>`).
    Run(TextRun),
    /// A line break (ECMA-376 `<a:br>`).
    LineBreak {
        /// Optional run properties for the line break.
        props: Option<RunProperties>,
    },
    /// A text field (ECMA-376 `<a:fld>`).
    Field {
        /// Field ID (GUID).
        id: String,
        /// Field type (e.g., "slidenum").
        field_type: Option<String>,
        /// Displayed text.
        text: Option<String>,
        /// Run properties for the field.
        run_props: Option<RunProperties>,
        /// Paragraph properties for the field.
        para_props: Option<ParagraphProperties>,
    },
}

// =============================================================================
// TextListStyle
// =============================================================================

/// List style for text bodies (ECMA-376 CT_TextListStyle).
///
/// Contains default and per-level paragraph properties (levels 1-9).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TextListStyle {
    /// Default paragraph properties.
    pub def_ppr: Option<ParagraphProperties>,
    /// Per-level paragraph properties (index 0 = level 1, ..., index 8 = level 9).
    pub level_ppr: [Option<ParagraphProperties>; 9],
}
