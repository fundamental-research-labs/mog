// =============================================================================
// AxisType
// =============================================================================

/// Type of chart axis (CT_CatAx / CT_ValAx / CT_DateAx / CT_SerAx).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum AxisType {
    /// Category axis (X-axis for most charts)
    #[default]
    Category,
    /// Value axis (Y-axis for most charts)
    Value,
    /// Date axis (X-axis for date data)
    Date,
    /// Series axis (Z-axis for 3-D charts)
    Series,
}

impl AxisType {
    /// Parse from an OOXML element name (`"catAx"`, `"valAx"`, etc.).
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "catAx" => Self::Category,
            "valAx" => Self::Value,
            "dateAx" => Self::Date,
            "serAx" => Self::Series,
            _ => Self::Category,
        }
    }

    /// Serialize to the OOXML element name.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Category => "catAx",
            Self::Value => "valAx",
            Self::Date => "dateAx",
            Self::Series => "serAx",
        }
    }
}

// =============================================================================
// AxisCrosses
// =============================================================================

/// Where the axis crosses (ST_Crosses).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum AxisCrosses {
    /// Auto zero (Excel determines, default)
    #[default]
    AutoZero,
    /// At minimum value
    Min,
    /// At maximum value
    Max,
}

impl AxisCrosses {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "autoZero" => Self::AutoZero,
            "min" => Self::Min,
            "max" => Self::Max,
            _ => Self::AutoZero,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::AutoZero => "autoZero",
            Self::Min => "min",
            Self::Max => "max",
        }
    }
}

// =============================================================================
// Orientation
// =============================================================================

/// Axis orientation (ST_Orientation).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum Orientation {
    /// Normal (min to max, default)
    #[default]
    MinMax,
    /// Reversed (max to min)
    MaxMin,
}

impl Orientation {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "minMax" => Self::MinMax,
            "maxMin" => Self::MaxMin,
            _ => Self::MinMax,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::MinMax => "minMax",
            Self::MaxMin => "maxMin",
        }
    }
}

// =============================================================================
// TickMark
// =============================================================================

/// Tick mark type (ST_TickMark).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum TickMark {
    /// Cross -- tick marks on both sides of the axis line (default per ST_TickMark)
    #[default]
    Cross,
    /// Inside -- tick marks inside the chart area
    In,
    /// No tick marks
    None,
    /// Outside -- tick marks outside the chart area
    Out,
}

impl TickMark {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "cross" => Self::Cross,
            "in" => Self::In,
            "none" => Self::None,
            "out" => Self::Out,
            _ => Self::Cross,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Cross => "cross",
            Self::In => "in",
            Self::None => "none",
            Self::Out => "out",
        }
    }
}

// =============================================================================
// TickLabelPosition
// =============================================================================

/// Tick label position (ST_TickLblPos).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum TickLabelPosition {
    /// High (at maximum of axis)
    High,
    /// Low (at minimum of axis)
    Low,
    /// Next to the axis line (default)
    #[default]
    NextTo,
    /// No tick labels
    None,
}

impl TickLabelPosition {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "high" => Self::High,
            "low" => Self::Low,
            "nextTo" => Self::NextTo,
            "none" => Self::None,
            _ => Self::NextTo,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::High => "high",
            Self::Low => "low",
            Self::NextTo => "nextTo",
            Self::None => "none",
        }
    }
}

// =============================================================================
// LabelAlignment
// =============================================================================

/// Label alignment for category axis labels (ST_LblAlgn).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum LabelAlignment {
    /// Center aligned (default)
    #[default]
    Center,
    /// Left aligned
    Left,
    /// Right aligned
    Right,
}

impl LabelAlignment {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "ctr" => Self::Center,
            "l" => Self::Left,
            "r" => Self::Right,
            _ => Self::Center,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Center => "ctr",
            Self::Left => "l",
            Self::Right => "r",
        }
    }
}

// =============================================================================
// TimeUnit
// =============================================================================

/// Time unit for date axes (ST_TimeUnit).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum TimeUnit {
    /// Days (default)
    #[default]
    Days,
    /// Months
    Months,
    /// Years
    Years,
}

impl TimeUnit {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "days" => Self::Days,
            "months" => Self::Months,
            "years" => Self::Years,
            _ => Self::Days,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Days => "days",
            Self::Months => "months",
            Self::Years => "years",
        }
    }
}

// =============================================================================
// CrossBetween (ST_CrossBetween)
// =============================================================================

/// How the value axis crosses the category axis (ST_CrossBetween).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum CrossBetween {
    /// Crosses between categories (default)
    #[default]
    Between,
    /// Crosses at midpoint of categories
    MidCat,
}

impl CrossBetween {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "between" => Self::Between,
            "midCat" => Self::MidCat,
            _ => Self::Between,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Between => "between",
            Self::MidCat => "midCat",
        }
    }
}

// =============================================================================
// BuiltInUnit (ST_BuiltInUnit)
// =============================================================================

/// Built-in display unit for value axes (ST_BuiltInUnit).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum BuiltInUnit {
    /// Hundreds
    Hundreds,
    /// Thousands
    Thousands,
    /// Ten thousands
    TenThousands,
    /// Hundred thousands
    HundredThousands,
    /// Millions
    Millions,
    /// Ten millions
    TenMillions,
    /// Hundred millions
    HundredMillions,
    /// Billions
    Billions,
    /// Trillions
    Trillions,
}

impl BuiltInUnit {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "hundreds" => Self::Hundreds,
            "thousands" => Self::Thousands,
            "tenThousands" => Self::TenThousands,
            "hundredThousands" => Self::HundredThousands,
            "millions" => Self::Millions,
            "tenMillions" => Self::TenMillions,
            "hundredMillions" => Self::HundredMillions,
            "billions" => Self::Billions,
            "trillions" => Self::Trillions,
            _ => Self::Thousands,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Hundreds => "hundreds",
            Self::Thousands => "thousands",
            Self::TenThousands => "tenThousands",
            Self::HundredThousands => "hundredThousands",
            Self::Millions => "millions",
            Self::TenMillions => "tenMillions",
            Self::HundredMillions => "hundredMillions",
            Self::Billions => "billions",
            Self::Trillions => "trillions",
        }
    }
}

// =============================================================================
// ChartAxisPosition (ST_AxPos)
// =============================================================================

/// Chart axis position (CT_PlotArea axis placement).
///
/// Controls where an axis is placed on a chart (Bottom, Top, Left, Right).
/// This is semantically different from `DataBarAxisPosition` which controls
/// axis behaviour in conditional formatting data bars.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum ChartAxisPosition {
    /// Bottom of chart (default for category axis)
    #[default]
    Bottom,
    /// Top of chart
    Top,
    /// Left of chart (default for value axis)
    Left,
    /// Right of chart
    Right,
}

impl ChartAxisPosition {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "b" => Self::Bottom,
            "t" => Self::Top,
            "l" => Self::Left,
            "r" => Self::Right,
            _ => Self::Bottom,
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
        }
    }
}
