use super::super::color::DrawingColor;
use super::super::effects::EffectProperties;
use super::super::fill::DrawingFill;
use super::super::line::Outline;
use super::super::primitives::{
    StPercentage, StPitchFamily, StTextFontSize, StTextNonNegativePoint, StTextPoint,
};
use super::super::style::Hyperlink;
use super::ExtensionList;

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
