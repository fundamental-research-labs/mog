use super::super::geometry::GeomGuide;
use super::super::primitives::{Emu, StAngle, StCoordinate};
use super::super::three_d::{Scene3D, Shape3D};
use super::{
    ExtensionList, Paragraph, TextAnchor, TextHorzOverflow, TextListStyle, TextVertOverflow,
    TextVerticalType, TextWrap,
};

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
