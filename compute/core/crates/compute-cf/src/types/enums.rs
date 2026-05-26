//! Shared enums for conditional formatting types.
//!
//! **NOTE**: `CFRuleType`, `CFOperator`, `CFTextOperator`, `DatePeriod` canonical
//! definitions now live in `domain_types::domain::conditional_format`.
//! This module re-exports them for backward compatibility.

use serde::{Deserialize, Serialize};

pub use domain_types::domain::conditional_format::{
    CFOperator, CFRuleType, CFTextOperator, DatePeriod,
};

/// How to determine the value for a color scale / data bar / icon set point.
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum CFValueType {
    Min,
    Max,
    Percent,
    Percentile,
    Number,
    Formula,
}

/// Direction for data bar rendering.
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum CFDataBarDirection {
    #[default]
    LeftToRight,
    RightToLeft,
    Context,
}

/// Axis position for data bars with negative values.
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum CFDataBarAxisPosition {
    #[default]
    Automatic,
    Midpoint,
    None,
}

/// Threshold comparison operator for icon sets.
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum CFIconThresholdOperator {
    GreaterThanOrEqual,
    GreaterThan,
}

/// Excel icon set names (20 known sets; `NoIcons` and `Custom` are sentinel
/// variants). Excludes `4Symbols`/`4Symbols2` which have no `IconSetType`
/// variant under the strict-parse regime.
/// Enum ensures compile-time exhaustiveness and prevents typos.
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CFIconSetName {
    #[serde(rename = "3Arrows")]
    ThreeArrows,
    #[serde(rename = "3ArrowsGray")]
    ThreeArrowsGray,
    #[serde(rename = "3Flags")]
    ThreeFlags,
    #[serde(rename = "3TrafficLights1")]
    ThreeTrafficLights1,
    #[serde(rename = "3TrafficLights2")]
    ThreeTrafficLights2,
    #[serde(rename = "3Signs")]
    ThreeSigns,
    #[serde(rename = "3Symbols")]
    ThreeSymbols,
    #[serde(rename = "3Symbols2")]
    ThreeSymbols2,
    #[serde(rename = "3Stars")]
    ThreeStars,
    #[serde(rename = "3Triangles")]
    ThreeTriangles,
    #[serde(rename = "4Arrows")]
    FourArrows,
    #[serde(rename = "4ArrowsGray")]
    FourArrowsGray,
    #[serde(rename = "4RedToBlack")]
    FourRedToBlack,
    #[serde(rename = "4Rating")]
    FourRating,
    #[serde(rename = "4TrafficLights")]
    FourTrafficLights,
    #[serde(rename = "5Arrows")]
    FiveArrows,
    #[serde(rename = "5ArrowsGray")]
    FiveArrowsGray,
    #[serde(rename = "5Rating")]
    FiveRating,
    #[serde(rename = "5Quarters")]
    FiveQuarters,
    #[serde(rename = "5Boxes")]
    FiveBoxes,
    #[serde(rename = "NoIcons")]
    NoIcons,
    #[serde(rename = "Custom")]
    Custom,
}

impl CFIconSetName {
    /// All serde-rename names in enum discriminant order.
    ///
    /// Used by `compute-wire` codegen to emit the TypeScript `ICON_SET_NAMES`
    /// constant from a single source of truth. A unit test in this crate
    /// ensures the array length equals the variant count.
    pub const SERDE_NAMES: &[&str] = &[
        "3Arrows",
        "3ArrowsGray",
        "3Flags",
        "3TrafficLights1",
        "3TrafficLights2",
        "3Signs",
        "3Symbols",
        "3Symbols2",
        "3Stars",
        "3Triangles",
        "4Arrows",
        "4ArrowsGray",
        "4RedToBlack",
        "4Rating",
        "4TrafficLights",
        "5Arrows",
        "5ArrowsGray",
        "5Rating",
        "5Quarters",
        "5Boxes",
        "NoIcons",
        "Custom",
    ];

    /// Number of icons in this set (3, 4, or 5). 0 for NoIcons/Custom.
    pub fn icon_count(&self) -> usize {
        match self {
            Self::ThreeArrows
            | Self::ThreeArrowsGray
            | Self::ThreeFlags
            | Self::ThreeTrafficLights1
            | Self::ThreeTrafficLights2
            | Self::ThreeSigns
            | Self::ThreeSymbols
            | Self::ThreeSymbols2
            | Self::ThreeStars
            | Self::ThreeTriangles => 3,
            Self::FourArrows
            | Self::FourArrowsGray
            | Self::FourRedToBlack
            | Self::FourRating
            | Self::FourTrafficLights => 4,
            Self::FiveArrows
            | Self::FiveArrowsGray
            | Self::FiveRating
            | Self::FiveQuarters
            | Self::FiveBoxes => 5,
            Self::NoIcons => 0,
            Self::Custom => 0,
        }
    }
}

/// Underline type for CF styles (Excel-compatible).
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum CFUnderlineType {
    None,
    Single,
    Double,
    SingleAccounting,
    DoubleAccounting,
}

/// Border style for CF styles (Excel-compatible).
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum CFBorderStyle {
    None,
    Thin,
    Medium,
    Thick,
    Dashed,
    Dotted,
    Double,
    Hair,
    MediumDashed,
    DashDot,
    MediumDashDot,
    DashDotDot,
    MediumDashDotDot,
    SlantDashDot,
}

/// Pre-parsed threshold for single-value cell comparison.
#[derive(Debug, Clone, PartialEq)]
pub struct CellValueThreshold {
    /// Original text (for string Equal/NotEqual comparison).
    pub text: String,
    /// Pre-parsed numeric value (None if text is not a valid number).
    pub number: Option<f64>,
}

/// Single-value comparison operators (excludes Between/NotBetween).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CellValueSingleOp {
    GreaterThan,
    LessThan,
    GreaterThanOrEqual,
    LessThanOrEqual,
    Equal,
    NotEqual,
}

/// Type-safe cell value comparison with arity encoded in the type.
#[derive(Debug, Clone, PartialEq)]
pub enum CellValueComparison {
    Single {
        operator: CellValueSingleOp,
        threshold: CellValueThreshold,
    },
    Between {
        low: f64,
        high: f64,
    },
    NotBetween {
        low: f64,
        high: f64,
    },
}
