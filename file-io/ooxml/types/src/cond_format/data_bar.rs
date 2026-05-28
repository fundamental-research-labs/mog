use super::{CfColor, Cfvo, default_true};

// ============================================================================
// DataBarDirection - Data bar direction (Excel 2010+)
// ============================================================================

/// Data bar direction (Excel 2010+).
///
/// # Serde
///
/// Serializes to the OOXML attribute token (e.g. `"context"`, `"leftToRight"`),
/// matching `to_ooxml` / `from_ooxml`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum DataBarDirection {
    /// Context-dependent direction
    #[default]
    #[serde(rename = "context")]
    Context,
    /// Left to right
    #[serde(rename = "leftToRight")]
    LeftToRight,
    /// Right to left
    #[serde(rename = "rightToLeft")]
    RightToLeft,
}

impl DataBarDirection {
    /// Strict parse. Returns `None` on any token not in the OOXML spec.
    /// Callers must handle `None` explicitly.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        Some(match s {
            "context" => Self::Context,
            "leftToRight" => Self::LeftToRight,
            "rightToLeft" => Self::RightToLeft,
            _ => return None,
        })
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Context => "context",
            Self::LeftToRight => "leftToRight",
            Self::RightToLeft => "rightToLeft",
        }
    }
}

// ============================================================================
// DataBarAxisPosition - Axis position for data bars (Excel 2010+)
// ============================================================================

/// Data bar axis position (Excel 2010+).
///
/// Controls where the axis appears in a data bar for conditional formatting.
///
/// # Serde
///
/// Serializes to the OOXML attribute token (e.g. `"automatic"`, `"middle"`, `"none"`),
/// matching `to_ooxml` / `from_ooxml`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum DataBarAxisPosition {
    /// Automatic axis position (default)
    #[default]
    #[serde(rename = "automatic")]
    Automatic,
    /// Middle axis position
    #[serde(rename = "middle")]
    Middle,
    /// No axis
    #[serde(rename = "none")]
    None,
}

impl DataBarAxisPosition {
    /// Strict parse. Returns `None` on any token not in the OOXML spec.
    /// Callers must handle `None` explicitly.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        Some(match s {
            "automatic" => Self::Automatic,
            "middle" => Self::Middle,
            "none" => Self::None,
            _ => return None,
        })
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Automatic => "automatic",
            Self::Middle => "middle",
            Self::None => "none",
        }
    }
}
fn default_min_length() -> u32 {
    10
}
fn default_max_length() -> u32 {
    90
}

/// Data bar (ECMA-376 CT_DataBar + x14 extensions).
///
/// Renders an in-cell horizontal bar proportional to the cell value.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DataBar {
    /// Minimum bar length percentage (default 10).
    #[serde(default = "default_min_length")]
    pub min_length: u32,
    /// Maximum bar length percentage (default 90).
    #[serde(default = "default_max_length")]
    pub max_length: u32,
    /// Whether to show the cell value alongside the bar (default true).
    #[serde(default = "default_true")]
    pub show_value: bool,
    /// Exactly 2 CFVOs (min and max thresholds).
    pub cfvo: Vec<Cfvo>,
    /// Primary bar color.
    pub color: CfColor,

    // Excel 2010+ extensions (x14 namespace)
    /// Use gradient fill (default true).
    #[serde(default = "default_true")]
    pub gradient: bool,
    /// Draw a border around the data bar (Excel 2010+).
    #[serde(default)]
    pub border: bool,
    /// Bar direction.
    #[serde(default)]
    pub direction: DataBarDirection,
    /// Negative bar color same as positive (default true).
    #[serde(default = "default_true")]
    pub negative_bar_color_same_as_positive: bool,
    /// Negative bar border color same as positive (default true).
    #[serde(default = "default_true")]
    pub negative_bar_border_color_same_as_positive: bool,
    /// Axis position.
    #[serde(default)]
    pub axis_position: DataBarAxisPosition,
    /// Axis color.
    pub axis_color: Option<CfColor>,
    /// Border color.
    pub border_color: Option<CfColor>,
    /// Negative fill color.
    pub negative_fill_color: Option<CfColor>,
    /// Negative border color.
    pub negative_border_color: Option<CfColor>,

    /// Round-trip metadata: whether `minLength` was present in the source XML.
    #[serde(default, skip)]
    pub min_length_attr_present: bool,
    /// Round-trip metadata: whether `maxLength` was present in the source XML.
    #[serde(default, skip)]
    pub max_length_attr_present: bool,
    /// Round-trip metadata: whether `showValue` was present in the source XML.
    #[serde(default, skip)]
    pub show_value_attr_present: bool,
    /// Round-trip metadata: whether `gradient` was present in the source XML.
    #[serde(default, skip)]
    pub gradient_attr_present: bool,
    /// Round-trip metadata: whether `border` was present in the source XML.
    #[serde(default, skip)]
    pub border_attr_present: bool,
    /// Round-trip metadata: whether `direction` was present in the source XML.
    #[serde(default, skip)]
    pub direction_attr_present: bool,
    /// Round-trip metadata: whether `negativeBarColorSameAsPositive` was present.
    #[serde(default, skip)]
    pub negative_bar_color_same_as_positive_attr_present: bool,
    /// Round-trip metadata: whether `negativeBarBorderColorSameAsPositive` was present.
    #[serde(default, skip)]
    pub negative_bar_border_color_same_as_positive_attr_present: bool,
    /// Round-trip metadata: whether `axisPosition` was present in the source XML.
    #[serde(default, skip)]
    pub axis_position_attr_present: bool,
}

impl Default for DataBar {
    fn default() -> Self {
        Self {
            min_length: 10,
            max_length: 90,
            show_value: true,
            cfvo: Vec::new(),
            color: CfColor::default(),
            gradient: true,
            border: false,
            direction: DataBarDirection::default(),
            negative_bar_color_same_as_positive: true,
            negative_bar_border_color_same_as_positive: true,
            axis_position: DataBarAxisPosition::default(),
            axis_color: None,
            border_color: None,
            negative_fill_color: None,
            negative_border_color: None,
            min_length_attr_present: false,
            max_length_attr_present: false,
            show_value_attr_present: false,
            gradient_attr_present: false,
            border_attr_present: false,
            direction_attr_present: false,
            negative_bar_color_same_as_positive_attr_present: false,
            negative_bar_border_color_same_as_positive_attr_present: false,
            axis_position_attr_present: false,
        }
    }
}
