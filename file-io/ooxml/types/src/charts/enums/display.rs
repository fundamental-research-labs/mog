// =============================================================================
// MarkerStyle
// =============================================================================

/// Marker symbol for line/scatter charts (ST_MarkerStyle).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum MarkerStyle {
    /// No marker
    None,
    /// Automatic (varies by series, default)
    #[default]
    Auto,
    /// Circle
    Circle,
    /// Dash
    Dash,
    /// Diamond
    Diamond,
    /// Dot
    Dot,
    /// Picture
    Picture,
    /// Plus sign
    Plus,
    /// Square
    Square,
    /// Star
    Star,
    /// Triangle
    Triangle,
    /// X mark
    X,
}

impl MarkerStyle {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "none" => Self::None,
            "auto" => Self::Auto,
            "circle" => Self::Circle,
            "dash" => Self::Dash,
            "diamond" => Self::Diamond,
            "dot" => Self::Dot,
            "picture" => Self::Picture,
            "plus" => Self::Plus,
            "square" => Self::Square,
            "star" => Self::Star,
            "triangle" => Self::Triangle,
            "x" => Self::X,
            _ => Self::Auto,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Auto => "auto",
            Self::Circle => "circle",
            Self::Dash => "dash",
            Self::Diamond => "diamond",
            Self::Dot => "dot",
            Self::Picture => "picture",
            Self::Plus => "plus",
            Self::Square => "square",
            Self::Star => "star",
            Self::Triangle => "triangle",
            Self::X => "x",
        }
    }
}

// =============================================================================
// LegendPosition
// =============================================================================

/// Legend position on the chart (ST_LegendPos).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum LegendPosition {
    /// Bottom of chart
    Bottom,
    /// Top of chart
    Top,
    /// Left of chart
    Left,
    /// Right of chart (default per ST_LegendPos)
    #[default]
    Right,
    /// Top-right corner
    TopRight,
}

impl LegendPosition {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "b" => Self::Bottom,
            "t" => Self::Top,
            "l" => Self::Left,
            "r" => Self::Right,
            "tr" => Self::TopRight,
            _ => Self::Right,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Bottom => "b",
            Self::Top => "t",
            Self::Left => "l",
            Self::Right => "r",
            Self::TopRight => "tr",
        }
    }
}

// =============================================================================
// DisplayBlanksAs
// =============================================================================

/// How to display blank cells in charts (ST_DispBlanksAs).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum DisplayBlanksAs {
    /// Leave a gap
    Gap,
    /// Connect with a line (span)
    Span,
    /// Treat as zero (default per ST_DispBlanksAs)
    #[default]
    Zero,
}

impl DisplayBlanksAs {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "gap" => Self::Gap,
            "span" => Self::Span,
            "zero" => Self::Zero,
            _ => Self::Zero,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Gap => "gap",
            Self::Span => "span",
            Self::Zero => "zero",
        }
    }
}

// =============================================================================
// DataLabelPosition
// =============================================================================

/// Data label position (ST_DLblPos).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum DataLabelPosition {
    /// Best fit (default)
    #[default]
    BestFit,
    /// Bottom
    Bottom,
    /// Center
    Center,
    /// Inside base
    InsideBase,
    /// Inside end
    InsideEnd,
    /// Left
    Left,
    /// Outside end
    OutsideEnd,
    /// Right
    Right,
    /// Top
    Top,
}

impl DataLabelPosition {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "bestFit" => Self::BestFit,
            "b" => Self::Bottom,
            "ctr" => Self::Center,
            "inBase" => Self::InsideBase,
            "inEnd" => Self::InsideEnd,
            "l" => Self::Left,
            "outEnd" => Self::OutsideEnd,
            "r" => Self::Right,
            "t" => Self::Top,
            _ => Self::BestFit,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::BestFit => "bestFit",
            Self::Bottom => "b",
            Self::Center => "ctr",
            Self::InsideBase => "inBase",
            Self::InsideEnd => "inEnd",
            Self::Left => "l",
            Self::OutsideEnd => "outEnd",
            Self::Right => "r",
            Self::Top => "t",
        }
    }
}

// =============================================================================
// PictureFormat (ST_PictureFormat)
// =============================================================================

/// Picture format for picture options (ST_PictureFormat).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum PictureFormat {
    /// Stretch the picture
    #[default]
    Stretch,
    /// Stack the picture
    Stack,
    /// Stack and scale the picture
    StackScale,
}

impl PictureFormat {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "stretch" => Self::Stretch,
            "stack" => Self::Stack,
            "stackScale" => Self::StackScale,
            _ => Self::Stretch,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Stretch => "stretch",
            Self::Stack => "stack",
            Self::StackScale => "stackScale",
        }
    }
}
