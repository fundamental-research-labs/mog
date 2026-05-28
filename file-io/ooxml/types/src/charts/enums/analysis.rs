// =============================================================================
// ErrorBarDirection
// =============================================================================

/// Error bar direction (ST_ErrDir).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum ErrorBarDirection {
    /// X direction
    X,
    /// Y direction (default)
    #[default]
    Y,
}

impl ErrorBarDirection {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "x" => Self::X,
            "y" => Self::Y,
            _ => Self::Y,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::X => "x",
            Self::Y => "y",
        }
    }
}

// =============================================================================
// ErrorBarType
// =============================================================================

/// Error bar type (ST_ErrBarType).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum ErrorBarType {
    /// Both plus and minus (default)
    #[default]
    Both,
    /// Plus only
    Plus,
    /// Minus only
    Minus,
}

impl ErrorBarType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "both" => Self::Both,
            "plus" => Self::Plus,
            "minus" => Self::Minus,
            _ => Self::Both,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Both => "both",
            Self::Plus => "plus",
            Self::Minus => "minus",
        }
    }
}

// =============================================================================
// ErrorValueType
// =============================================================================

/// Error value type (ST_ErrValType).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum ErrorValueType {
    /// Custom error values
    Custom,
    /// Fixed value (default per ST_ErrValType)
    #[default]
    FixedVal,
    /// Percentage
    Percentage,
    /// Standard deviation
    StdDev,
    /// Standard error
    StdErr,
}

impl ErrorValueType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "cust" => Self::Custom,
            "fixedVal" => Self::FixedVal,
            "percentage" => Self::Percentage,
            "stdDev" => Self::StdDev,
            "stdErr" => Self::StdErr,
            _ => Self::FixedVal,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Custom => "cust",
            Self::FixedVal => "fixedVal",
            Self::Percentage => "percentage",
            Self::StdDev => "stdDev",
            Self::StdErr => "stdErr",
        }
    }
}

// =============================================================================
// TrendlineType
// =============================================================================

/// Trendline type (ST_TrendlineType).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum TrendlineType {
    /// Exponential trendline
    Exponential,
    /// Linear trendline (default)
    #[default]
    Linear,
    /// Logarithmic trendline
    Logarithmic,
    /// Moving average
    MovingAverage,
    /// Polynomial trendline
    Polynomial,
    /// Power trendline
    Power,
}

impl TrendlineType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "exp" => Self::Exponential,
            "linear" => Self::Linear,
            "log" => Self::Logarithmic,
            "movingAvg" => Self::MovingAverage,
            "poly" => Self::Polynomial,
            "power" => Self::Power,
            _ => Self::Linear,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Exponential => "exp",
            Self::Linear => "linear",
            Self::Logarithmic => "log",
            Self::MovingAverage => "movingAvg",
            Self::Polynomial => "poly",
            Self::Power => "power",
        }
    }
}
