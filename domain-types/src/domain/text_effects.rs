//! Text effects configuration types.
//!
//! Mirrors the TS contracts in `contracts/src/text-effects/types.ts` and
//! `contracts/src/text-effects/effects.ts`.  Every struct serializes to
//! camelCase JSON that is byte-identical to its TS counterpart.

use serde::{Deserialize, Serialize};

// =============================================================================
// Text Warp Presets (41 from DrawingML ST_TextShapeType)
// =============================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TextWarpPreset {
    #[serde(rename = "textNoShape")]
    TextNoShape,
    #[serde(rename = "textPlain")]
    TextPlain,
    #[serde(rename = "textArchUp")]
    TextArchUp,
    #[serde(rename = "textArchDown")]
    TextArchDown,
    #[serde(rename = "textCircle")]
    TextCircle,
    #[serde(rename = "textButton")]
    TextButton,
    #[serde(rename = "textArchUpPour")]
    TextArchUpPour,
    #[serde(rename = "textArchDownPour")]
    TextArchDownPour,
    #[serde(rename = "textCirclePour")]
    TextCirclePour,
    #[serde(rename = "textButtonPour")]
    TextButtonPour,
    #[serde(rename = "textCurveUp")]
    TextCurveUp,
    #[serde(rename = "textCurveDown")]
    TextCurveDown,
    #[serde(rename = "textWave1")]
    TextWave1,
    #[serde(rename = "textWave2")]
    TextWave2,
    #[serde(rename = "textDoubleWave1")]
    TextDoubleWave1,
    #[serde(rename = "textWave4")]
    TextWave4,
    #[serde(rename = "textInflate")]
    TextInflate,
    #[serde(rename = "textDeflate")]
    TextDeflate,
    #[serde(rename = "textInflateBottom")]
    TextInflateBottom,
    #[serde(rename = "textDeflateBottom")]
    TextDeflateBottom,
    #[serde(rename = "textInflateTop")]
    TextInflateTop,
    #[serde(rename = "textDeflateTop")]
    TextDeflateTop,
    #[serde(rename = "textDeflateInflate")]
    TextDeflateInflate,
    #[serde(rename = "textDeflateInflateDeflate")]
    TextDeflateInflateDeflate,
    #[serde(rename = "textFadeRight")]
    TextFadeRight,
    #[serde(rename = "textFadeLeft")]
    TextFadeLeft,
    #[serde(rename = "textFadeUp")]
    TextFadeUp,
    #[serde(rename = "textFadeDown")]
    TextFadeDown,
    #[serde(rename = "textSlantUp")]
    TextSlantUp,
    #[serde(rename = "textSlantDown")]
    TextSlantDown,
    #[serde(rename = "textCascadeUp")]
    TextCascadeUp,
    #[serde(rename = "textCascadeDown")]
    TextCascadeDown,
    #[serde(rename = "textTriangle")]
    TextTriangle,
    #[serde(rename = "textTriangleInverted")]
    TextTriangleInverted,
    #[serde(rename = "textChevron")]
    TextChevron,
    #[serde(rename = "textChevronInverted")]
    TextChevronInverted,
    #[serde(rename = "textRingInside")]
    TextRingInside,
    #[serde(rename = "textRingOutside")]
    TextRingOutside,
    #[serde(rename = "textStop")]
    TextStop,
    #[serde(rename = "textCanUp")]
    TextCanUp,
    #[serde(rename = "textCanDown")]
    TextCanDown,
}

// =============================================================================
// Adjustment Values
// =============================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdjustmentValues {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adj1: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adj2: Option<f64>,
}

// =============================================================================
// Fill Types
// =============================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum GradientType {
    #[serde(rename = "linear")]
    Linear,
    #[serde(rename = "radial")]
    Radial,
    #[serde(rename = "path")]
    Path,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TileFlipMode {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "x")]
    X,
    #[serde(rename = "y")]
    Y,
    #[serde(rename = "xy")]
    Xy,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradientStop {
    pub position: f64,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
}

/// Discriminated union for text-effect fill.
/// Serializes as `{ "type": "solid", ... }` etc.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TextEffectFill {
    Solid {
        color: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        opacity: Option<f64>,
    },
    Gradient {
        #[serde(rename = "gradientType")]
        gradient_type: GradientType,
        #[serde(skip_serializing_if = "Option::is_none")]
        angle: Option<f64>,
        stops: Vec<GradientStop>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "focusX")]
        focus_x: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "focusY")]
        focus_y: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "rotateWithShape")]
        rotate_with_shape: Option<bool>,
    },
    Pattern {
        pattern: PatternType,
        #[serde(rename = "fgColor")]
        fg_color: String,
        #[serde(rename = "bgColor")]
        bg_color: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        opacity: Option<f64>,
    },
    None {},
}

// =============================================================================
// Pattern Type (48 DrawingML patterns)
// =============================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum PatternType {
    #[serde(rename = "pct5")]
    Pct5,
    #[serde(rename = "pct10")]
    Pct10,
    #[serde(rename = "pct20")]
    Pct20,
    #[serde(rename = "pct25")]
    Pct25,
    #[serde(rename = "pct30")]
    Pct30,
    #[serde(rename = "pct40")]
    Pct40,
    #[serde(rename = "pct50")]
    Pct50,
    #[serde(rename = "pct60")]
    Pct60,
    #[serde(rename = "pct70")]
    Pct70,
    #[serde(rename = "pct75")]
    Pct75,
    #[serde(rename = "pct80")]
    Pct80,
    #[serde(rename = "pct90")]
    Pct90,
    #[serde(rename = "horz")]
    Horz,
    #[serde(rename = "vert")]
    Vert,
    #[serde(rename = "ltHorz")]
    LtHorz,
    #[serde(rename = "ltVert")]
    LtVert,
    #[serde(rename = "dkHorz")]
    DkHorz,
    #[serde(rename = "dkVert")]
    DkVert,
    #[serde(rename = "narHorz")]
    NarHorz,
    #[serde(rename = "narVert")]
    NarVert,
    #[serde(rename = "dashHorz")]
    DashHorz,
    #[serde(rename = "dashVert")]
    DashVert,
    #[serde(rename = "cross")]
    Cross,
    #[serde(rename = "dnDiag")]
    DnDiag,
    #[serde(rename = "upDiag")]
    UpDiag,
    #[serde(rename = "ltDnDiag")]
    LtDnDiag,
    #[serde(rename = "ltUpDiag")]
    LtUpDiag,
    #[serde(rename = "dkDnDiag")]
    DkDnDiag,
    #[serde(rename = "dkUpDiag")]
    DkUpDiag,
    #[serde(rename = "wdDnDiag")]
    WdDnDiag,
    #[serde(rename = "wdUpDiag")]
    WdUpDiag,
    #[serde(rename = "dashDnDiag")]
    DashDnDiag,
    #[serde(rename = "dashUpDiag")]
    DashUpDiag,
    #[serde(rename = "diagCross")]
    DiagCross,
    #[serde(rename = "smCheck")]
    SmCheck,
    #[serde(rename = "lgCheck")]
    LgCheck,
    #[serde(rename = "smGrid")]
    SmGrid,
    #[serde(rename = "lgGrid")]
    LgGrid,
    #[serde(rename = "dotGrid")]
    DotGrid,
    #[serde(rename = "smConfetti")]
    SmConfetti,
    #[serde(rename = "lgConfetti")]
    LgConfetti,
    #[serde(rename = "horzBrick")]
    HorzBrick,
    #[serde(rename = "diagBrick")]
    DiagBrick,
    #[serde(rename = "solidDmnd")]
    SolidDmnd,
    #[serde(rename = "openDmnd")]
    OpenDmnd,
    #[serde(rename = "dotDmnd")]
    DotDmnd,
    #[serde(rename = "plaid")]
    Plaid,
    #[serde(rename = "sphere")]
    Sphere,
    #[serde(rename = "weave")]
    Weave,
    #[serde(rename = "divot")]
    Divot,
    #[serde(rename = "shingle")]
    Shingle,
    #[serde(rename = "wave")]
    Wave,
    #[serde(rename = "trellis")]
    Trellis,
    #[serde(rename = "zigZag")]
    ZigZag,
}

// =============================================================================
// Outline / Stroke Types
// =============================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum LineDash {
    #[serde(rename = "solid")]
    Solid,
    #[serde(rename = "dot")]
    Dot,
    #[serde(rename = "dash")]
    Dash,
    #[serde(rename = "dashDot")]
    DashDot,
    #[serde(rename = "lgDash")]
    LgDash,
    #[serde(rename = "lgDashDot")]
    LgDashDot,
    #[serde(rename = "lgDashDotDot")]
    LgDashDotDot,
    #[serde(rename = "sysDash")]
    SysDash,
    #[serde(rename = "sysDot")]
    SysDot,
    #[serde(rename = "sysDashDot")]
    SysDashDot,
    #[serde(rename = "sysDashDotDot")]
    SysDashDotDot,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum LineCap {
    #[serde(rename = "flat")]
    Flat,
    #[serde(rename = "round")]
    Round,
    #[serde(rename = "square")]
    Square,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum LineJoin {
    #[serde(rename = "bevel")]
    Bevel,
    #[serde(rename = "miter")]
    Miter,
    #[serde(rename = "round")]
    Round,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CompoundLine {
    #[serde(rename = "sng")]
    Sng,
    #[serde(rename = "dbl")]
    Dbl,
    #[serde(rename = "thickThin")]
    ThickThin,
    #[serde(rename = "thinThick")]
    ThinThick,
    #[serde(rename = "tri")]
    Tri,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextEffectOutline {
    pub width: f64,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dash: Option<LineDash>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cap: Option<LineCap>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub join: Option<LineJoin>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub miter_limit: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compound: Option<CompoundLine>,
}

// =============================================================================
// Text Effects (mirrors effects.ts)
// =============================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ShadowAlignment {
    #[serde(rename = "tl")]
    TopLeft,
    #[serde(rename = "t")]
    Top,
    #[serde(rename = "tr")]
    TopRight,
    #[serde(rename = "l")]
    Left,
    #[serde(rename = "ctr")]
    Center,
    #[serde(rename = "r")]
    Right,
    #[serde(rename = "bl")]
    BottomLeft,
    #[serde(rename = "b")]
    Bottom,
    #[serde(rename = "br")]
    BottomRight,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum PresetShadowType {
    #[serde(rename = "shdw1")]
    Shdw1,
    #[serde(rename = "shdw2")]
    Shdw2,
    #[serde(rename = "shdw3")]
    Shdw3,
    #[serde(rename = "shdw4")]
    Shdw4,
    #[serde(rename = "shdw5")]
    Shdw5,
    #[serde(rename = "shdw6")]
    Shdw6,
    #[serde(rename = "shdw7")]
    Shdw7,
    #[serde(rename = "shdw8")]
    Shdw8,
    #[serde(rename = "shdw9")]
    Shdw9,
    #[serde(rename = "shdw10")]
    Shdw10,
    #[serde(rename = "shdw11")]
    Shdw11,
    #[serde(rename = "shdw12")]
    Shdw12,
    #[serde(rename = "shdw13")]
    Shdw13,
    #[serde(rename = "shdw14")]
    Shdw14,
    #[serde(rename = "shdw15")]
    Shdw15,
    #[serde(rename = "shdw16")]
    Shdw16,
    #[serde(rename = "shdw17")]
    Shdw17,
    #[serde(rename = "shdw18")]
    Shdw18,
    #[serde(rename = "shdw19")]
    Shdw19,
    #[serde(rename = "shdw20")]
    Shdw20,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OuterShadowEffect {
    pub blur_radius: f64,
    pub distance: f64,
    pub direction: f64,
    pub color: String,
    pub opacity: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skew_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skew_y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alignment: Option<ShadowAlignment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotate_with_shape: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InnerShadowEffect {
    pub blur_radius: f64,
    pub distance: f64,
    pub direction: f64,
    pub color: String,
    pub opacity: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlowEffect {
    pub radius: f64,
    pub color: String,
    pub opacity: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftEdgeEffect {
    pub radius: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflectionEffect {
    pub blur_radius: f64,
    pub start_opacity: f64,
    pub end_opacity: f64,
    pub distance: f64,
    pub direction: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fade_direction: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale_y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skew_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skew_y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alignment: Option<ShadowAlignment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotate_with_shape: Option<bool>,
}

// -- Bevel / 3D types --------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum BevelPreset {
    #[serde(rename = "relaxedInset")]
    RelaxedInset,
    #[serde(rename = "circle")]
    Circle,
    #[serde(rename = "slope")]
    Slope,
    #[serde(rename = "cross")]
    Cross,
    #[serde(rename = "angle")]
    Angle,
    #[serde(rename = "softRound")]
    SoftRound,
    #[serde(rename = "convex")]
    Convex,
    #[serde(rename = "coolSlant")]
    CoolSlant,
    #[serde(rename = "divot")]
    Divot,
    #[serde(rename = "riblet")]
    Riblet,
    #[serde(rename = "hardEdge")]
    HardEdge,
    #[serde(rename = "artDeco")]
    ArtDeco,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BevelEffect {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_preset: Option<BevelPreset>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bottom_preset: Option<BevelPreset>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bottom_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bottom_height: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum MaterialPreset {
    #[serde(rename = "dkEdge")]
    DkEdge,
    #[serde(rename = "flat")]
    Flat,
    #[serde(rename = "legacyMatte")]
    LegacyMatte,
    #[serde(rename = "legacyMetal")]
    LegacyMetal,
    #[serde(rename = "legacyPlastic")]
    LegacyPlastic,
    #[serde(rename = "legacyWireframe")]
    LegacyWireframe,
    #[serde(rename = "matte")]
    Matte,
    #[serde(rename = "metal")]
    Metal,
    #[serde(rename = "plastic")]
    Plastic,
    #[serde(rename = "powder")]
    Powder,
    #[serde(rename = "softEdge")]
    SoftEdge,
    #[serde(rename = "softmetal")]
    Softmetal,
    #[serde(rename = "translucentPowder")]
    TranslucentPowder,
    #[serde(rename = "warmMatte")]
    WarmMatte,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum LightRigType {
    #[serde(rename = "balanced")]
    Balanced,
    #[serde(rename = "brightRoom")]
    BrightRoom,
    #[serde(rename = "chilly")]
    Chilly,
    #[serde(rename = "contrasting")]
    Contrasting,
    #[serde(rename = "flat")]
    Flat,
    #[serde(rename = "flood")]
    Flood,
    #[serde(rename = "freezing")]
    Freezing,
    #[serde(rename = "glow")]
    Glow,
    #[serde(rename = "harsh")]
    Harsh,
    #[serde(rename = "legacyFlat1")]
    LegacyFlat1,
    #[serde(rename = "legacyFlat2")]
    LegacyFlat2,
    #[serde(rename = "legacyFlat3")]
    LegacyFlat3,
    #[serde(rename = "legacyFlat4")]
    LegacyFlat4,
    #[serde(rename = "legacyHarsh1")]
    LegacyHarsh1,
    #[serde(rename = "legacyHarsh2")]
    LegacyHarsh2,
    #[serde(rename = "legacyHarsh3")]
    LegacyHarsh3,
    #[serde(rename = "legacyHarsh4")]
    LegacyHarsh4,
    #[serde(rename = "legacyNormal1")]
    LegacyNormal1,
    #[serde(rename = "legacyNormal2")]
    LegacyNormal2,
    #[serde(rename = "legacyNormal3")]
    LegacyNormal3,
    #[serde(rename = "legacyNormal4")]
    LegacyNormal4,
    #[serde(rename = "morning")]
    Morning,
    #[serde(rename = "soft")]
    Soft,
    #[serde(rename = "sunrise")]
    Sunrise,
    #[serde(rename = "sunset")]
    Sunset,
    #[serde(rename = "threePt")]
    ThreePt,
    #[serde(rename = "twoPt")]
    TwoPt,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum LightDirection {
    #[serde(rename = "t")]
    Top,
    #[serde(rename = "tl")]
    TopLeft,
    #[serde(rename = "tr")]
    TopRight,
    #[serde(rename = "l")]
    Left,
    #[serde(rename = "r")]
    Right,
    #[serde(rename = "b")]
    Bottom,
    #[serde(rename = "bl")]
    BottomLeft,
    #[serde(rename = "br")]
    BottomRight,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transform3DEffect {
    pub rotation_x: f64,
    pub rotation_y: f64,
    pub rotation_z: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub perspective: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extrusion_height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extrusion_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contour_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contour_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub material: Option<MaterialPreset>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub light_rig: Option<LightRigType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub light_direction: Option<LightDirection>,
}

// -- TextEffects container ---------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextEffects {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outer_shadow: Option<OuterShadowEffect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inner_shadow: Option<InnerShadowEffect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset_shadow: Option<PresetShadowType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub glow: Option<GlowEffect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub soft_edge: Option<SoftEdgeEffect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reflection: Option<ReflectionEffect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bevel: Option<BevelEffect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transform_3d: Option<Transform3DEffect>,
}

// =============================================================================
// Text Effect Anchor / TextDirection enums
// =============================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TextEffectAnchor {
    #[serde(rename = "top")]
    Top,
    #[serde(rename = "middle")]
    Middle,
    #[serde(rename = "bottom")]
    Bottom,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TextDirection {
    #[serde(rename = "ltr")]
    Ltr,
    #[serde(rename = "rtl")]
    Rtl,
}

// =============================================================================
// TextEffectConfig — top-level
// =============================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextEffectConfig {
    pub warp_preset: TextWarpPreset,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warp_adjustments: Option<AdjustmentValues>,
    pub fill: TextEffectFill,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline: Option<TextEffectOutline>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effects: Option<TextEffects>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub follow_path: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor: Option<TextEffectAnchor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_direction: Option<TextDirection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub normalize_heights: Option<bool>,
}
