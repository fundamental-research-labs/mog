//! Text types for DrawingML (ECMA-376 CT_TextBody and related).

use super::color::DrawingColor;
use super::effects::EffectProperties;
use super::fill::DrawingFill;
use super::geometry::GeomGuide;
use super::line::Outline;
use super::primitives::{
    Emu, StAngle, StCoordinate, StPercentage, StPitchFamily, StTextFontSize, StTextIndentLevelType,
    StTextNonNegativePoint, StTextPoint,
};
use super::style::Hyperlink;
use super::three_d::{Scene3D, Shape3D};

// =============================================================================
// TextAnchor
// =============================================================================

/// Vertical text anchor within a text body (ECMA-376 ST_TextAnchoringType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TextAnchor {
    /// Anchor text to the top.
    #[default]
    Top,
    /// Anchor text to the center.
    Center,
    /// Anchor text to the bottom.
    Bottom,
    /// Justified anchor.
    Justified,
    /// Distributed anchor.
    Distributed,
}

impl TextAnchor {
    /// Parse from an OOXML `anchor` attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "t" => Self::Top,
            "ctr" => Self::Center,
            "b" => Self::Bottom,
            "just" => Self::Justified,
            "dist" => Self::Distributed,
            _ => Self::Top,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Top => "t",
            Self::Center => "ctr",
            Self::Bottom => "b",
            Self::Justified => "just",
            Self::Distributed => "dist",
        }
    }
}

// =============================================================================
// TextWrap
// =============================================================================

/// Text wrapping mode (ECMA-376 ST_TextWrappingType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TextWrap {
    /// No wrapping.
    #[default]
    None,
    /// Square wrapping.
    Square,
}

impl TextWrap {
    /// Parse from an OOXML `wrap` attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "none" => Self::None,
            "square" => Self::Square,
            _ => Self::None,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Square => "square",
        }
    }
}

// =============================================================================
// TextAlign
// =============================================================================

/// Horizontal text alignment within a paragraph (ECMA-376 ST_TextAlignType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TextAlign {
    /// Left alignment.
    #[default]
    Left,
    /// Center alignment.
    Center,
    /// Right alignment.
    Right,
    /// Justified alignment.
    Justify,
    /// Justify low alignment.
    JustifyLow,
    /// Distributed alignment.
    Distributed,
    /// Thai distributed alignment.
    ThaiDistributed,
}

impl TextAlign {
    /// Parse from an OOXML `algn` attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "l" => Self::Left,
            "ctr" => Self::Center,
            "r" => Self::Right,
            "just" => Self::Justify,
            "justLow" => Self::JustifyLow,
            "dist" => Self::Distributed,
            "thaiDist" => Self::ThaiDistributed,
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
            Self::Justify => "just",
            Self::JustifyLow => "justLow",
            Self::Distributed => "dist",
            Self::ThaiDistributed => "thaiDist",
        }
    }
}

// =============================================================================
// Text Body Types
// =============================================================================

/// Text body for text boxes and shape text (ECMA-376 CT_TextBody).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TextBody {
    /// Body properties.
    pub body_props: TextBodyProperties,
    /// List style (ECMA-376 `<a:lstStyle>`).
    pub list_style: Option<TextListStyle>,
    /// Paragraphs.
    pub paragraphs: Vec<Paragraph>,
}

/// Text warp preset type (ECMA-376 ST_TextShapeType).
///
/// Defines 41 preset text shape transformations for WordArt effects.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextWarpPreset {
    TextNoShape,
    TextPlain,
    TextStop,
    TextTriangle,
    TextTriangleInverted,
    TextChevron,
    TextChevronInverted,
    TextRingInside,
    TextRingOutside,
    TextArchUp,
    TextArchDown,
    TextCircle,
    TextButton,
    TextArchUpPour,
    TextArchDownPour,
    TextCirclePour,
    TextButtonPour,
    TextCurveUp,
    TextCurveDown,
    TextCanUp,
    TextCanDown,
    TextWave1,
    TextWave2,
    TextDoubleWave1,
    TextWave4,
    TextInflate,
    TextDeflate,
    TextInflateBottom,
    TextDeflateBottom,
    TextInflateTop,
    TextDeflateTop,
    TextDeflateInflate,
    TextDeflateInflateDeflate,
    TextFadeRight,
    TextFadeLeft,
    TextFadeUp,
    TextFadeDown,
    TextSlantUp,
    TextSlantDown,
    TextCascadeUp,
    TextCascadeDown,
}

impl TextWarpPreset {
    /// Parse from OOXML string value (e.g., "textWave1").
    pub fn from_ooxml(s: &str) -> Option<Self> {
        match s {
            "textNoShape" => Some(Self::TextNoShape),
            "textPlain" => Some(Self::TextPlain),
            "textStop" => Some(Self::TextStop),
            "textTriangle" => Some(Self::TextTriangle),
            "textTriangleInverted" => Some(Self::TextTriangleInverted),
            "textChevron" => Some(Self::TextChevron),
            "textChevronInverted" => Some(Self::TextChevronInverted),
            "textRingInside" => Some(Self::TextRingInside),
            "textRingOutside" => Some(Self::TextRingOutside),
            "textArchUp" => Some(Self::TextArchUp),
            "textArchDown" => Some(Self::TextArchDown),
            "textCircle" => Some(Self::TextCircle),
            "textButton" => Some(Self::TextButton),
            "textArchUpPour" => Some(Self::TextArchUpPour),
            "textArchDownPour" => Some(Self::TextArchDownPour),
            "textCirclePour" => Some(Self::TextCirclePour),
            "textButtonPour" => Some(Self::TextButtonPour),
            "textCurveUp" => Some(Self::TextCurveUp),
            "textCurveDown" => Some(Self::TextCurveDown),
            "textCanUp" => Some(Self::TextCanUp),
            "textCanDown" => Some(Self::TextCanDown),
            "textWave1" => Some(Self::TextWave1),
            "textWave2" => Some(Self::TextWave2),
            "textDoubleWave1" => Some(Self::TextDoubleWave1),
            "textWave4" => Some(Self::TextWave4),
            "textInflate" => Some(Self::TextInflate),
            "textDeflate" => Some(Self::TextDeflate),
            "textInflateBottom" => Some(Self::TextInflateBottom),
            "textDeflateBottom" => Some(Self::TextDeflateBottom),
            "textInflateTop" => Some(Self::TextInflateTop),
            "textDeflateTop" => Some(Self::TextDeflateTop),
            "textDeflateInflate" => Some(Self::TextDeflateInflate),
            "textDeflateInflateDeflate" => Some(Self::TextDeflateInflateDeflate),
            "textFadeRight" => Some(Self::TextFadeRight),
            "textFadeLeft" => Some(Self::TextFadeLeft),
            "textFadeUp" => Some(Self::TextFadeUp),
            "textFadeDown" => Some(Self::TextFadeDown),
            "textSlantUp" => Some(Self::TextSlantUp),
            "textSlantDown" => Some(Self::TextSlantDown),
            "textCascadeUp" => Some(Self::TextCascadeUp),
            "textCascadeDown" => Some(Self::TextCascadeDown),
            _ => None,
        }
    }

    /// Convert to OOXML string value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::TextNoShape => "textNoShape",
            Self::TextPlain => "textPlain",
            Self::TextStop => "textStop",
            Self::TextTriangle => "textTriangle",
            Self::TextTriangleInverted => "textTriangleInverted",
            Self::TextChevron => "textChevron",
            Self::TextChevronInverted => "textChevronInverted",
            Self::TextRingInside => "textRingInside",
            Self::TextRingOutside => "textRingOutside",
            Self::TextArchUp => "textArchUp",
            Self::TextArchDown => "textArchDown",
            Self::TextCircle => "textCircle",
            Self::TextButton => "textButton",
            Self::TextArchUpPour => "textArchUpPour",
            Self::TextArchDownPour => "textArchDownPour",
            Self::TextCirclePour => "textCirclePour",
            Self::TextButtonPour => "textButtonPour",
            Self::TextCurveUp => "textCurveUp",
            Self::TextCurveDown => "textCurveDown",
            Self::TextCanUp => "textCanUp",
            Self::TextCanDown => "textCanDown",
            Self::TextWave1 => "textWave1",
            Self::TextWave2 => "textWave2",
            Self::TextDoubleWave1 => "textDoubleWave1",
            Self::TextWave4 => "textWave4",
            Self::TextInflate => "textInflate",
            Self::TextDeflate => "textDeflate",
            Self::TextInflateBottom => "textInflateBottom",
            Self::TextDeflateBottom => "textDeflateBottom",
            Self::TextInflateTop => "textInflateTop",
            Self::TextDeflateTop => "textDeflateTop",
            Self::TextDeflateInflate => "textDeflateInflate",
            Self::TextDeflateInflateDeflate => "textDeflateInflateDeflate",
            Self::TextFadeRight => "textFadeRight",
            Self::TextFadeLeft => "textFadeLeft",
            Self::TextFadeUp => "textFadeUp",
            Self::TextFadeDown => "textFadeDown",
            Self::TextSlantUp => "textSlantUp",
            Self::TextSlantDown => "textSlantDown",
            Self::TextCascadeUp => "textCascadeUp",
            Self::TextCascadeDown => "textCascadeDown",
        }
    }
}

/// Preset text warp (ECMA-376 CT_PresetTextShape).
///
/// Represents a preset text warp transformation with optional adjustment values.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PresetTextWarp {
    /// Preset type (required).
    pub preset: TextWarpPreset,
    /// Adjustment values (optional, 0..N geometry guides).
    pub adjust_values: Vec<GeomGuide>,
}

/// Flat text properties (ECMA-376 CT_FlatText).
///
/// Part of the EG_Text3D choice group (alternative to sp3d/Shape3D).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub struct FlatText {
    /// Z-coordinate (depth) in EMUs (ECMA-376 `z` attribute, default 0).
    #[serde(rename = "z")]
    pub z: Option<StCoordinate>,
}

/// Text body properties (ECMA-376 CT_TextBodyProperties).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TextBodyProperties {
    /// Rotation in 60000ths of a degree.
    pub rot: Option<StAngle>,
    /// Vertical text anchor.
    pub anchor: Option<TextAnchor>,
    /// Text wrapping mode.
    pub wrap: Option<TextWrap>,
    /// Left inset in EMUs.
    pub l_ins: Option<Emu>,
    /// Top inset in EMUs.
    pub t_ins: Option<Emu>,
    /// Right inset in EMUs.
    pub r_ins: Option<Emu>,
    /// Bottom inset in EMUs.
    pub b_ins: Option<Emu>,
    /// Vertical text type.
    pub vert: Option<TextVerticalType>,
    /// Vertical overflow behaviour.
    pub vert_overflow: Option<TextVertOverflow>,
    /// Horizontal overflow behaviour.
    pub horz_overflow: Option<TextHorzOverflow>,
    /// Anchor text at centre of text body.
    pub anchor_ctr: Option<bool>,
    /// Right-to-left columns.
    pub rtl_col: Option<bool>,
    /// Space first and last paragraph.
    pub spc_first_last_para: Option<bool>,
    /// Number of text columns.
    pub num_col: Option<u32>,
    /// Space between columns in EMUs.
    pub spc_col: Option<Emu>,
    /// Upright text (not rotated with shape).
    pub upright: Option<bool>,
    /// Compatible line spacing.
    pub compat_ln_spc: Option<bool>,
    /// Force anti-aliasing.
    pub force_aa: Option<bool>,
    /// Text originated from WordArt.
    pub from_word_art: Option<bool>,
    /// Autofit behaviour.
    pub autofit: Option<TextAutofit>,
    /// Extension list for future compatibility.
    pub ext_lst: Option<ExtensionList>,
    /// Preset text warp (ECMA-376 CT_PresetTextShape).
    pub prst_tx_warp: Option<PresetTextWarp>,
    /// 3D scene properties (ECMA-376 CT_Scene3D).
    pub scene3d: Option<Scene3D>,
    /// 3D shape properties for text (ECMA-376 CT_Shape3D, EG_Text3D group).
    /// Mutually exclusive with `flat_tx` (XSD choice group).
    pub sp3d: Option<Shape3D>,
    /// Flat text properties (ECMA-376 CT_FlatText, EG_Text3D group).
    /// Mutually exclusive with `sp3d` (XSD choice group).
    #[serde(rename = "flatTx")]
    pub flat_tx: Option<FlatText>,
}

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

/// Text run properties (ECMA-376 CT_TextCharacterProperties).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RunProperties {
    /// Font size in hundredths of a point (e.g., 1100 = 11pt).
    pub size: Option<StTextFontSize>,
    /// Bold.
    pub bold: Option<bool>,
    /// Italic.
    pub italic: Option<bool>,
    /// Underline type.
    pub underline: Option<TextUnderlineType>,
    /// Strikethrough type.
    pub strike: Option<TextStrikeType>,
    /// Latin font (replaces old `font: Option<String>`).
    pub latin: Option<TextFont>,
    /// East Asian font.
    pub ea: Option<TextFont>,
    /// Complex script font.
    pub cs: Option<TextFont>,
    /// Symbol font.
    pub sym: Option<TextFont>,
    /// Text colour.
    pub color: Option<DrawingColor>,
    /// Language (e.g., "en-US").
    pub lang: Option<String>,
    /// Alternate language.
    pub alt_lang: Option<String>,
    /// Kerning in hundredths of a point.
    pub kern: Option<StTextNonNegativePoint>,
    /// Capitalization type.
    pub cap: Option<TextCapsType>,
    /// Character spacing in hundredths of a point.
    pub spacing: Option<StTextPoint>,
    /// Baseline shift (percentage * 1000, e.g., 30000 = superscript 30%).
    pub baseline: Option<StPercentage>,
    /// Highlight colour.
    pub highlight: Option<DrawingColor>,
    /// Click hyperlink.
    pub hlink_click: Option<Hyperlink>,
    /// Mouse-over hyperlink.
    pub hlink_mouse_over: Option<Hyperlink>,
    /// Text fill (overrides shape fill for text).
    pub text_fill: Option<DrawingFill>,
    /// Text outline.
    pub text_outline: Option<Outline>,
    /// Effect properties (ECMA-376 EG_EffectProperties: effectLst/effectDag).
    pub effects: Option<EffectProperties>,
    /// Underline line properties.
    pub underline_line: Option<UnderlineLine>,
    /// Underline fill properties.
    pub underline_fill: Option<UnderlineFill>,
    /// East Asian kumimoji flag.
    pub kumimoji: Option<bool>,
    /// Normalize heights flag.
    pub normalize_h: Option<bool>,
    /// No proofing flag.
    pub no_proof: Option<bool>,
    /// Dirty flag (needs recalculation).
    pub dirty: Option<bool>,
    /// Spelling error flag.
    pub err: Option<bool>,
    /// Smart tag clean flag.
    pub smt_clean: Option<bool>,
    /// Smart tag ID.
    pub smt_id: Option<u32>,
    /// Bookmark link target.
    pub bmk: Option<String>,
    /// Right-to-left text.
    pub rtl: Option<bool>,
    /// Extension list for future compatibility.
    pub ext_lst: Option<ExtensionList>,
}

// =============================================================================
// TextUnderlineType
// =============================================================================

/// Text underline style (ECMA-376 ST_TextUnderlineType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TextUnderlineType {
    /// No underline.
    #[default]
    None,
    /// Underline words only (not spaces).
    Words,
    /// Single underline.
    Single,
    /// Double underline.
    Double,
    /// Heavy underline.
    Heavy,
    /// Dotted underline.
    Dotted,
    /// Heavy dotted underline.
    DottedHeavy,
    /// Dash underline.
    Dash,
    /// Heavy dash underline.
    DashHeavy,
    /// Long dash underline.
    DashLong,
    /// Heavy long dash underline.
    DashLongHeavy,
    /// Dot-dash underline.
    DotDash,
    /// Heavy dot-dash underline.
    DotDashHeavy,
    /// Dot-dot-dash underline.
    DotDotDash,
    /// Heavy dot-dot-dash underline.
    DotDotDashHeavy,
    /// Wavy underline.
    Wavy,
    /// Heavy wavy underline.
    WavyHeavy,
    /// Double wavy underline.
    WavyDouble,
}

impl TextUnderlineType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "none" => Self::None,
            "words" => Self::Words,
            "sng" => Self::Single,
            "dbl" => Self::Double,
            "heavy" => Self::Heavy,
            "dotted" => Self::Dotted,
            "dottedHeavy" => Self::DottedHeavy,
            "dash" => Self::Dash,
            "dashHeavy" => Self::DashHeavy,
            "dashLong" => Self::DashLong,
            "dashLongHeavy" => Self::DashLongHeavy,
            "dotDash" => Self::DotDash,
            "dotDashHeavy" => Self::DotDashHeavy,
            "dotDotDash" => Self::DotDotDash,
            "dotDotDashHeavy" => Self::DotDotDashHeavy,
            "wavy" => Self::Wavy,
            "wavyHeavy" => Self::WavyHeavy,
            "wavyDbl" => Self::WavyDouble,
            _ => Self::None,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Words => "words",
            Self::Single => "sng",
            Self::Double => "dbl",
            Self::Heavy => "heavy",
            Self::Dotted => "dotted",
            Self::DottedHeavy => "dottedHeavy",
            Self::Dash => "dash",
            Self::DashHeavy => "dashHeavy",
            Self::DashLong => "dashLong",
            Self::DashLongHeavy => "dashLongHeavy",
            Self::DotDash => "dotDash",
            Self::DotDashHeavy => "dotDashHeavy",
            Self::DotDotDash => "dotDotDash",
            Self::DotDotDashHeavy => "dotDotDashHeavy",
            Self::Wavy => "wavy",
            Self::WavyHeavy => "wavyHeavy",
            Self::WavyDouble => "wavyDbl",
        }
    }
}

// =============================================================================
// TextStrikeType
// =============================================================================

/// Text strikethrough type (ECMA-376 ST_TextStrikeType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TextStrikeType {
    /// No strikethrough.
    #[default]
    NoStrike,
    /// Single strikethrough.
    SingleStrike,
    /// Double strikethrough.
    DoubleStrike,
}

impl TextStrikeType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "noStrike" => Self::NoStrike,
            "sngStrike" => Self::SingleStrike,
            "dblStrike" => Self::DoubleStrike,
            _ => Self::NoStrike,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::NoStrike => "noStrike",
            Self::SingleStrike => "sngStrike",
            Self::DoubleStrike => "dblStrike",
        }
    }
}

// =============================================================================
// TextCapsType
// =============================================================================

/// Text capitalisation type (ECMA-376 ST_TextCapsType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TextCapsType {
    /// No capitalisation change.
    #[default]
    None,
    /// Small caps.
    Small,
    /// All caps.
    All,
}

impl TextCapsType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "none" => Self::None,
            "small" => Self::Small,
            "all" => Self::All,
            _ => Self::None,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Small => "small",
            Self::All => "all",
        }
    }
}

// =============================================================================
// TextVerticalType
// =============================================================================

/// Vertical text orientation (ECMA-376 ST_TextVerticalType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TextVerticalType {
    /// Horizontal text (default).
    #[default]
    Horizontal,
    /// Vertical text.
    Vertical,
    /// Vertical text rotated 270 degrees.
    Vertical270,
    /// WordArt vertical text.
    WordArtVert,
    /// East Asian vertical text.
    EastAsianVert,
    /// Mongolian vertical text.
    MongolianVert,
    /// WordArt vertical right-to-left text.
    WordArtVertRtl,
}

impl TextVerticalType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "horz" => Self::Horizontal,
            "vert" => Self::Vertical,
            "vert270" => Self::Vertical270,
            "wordArtVert" => Self::WordArtVert,
            "eaVert" => Self::EastAsianVert,
            "mongolianVert" => Self::MongolianVert,
            "wordArtVertRtl" => Self::WordArtVertRtl,
            _ => Self::Horizontal,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Horizontal => "horz",
            Self::Vertical => "vert",
            Self::Vertical270 => "vert270",
            Self::WordArtVert => "wordArtVert",
            Self::EastAsianVert => "eaVert",
            Self::MongolianVert => "mongolianVert",
            Self::WordArtVertRtl => "wordArtVertRtl",
        }
    }
}

// =============================================================================
// TextVertOverflow
// =============================================================================

/// Vertical text overflow behaviour (ECMA-376 ST_TextVertOverflowType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TextVertOverflow {
    /// Text overflows the bounding box.
    #[default]
    Overflow,
    /// Text is replaced with an ellipsis when it overflows.
    Ellipsis,
    /// Text is clipped at the bounding box boundary.
    Clip,
}

impl TextVertOverflow {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "overflow" => Self::Overflow,
            "ellipsis" => Self::Ellipsis,
            "clip" => Self::Clip,
            _ => Self::Overflow,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Overflow => "overflow",
            Self::Ellipsis => "ellipsis",
            Self::Clip => "clip",
        }
    }
}

// =============================================================================
// TextHorzOverflow
// =============================================================================

/// Horizontal text overflow behaviour (ECMA-376 ST_TextHorzOverflowType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TextHorzOverflow {
    /// Text overflows the bounding box.
    #[default]
    Overflow,
    /// Text is clipped at the bounding box boundary.
    Clip,
}

impl TextHorzOverflow {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "overflow" => Self::Overflow,
            "clip" => Self::Clip,
            _ => Self::Overflow,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Overflow => "overflow",
            Self::Clip => "clip",
        }
    }
}

// =============================================================================
// TextAutofit
// =============================================================================

/// Text autofit behaviour (ECMA-376 EG_TextAutofit).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TextAutofit {
    /// No autofit (text overflows as-is).
    #[default]
    NoAutofit,
    /// Normal autofit: shrink text to fit the shape.
    NormalAutofit {
        /// Font scale in thousandths of a percent (e.g., 100000 = 100%).
        font_scale: Option<u32>,
        /// Line space reduction in thousandths of a percent.
        line_space_reduction: Option<u32>,
    },
    /// Shape autofit: resize the shape to fit the text.
    ShapeAutofit,
}

// =============================================================================
// TextFontAlignType
// =============================================================================

/// Font alignment within a paragraph (ECMA-376 ST_TextFontAlignType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TextFontAlignType {
    /// Automatic alignment.
    #[default]
    Auto,
    /// Align to top.
    Top,
    /// Align to centre.
    Center,
    /// Align to baseline.
    Baseline,
    /// Align to bottom.
    Bottom,
}

impl TextFontAlignType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "auto" => Self::Auto,
            "t" => Self::Top,
            "ctr" => Self::Center,
            "base" => Self::Baseline,
            "b" => Self::Bottom,
            _ => Self::Auto,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Top => "t",
            Self::Center => "ctr",
            Self::Baseline => "base",
            Self::Bottom => "b",
        }
    }
}

// =============================================================================
// TextAutonumberType
// =============================================================================

/// Autonumber bullet scheme (ECMA-376 ST_TextAutonumberScheme).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, Default,
)]
pub enum TextAutonumberType {
    /// a), b), c), ...
    AlphaLcParenBoth,
    /// A), B), C), ...
    AlphaUcParenBoth,
    /// a), b), c), ... (right paren only)
    AlphaLcParenR,
    /// A), B), C), ... (right paren only)
    AlphaUcParenR,
    /// a., b., c., ...
    AlphaLcPeriod,
    /// A., B., C., ...
    AlphaUcPeriod,
    /// (1), (2), (3), ...
    ArabicParenBoth,
    /// 1), 2), 3), ...
    ArabicParenR,
    /// 1., 2., 3., ...
    #[default]
    ArabicPeriod,
    /// 1, 2, 3, ...
    ArabicPlain,
    /// (i), (ii), (iii), ...
    RomanLcParenBoth,
    /// (I), (II), (III), ...
    RomanUcParenBoth,
    /// i), ii), iii), ...
    RomanLcParenR,
    /// I), II), III), ...
    RomanUcParenR,
    /// i., ii., iii., ...
    RomanLcPeriod,
    /// I., II., III., ...
    RomanUcPeriod,
    /// Circled number (double-byte plain).
    CircleNumDbPlain,
    /// Circled number (wide black plain).
    CircleNumWdBlackPlain,
    /// Circled number (wide white plain).
    CircleNumWdWhitePlain,
    /// Arabic double-byte with period.
    ArabicDbPeriod,
    /// Arabic double-byte plain.
    ArabicDbPlain,
    /// East Asian CHS with period.
    Ea1ChsPeriod,
    /// East Asian CHS plain.
    Ea1ChsPlain,
    /// East Asian CHT with period.
    Ea1ChtPeriod,
    /// East Asian CHT plain.
    Ea1ChtPlain,
    /// East Asian Japanese/CHS double-byte with period.
    Ea1JpnChsDbPeriod,
    /// East Asian Japanese/Korean plain.
    Ea1JpnKorPlain,
    /// East Asian Japanese/Korean with period.
    Ea1JpnKorPeriod,
    /// Arabic 1 minus.
    Arabic1Minus,
    /// Arabic 2 minus.
    Arabic2Minus,
    /// Hebrew 2 minus.
    Hebrew2Minus,
    /// Thai alphabet with period.
    ThaiAlphaPeriod,
    /// Thai alphabet with right paren.
    ThaiAlphaParenR,
    /// Thai alphabet with both parens.
    ThaiAlphaParenBoth,
    /// Thai number with period.
    ThaiNumPeriod,
    /// Thai number with right paren.
    ThaiNumParenR,
    /// Thai number with both parens.
    ThaiNumParenBoth,
    /// Hindi alphabet with period.
    HindiAlphaPeriod,
    /// Hindi number with period.
    HindiNumPeriod,
    /// Hindi number with right paren.
    HindiNumParenR,
    /// Hindi alpha1 with period.
    HindiAlpha1Period,
}

impl TextAutonumberType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "alphaLcParenBoth" => Self::AlphaLcParenBoth,
            "alphaUcParenBoth" => Self::AlphaUcParenBoth,
            "alphaLcParenR" => Self::AlphaLcParenR,
            "alphaUcParenR" => Self::AlphaUcParenR,
            "alphaLcPeriod" => Self::AlphaLcPeriod,
            "alphaUcPeriod" => Self::AlphaUcPeriod,
            "arabicParenBoth" => Self::ArabicParenBoth,
            "arabicParenR" => Self::ArabicParenR,
            "arabicPeriod" => Self::ArabicPeriod,
            "arabicPlain" => Self::ArabicPlain,
            "romanLcParenBoth" => Self::RomanLcParenBoth,
            "romanUcParenBoth" => Self::RomanUcParenBoth,
            "romanLcParenR" => Self::RomanLcParenR,
            "romanUcParenR" => Self::RomanUcParenR,
            "romanLcPeriod" => Self::RomanLcPeriod,
            "romanUcPeriod" => Self::RomanUcPeriod,
            "circleNumDbPlain" => Self::CircleNumDbPlain,
            "circleNumWdBlackPlain" => Self::CircleNumWdBlackPlain,
            "circleNumWdWhitePlain" => Self::CircleNumWdWhitePlain,
            "arabicDbPeriod" => Self::ArabicDbPeriod,
            "arabicDbPlain" => Self::ArabicDbPlain,
            "ea1ChsPeriod" => Self::Ea1ChsPeriod,
            "ea1ChsPlain" => Self::Ea1ChsPlain,
            "ea1ChtPeriod" => Self::Ea1ChtPeriod,
            "ea1ChtPlain" => Self::Ea1ChtPlain,
            "ea1JpnChsDbPeriod" => Self::Ea1JpnChsDbPeriod,
            "ea1JpnKorPlain" => Self::Ea1JpnKorPlain,
            "ea1JpnKorPeriod" => Self::Ea1JpnKorPeriod,
            "arabic1Minus" => Self::Arabic1Minus,
            "arabic2Minus" => Self::Arabic2Minus,
            "hebrew2Minus" => Self::Hebrew2Minus,
            "thaiAlphaPeriod" => Self::ThaiAlphaPeriod,
            "thaiAlphaParenR" => Self::ThaiAlphaParenR,
            "thaiAlphaParenBoth" => Self::ThaiAlphaParenBoth,
            "thaiNumPeriod" => Self::ThaiNumPeriod,
            "thaiNumParenR" => Self::ThaiNumParenR,
            "thaiNumParenBoth" => Self::ThaiNumParenBoth,
            "hindiAlphaPeriod" => Self::HindiAlphaPeriod,
            "hindiNumPeriod" => Self::HindiNumPeriod,
            "hindiNumParenR" => Self::HindiNumParenR,
            "hindiAlpha1Period" => Self::HindiAlpha1Period,
            _ => Self::ArabicPeriod,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::AlphaLcParenBoth => "alphaLcParenBoth",
            Self::AlphaUcParenBoth => "alphaUcParenBoth",
            Self::AlphaLcParenR => "alphaLcParenR",
            Self::AlphaUcParenR => "alphaUcParenR",
            Self::AlphaLcPeriod => "alphaLcPeriod",
            Self::AlphaUcPeriod => "alphaUcPeriod",
            Self::ArabicParenBoth => "arabicParenBoth",
            Self::ArabicParenR => "arabicParenR",
            Self::ArabicPeriod => "arabicPeriod",
            Self::ArabicPlain => "arabicPlain",
            Self::RomanLcParenBoth => "romanLcParenBoth",
            Self::RomanUcParenBoth => "romanUcParenBoth",
            Self::RomanLcParenR => "romanLcParenR",
            Self::RomanUcParenR => "romanUcParenR",
            Self::RomanLcPeriod => "romanLcPeriod",
            Self::RomanUcPeriod => "romanUcPeriod",
            Self::CircleNumDbPlain => "circleNumDbPlain",
            Self::CircleNumWdBlackPlain => "circleNumWdBlackPlain",
            Self::CircleNumWdWhitePlain => "circleNumWdWhitePlain",
            Self::ArabicDbPeriod => "arabicDbPeriod",
            Self::ArabicDbPlain => "arabicDbPlain",
            Self::Ea1ChsPeriod => "ea1ChsPeriod",
            Self::Ea1ChsPlain => "ea1ChsPlain",
            Self::Ea1ChtPeriod => "ea1ChtPeriod",
            Self::Ea1ChtPlain => "ea1ChtPlain",
            Self::Ea1JpnChsDbPeriod => "ea1JpnChsDbPeriod",
            Self::Ea1JpnKorPlain => "ea1JpnKorPlain",
            Self::Ea1JpnKorPeriod => "ea1JpnKorPeriod",
            Self::Arabic1Minus => "arabic1Minus",
            Self::Arabic2Minus => "arabic2Minus",
            Self::Hebrew2Minus => "hebrew2Minus",
            Self::ThaiAlphaPeriod => "thaiAlphaPeriod",
            Self::ThaiAlphaParenR => "thaiAlphaParenR",
            Self::ThaiAlphaParenBoth => "thaiAlphaParenBoth",
            Self::ThaiNumPeriod => "thaiNumPeriod",
            Self::ThaiNumParenR => "thaiNumParenR",
            Self::ThaiNumParenBoth => "thaiNumParenBoth",
            Self::HindiAlphaPeriod => "hindiAlphaPeriod",
            Self::HindiNumPeriod => "hindiNumPeriod",
            Self::HindiNumParenR => "hindiNumParenR",
            Self::HindiAlpha1Period => "hindiAlpha1Period",
        }
    }
}

// =============================================================================
// TextFont
// =============================================================================

/// Font reference for text runs (ECMA-376 CT_TextFont).
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct TextFont {
    /// Font typeface name (e.g., "Calibri", "Arial").
    pub typeface: String,
    /// Panose-1 classification (10-byte hex string).
    pub panose: Option<String>,
    /// Pitch family (bitmask).
    pub pitch_family: Option<StPitchFamily>,
    /// Character set.
    pub charset: Option<i8>,
}

// =============================================================================
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

// =============================================================================
// BulletProperties and sub-types
// =============================================================================

/// Bullet colour specification (ECMA-376 EG_TextBulletColor).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum BulletColor {
    /// Bullet uses the text colour.
    FollowText,
    /// Bullet uses a custom colour.
    Custom(DrawingColor),
}

/// Bullet size specification (ECMA-376 EG_TextBulletSize).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum BulletSize {
    /// Bullet size follows text size.
    FollowText,
    /// Bullet size as percentage of text size (hundredths of a percent).
    Percent(u32),
    /// Bullet size in points (hundredths of a point).
    Points(u32),
}

/// Bullet type specification (ECMA-376 EG_TextBulletTypeface).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum BulletType {
    /// No bullet.
    None,
    /// Character bullet (e.g., "bullet character").
    Char(String),
    /// Automatic numbered bullet.
    AutoNum {
        /// Numbering scheme.
        scheme: TextAutonumberType,
        /// Starting number (defaults to 1 in OOXML).
        start_at: Option<u32>,
    },
    /// Picture bullet (relationship ID to image).
    Blip(String),
}

/// Bullet properties for a paragraph (ECMA-376 CT_TextParagraphProperties bullet group).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BulletProperties {
    /// Bullet colour.
    pub color: Option<BulletColor>,
    /// Bullet size.
    pub size: Option<BulletSize>,
    /// Bullet font.
    pub font: Option<TextFont>,
    /// Whether the bullet font follows the text font (`<a:buFontTx/>`).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub font_follows_text: bool,
    /// Bullet type.
    pub bullet_type: Option<BulletType>,
}

// =============================================================================
// ExtensionList
// =============================================================================

/// Extension list for future compatibility (ECMA-376 CT_OfficeArtExtensionList).
///
/// Preserves raw XML for extensions that are not yet modelled.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ExtensionList {
    /// Raw XML string of the extension list element contents.
    pub raw_xml: Option<String>,
}

// =============================================================================
// UnderlineLine and UnderlineFill
// =============================================================================

/// Underline line properties (ECMA-376 CT_TextUnderlineLine).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum UnderlineLine {
    /// Underline line follows the text formatting.
    FollowText,
    /// Custom underline line properties.
    Custom(Outline),
}

/// Underline fill properties (ECMA-376 CT_TextUnderlineFill).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum UnderlineFill {
    /// Underline fill follows the text formatting.
    FollowText,
    /// Custom underline fill.
    Custom(DrawingFill),
}

// =============================================================================
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
