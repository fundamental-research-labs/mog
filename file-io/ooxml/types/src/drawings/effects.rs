//! Effect types for DrawingML (ECMA-376 CT_EffectList).

use super::color::DrawingColor;
use super::fill::{DrawingFill, RectAlignment};
use super::line::Outline;
use super::primitives::{
    StAngle, StCoordinate, StFixedAngle, StFixedPercentage, StPercentage, StPositiveCoordinate,
    StPositiveFixedAngle, StPositiveFixedPercentageDecimal, StPositivePercentage,
};

// =============================================================================
// ShapeEffect / EffectList
// =============================================================================

/// Outer shadow effect (ECMA-376 CT_OuterShadowEffect).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct OuterShadow {
    /// XSD: optional, default 0
    pub blur_rad: StPositiveCoordinate,
    /// XSD: optional, default 0
    pub dist: StPositiveCoordinate,
    /// XSD: optional, default 0
    pub dir: StAngle,
    /// XSD: required (EG_ColorChoice) — kept as Option to avoid breaking existing parsing.
    pub color: Option<DrawingColor>,
    /// XSD: optional, default 100%
    pub sx: StPercentage,
    /// XSD: optional, default 100%
    pub sy: StPercentage,
    /// XSD: optional, default 0
    pub kx: StFixedAngle,
    /// XSD: optional, default 0
    pub ky: StFixedAngle,
    /// XSD: optional, default "b"
    pub align: Option<RectAlignment>,
    /// XSD: optional, default true
    pub rot_with_shape: bool,
}

impl Default for OuterShadow {
    fn default() -> Self {
        Self {
            blur_rad: StPositiveCoordinate::default(),
            dist: StPositiveCoordinate::default(),
            dir: StAngle::default(),
            color: None,
            sx: StPercentage::new(100_000),
            sy: StPercentage::new(100_000),
            kx: StFixedAngle::default(),
            ky: StFixedAngle::default(),
            align: None,
            rot_with_shape: true,
        }
    }
}

/// Inner shadow effect (ECMA-376 CT_InnerShadowEffect).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct InnerShadow {
    /// XSD: optional, default 0
    pub blur_rad: StPositiveCoordinate,
    /// XSD: optional, default 0
    pub dist: StPositiveCoordinate,
    /// XSD: optional, default 0
    pub dir: StAngle,
    /// XSD: required (EG_ColorChoice) — kept as Option to avoid breaking existing parsing.
    pub color: Option<DrawingColor>,
}

/// Glow effect (ECMA-376 CT_GlowEffect).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Glow {
    /// XSD: optional, default 0
    pub rad: StPositiveCoordinate,
    /// XSD: required (EG_ColorChoice) — kept as Option to avoid breaking existing parsing.
    pub color: Option<DrawingColor>,
}

/// Soft edge effect (ECMA-376 CT_SoftEdgesEffect).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SoftEdge {
    pub rad: StPositiveCoordinate,
}

/// Reflection effect (ECMA-376 CT_ReflectionEffect).
///
/// All attributes are optional in XSD with defaults. We keep them non-optional
/// with matching default values for ergonomic access.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Reflection {
    /// XSD: optional, default 0
    pub blur_rad: StPositiveCoordinate,
    /// XSD: optional, default 100% (attr name: stA)
    pub start_alpha: StPositiveFixedPercentageDecimal,
    /// XSD: optional, default 0% (attr name: stPos)
    pub start_pos: StPositiveFixedPercentageDecimal,
    /// XSD: optional, default 0% (attr name: endA)
    pub end_alpha: StPositiveFixedPercentageDecimal,
    /// XSD: optional, default 100% (attr name: endPos)
    pub end_pos: StPositiveFixedPercentageDecimal,
    /// XSD: optional, default 0
    pub dist: StPositiveCoordinate,
    /// XSD: optional, default 0
    pub dir: StAngle,
    /// XSD: optional, default 5400000
    pub fade_dir: StAngle,
    /// XSD: optional, default 100%
    pub sx: StPercentage,
    /// XSD: optional, default 100%
    pub sy: StPercentage,
    /// XSD: optional, default 0
    pub kx: StFixedAngle,
    /// XSD: optional, default 0
    pub ky: StFixedAngle,
    /// XSD: optional, default "b"
    pub align: Option<RectAlignment>,
    /// XSD: optional, default true
    pub rot_with_shape: bool,
}

impl Default for Reflection {
    fn default() -> Self {
        Self {
            blur_rad: StPositiveCoordinate::default(),
            start_alpha: StPositiveFixedPercentageDecimal::default(),
            start_pos: StPositiveFixedPercentageDecimal::default(),
            end_alpha: StPositiveFixedPercentageDecimal::default(),
            end_pos: StPositiveFixedPercentageDecimal::default(),
            dist: StPositiveCoordinate::default(),
            dir: StAngle::default(),
            fade_dir: StAngle::new(5_400_000),
            sx: StPercentage::new(100_000),
            sy: StPercentage::new(100_000),
            kx: StFixedAngle::default(),
            ky: StFixedAngle::default(),
            align: None,
            rot_with_shape: true,
        }
    }
}

// =============================================================================
// PresetShadowVal
// =============================================================================

/// Preset shadow value (ECMA-376 ST_PresetShadowVal).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum PresetShadowVal {
    #[default]
    Shdw1,
    Shdw2,
    Shdw3,
    Shdw4,
    Shdw5,
    Shdw6,
    Shdw7,
    Shdw8,
    Shdw9,
    Shdw10,
    Shdw11,
    Shdw12,
    Shdw13,
    Shdw14,
    Shdw15,
    Shdw16,
    Shdw17,
    Shdw18,
    Shdw19,
    Shdw20,
}

impl PresetShadowVal {
    /// Parse from an OOXML `prst` attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Option<Self> {
        match s {
            "shdw1" => Some(Self::Shdw1),
            "shdw2" => Some(Self::Shdw2),
            "shdw3" => Some(Self::Shdw3),
            "shdw4" => Some(Self::Shdw4),
            "shdw5" => Some(Self::Shdw5),
            "shdw6" => Some(Self::Shdw6),
            "shdw7" => Some(Self::Shdw7),
            "shdw8" => Some(Self::Shdw8),
            "shdw9" => Some(Self::Shdw9),
            "shdw10" => Some(Self::Shdw10),
            "shdw11" => Some(Self::Shdw11),
            "shdw12" => Some(Self::Shdw12),
            "shdw13" => Some(Self::Shdw13),
            "shdw14" => Some(Self::Shdw14),
            "shdw15" => Some(Self::Shdw15),
            "shdw16" => Some(Self::Shdw16),
            "shdw17" => Some(Self::Shdw17),
            "shdw18" => Some(Self::Shdw18),
            "shdw19" => Some(Self::Shdw19),
            "shdw20" => Some(Self::Shdw20),
            _ => None,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Shdw1 => "shdw1",
            Self::Shdw2 => "shdw2",
            Self::Shdw3 => "shdw3",
            Self::Shdw4 => "shdw4",
            Self::Shdw5 => "shdw5",
            Self::Shdw6 => "shdw6",
            Self::Shdw7 => "shdw7",
            Self::Shdw8 => "shdw8",
            Self::Shdw9 => "shdw9",
            Self::Shdw10 => "shdw10",
            Self::Shdw11 => "shdw11",
            Self::Shdw12 => "shdw12",
            Self::Shdw13 => "shdw13",
            Self::Shdw14 => "shdw14",
            Self::Shdw15 => "shdw15",
            Self::Shdw16 => "shdw16",
            Self::Shdw17 => "shdw17",
            Self::Shdw18 => "shdw18",
            Self::Shdw19 => "shdw19",
            Self::Shdw20 => "shdw20",
        }
    }
}

/// Preset shadow effect (ECMA-376 CT_PresetShadowEffect).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PresetShadow {
    /// XSD: required (attr name: prst)
    #[serde(rename = "prst")]
    pub preset: PresetShadowVal,
    /// XSD: optional, default 0
    pub dist: StPositiveCoordinate,
    /// XSD: optional, default 0
    pub dir: StAngle,
    /// XSD: required (EG_ColorChoice) — kept as Option to avoid breaking existing parsing.
    pub color: Option<DrawingColor>,
}

/// Blur effect for effectLst (ECMA-376 CT_BlurEffect).
///
/// Both attributes are optional in XSD with defaults. We keep them non-optional
/// with matching default values for ergonomic access.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BlurEffect {
    /// XSD: optional, default 0
    pub rad: StPositiveCoordinate,
    /// XSD: optional, default true
    pub grow: bool,
}

impl Default for BlurEffect {
    fn default() -> Self {
        Self {
            rad: StPositiveCoordinate::default(),
            grow: true,
        }
    }
}

// =============================================================================
// BlendMode
// =============================================================================

/// Blend mode for fill overlay effects (ECMA-376 ST_BlendMode).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum BlendMode {
    #[default]
    Over,
    Mult,
    Screen,
    Darken,
    Lighten,
}

impl BlendMode {
    /// Parse from an OOXML `blend` attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "over" => Self::Over,
            "mult" => Self::Mult,
            "screen" => Self::Screen,
            "darken" => Self::Darken,
            "lighten" => Self::Lighten,
            _ => Self::Over,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Over => "over",
            Self::Mult => "mult",
            Self::Screen => "screen",
            Self::Darken => "darken",
            Self::Lighten => "lighten",
        }
    }
}

/// Fill overlay effect for effectLst (ECMA-376 CT_FillOverlayEffect).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct FillOverlayEffect {
    pub blend: BlendMode,
    /// XSD: required (EG_FillProperties) — kept as Option to avoid breaking existing parsing.
    pub fill: Option<DrawingFill>,
}

/// Shape-level effect list (ECMA-376 CT_EffectList).
///
/// Each field is optional — only present effects are serialized.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct EffectList {
    pub blur: Option<BlurEffect>,
    pub fill_overlay: Option<FillOverlayEffect>,
    pub glow: Option<Glow>,
    pub inner_shadow: Option<InnerShadow>,
    pub outer_shadow: Option<OuterShadow>,
    pub preset_shadow: Option<PresetShadow>,
    pub reflection: Option<Reflection>,
    pub soft_edge: Option<SoftEdge>,
}

impl EffectList {
    /// Returns `true` if no effects are set.
    pub fn is_empty(&self) -> bool {
        self.blur.is_none()
            && self.fill_overlay.is_none()
            && self.glow.is_none()
            && self.inner_shadow.is_none()
            && self.outer_shadow.is_none()
            && self.preset_shadow.is_none()
            && self.reflection.is_none()
            && self.soft_edge.is_none()
    }
}

// =============================================================================
// DAG-level effect types (EG_Effect members not in CT_EffectList)
// =============================================================================

/// Alpha bi-level effect (ECMA-376 CT_AlphaBiLevelEffect).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AlphaBiLevelEffect {
    /// XSD: required
    pub thresh: StPositiveFixedPercentageDecimal,
}

/// Alpha ceiling effect (ECMA-376 CT_AlphaCeilingEffect).
///
/// Empty type — no attributes or child elements.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AlphaCeilingEffect;

/// Alpha floor effect (ECMA-376 CT_AlphaFloorEffect).
///
/// Empty type — no attributes or child elements.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AlphaFloorEffect;

/// Alpha inverse effect (ECMA-376 CT_AlphaInverseEffect).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AlphaInverseEffect {
    /// XSD: optional (EG_ColorChoice, minOccurs=0)
    pub color: Option<DrawingColor>,
}

/// Alpha modulate effect (ECMA-376 CT_AlphaModulateEffect).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AlphaModulateEffect {
    /// XSD: required
    #[serde(rename = "cont")]
    pub cont: Box<EffectContainer>,
}

/// Alpha modulate fixed effect (ECMA-376 CT_AlphaModulateFixedEffect).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AlphaModulateFixedEffect {
    /// XSD: optional, default 100%
    pub amt: StPositivePercentage,
}

/// Alpha outset effect (ECMA-376 CT_AlphaOutsetEffect).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AlphaOutsetEffect {
    /// XSD: optional, default 0
    pub rad: StCoordinate,
}

/// Alpha replace effect (ECMA-376 CT_AlphaReplaceEffect).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AlphaReplaceEffect {
    /// XSD: required
    pub a: StPositiveFixedPercentageDecimal,
}

/// Bi-level (threshold) effect (ECMA-376 CT_BiLevelEffect).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BiLevelEffect {
    /// XSD: required
    pub thresh: StPositiveFixedPercentageDecimal,
}

/// Blend effect (ECMA-376 CT_BlendEffect).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BlendEffect {
    /// XSD: required
    pub blend: BlendMode,
    /// XSD: required
    #[serde(rename = "cont")]
    pub cont: Box<EffectContainer>,
}

/// Color change effect (ECMA-376 CT_ColorChangeEffect).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ColorChangeEffect {
    /// XSD: optional, default true
    pub use_a: Option<bool>,
    /// XSD: required (CT_Color — wraps EG_ColorChoice)
    #[serde(rename = "clrFrom")]
    pub clr_from: Option<DrawingColor>,
    /// XSD: required (CT_Color — wraps EG_ColorChoice)
    #[serde(rename = "clrTo")]
    pub clr_to: Option<DrawingColor>,
}

/// Color replace effect (ECMA-376 CT_ColorReplaceEffect).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ColorReplaceEffect {
    /// XSD: required (EG_ColorChoice) — kept as Option to avoid breaking existing parsing.
    pub color: Option<DrawingColor>,
}

/// Duotone effect (ECMA-376 CT_DuotoneEffect).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DuotoneEffect {
    /// XSD: required — exactly 2 colors (EG_ColorChoice, minOccurs=2, maxOccurs=2).
    pub colors: Vec<DrawingColor>,
}

/// Fill effect (ECMA-376 CT_FillEffect).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct FillEffect {
    /// XSD: required (EG_FillProperties) — kept as Option to avoid breaking existing parsing.
    pub fill: Option<DrawingFill>,
}

/// Grayscale effect (ECMA-376 CT_GrayscaleEffect).
///
/// Empty type — no attributes or child elements.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GrayscaleEffect;

/// HSL effect (ECMA-376 CT_HSLEffect).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct HslEffect {
    /// XSD: optional, default 0
    pub hue: StPositiveFixedAngle,
    /// XSD: optional, default 0%
    pub sat: StFixedPercentage,
    /// XSD: optional, default 0%
    pub lum: StFixedPercentage,
}

/// Luminance effect (ECMA-376 CT_LuminanceEffect).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct LuminanceEffect {
    /// XSD: optional, default 0%
    pub bright: StFixedPercentage,
    /// XSD: optional, default 0%
    pub contrast: StFixedPercentage,
}

/// Relative offset effect (ECMA-376 CT_RelativeOffsetEffect).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RelativeOffsetEffect {
    /// XSD: optional, default 0%
    pub tx: StPercentage,
    /// XSD: optional, default 0%
    pub ty: StPercentage,
}

/// Tint effect (ECMA-376 CT_TintEffect).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TintEffect {
    /// XSD: optional, default 0
    pub hue: StPositiveFixedAngle,
    /// XSD: optional, default 0%
    pub amt: StFixedPercentage,
}

/// Effect reference (ECMA-376 CT_EffectReference).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct EffectReference {
    /// XSD: required
    #[serde(rename = "ref")]
    pub ref_token: String,
}

/// A single effect choice in an effect DAG (ECMA-376 EG_Effect).
///
/// This is a choice group — exactly one variant is present per element.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum DagEffect {
    /// `<a:cont>` — nested effect container
    #[serde(rename = "cont")]
    Container(Box<EffectContainer>),
    /// `<a:effect>` — reference to a named effect
    #[serde(rename = "effect")]
    EffectRef(EffectReference),
    /// `<a:alphaBiLevel>`
    #[serde(rename = "alphaBiLevel")]
    AlphaBiLevel(AlphaBiLevelEffect),
    /// `<a:alphaCeiling>`
    #[serde(rename = "alphaCeiling")]
    AlphaCeiling(AlphaCeilingEffect),
    /// `<a:alphaFloor>`
    #[serde(rename = "alphaFloor")]
    AlphaFloor(AlphaFloorEffect),
    /// `<a:alphaInv>`
    #[serde(rename = "alphaInv")]
    AlphaInverse(AlphaInverseEffect),
    /// `<a:alphaMod>`
    #[serde(rename = "alphaMod")]
    AlphaModulate(AlphaModulateEffect),
    /// `<a:alphaModFix>`
    #[serde(rename = "alphaModFix")]
    AlphaModulateFixed(AlphaModulateFixedEffect),
    /// `<a:alphaOutset>`
    #[serde(rename = "alphaOutset")]
    AlphaOutset(AlphaOutsetEffect),
    /// `<a:alphaRepl>`
    #[serde(rename = "alphaRepl")]
    AlphaReplace(AlphaReplaceEffect),
    /// `<a:biLevel>`
    #[serde(rename = "biLevel")]
    BiLevel(BiLevelEffect),
    /// `<a:blend>`
    #[serde(rename = "blend")]
    Blend(BlendEffect),
    /// `<a:blur>`
    #[serde(rename = "blur")]
    Blur(BlurEffect),
    /// `<a:clrChange>`
    #[serde(rename = "clrChange")]
    ColorChange(ColorChangeEffect),
    /// `<a:clrRepl>`
    #[serde(rename = "clrRepl")]
    ColorReplace(ColorReplaceEffect),
    /// `<a:duotone>`
    #[serde(rename = "duotone")]
    Duotone(DuotoneEffect),
    /// `<a:fill>`
    #[serde(rename = "fill")]
    Fill(FillEffect),
    /// `<a:fillOverlay>`
    #[serde(rename = "fillOverlay")]
    FillOverlay(FillOverlayEffect),
    /// `<a:glow>`
    #[serde(rename = "glow")]
    Glow(Glow),
    /// `<a:grayscl>`
    #[serde(rename = "grayscl")]
    Grayscale(GrayscaleEffect),
    /// `<a:hsl>`
    #[serde(rename = "hsl")]
    Hsl(HslEffect),
    /// `<a:innerShdw>`
    #[serde(rename = "innerShdw")]
    InnerShadow(InnerShadow),
    /// `<a:lum>`
    #[serde(rename = "lum")]
    Luminance(LuminanceEffect),
    /// `<a:outerShdw>`
    #[serde(rename = "outerShdw")]
    OuterShadow(OuterShadow),
    /// `<a:prstShdw>`
    #[serde(rename = "prstShdw")]
    PresetShadow(PresetShadow),
    /// `<a:reflection>`
    #[serde(rename = "reflection")]
    Reflection(Reflection),
    /// `<a:relOff>`
    #[serde(rename = "relOff")]
    RelativeOffset(RelativeOffsetEffect),
    /// `<a:softEdge>`
    #[serde(rename = "softEdge")]
    SoftEdge(SoftEdge),
    /// `<a:tint>`
    #[serde(rename = "tint")]
    Tint(TintEffect),
    /// `<a:xfrm>`
    #[serde(rename = "xfrm")]
    Transform(TransformEffect),
}

// =============================================================================
// EffectContainer / EffectProperties (EG_EffectProperties)
// =============================================================================

/// Container type for effect DAG (ECMA-376 ST_EffectContainerType).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum EffectContainerType {
    Sib,
    Tree,
}

impl EffectContainerType {
    /// Parse from an OOXML `type` attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Option<Self> {
        match s {
            "sib" => Some(Self::Sib),
            "tree" => Some(Self::Tree),
            _ => None,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Sib => "sib",
            Self::Tree => "tree",
        }
    }
}

/// Effect container / DAG (ECMA-376 CT_EffectContainer).
///
/// Contains an unbounded list of `EG_Effect` choices (0..unbounded).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct EffectContainer {
    /// XSD: optional, default "sib"
    pub container_type: Option<EffectContainerType>,
    /// XSD: optional
    pub name: Option<String>,
    /// XSD: EG_Effect, minOccurs=0, maxOccurs=unbounded
    pub effects: Vec<DagEffect>,
}

/// Choice between effect list and effect DAG (ECMA-376 EG_EffectProperties).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum EffectProperties {
    EffectList(EffectList),
    EffectDag(EffectContainer),
}

// =============================================================================
// TransformEffect
// =============================================================================

/// Transform effect (ECMA-376 CT_TransformEffect).
///
/// Applies a 2D affine transform as a DAG-level effect.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TransformEffect {
    /// Horizontal scale factor (percentage x 1000, default 100000 = 100%).
    pub sx: StPercentage,
    /// Vertical scale factor (percentage x 1000, default 100000 = 100%).
    pub sy: StPercentage,
    /// Horizontal skew angle in 60000ths of a degree (default 0).
    pub kx: StFixedAngle,
    /// Vertical skew angle in 60000ths of a degree (default 0).
    pub ky: StFixedAngle,
    /// Horizontal translation in EMUs (default 0).
    pub tx: StCoordinate,
    /// Vertical translation in EMUs (default 0).
    pub ty: StCoordinate,
}

impl Default for TransformEffect {
    fn default() -> Self {
        Self {
            sx: StPercentage::new(100_000),
            sy: StPercentage::new(100_000),
            kx: StFixedAngle::default(),
            ky: StFixedAngle::default(),
            tx: StCoordinate::default(),
            ty: StCoordinate::default(),
        }
    }
}

// =============================================================================
// WholeE2oFormatting
// =============================================================================

/// Whole element 2D formatting (ECMA-376 CT_WholeE2oFormatting).
///
/// Used in table/chart formatting for outline + effect on the entire element.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct WholeE2oFormatting {
    /// Line properties (outline).
    pub ln: Option<Outline>,
    /// Effect properties (EG_EffectProperties: effectLst or effectDag).
    pub effect: Option<EffectProperties>,
}
