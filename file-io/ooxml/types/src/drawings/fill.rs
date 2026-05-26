//! Fill types for DrawingML (ECMA-376 EG_FillProperties).

use super::color::DrawingColor;
use super::effects::{BlurEffect, FillOverlayEffect};
use super::primitives::{StAngle, StCoordinate, StPercentage, StPositiveFixedPercentageDecimal};

fn is_zero_u8(v: &u8) -> bool {
    *v == 0
}

// =============================================================================
// CompressionState
// =============================================================================

/// Image compression state (ECMA-376 ST_BlipCompression).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum CompressionState {
    /// No compression.
    #[default]
    None,
    /// Print quality.
    Print,
    /// Screen quality.
    Screen,
    /// Email quality (most compressed).
    Email,
    /// High-quality print.
    HqPrint,
}

impl CompressionState {
    /// Parse from an OOXML `cstate` attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "none" => Self::None,
            "print" => Self::Print,
            "screen" => Self::Screen,
            "email" => Self::Email,
            "hqprint" => Self::HqPrint,
            _ => Self::None,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Print => "print",
            Self::Screen => "screen",
            Self::Email => "email",
            Self::HqPrint => "hqprint",
        }
    }
}

// =============================================================================
// Fill
// =============================================================================

/// Fill style for drawing shapes (ECMA-376 EG_FillProperties group).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub enum DrawingFill {
    /// No fill (transparent).
    #[default]
    NoFill,
    /// Solid colour fill.
    Solid(SolidFill),
    /// Gradient fill.
    Gradient(GradientFill),
    /// Pattern fill.
    Pattern(PatternFill),
    /// Picture / texture fill.
    Blip(BlipFill),
    /// Group fill — inherits fill from parent group.
    Group,
}

/// Solid colour fill.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SolidFill {
    /// Fill colour.
    pub color: DrawingColor,
}

/// Gradient path type (ECMA-376 ST_PathShadeType).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum GradientPathType {
    /// Circular gradient from center.
    Circle,
    /// Rectangular gradient.
    Rect,
    /// Shape-conforming gradient.
    Shape,
}

impl GradientPathType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Option<Self> {
        match s {
            "circle" => Some(Self::Circle),
            "rect" => Some(Self::Rect),
            "shape" => Some(Self::Shape),
            _ => None,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Circle => "circle",
            Self::Rect => "rect",
            Self::Shape => "shape",
        }
    }
}

/// Relative rectangle (ECMA-376 CT_RelativeRect).
/// Values are percentages (0-100000 where 100000 = 100%).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RelativeRect {
    pub l: Option<StPercentage>,
    pub t: Option<StPercentage>,
    pub r: Option<StPercentage>,
    pub b: Option<StPercentage>,
}

/// Gradient fill (ECMA-376 CT_GradientFillProperties, dml-main.xsd:1438).
///
/// **Intentional flattening**: The XSD `lin` element (CT_LinearShadeProperties) with
/// attributes `@ang` and `@scaled` is flattened into `lin_ang` and `lin_scaled` fields
/// directly on this struct, since the intermediate wrapper type adds no semantic value.
/// Similarly, `path` (CT_PathShadeProperties) children are flattened into `path`,
/// `fill_to_rect`.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GradientFill {
    /// Linear shade angle in 60000ths of a degree (from `lin/@ang`, CT_LinearShadeProperties).
    pub lin_ang: Option<StAngle>,
    /// Whether linear angle is scaled with shape (from `lin/@scaled`, CT_LinearShadeProperties).
    pub lin_scaled: Option<bool>,
    /// Gradient colour stops (2+).
    pub stops: Vec<GradientStop>,
    /// Path shade type (if not linear).
    pub path: Option<GradientPathType>,
    /// Fill-to rectangle for path gradients (percentages 0-100000).
    pub fill_to_rect: Option<RelativeRect>,
    /// Tile rectangle.
    pub tile_rect: Option<RelativeRect>,
    /// Tile flip mode.
    pub flip: Option<TileFlipMode>,
    /// Whether gradient rotates with shape.
    pub rotate_with_shape: Option<bool>,
}

/// A single colour stop within a gradient.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GradientStop {
    /// Position within the gradient (0-100000 in OOXML units).
    pub position: StPositiveFixedPercentageDecimal,
    /// Colour at this stop.
    pub color: DrawingColor,
}

// =============================================================================
// PresetPatternVal
// =============================================================================

/// Preset pattern fill value (ECMA-376 ST_PresetPatternVal).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum PresetPatternVal {
    Pct5,
    Pct10,
    Pct20,
    Pct25,
    Pct30,
    Pct40,
    Pct50,
    Pct60,
    Pct70,
    Pct75,
    Pct80,
    Pct90,
    Horz,
    Vert,
    LtHorz,
    LtVert,
    DkHorz,
    DkVert,
    NarHorz,
    NarVert,
    DashHorz,
    DashVert,
    Cross,
    DnDiag,
    UpDiag,
    LtDnDiag,
    LtUpDiag,
    DkDnDiag,
    DkUpDiag,
    WdDnDiag,
    WdUpDiag,
    DashDnDiag,
    DashUpDiag,
    DiagCross,
    SmCheck,
    LgCheck,
    SmGrid,
    LgGrid,
    DotGrid,
    SmConfetti,
    LgConfetti,
    HorzBrick,
    DiagBrick,
    SolidDmnd,
    OpenDmnd,
    DotDmnd,
    Plaid,
    Sphere,
    Weave,
    Divot,
    Shingle,
    Wave,
    Trellis,
    ZigZag,
}

impl PresetPatternVal {
    /// Parse from an OOXML `prst` attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Option<Self> {
        match s {
            "pct5" => Some(Self::Pct5),
            "pct10" => Some(Self::Pct10),
            "pct20" => Some(Self::Pct20),
            "pct25" => Some(Self::Pct25),
            "pct30" => Some(Self::Pct30),
            "pct40" => Some(Self::Pct40),
            "pct50" => Some(Self::Pct50),
            "pct60" => Some(Self::Pct60),
            "pct70" => Some(Self::Pct70),
            "pct75" => Some(Self::Pct75),
            "pct80" => Some(Self::Pct80),
            "pct90" => Some(Self::Pct90),
            "horz" => Some(Self::Horz),
            "vert" => Some(Self::Vert),
            "ltHorz" => Some(Self::LtHorz),
            "ltVert" => Some(Self::LtVert),
            "dkHorz" => Some(Self::DkHorz),
            "dkVert" => Some(Self::DkVert),
            "narHorz" => Some(Self::NarHorz),
            "narVert" => Some(Self::NarVert),
            "dashHorz" => Some(Self::DashHorz),
            "dashVert" => Some(Self::DashVert),
            "cross" => Some(Self::Cross),
            "dnDiag" => Some(Self::DnDiag),
            "upDiag" => Some(Self::UpDiag),
            "ltDnDiag" => Some(Self::LtDnDiag),
            "ltUpDiag" => Some(Self::LtUpDiag),
            "dkDnDiag" => Some(Self::DkDnDiag),
            "dkUpDiag" => Some(Self::DkUpDiag),
            "wdDnDiag" => Some(Self::WdDnDiag),
            "wdUpDiag" => Some(Self::WdUpDiag),
            "dashDnDiag" => Some(Self::DashDnDiag),
            "dashUpDiag" => Some(Self::DashUpDiag),
            "diagCross" => Some(Self::DiagCross),
            "smCheck" => Some(Self::SmCheck),
            "lgCheck" => Some(Self::LgCheck),
            "smGrid" => Some(Self::SmGrid),
            "lgGrid" => Some(Self::LgGrid),
            "dotGrid" => Some(Self::DotGrid),
            "smConfetti" => Some(Self::SmConfetti),
            "lgConfetti" => Some(Self::LgConfetti),
            "horzBrick" => Some(Self::HorzBrick),
            "diagBrick" => Some(Self::DiagBrick),
            "solidDmnd" => Some(Self::SolidDmnd),
            "openDmnd" => Some(Self::OpenDmnd),
            "dotDmnd" => Some(Self::DotDmnd),
            "plaid" => Some(Self::Plaid),
            "sphere" => Some(Self::Sphere),
            "weave" => Some(Self::Weave),
            "divot" => Some(Self::Divot),
            "shingle" => Some(Self::Shingle),
            "wave" => Some(Self::Wave),
            "trellis" => Some(Self::Trellis),
            "zigZag" => Some(Self::ZigZag),
            _ => None,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Pct5 => "pct5",
            Self::Pct10 => "pct10",
            Self::Pct20 => "pct20",
            Self::Pct25 => "pct25",
            Self::Pct30 => "pct30",
            Self::Pct40 => "pct40",
            Self::Pct50 => "pct50",
            Self::Pct60 => "pct60",
            Self::Pct70 => "pct70",
            Self::Pct75 => "pct75",
            Self::Pct80 => "pct80",
            Self::Pct90 => "pct90",
            Self::Horz => "horz",
            Self::Vert => "vert",
            Self::LtHorz => "ltHorz",
            Self::LtVert => "ltVert",
            Self::DkHorz => "dkHorz",
            Self::DkVert => "dkVert",
            Self::NarHorz => "narHorz",
            Self::NarVert => "narVert",
            Self::DashHorz => "dashHorz",
            Self::DashVert => "dashVert",
            Self::Cross => "cross",
            Self::DnDiag => "dnDiag",
            Self::UpDiag => "upDiag",
            Self::LtDnDiag => "ltDnDiag",
            Self::LtUpDiag => "ltUpDiag",
            Self::DkDnDiag => "dkDnDiag",
            Self::DkUpDiag => "dkUpDiag",
            Self::WdDnDiag => "wdDnDiag",
            Self::WdUpDiag => "wdUpDiag",
            Self::DashDnDiag => "dashDnDiag",
            Self::DashUpDiag => "dashUpDiag",
            Self::DiagCross => "diagCross",
            Self::SmCheck => "smCheck",
            Self::LgCheck => "lgCheck",
            Self::SmGrid => "smGrid",
            Self::LgGrid => "lgGrid",
            Self::DotGrid => "dotGrid",
            Self::SmConfetti => "smConfetti",
            Self::LgConfetti => "lgConfetti",
            Self::HorzBrick => "horzBrick",
            Self::DiagBrick => "diagBrick",
            Self::SolidDmnd => "solidDmnd",
            Self::OpenDmnd => "openDmnd",
            Self::DotDmnd => "dotDmnd",
            Self::Plaid => "plaid",
            Self::Sphere => "sphere",
            Self::Weave => "weave",
            Self::Divot => "divot",
            Self::Shingle => "shingle",
            Self::Wave => "wave",
            Self::Trellis => "trellis",
            Self::ZigZag => "zigZag",
        }
    }
}

/// Pattern fill.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PatternFill {
    /// Pattern preset type.
    pub preset: Option<PresetPatternVal>,
    /// Foreground colour.
    pub fg_color: Option<DrawingColor>,
    /// Background colour.
    pub bg_color: Option<DrawingColor>,
}

/// Blip (picture / texture) fill referencing image data.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BlipFill {
    /// Relationship ID for an embedded image (e.g., "rId1").
    pub embed_id: Option<String>,
    /// Relationship ID for an externally linked image.
    pub link_id: Option<String>,
    /// Image compression state.
    pub compression: Option<CompressionState>,
    /// Source rectangle for image cropping (ECMA-376 `srcRect`, CT_RelativeRect).
    pub source_rect: Option<SourceRect>,
    /// Blip-level image effects (ECMA-376 effect children of CT_Blip).
    pub effects: Vec<BlipEffect>,
    /// Fill mode — stretch or tile (ECMA-376 CT_BlipFillProperties choice).
    pub fill_mode: Option<FillMode>,
    /// Resolution in DPI (ECMA-376 `@dpi` on CT_BlipFillProperties).
    pub dpi: Option<u32>,
    /// Whether the fill rotates with the shape (ECMA-376 `@rotWithShape` on CT_BlipFillProperties).
    pub rot_with_shape: Option<bool>,
    /// Extension list — opaque XML passthrough (CT_Blip extLst).
    pub ext_lst: Option<String>,
    /// Bitmask tracking which `srcRect` attributes were explicitly present in the
    /// original XML (bit 0 = l, bit 1 = t, bit 2 = r, bit 3 = b).
    /// Used by the writer to avoid emitting default zeros for absent attributes.
    #[serde(default, skip_serializing_if = "is_zero_u8")]
    pub src_rect_explicit: u8,
}

// =============================================================================
// SourceRect
// =============================================================================

/// Source rectangle for image cropping (ECMA-376 CT_RelativeRect).
///
/// Values use OOXML's percentage scale: 0-100000 where 100000 = 100%.
/// All zeros means no cropping (full image visible).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SourceRect {
    /// Top crop percentage (0-100000).
    pub top: StPositiveFixedPercentageDecimal,
    /// Bottom crop percentage (0-100000).
    pub bottom: StPositiveFixedPercentageDecimal,
    /// Left crop percentage (0-100000).
    pub left: StPositiveFixedPercentageDecimal,
    /// Right crop percentage (0-100000).
    pub right: StPositiveFixedPercentageDecimal,
}

// =============================================================================
// BlipEffect
// =============================================================================

/// Blip-level image effect (ECMA-376 EG_EffectExtension children of CT_Blip).
///
/// Covers all 17 effect elements that can appear as children of `<a:blip>`.
/// Complex effects with child structures store simplified representations;
/// full fidelity is deferred for `ColorChange` and `AlphaModulate`.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum BlipEffect {
    /// Fixed alpha modulation (`a:alphaModFix`). `amt` is 0-100000 (100000 = fully opaque).
    AlphaModFix { amt: u32 },
    /// Luminance adjustment (`a:lum`). `bright` and `contrast` are ST_FixedPercentage (-100000..100000).
    Luminance { bright: i32, contrast: i32 },
    /// Grayscale conversion (`a:grayscl`). No attributes.
    Grayscale,
    /// Bi-level (black & white) threshold (`a:biLevel`). `thresh` is 0-100000.
    BiLevel { thresh: u32 },
    /// Alpha bi-level threshold (`a:alphaBiLevel`). `thresh` is 0-100000.
    AlphaBiLevel { thresh: u32 },
    /// Alpha ceiling (`a:alphaCeiling`). No attributes.
    AlphaCeiling,
    /// Alpha floor (`a:alphaFloor`). No attributes.
    AlphaFloor,
    /// Alpha inverse (`a:alphaInv`). Optional color parameter.
    AlphaInverse { color: Option<DrawingColor> },
    /// Alpha modulate (`a:alphaMod`). Complex effect container — stored opaque for roundtrip.
    AlphaModulate,
    /// Alpha replace (`a:alphaRepl`). `alpha` is 0-100000.
    AlphaReplace { alpha: u32 },
    /// Gaussian blur (`a:blur`). See [`BlurEffect`] for fields.
    Blur(BlurEffect),
    /// Chroma key / transparent color (`a:clrChange`).
    /// Complex clrFrom/clrTo children stored as raw XML for roundtrip fidelity.
    ColorChange {
        use_alpha: bool,
        raw_xml: Option<String>,
    },
    /// Color replacement (`a:clrRepl`). Replaces all colors with given color.
    ColorReplace { color: Option<DrawingColor> },
    /// Duotone effect (`a:duotone`). Two colors define the mapping.
    Duotone {
        color1: Option<DrawingColor>,
        color2: Option<DrawingColor>,
    },
    /// Fill overlay (`a:fillOverlay`). See [`FillOverlayEffect`] for fields.
    FillOverlay(FillOverlayEffect),
    /// HSL shift (`a:hsl`). `hue` is ST_PositiveFixedAngle (0-21600000, 60000ths of degree);
    /// `sat` and `lum` are ST_FixedPercentage (-100000..100000).
    Hsl { hue: i32, sat: i32, lum: i32 },
    /// Tint effect (`a:tint`). `hue` is ST_PositiveFixedAngle; `amt` is ST_FixedPercentage.
    Tint { hue: i32, amt: i32 },
}

// =============================================================================
// VideoFile
// =============================================================================

/// Video file reference (ECMA-376 CT_VideoFile).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct VideoFile {
    /// Relationship ID to the video file (r:link).
    pub link: String,
    /// Content type of the video (e.g., "video/mp4").
    pub content_type: Option<String>,
}

// =============================================================================
// TileFill
// =============================================================================

/// Tile flip mode for tiled fills (ECMA-376 ST_TileFlipMode).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TileFlipMode {
    #[default]
    None,
    X,
    Y,
    XY,
}

impl TileFlipMode {
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "none" => Self::None,
            "x" => Self::X,
            "y" => Self::Y,
            "xy" => Self::XY,
            _ => Self::None,
        }
    }

    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::X => "x",
            Self::Y => "y",
            Self::XY => "xy",
        }
    }
}

/// Rectangle alignment for tile anchoring (ECMA-376 ST_RectAlignment).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum RectAlignment {
    TopLeft,
    Top,
    TopRight,
    Left,
    #[default]
    Center,
    Right,
    BottomLeft,
    Bottom,
    BottomRight,
}

impl RectAlignment {
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "tl" => Self::TopLeft,
            "t" => Self::Top,
            "tr" => Self::TopRight,
            "l" => Self::Left,
            "ctr" => Self::Center,
            "r" => Self::Right,
            "bl" => Self::BottomLeft,
            "b" => Self::Bottom,
            "br" => Self::BottomRight,
            _ => Self::Center,
        }
    }

    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::TopLeft => "tl",
            Self::Top => "t",
            Self::TopRight => "tr",
            Self::Left => "l",
            Self::Center => "ctr",
            Self::Right => "r",
            Self::BottomLeft => "bl",
            Self::Bottom => "b",
            Self::BottomRight => "br",
        }
    }
}

/// Tile fill properties for tiled image fills (ECMA-376 CT_TileInfoProperties).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TileFill {
    /// Horizontal offset in EMUs.
    pub tx: Option<StCoordinate>,
    /// Vertical offset in EMUs.
    pub ty: Option<StCoordinate>,
    /// Horizontal scale (percentage, 100000 = 100%).
    pub sx: Option<StPercentage>,
    /// Vertical scale (percentage, 100000 = 100%).
    pub sy: Option<StPercentage>,
    /// Tile flip mode.
    pub flip: TileFlipMode,
    /// Tile alignment anchor.
    pub align: Option<RectAlignment>,
}

// =============================================================================
// FillMode
// =============================================================================

/// Blip fill mode — how the image fills its container (ECMA-376 CT_BlipFillProperties choice).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum FillMode {
    /// Stretch fill with optional inset rectangle.
    Stretch { fill_rect: Option<SourceRect> },
    /// Tile fill with tiling parameters.
    Tile(TileFill),
}
