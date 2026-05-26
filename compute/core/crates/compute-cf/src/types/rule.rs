//! Internal computation types for conditional formatting rules.

use serde::{Deserialize, Serialize};

use cell_types::RangePos;
use value_types::Color;

use super::{
    CFBorderStyle, CFDataBarAxisPosition, CFDataBarDirection, CFIconSetName,
    CFIconThresholdOperator, CFTextOperator, CFUnderlineType, CFValueType, CellValueComparison,
    DatePeriod,
};

// =============================================================================
// Style Definition (from render-types.ts)
// =============================================================================

/// Style to apply when a CF rule matches.
/// All properties are optional -- only specified properties are applied.
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CfRenderStyle {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_color: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub underline_type: Option<CFUnderlineType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strikethrough: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_color: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_style: Option<CFBorderStyle>,

    // Per-side borders (override the unified border_color/border_style when set)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_top_color: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_top_style: Option<CFBorderStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_bottom_color: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_bottom_style: Option<CFBorderStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_left_color: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_left_style: Option<CFBorderStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_right_color: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_right_style: Option<CFBorderStyle>,

    /// Optional number format override (Excel CF can apply number format).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
}

// =============================================================================
// Internal types (computation-ready, pre-parsed)
// =============================================================================

/// A single point in a color scale (min, mid, or max). Pre-parsed.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct CFColorPoint {
    pub value_type: CFValueType,
    pub value: Option<f64>,
    pub color: Color,
}

/// Color scale configuration (2 or 3 colors). Pre-parsed.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct CFColorScale {
    pub min_point: CFColorPoint,
    pub mid_point: Option<CFColorPoint>,
    pub max_point: CFColorPoint,
}

/// Data bar configuration. Pre-parsed.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct CFDataBar {
    pub min_point: CFColorPoint,
    pub max_point: CFColorPoint,
    pub positive_color: Color,
    pub negative_color: Option<Color>,
    pub border_color: Option<Color>,
    pub negative_border_color: Option<Color>,
    pub show_border: bool,
    pub gradient: bool,
    pub direction: CFDataBarDirection,
    pub axis_position: CFDataBarAxisPosition,
    pub axis_color: Option<Color>,
    pub show_value: bool,
    /// Minimum bar length as percentage (OOXML default: 10).
    pub min_length: u8,
    /// Maximum bar length as percentage (OOXML default: 90).
    pub max_length: u8,
    /// When true, negative bars use the positive fill color instead of negative_color.
    pub match_positive_fill_color: bool,
    /// When true, negative bars use the positive border color instead of negative_border_color.
    pub match_positive_border_color: bool,
}

/// A custom icon reference — overrides the default icon from the set.
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct CustomIcon {
    /// The icon set to source the icon from.
    pub icon_set: CFIconSetName,
    /// The 0-based index within that icon set.
    pub icon_index: u8,
}

/// Threshold for icon selection within an icon set. Pre-parsed.
#[derive(Debug, Clone, PartialEq)]
pub struct CFIconThreshold {
    pub value_type: CFValueType,
    pub value: Option<f64>,
    pub operator: CFIconThresholdOperator,
    /// Custom icon override — if set, this threshold uses this icon instead of the default.
    pub custom_icon: Option<CustomIcon>,
}

/// Icon set configuration. Pre-parsed.
#[derive(Debug, Clone, PartialEq)]
pub struct CFIconSet {
    pub icon_set_name: CFIconSetName,
    pub thresholds: Vec<CFIconThreshold>,
    pub reverse_order: bool,
    pub show_icon_only: bool,
}

/// A conditional formatting rule in its proper internal representation.
/// Each variant of `CFRuleKind` carries only its relevant fields.
#[derive(Debug, Clone, PartialEq)]
pub struct CFRule {
    pub priority: i32,
    pub stop_if_true: bool,
    pub ranges: Vec<RangePos>,
    pub style: Option<CfRenderStyle>,
    pub kind: CFRuleKind,
}

/// Type-safe discriminated union for CF rule kinds.
/// Prevents invalid state combinations (e.g., a ColorScale rule with a style).
#[derive(Debug, Clone, PartialEq)]
pub enum CFRuleKind {
    CellValue {
        comparison: CellValueComparison,
    },
    Formula {
        formula: String,
    },
    Top10 {
        rank: u32,
        percent: bool,
        bottom: bool,
    },
    AboveAverage {
        above: bool,
        equal_average: bool,
        std_dev: i32,
    },
    DuplicateValues {
        unique: bool,
    },
    ContainsText {
        operator: CFTextOperator,
        text: String,
    },
    ContainsBlanks {
        blanks: bool,
    },
    ContainsErrors {
        errors: bool,
    },
    TimePeriod {
        period: DatePeriod,
    },
    ColorScale(CFColorScale),
    DataBar(CFDataBar),
    IconSet(CFIconSet),
}

impl CFRuleKind {
    /// Returns true for visual rules (ColorScale, DataBar, IconSet).
    pub fn is_visual(&self) -> bool {
        matches!(
            self,
            Self::ColorScale(_) | Self::DataBar(_) | Self::IconSet(_)
        )
    }
}
