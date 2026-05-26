//! Line and stroke types for DrawingML (ECMA-376 CT_LineProperties).

use super::primitives::Emu;

// =============================================================================
// DashStyle
// =============================================================================

/// Line dash style (ECMA-376 ST_PresetLineDashVal).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum DashStyle {
    /// Solid line (no dashes).
    #[default]
    Solid,
    /// Dotted.
    Dot,
    /// Dashed.
    Dash,
    /// Dash-dot.
    DashDot,
    /// Long dash.
    LongDash,
    /// Long dash-dot.
    LongDashDot,
    /// Long dash-dot-dot.
    LongDashDotDot,
    /// System dash.
    SystemDash,
    /// System dot.
    SystemDot,
    /// System dash-dot.
    SystemDashDot,
    /// System dash-dot-dot.
    SystemDashDotDot,
}

impl DashStyle {
    /// Parse from an OOXML `val` attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "solid" => Self::Solid,
            "dot" => Self::Dot,
            "dash" => Self::Dash,
            "dashDot" => Self::DashDot,
            "lgDash" => Self::LongDash,
            "lgDashDot" => Self::LongDashDot,
            "lgDashDotDot" => Self::LongDashDotDot,
            "sysDash" => Self::SystemDash,
            "sysDot" => Self::SystemDot,
            "sysDashDot" => Self::SystemDashDot,
            "sysDashDotDot" => Self::SystemDashDotDot,
            _ => Self::Solid,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Solid => "solid",
            Self::Dot => "dot",
            Self::Dash => "dash",
            Self::DashDot => "dashDot",
            Self::LongDash => "lgDash",
            Self::LongDashDot => "lgDashDot",
            Self::LongDashDotDot => "lgDashDotDot",
            Self::SystemDash => "sysDash",
            Self::SystemDot => "sysDot",
            Self::SystemDashDot => "sysDashDot",
            Self::SystemDashDotDot => "sysDashDotDot",
        }
    }
}

// =============================================================================
// CompoundLine
// =============================================================================

/// Compound line type (ECMA-376 ST_CompoundLine).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum CompoundLine {
    /// Single line.
    #[default]
    Single,
    /// Double line.
    Double,
    /// Thick-thin double line.
    ThickThin,
    /// Thin-thick double line.
    ThinThick,
    /// Triple line.
    Triple,
}

impl CompoundLine {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "sng" => Self::Single,
            "dbl" => Self::Double,
            "thickThin" => Self::ThickThin,
            "thinThick" => Self::ThinThick,
            "tri" => Self::Triple,
            _ => Self::Single,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Single => "sng",
            Self::Double => "dbl",
            Self::ThickThin => "thickThin",
            Self::ThinThick => "thinThick",
            Self::Triple => "tri",
        }
    }
}

// =============================================================================
// LineCap
// =============================================================================

/// Line end cap type (ECMA-376 ST_LineCap).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum LineCap {
    /// Flat cap (line ends exactly at endpoint).
    #[default]
    Flat,
    /// Square cap (extends half the line width beyond endpoint).
    Square,
    /// Round cap (semicircle at endpoint).
    Round,
}

impl LineCap {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "flat" => Self::Flat,
            "sq" => Self::Square,
            "rnd" => Self::Round,
            _ => Self::Flat,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Flat => "flat",
            Self::Square => "sq",
            Self::Round => "rnd",
        }
    }
}

// =============================================================================
// LineEndType
// =============================================================================

/// Line end decoration type (ECMA-376 ST_LineEndType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum LineEndType {
    /// No line end decoration.
    #[default]
    None,
    /// Triangle arrowhead.
    Triangle,
    /// Stealth arrowhead.
    Stealth,
    /// Diamond arrowhead.
    Diamond,
    /// Oval arrowhead.
    Oval,
    /// Arrow arrowhead.
    Arrow,
}

impl LineEndType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Option<Self> {
        match s {
            "none" => Some(Self::None),
            "triangle" => Some(Self::Triangle),
            "stealth" => Some(Self::Stealth),
            "diamond" => Some(Self::Diamond),
            "oval" => Some(Self::Oval),
            "arrow" => Some(Self::Arrow),
            _ => Option::None,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Triangle => "triangle",
            Self::Stealth => "stealth",
            Self::Diamond => "diamond",
            Self::Oval => "oval",
            Self::Arrow => "arrow",
        }
    }
}

// =============================================================================
// LineEndSize
// =============================================================================

/// Line end decoration size (ECMA-376 ST_LineEndWidth / ST_LineEndLength).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum LineEndSize {
    /// Small.
    Small,
    /// Medium.
    Medium,
    /// Large.
    Large,
}

impl LineEndSize {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Option<Self> {
        match s {
            "sm" => Some(Self::Small),
            "med" => Some(Self::Medium),
            "lg" => Some(Self::Large),
            _ => None,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Small => "sm",
            Self::Medium => "med",
            Self::Large => "lg",
        }
    }
}

// =============================================================================
// LineJoin
// =============================================================================

/// Line join type (ECMA-376 EG_LineJoinProperties).
///
/// Parsed from child elements (`<a:round/>`, `<a:bevel/>`, `<a:miter lim="..."/>`),
/// not from a single attribute value.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum LineJoin {
    /// Round join.
    Round,
    /// Bevel join.
    Bevel,
    /// Miter join with optional limit (in 1/100ths of a percent).
    Miter { limit: Option<i32> },
}

// =============================================================================
// PenAlignment
// =============================================================================

/// Pen alignment (ECMA-376 ST_PenAlignment).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum PenAlignment {
    /// Center alignment (stroke centered on the path).
    Center,
    /// Inset alignment (stroke inside the path).
    Inset,
}

impl PenAlignment {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Option<Self> {
        match s {
            "ctr" => Some(Self::Center),
            "in" => Some(Self::Inset),
            _ => None,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Center => "ctr",
            Self::Inset => "in",
        }
    }
}

// =============================================================================
// LineEndProperties
// =============================================================================

/// Line end (arrowhead) properties (ECMA-376 CT_LineEndProperties).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct LineEndProperties {
    /// End decoration type.
    pub end_type: Option<LineEndType>,
    /// End decoration width.
    pub width: Option<LineEndSize>,
    /// End decoration length.
    pub length: Option<LineEndSize>,
}

// =============================================================================
// LineFill
// =============================================================================

/// Line fill properties (ECMA-376 EG_LineFillProperties).
///
/// Lines support 4 fill types, not just solid color.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum LineFill {
    /// No fill (transparent line).
    NoFill,
    /// Solid colour fill.
    Solid(super::fill::SolidFill),
    /// Gradient fill.
    Gradient(super::fill::GradientFill),
    /// Pattern fill.
    Pattern(super::fill::PatternFill),
}

// =============================================================================
// DashStop / LineDash
// =============================================================================

/// Custom dash stop (ECMA-376 CT_DashStop).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct DashStop {
    /// Dash length (percentage, 100000 = 100%).
    pub d: u32,
    /// Space length (percentage, 100000 = 100%).
    pub sp: u32,
}

/// Line dash style (ECMA-376 choice of prstDash | custDash).
///
/// The XSD defines preset and custom dash as a choice group —
/// a line has one or the other, never both.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum LineDash {
    /// Preset dash pattern (`<a:prstDash val="...">`).
    Preset(DashStyle),
    /// Custom dash pattern (`<a:custDash>` with `<a:ds>` children).
    Custom(Vec<DashStop>),
}

// =============================================================================
// Outline
// =============================================================================

/// Line / outline properties (ECMA-376 CT_LineProperties).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Outline {
    /// Line width in EMUs.
    pub width: Option<Emu>,
    /// Line fill (ECMA-376 EG_LineFillProperties).
    pub fill: Option<LineFill>,
    /// Dash style (preset or custom).
    pub dash: Option<LineDash>,
    /// Compound line type.
    pub compound: Option<CompoundLine>,
    /// Line end cap type.
    pub cap: Option<LineCap>,
    /// Head end (arrowhead) properties.
    pub head_end: Option<LineEndProperties>,
    /// Tail end (arrowhead) properties.
    pub tail_end: Option<LineEndProperties>,
    /// Line join style.
    pub join: Option<LineJoin>,
    /// Pen alignment.
    pub align: Option<PenAlignment>,
}
