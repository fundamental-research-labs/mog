//! Conditional formatting types (ECMA-376 CT_ConditionalFormatting).
//!
//! Contains vocabulary enums and structural types for conditional formatting:
//! operators, time periods, CFVO types, data bar settings, icon sets,
//! rule types, color scales, and the CfRule/ConditionalFormatting containers.

// ============================================================================
// CfOperator - Conditional formatting operator
// ============================================================================

/// Conditional formatting operator (ST_ConditionalFormattingOperator).
///
/// Used for cell value comparison rules.
///
/// # Serde
///
/// Serializes to the OOXML attribute token (e.g. `"lessThan"`, `"containsText"`),
/// matching what `from_ooxml` / `to_ooxml` produce. This keeps JSON wire and
/// Yrs storage byte-compatible with the pre-Round-D `String` field shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum CfOperator {
    /// Less than comparison
    #[default]
    #[serde(rename = "lessThan")]
    LessThan,
    /// Less than or equal comparison
    #[serde(rename = "lessThanOrEqual")]
    LessThanOrEqual,
    /// Equal comparison
    #[serde(rename = "equal")]
    Equal,
    /// Not equal comparison
    #[serde(rename = "notEqual")]
    NotEqual,
    /// Greater than or equal comparison
    #[serde(rename = "greaterThanOrEqual")]
    GreaterThanOrEqual,
    /// Greater than comparison
    #[serde(rename = "greaterThan")]
    GreaterThan,
    /// Between two values (inclusive)
    #[serde(rename = "between")]
    Between,
    /// Not between two values
    #[serde(rename = "notBetween")]
    NotBetween,
    /// Contains text (for text rules)
    #[serde(rename = "containsText")]
    ContainsText,
    /// Does not contain text (for text rules)
    #[serde(rename = "notContains")]
    NotContains,
    /// Begins with text (for text rules)
    #[serde(rename = "beginsWith")]
    BeginsWith,
    /// Ends with text (for text rules)
    #[serde(rename = "endsWith")]
    EndsWith,
}

impl CfOperator {
    /// Strict parse from an OOXML attribute value. Returns `None` on any
    /// token not in the OOXML spec. Callers must handle `None` explicitly
    /// — silently defaulting an unknown operator would corrupt data (a
    /// `>=` rule silently becoming `<` is worse than loud rejection).
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        Some(match s {
            "lessThan" => Self::LessThan,
            "lessThanOrEqual" => Self::LessThanOrEqual,
            "equal" => Self::Equal,
            "notEqual" => Self::NotEqual,
            "greaterThanOrEqual" => Self::GreaterThanOrEqual,
            "greaterThan" => Self::GreaterThan,
            "between" => Self::Between,
            "notBetween" => Self::NotBetween,
            "containsText" => Self::ContainsText,
            "notContains" => Self::NotContains,
            "beginsWith" => Self::BeginsWith,
            "endsWith" => Self::EndsWith,
            _ => return None,
        })
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::LessThan => "lessThan",
            Self::LessThanOrEqual => "lessThanOrEqual",
            Self::Equal => "equal",
            Self::NotEqual => "notEqual",
            Self::GreaterThanOrEqual => "greaterThanOrEqual",
            Self::GreaterThan => "greaterThan",
            Self::Between => "between",
            Self::NotBetween => "notBetween",
            Self::ContainsText => "containsText",
            Self::NotContains => "notContains",
            Self::BeginsWith => "beginsWith",
            Self::EndsWith => "endsWith",
        }
    }
}

// ============================================================================
// CfTimePeriod - Time period for date-based conditional formatting
// ============================================================================

/// Time period for date-based conditional formatting (ST_TimePeriod).
///
/// # Serde
///
/// Serializes to the OOXML attribute token (e.g. `"today"`, `"last7Days"`),
/// matching `to_ooxml` / `from_ooxml`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum CfTimePeriod {
    /// Today
    #[default]
    #[serde(rename = "today")]
    Today,
    /// Yesterday
    #[serde(rename = "yesterday")]
    Yesterday,
    /// Tomorrow
    #[serde(rename = "tomorrow")]
    Tomorrow,
    /// Last 7 days
    #[serde(rename = "last7Days")]
    Last7Days,
    /// This month
    #[serde(rename = "thisMonth")]
    ThisMonth,
    /// Last month
    #[serde(rename = "lastMonth")]
    LastMonth,
    /// Next month
    #[serde(rename = "nextMonth")]
    NextMonth,
    /// This week
    #[serde(rename = "thisWeek")]
    ThisWeek,
    /// Last week
    #[serde(rename = "lastWeek")]
    LastWeek,
    /// Next week
    #[serde(rename = "nextWeek")]
    NextWeek,
}

impl CfTimePeriod {
    /// Strict parse. Returns `None` on any token not in the OOXML spec.
    /// Callers must handle `None` explicitly.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        Some(match s {
            "today" => Self::Today,
            "yesterday" => Self::Yesterday,
            "tomorrow" => Self::Tomorrow,
            "last7Days" => Self::Last7Days,
            "thisMonth" => Self::ThisMonth,
            "lastMonth" => Self::LastMonth,
            "nextMonth" => Self::NextMonth,
            "thisWeek" => Self::ThisWeek,
            "lastWeek" => Self::LastWeek,
            "nextWeek" => Self::NextWeek,
            _ => return None,
        })
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Today => "today",
            Self::Yesterday => "yesterday",
            Self::Tomorrow => "tomorrow",
            Self::Last7Days => "last7Days",
            Self::ThisMonth => "thisMonth",
            Self::LastMonth => "lastMonth",
            Self::NextMonth => "nextMonth",
            Self::ThisWeek => "thisWeek",
            Self::LastWeek => "lastWeek",
            Self::NextWeek => "nextWeek",
        }
    }
}

// ============================================================================
// CfvoType - CFVO (Conditional Format Value Object) type
// ============================================================================

/// CFVO type (ST_CfvoType) -- for color scales, data bars, icon sets.
///
/// Includes AutoMin/AutoMax from the Excel 2010+ extension namespace.
///
/// # Serde
///
/// Serializes to the OOXML attribute token (e.g. `"num"`, `"autoMin"`),
/// matching `to_ooxml` / `from_ooxml`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum CfvoType {
    /// Numeric value
    #[default]
    #[serde(rename = "num")]
    Num,
    /// Percentage value
    #[serde(rename = "percent")]
    Percent,
    /// Maximum value
    #[serde(rename = "max")]
    Max,
    /// Minimum value
    #[serde(rename = "min")]
    Min,
    /// Formula value
    #[serde(rename = "formula")]
    Formula,
    /// Percentile value
    #[serde(rename = "percentile")]
    Percentile,
    /// Automatic minimum (Excel 2010+)
    #[serde(rename = "autoMin")]
    AutoMin,
    /// Automatic maximum (Excel 2010+)
    #[serde(rename = "autoMax")]
    AutoMax,
}

impl CfvoType {
    /// Strict parse. Returns `None` on any token not in the OOXML spec.
    /// Callers must handle `None` explicitly.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        Some(match s {
            "num" => Self::Num,
            "percent" => Self::Percent,
            "max" => Self::Max,
            "min" => Self::Min,
            "formula" => Self::Formula,
            "percentile" => Self::Percentile,
            "autoMin" => Self::AutoMin,
            "autoMax" => Self::AutoMax,
            _ => return None,
        })
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Num => "num",
            Self::Percent => "percent",
            Self::Max => "max",
            Self::Min => "min",
            Self::Formula => "formula",
            Self::Percentile => "percentile",
            Self::AutoMin => "autoMin",
            Self::AutoMax => "autoMax",
        }
    }
}

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

// ============================================================================
// IconSetType - Icon set type for conditional formatting
// ============================================================================

/// Icon set type (ST_IconSetType).
///
/// Uses descriptive variant names (ThreeArrows, FourArrows, etc.) with OOXML
/// string conversion to "3Arrows", "4Arrows", etc.
///
/// # Serde
///
/// Serializes to the OOXML attribute token (e.g. `"3Arrows"`, `"5Boxes"`, `"NoIcons"`),
/// matching `to_ooxml` / `from_ooxml`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum IconSetType {
    /// 3 traffic lights (default) -- solid
    #[default]
    #[serde(rename = "3TrafficLights1")]
    ThreeTrafficLights1,
    /// 3 arrows (up/side/down)
    #[serde(rename = "3Arrows")]
    ThreeArrows,
    /// 3 arrows gray
    #[serde(rename = "3ArrowsGray")]
    ThreeArrowsGray,
    /// 3 flags
    #[serde(rename = "3Flags")]
    ThreeFlags,
    /// 3 traffic lights with border
    #[serde(rename = "3TrafficLights2")]
    ThreeTrafficLights2,
    /// 3 signs
    #[serde(rename = "3Signs")]
    ThreeSigns,
    /// 3 symbols (circled)
    #[serde(rename = "3Symbols")]
    ThreeSymbols,
    /// 3 symbols (uncircled)
    #[serde(rename = "3Symbols2")]
    ThreeSymbols2,
    /// 4 arrows
    #[serde(rename = "4Arrows")]
    FourArrows,
    /// 4 arrows gray
    #[serde(rename = "4ArrowsGray")]
    FourArrowsGray,
    /// 4 red to black
    #[serde(rename = "4RedToBlack")]
    FourRedToBlack,
    /// 4 rating
    #[serde(rename = "4Rating")]
    FourRating,
    /// 4 traffic lights
    #[serde(rename = "4TrafficLights")]
    FourTrafficLights,
    /// 5 arrows
    #[serde(rename = "5Arrows")]
    FiveArrows,
    /// 5 arrows gray
    #[serde(rename = "5ArrowsGray")]
    FiveArrowsGray,
    /// 5 rating
    #[serde(rename = "5Rating")]
    FiveRating,
    /// 5 quarters
    #[serde(rename = "5Quarters")]
    FiveQuarters,
    /// 3 stars
    #[serde(rename = "3Stars")]
    ThreeStars,
    /// 3 triangles
    #[serde(rename = "3Triangles")]
    ThreeTriangles,
    /// 5 boxes
    #[serde(rename = "5Boxes")]
    FiveBoxes,
    /// No icons (hide icons)
    #[serde(rename = "NoIcons")]
    NoIcons,
}

impl IconSetType {
    /// Strict parse. Returns `None` on any token not in the OOXML spec.
    /// Callers must handle `None` explicitly.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        Some(match s {
            "3Arrows" => Self::ThreeArrows,
            "3ArrowsGray" => Self::ThreeArrowsGray,
            "3Flags" => Self::ThreeFlags,
            "3TrafficLights1" => Self::ThreeTrafficLights1,
            "3TrafficLights2" => Self::ThreeTrafficLights2,
            "3Signs" => Self::ThreeSigns,
            "3Symbols" => Self::ThreeSymbols,
            "3Symbols2" => Self::ThreeSymbols2,
            "4Arrows" => Self::FourArrows,
            "4ArrowsGray" => Self::FourArrowsGray,
            "4RedToBlack" => Self::FourRedToBlack,
            "4Rating" => Self::FourRating,
            "4TrafficLights" => Self::FourTrafficLights,
            "5Arrows" => Self::FiveArrows,
            "5ArrowsGray" => Self::FiveArrowsGray,
            "5Rating" => Self::FiveRating,
            "5Quarters" => Self::FiveQuarters,
            "3Stars" => Self::ThreeStars,
            "3Triangles" => Self::ThreeTriangles,
            "5Boxes" => Self::FiveBoxes,
            "NoIcons" => Self::NoIcons,
            _ => return None,
        })
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::ThreeArrows => "3Arrows",
            Self::ThreeArrowsGray => "3ArrowsGray",
            Self::ThreeFlags => "3Flags",
            Self::ThreeTrafficLights1 => "3TrafficLights1",
            Self::ThreeTrafficLights2 => "3TrafficLights2",
            Self::ThreeSigns => "3Signs",
            Self::ThreeSymbols => "3Symbols",
            Self::ThreeSymbols2 => "3Symbols2",
            Self::FourArrows => "4Arrows",
            Self::FourArrowsGray => "4ArrowsGray",
            Self::FourRedToBlack => "4RedToBlack",
            Self::FourRating => "4Rating",
            Self::FourTrafficLights => "4TrafficLights",
            Self::FiveArrows => "5Arrows",
            Self::FiveArrowsGray => "5ArrowsGray",
            Self::FiveRating => "5Rating",
            Self::FiveQuarters => "5Quarters",
            Self::ThreeStars => "3Stars",
            Self::ThreeTriangles => "3Triangles",
            Self::FiveBoxes => "5Boxes",
            Self::NoIcons => "NoIcons",
        }
    }

    /// Get the number of icons in this set.
    pub fn num_icons(&self) -> usize {
        match self {
            Self::ThreeArrows
            | Self::ThreeArrowsGray
            | Self::ThreeFlags
            | Self::ThreeSigns
            | Self::ThreeSymbols
            | Self::ThreeSymbols2
            | Self::ThreeTrafficLights1
            | Self::ThreeTrafficLights2
            | Self::ThreeStars
            | Self::ThreeTriangles => 3,
            Self::FourArrows
            | Self::FourArrowsGray
            | Self::FourRating
            | Self::FourRedToBlack
            | Self::FourTrafficLights => 4,
            Self::FiveArrows
            | Self::FiveArrowsGray
            | Self::FiveQuarters
            | Self::FiveRating
            | Self::FiveBoxes => 5,
            Self::NoIcons => 0,
        }
    }
}

// ============================================================================
// CfRuleType - Conditional formatting rule type
// ============================================================================

/// Conditional formatting rule type (ECMA-376 ST_CfType).
///
/// Classifies what kind of conditional formatting rule this is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum CfRuleType {
    /// Custom formula expression.
    #[default]
    Expression,
    /// Cell value comparison (uses operator + 1-2 values).
    CellIs,
    /// 2-color or 3-color gradient scale.
    ColorScale,
    /// In-cell data bar.
    DataBar,
    /// Conditional icon set.
    IconSet,
    /// Top/bottom N or N%.
    Top10,
    /// Unique values in range.
    UniqueValues,
    /// Duplicate values in range.
    DuplicateValues,
    /// Cell text contains substring.
    ContainsText,
    /// Cell text does not contain substring.
    NotContainsText,
    /// Cell text begins with prefix.
    BeginsWith,
    /// Cell text ends with suffix.
    EndsWith,
    /// Cell is blank.
    ContainsBlanks,
    /// Cell is not blank.
    NotContainsBlanks,
    /// Cell contains an error.
    ContainsErrors,
    /// Cell does not contain an error.
    NotContainsErrors,
    /// Date falls in time period.
    TimePeriod,
    /// Above or below average.
    AboveAverage,
}

impl CfRuleType {
    /// Parse from an OOXML attribute value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "expression" => Self::Expression,
            "cellIs" => Self::CellIs,
            "colorScale" => Self::ColorScale,
            "dataBar" => Self::DataBar,
            "iconSet" => Self::IconSet,
            "top10" => Self::Top10,
            "uniqueValues" => Self::UniqueValues,
            "duplicateValues" => Self::DuplicateValues,
            "containsText" => Self::ContainsText,
            "notContainsText" => Self::NotContainsText,
            "beginsWith" => Self::BeginsWith,
            "endsWith" => Self::EndsWith,
            "containsBlanks" => Self::ContainsBlanks,
            "notContainsBlanks" => Self::NotContainsBlanks,
            "containsErrors" => Self::ContainsErrors,
            "notContainsErrors" => Self::NotContainsErrors,
            "timePeriod" => Self::TimePeriod,
            "aboveAverage" => Self::AboveAverage,
            _ => Self::Expression,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Expression => "expression",
            Self::CellIs => "cellIs",
            Self::ColorScale => "colorScale",
            Self::DataBar => "dataBar",
            Self::IconSet => "iconSet",
            Self::Top10 => "top10",
            Self::UniqueValues => "uniqueValues",
            Self::DuplicateValues => "duplicateValues",
            Self::ContainsText => "containsText",
            Self::NotContainsText => "notContainsText",
            Self::BeginsWith => "beginsWith",
            Self::EndsWith => "endsWith",
            Self::ContainsBlanks => "containsBlanks",
            Self::NotContainsBlanks => "notContainsBlanks",
            Self::ContainsErrors => "containsErrors",
            Self::NotContainsErrors => "notContainsErrors",
            Self::TimePeriod => "timePeriod",
            Self::AboveAverage => "aboveAverage",
        }
    }
}

// ============================================================================
// Structural types - CF building blocks
// ============================================================================

fn default_true() -> bool {
    true
}

/// Simplified color for conditional formatting contexts (SpreadsheetML CT_Color).
///
/// This is the **SpreadsheetML** color model, NOT DrawingML. SpreadsheetML CF
/// uses a simple color model: RGB, theme index, indexed palette, or auto --
/// optionally with a tint. DrawingML's `DrawingColor` has 6 base types +
/// transforms and lives in the `drawings` module.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CfColor {
    /// sRGB color in ARGB hex (e.g., "FF00FF00").
    pub rgb: Option<String>,
    /// Theme color index (0-based).
    pub theme: Option<u32>,
    /// Indexed color palette entry.
    pub indexed: Option<u32>,
    /// Tint adjustment (-1.0 to 1.0). Applied on top of theme/indexed color.
    pub tint: Option<f64>,
    /// Automatic color flag.
    #[serde(default)]
    pub auto: bool,
}

/// Conditional format value object (ECMA-376 CT_Cfvo).
///
/// Defines a threshold/boundary value for color scales, data bars, and icon sets.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Cfvo {
    /// Value type (num, percent, max, min, formula, percentile, autoMin, autoMax).
    pub cfvo_type: CfvoType,
    /// Value string (number, formula, etc.). None for min/max/autoMin/autoMax.
    pub val: Option<String>,
    /// Greater-than-or-equal flag (default true per ECMA-376).
    /// When false, the threshold is exclusive (greater-than only).
    #[serde(default = "default_true")]
    pub gte: bool,
}

impl Default for Cfvo {
    fn default() -> Self {
        Self {
            cfvo_type: CfvoType::default(),
            val: None,
            gte: true,
        }
    }
}

/// Color scale (ECMA-376 CT_ColorScale).
///
/// Maps cell values to a gradient between 2 or 3 colors.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ColorScale {
    /// 2 or 3 CFVO thresholds (min, [mid], max).
    pub cfvo: Vec<Cfvo>,
    /// 2 or 3 colors corresponding to the CFVOs.
    pub colors: Vec<CfColor>,
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

/// Custom icon reference (ECMA-376 CT_CfIcon, Excel 2010+).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CfIcon {
    /// Icon set to source the icon from.
    pub icon_set: IconSetType,
    /// Zero-based icon index within the set.
    pub icon_id: u32,
}

/// Icon set (ECMA-376 CT_IconSet + x14 extensions).
///
/// Displays icons (arrows, flags, traffic lights, etc.) based on cell values.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct IconSet {
    /// Icon set type (default ThreeTrafficLights1).
    #[serde(default)]
    pub icon_set: IconSetType,
    /// Whether to show the cell value alongside the icon (default true).
    #[serde(default = "default_true")]
    pub show_value: bool,
    /// Whether CFVO values are percentages (default true).
    #[serde(default = "default_true")]
    pub percent: bool,
    /// Reverse icon order (default false).
    #[serde(default)]
    pub reverse: bool,
    /// 2-5 CFVO thresholds depending on icon set size.
    pub cfvo: Vec<Cfvo>,

    // Excel 2010+ extensions
    /// Whether custom icons are used.
    #[serde(default)]
    pub custom: bool,
    /// Custom icon selections (one per threshold, x14).
    #[serde(default)]
    pub cf_icon: Vec<CfIcon>,
}

impl Default for IconSet {
    fn default() -> Self {
        Self {
            icon_set: IconSetType::default(),
            show_value: true,
            percent: true,
            reverse: false,
            cfvo: Vec::new(),
            custom: false,
            cf_icon: Vec::new(),
        }
    }
}

// ============================================================================
// CfRule and container types
// ============================================================================

/// Conditional formatting rule (ECMA-376 CT_CfRule).
///
/// A flat struct (not a tagged enum) matching the OOXML schema. The `rule_type`
/// field determines which optional fields are meaningful:
/// - `CellIs`: uses `operator`, `formulas` (1-2)
/// - `Expression`: uses `formulas` (1)
/// - `ColorScale`: uses `color_scale`
/// - `DataBar`: uses `data_bar`
/// - `IconSet`: uses `icon_set`
/// - `Top10`: uses `rank`, `percent`, `bottom`
/// - `AboveAverage`: uses `above_average`, `equal_average`, `std_dev`
/// - `ContainsText`/`BeginsWith`/`EndsWith`: uses `text`, `operator`
/// - `TimePeriod`: uses `time_period`
/// - Others: only `rule_type` + `dxf_id`
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CfRule {
    /// Rule type (required).
    pub rule_type: CfRuleType,
    /// Priority (1 = highest, required).
    pub priority: i32,
    /// Differential format ID (references styles.xml dxf list).
    pub dxf_id: Option<u32>,
    /// Stop evaluating lower-priority rules if this one matches.
    #[serde(default)]
    pub stop_if_true: bool,

    // -- cellIs fields --
    /// Comparison operator (for cellIs and text rules).
    pub operator: Option<CfOperator>,

    // -- text rule fields --
    /// Text value (for containsText, beginsWith, endsWith).
    pub text: Option<String>,

    // -- timePeriod field --
    /// Time period (for timePeriod rules).
    pub time_period: Option<CfTimePeriod>,

    // -- top10 / aboveAverage fields --
    /// Rank threshold (for top10 rules).
    pub rank: Option<u32>,
    /// Interpret rank as percentage (for top10).
    #[serde(default)]
    pub percent: bool,
    /// Select bottom instead of top (for top10).
    #[serde(default)]
    pub bottom: bool,
    /// Above average (default true for aboveAverage type).
    #[serde(default = "default_true")]
    pub above_average: bool,
    /// Standard deviation multiplier (for aboveAverage).
    pub std_dev: Option<i32>,
    /// Include values equal to average (for aboveAverage).
    #[serde(default)]
    pub equal_average: bool,

    // -- formula(s) --
    /// 0-3 formula strings (for expression: 1, cellIs: 1-2, text rules: 1).
    #[serde(default)]
    pub formulas: Vec<String>,

    // -- visual elements (mutually exclusive based on rule_type) --
    /// Color scale configuration (for colorScale type).
    pub color_scale: Option<ColorScale>,
    /// Data bar configuration (for dataBar type).
    pub data_bar: Option<DataBar>,
    /// Icon set configuration (for iconSet type).
    pub icon_set: Option<IconSet>,
    /// x14:id from `<extLst>` inside the cfRule, linking to extended CF data
    /// in the worksheet's `<extLst>` section. Preserved for round-trip fidelity.
    pub ext_id: Option<String>,
}

impl Default for CfRule {
    fn default() -> Self {
        Self {
            rule_type: CfRuleType::default(),
            priority: 0,
            dxf_id: None,
            stop_if_true: false,
            operator: None,
            text: None,
            time_period: None,
            rank: None,
            percent: false,
            bottom: false,
            above_average: true,
            std_dev: None,
            equal_average: false,
            formulas: Vec::new(),
            color_scale: None,
            data_bar: None,
            icon_set: None,
            ext_id: None,
        }
    }
}

/// Conditional formatting block (ECMA-376 CT_ConditionalFormatting).
///
/// Associates one or more rules with cell ranges on a worksheet.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ConditionalFormatting {
    /// Space-separated cell ranges in A1 notation (e.g., "A1:C10 E1:E10").
    ///
    /// # Layering rule (typed OOXML layering rule)
    ///
    /// Stays `String` at the `ooxml-types` layer by policy:
    /// `ooxml-types` must never depend on `formula-types`. This is the
    /// XLSX external-format boundary, symmetric to typed Yrs boundary's Yrs
    /// on-disk JSON rule — `String` here is architecturally correct, not
    /// debt. The typed treatment lives at every in-engine consumer:
    ///
    /// - Read: `xlsx-parser::output::to_parse_output::features::
    ///   convert_conditional_formats` parses via `SqrefList::parse`.
    /// - Write: `xlsx-parser::domain::cond_format::write::bridge::
    ///   ranges_to_sqref` emits via `SqrefList::to_a1_string`.
    /// - Lowering helpers: `compute::import::parse_output_to_snapshot::
    ///   cond_format_lowering`.
    pub sqref: String,
    /// Whether this applies to a pivot table.
    #[serde(default)]
    pub pivot: bool,
    /// Rules in priority order.
    pub rules: Vec<CfRule>,
}

/// Extended CF rule for x14 namespace (Excel 2010+).
///
/// Carries additional data bar / icon set properties not available in the
/// base CT_CfRule schema.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CfRuleX14 {
    /// Rule type.
    pub rule_type: CfRuleType,
    /// Priority.
    pub priority: i32,
    /// GUID linking to the base rule.
    pub id: String,
    /// Extended data bar configuration.
    pub data_bar: Option<DataBar>,
    /// Extended icon set configuration.
    pub icon_set: Option<IconSet>,
}

/// X14 conditional formatting container (Excel 2010+).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ConditionalFormattingX14 {
    /// GUID.
    pub id: String,
    /// Cell ranges. Same `String` vs `SqrefList` layering constraint as
    /// [`ConditionalFormatting::sqref`] — see the doc there for full
    /// rationale. No live consumer reads this field today (only
    /// `parse_conditional_formatting_x14_element` writes it and the X14
    /// parser output is not routed through any downstream pipeline), so
    /// the typed migration is deferred with the sibling base-CF field.
    pub sqref: String,
    /// Extended rules.
    pub rules: Vec<CfRuleX14>,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // CfOperator
    // -----------------------------------------------------------------------

    #[test]
    fn cf_operator_default() {
        assert_eq!(CfOperator::default(), CfOperator::LessThan);
    }

    #[test]
    fn cf_operator_roundtrip() {
        let all = [
            CfOperator::LessThan,
            CfOperator::LessThanOrEqual,
            CfOperator::Equal,
            CfOperator::NotEqual,
            CfOperator::GreaterThanOrEqual,
            CfOperator::GreaterThan,
            CfOperator::Between,
            CfOperator::NotBetween,
            CfOperator::ContainsText,
            CfOperator::NotContains,
            CfOperator::BeginsWith,
            CfOperator::EndsWith,
        ];
        for v in all {
            assert_eq!(
                CfOperator::from_ooxml_token(v.to_ooxml()),
                Some(v),
                "roundtrip failed for {:?}",
                v
            );
        }
    }

    #[test]
    fn cf_operator_unknown_is_none() {
        assert_eq!(CfOperator::from_ooxml_token("bogus"), None);
        assert_eq!(CfOperator::from_ooxml_token(""), None);
    }

    #[test]
    fn cf_operator_to_ooxml_values() {
        assert_eq!(CfOperator::LessThan.to_ooxml(), "lessThan");
        assert_eq!(CfOperator::ContainsText.to_ooxml(), "containsText");
        assert_eq!(CfOperator::EndsWith.to_ooxml(), "endsWith");
    }

    // -----------------------------------------------------------------------
    // CfTimePeriod
    // -----------------------------------------------------------------------

    #[test]
    fn cf_time_period_default() {
        assert_eq!(CfTimePeriod::default(), CfTimePeriod::Today);
    }

    #[test]
    fn cf_time_period_roundtrip() {
        let all = [
            CfTimePeriod::Today,
            CfTimePeriod::Yesterday,
            CfTimePeriod::Tomorrow,
            CfTimePeriod::Last7Days,
            CfTimePeriod::ThisMonth,
            CfTimePeriod::LastMonth,
            CfTimePeriod::NextMonth,
            CfTimePeriod::ThisWeek,
            CfTimePeriod::LastWeek,
            CfTimePeriod::NextWeek,
        ];
        for v in all {
            assert_eq!(
                CfTimePeriod::from_ooxml_token(v.to_ooxml()),
                Some(v),
                "roundtrip failed for {:?}",
                v
            );
        }
    }

    #[test]
    fn cf_time_period_unknown_is_none() {
        assert_eq!(CfTimePeriod::from_ooxml_token("bogus"), None);
        assert_eq!(CfTimePeriod::from_ooxml_token(""), None);
    }

    #[test]
    fn cf_time_period_to_ooxml_values() {
        assert_eq!(CfTimePeriod::Last7Days.to_ooxml(), "last7Days");
        assert_eq!(CfTimePeriod::ThisMonth.to_ooxml(), "thisMonth");
        assert_eq!(CfTimePeriod::NextWeek.to_ooxml(), "nextWeek");
    }

    // -----------------------------------------------------------------------
    // CfvoType
    // -----------------------------------------------------------------------

    #[test]
    fn cfvo_type_default() {
        assert_eq!(CfvoType::default(), CfvoType::Num);
    }

    #[test]
    fn cfvo_type_roundtrip() {
        let all = [
            CfvoType::Num,
            CfvoType::Percent,
            CfvoType::Max,
            CfvoType::Min,
            CfvoType::Formula,
            CfvoType::Percentile,
            CfvoType::AutoMin,
            CfvoType::AutoMax,
        ];
        for v in all {
            assert_eq!(
                CfvoType::from_ooxml_token(v.to_ooxml()),
                Some(v),
                "roundtrip failed for {:?}",
                v
            );
        }
    }

    #[test]
    fn cfvo_type_unknown_is_none() {
        assert_eq!(CfvoType::from_ooxml_token("bogus"), None);
        assert_eq!(CfvoType::from_ooxml_token(""), None);
    }

    #[test]
    fn cfvo_type_to_ooxml_values() {
        assert_eq!(CfvoType::Percent.to_ooxml(), "percent");
        assert_eq!(CfvoType::AutoMin.to_ooxml(), "autoMin");
        assert_eq!(CfvoType::AutoMax.to_ooxml(), "autoMax");
    }

    // -----------------------------------------------------------------------
    // DataBarDirection
    // -----------------------------------------------------------------------

    #[test]
    fn data_bar_direction_default() {
        assert_eq!(DataBarDirection::default(), DataBarDirection::Context);
    }

    #[test]
    fn data_bar_direction_roundtrip() {
        let all = [
            DataBarDirection::Context,
            DataBarDirection::LeftToRight,
            DataBarDirection::RightToLeft,
        ];
        for v in all {
            assert_eq!(
                DataBarDirection::from_ooxml_token(v.to_ooxml()),
                Some(v),
                "roundtrip failed for {:?}",
                v
            );
        }
    }

    #[test]
    fn data_bar_direction_unknown_is_none() {
        assert_eq!(DataBarDirection::from_ooxml_token("bogus"), None);
        assert_eq!(DataBarDirection::from_ooxml_token(""), None);
    }

    #[test]
    fn data_bar_direction_to_ooxml_values() {
        assert_eq!(DataBarDirection::LeftToRight.to_ooxml(), "leftToRight");
        assert_eq!(DataBarDirection::RightToLeft.to_ooxml(), "rightToLeft");
    }

    // -----------------------------------------------------------------------
    // DataBarAxisPosition
    // -----------------------------------------------------------------------

    #[test]
    fn data_bar_axis_position_default() {
        assert_eq!(
            DataBarAxisPosition::default(),
            DataBarAxisPosition::Automatic
        );
    }

    #[test]
    fn data_bar_axis_position_roundtrip() {
        let all = [
            DataBarAxisPosition::Automatic,
            DataBarAxisPosition::Middle,
            DataBarAxisPosition::None,
        ];
        for v in all {
            assert_eq!(
                DataBarAxisPosition::from_ooxml_token(v.to_ooxml()),
                Some(v),
                "roundtrip failed for {:?}",
                v
            );
        }
    }

    #[test]
    fn data_bar_axis_position_unknown_is_none() {
        assert_eq!(DataBarAxisPosition::from_ooxml_token("bogus"), None);
        assert_eq!(DataBarAxisPosition::from_ooxml_token(""), None);
    }

    #[test]
    fn data_bar_axis_position_to_ooxml_values() {
        assert_eq!(DataBarAxisPosition::Automatic.to_ooxml(), "automatic");
        assert_eq!(DataBarAxisPosition::Middle.to_ooxml(), "middle");
        assert_eq!(DataBarAxisPosition::None.to_ooxml(), "none");
    }

    // -----------------------------------------------------------------------
    // IconSetType
    // -----------------------------------------------------------------------

    #[test]
    fn icon_set_type_default() {
        assert_eq!(IconSetType::default(), IconSetType::ThreeTrafficLights1);
    }

    #[test]
    fn icon_set_type_roundtrip() {
        let all = [
            IconSetType::ThreeTrafficLights1,
            IconSetType::ThreeArrows,
            IconSetType::ThreeArrowsGray,
            IconSetType::ThreeFlags,
            IconSetType::ThreeTrafficLights2,
            IconSetType::ThreeSigns,
            IconSetType::ThreeSymbols,
            IconSetType::ThreeSymbols2,
            IconSetType::FourArrows,
            IconSetType::FourArrowsGray,
            IconSetType::FourRedToBlack,
            IconSetType::FourRating,
            IconSetType::FourTrafficLights,
            IconSetType::FiveArrows,
            IconSetType::FiveArrowsGray,
            IconSetType::FiveRating,
            IconSetType::FiveQuarters,
            IconSetType::ThreeStars,
            IconSetType::ThreeTriangles,
            IconSetType::FiveBoxes,
            IconSetType::NoIcons,
        ];
        for v in all {
            assert_eq!(
                IconSetType::from_ooxml_token(v.to_ooxml()),
                Some(v),
                "roundtrip failed for {:?}",
                v
            );
        }
    }

    #[test]
    fn icon_set_type_unknown_is_none() {
        assert_eq!(IconSetType::from_ooxml_token("bogus"), None);
        assert_eq!(IconSetType::from_ooxml_token(""), None);
    }

    #[test]
    fn icon_set_type_to_ooxml_values() {
        assert_eq!(IconSetType::ThreeArrows.to_ooxml(), "3Arrows");
        assert_eq!(IconSetType::FiveBoxes.to_ooxml(), "5Boxes");
        assert_eq!(IconSetType::NoIcons.to_ooxml(), "NoIcons");
    }

    #[test]
    fn icon_set_type_num_icons() {
        // 3-icon sets
        assert_eq!(IconSetType::ThreeArrows.num_icons(), 3);
        assert_eq!(IconSetType::ThreeFlags.num_icons(), 3);
        assert_eq!(IconSetType::ThreeTrafficLights1.num_icons(), 3);
        assert_eq!(IconSetType::ThreeStars.num_icons(), 3);
        assert_eq!(IconSetType::ThreeTriangles.num_icons(), 3);
        // 4-icon sets
        assert_eq!(IconSetType::FourArrows.num_icons(), 4);
        assert_eq!(IconSetType::FourRating.num_icons(), 4);
        assert_eq!(IconSetType::FourTrafficLights.num_icons(), 4);
        // 5-icon sets
        assert_eq!(IconSetType::FiveArrows.num_icons(), 5);
        assert_eq!(IconSetType::FiveQuarters.num_icons(), 5);
        assert_eq!(IconSetType::FiveBoxes.num_icons(), 5);
        // No icons
        assert_eq!(IconSetType::NoIcons.num_icons(), 0);
    }

    // -----------------------------------------------------------------------
    // CfRuleType
    // -----------------------------------------------------------------------

    #[test]
    fn cf_rule_type_default() {
        assert_eq!(CfRuleType::default(), CfRuleType::Expression);
    }

    #[test]
    fn cf_rule_type_roundtrip() {
        let all = [
            CfRuleType::Expression,
            CfRuleType::CellIs,
            CfRuleType::ColorScale,
            CfRuleType::DataBar,
            CfRuleType::IconSet,
            CfRuleType::Top10,
            CfRuleType::UniqueValues,
            CfRuleType::DuplicateValues,
            CfRuleType::ContainsText,
            CfRuleType::NotContainsText,
            CfRuleType::BeginsWith,
            CfRuleType::EndsWith,
            CfRuleType::ContainsBlanks,
            CfRuleType::NotContainsBlanks,
            CfRuleType::ContainsErrors,
            CfRuleType::NotContainsErrors,
            CfRuleType::TimePeriod,
            CfRuleType::AboveAverage,
        ];
        for v in all {
            assert_eq!(
                CfRuleType::from_ooxml(v.to_ooxml()),
                v,
                "roundtrip failed for {:?}",
                v
            );
        }
    }

    #[test]
    fn cf_rule_type_unknown_fallback() {
        assert_eq!(CfRuleType::from_ooxml("bogus"), CfRuleType::Expression);
        assert_eq!(CfRuleType::from_ooxml(""), CfRuleType::Expression);
    }

    #[test]
    fn cf_rule_type_to_ooxml_values() {
        assert_eq!(CfRuleType::CellIs.to_ooxml(), "cellIs");
        assert_eq!(CfRuleType::ColorScale.to_ooxml(), "colorScale");
        assert_eq!(CfRuleType::DataBar.to_ooxml(), "dataBar");
        assert_eq!(CfRuleType::Top10.to_ooxml(), "top10");
        assert_eq!(CfRuleType::ContainsText.to_ooxml(), "containsText");
        assert_eq!(CfRuleType::AboveAverage.to_ooxml(), "aboveAverage");
    }

    // -----------------------------------------------------------------------
    // Cfvo
    // -----------------------------------------------------------------------

    #[test]
    fn cfvo_default_gte_true() {
        let cfvo = Cfvo::default();
        assert!(cfvo.gte, "Cfvo default gte should be true per ECMA-376");
        assert_eq!(cfvo.cfvo_type, CfvoType::Num);
        assert!(cfvo.val.is_none());
    }

    #[test]
    fn cfvo_with_value() {
        let cfvo = Cfvo {
            cfvo_type: CfvoType::Percent,
            val: Some("50".to_string()),
            gte: false,
        };
        assert_eq!(cfvo.cfvo_type, CfvoType::Percent);
        assert_eq!(cfvo.val.as_deref(), Some("50"));
        assert!(!cfvo.gte);
    }

    // -----------------------------------------------------------------------
    // CfColor
    // -----------------------------------------------------------------------

    #[test]
    fn cf_color_default_all_none() {
        let c = CfColor::default();
        assert!(c.rgb.is_none());
        assert!(c.theme.is_none());
        assert!(c.indexed.is_none());
        assert!(c.tint.is_none());
        assert!(!c.auto);
    }

    #[test]
    fn cf_color_rgb() {
        let c = CfColor {
            rgb: Some("FF00FF00".to_string()),
            ..Default::default()
        };
        assert_eq!(c.rgb.as_deref(), Some("FF00FF00"));
    }

    #[test]
    fn cf_color_theme_with_tint() {
        let c = CfColor {
            theme: Some(4),
            tint: Some(-0.25),
            ..Default::default()
        };
        assert_eq!(c.theme, Some(4));
        assert_eq!(c.tint, Some(-0.25));
    }

    // -----------------------------------------------------------------------
    // ColorScale
    // -----------------------------------------------------------------------

    #[test]
    fn color_scale_two_color() {
        let cs = ColorScale {
            cfvo: vec![
                Cfvo {
                    cfvo_type: CfvoType::Min,
                    val: None,
                    gte: true,
                },
                Cfvo {
                    cfvo_type: CfvoType::Max,
                    val: None,
                    gte: true,
                },
            ],
            colors: vec![
                CfColor {
                    rgb: Some("FFFF0000".to_string()),
                    ..Default::default()
                },
                CfColor {
                    rgb: Some("FF00FF00".to_string()),
                    ..Default::default()
                },
            ],
        };
        assert_eq!(cs.cfvo.len(), 2);
        assert_eq!(cs.colors.len(), 2);
    }

    #[test]
    fn color_scale_three_color() {
        let cs = ColorScale {
            cfvo: vec![
                Cfvo {
                    cfvo_type: CfvoType::Min,
                    val: None,
                    gte: true,
                },
                Cfvo {
                    cfvo_type: CfvoType::Percentile,
                    val: Some("50".to_string()),
                    gte: true,
                },
                Cfvo {
                    cfvo_type: CfvoType::Max,
                    val: None,
                    gte: true,
                },
            ],
            colors: vec![
                CfColor {
                    rgb: Some("FFFF0000".to_string()),
                    ..Default::default()
                },
                CfColor {
                    rgb: Some("FFFFFF00".to_string()),
                    ..Default::default()
                },
                CfColor {
                    rgb: Some("FF00FF00".to_string()),
                    ..Default::default()
                },
            ],
        };
        assert_eq!(cs.cfvo.len(), 3);
        assert_eq!(cs.colors.len(), 3);
    }

    // -----------------------------------------------------------------------
    // DataBar
    // -----------------------------------------------------------------------

    #[test]
    fn data_bar_defaults() {
        let db = DataBar::default();
        assert_eq!(db.min_length, 10);
        assert_eq!(db.max_length, 90);
        assert!(db.show_value);
        assert!(db.gradient);
        assert!(db.negative_bar_color_same_as_positive);
        assert!(db.negative_bar_border_color_same_as_positive);
        assert_eq!(db.direction, DataBarDirection::Context);
        assert_eq!(db.axis_position, DataBarAxisPosition::Automatic);
        assert!(db.cfvo.is_empty());
        assert!(db.axis_color.is_none());
        assert!(db.border_color.is_none());
        assert!(db.negative_fill_color.is_none());
        assert!(db.negative_border_color.is_none());
    }

    // -----------------------------------------------------------------------
    // IconSet
    // -----------------------------------------------------------------------

    #[test]
    fn icon_set_struct_defaults() {
        let is = IconSet::default();
        assert_eq!(is.icon_set, IconSetType::ThreeTrafficLights1);
        assert!(is.show_value);
        assert!(is.percent);
        assert!(!is.reverse);
        assert!(is.cfvo.is_empty());
        assert!(!is.custom);
        assert!(is.cf_icon.is_empty());
    }

    #[test]
    fn icon_set_with_custom_icons() {
        let is = IconSet {
            icon_set: IconSetType::ThreeArrows,
            show_value: false,
            percent: true,
            reverse: false,
            cfvo: vec![
                Cfvo {
                    cfvo_type: CfvoType::Percent,
                    val: Some("0".to_string()),
                    gte: true,
                },
                Cfvo {
                    cfvo_type: CfvoType::Percent,
                    val: Some("33".to_string()),
                    gte: true,
                },
                Cfvo {
                    cfvo_type: CfvoType::Percent,
                    val: Some("67".to_string()),
                    gte: true,
                },
            ],
            custom: true,
            cf_icon: vec![
                CfIcon {
                    icon_set: IconSetType::ThreeFlags,
                    icon_id: 0,
                },
                CfIcon {
                    icon_set: IconSetType::ThreeFlags,
                    icon_id: 1,
                },
                CfIcon {
                    icon_set: IconSetType::ThreeFlags,
                    icon_id: 2,
                },
            ],
        };
        assert!(is.custom);
        assert_eq!(is.cf_icon.len(), 3);
        assert_eq!(is.cf_icon[0].icon_set, IconSetType::ThreeFlags);
    }

    // -----------------------------------------------------------------------
    // CfRule
    // -----------------------------------------------------------------------

    #[test]
    fn cf_rule_defaults() {
        let rule = CfRule::default();
        assert_eq!(rule.rule_type, CfRuleType::Expression);
        assert_eq!(rule.priority, 0);
        assert!(rule.dxf_id.is_none());
        assert!(!rule.stop_if_true);
        assert!(rule.operator.is_none());
        assert!(rule.text.is_none());
        assert!(rule.time_period.is_none());
        assert!(rule.rank.is_none());
        assert!(!rule.percent);
        assert!(!rule.bottom);
        assert!(rule.above_average, "above_average defaults to true");
        assert!(rule.std_dev.is_none());
        assert!(!rule.equal_average);
        assert!(rule.formulas.is_empty());
        assert!(rule.color_scale.is_none());
        assert!(rule.data_bar.is_none());
        assert!(rule.icon_set.is_none());
    }

    // -----------------------------------------------------------------------
    // ConditionalFormatting
    // -----------------------------------------------------------------------

    #[test]
    fn conditional_formatting_with_cell_is_rule() {
        let cf = ConditionalFormatting {
            sqref: "A1:A10".to_string(),
            pivot: false,
            rules: vec![CfRule {
                rule_type: CfRuleType::CellIs,
                priority: 1,
                dxf_id: Some(0),
                operator: Some(CfOperator::GreaterThan),
                formulas: vec!["100".to_string()],
                ..Default::default()
            }],
        };
        assert_eq!(cf.sqref, "A1:A10");
        assert_eq!(cf.rules.len(), 1);
        assert_eq!(cf.rules[0].rule_type, CfRuleType::CellIs);
        assert_eq!(cf.rules[0].operator, Some(CfOperator::GreaterThan));
    }

    #[test]
    fn conditional_formatting_with_color_scale() {
        let cf = ConditionalFormatting {
            sqref: "B1:B20".to_string(),
            pivot: false,
            rules: vec![CfRule {
                rule_type: CfRuleType::ColorScale,
                priority: 1,
                color_scale: Some(ColorScale {
                    cfvo: vec![
                        Cfvo {
                            cfvo_type: CfvoType::Min,
                            val: None,
                            gte: true,
                        },
                        Cfvo {
                            cfvo_type: CfvoType::Max,
                            val: None,
                            gte: true,
                        },
                    ],
                    colors: vec![
                        CfColor {
                            rgb: Some("FFFF0000".to_string()),
                            ..Default::default()
                        },
                        CfColor {
                            rgb: Some("FF00FF00".to_string()),
                            ..Default::default()
                        },
                    ],
                }),
                ..Default::default()
            }],
        };
        assert_eq!(cf.rules[0].rule_type, CfRuleType::ColorScale);
        assert!(cf.rules[0].color_scale.is_some());
    }

    #[test]
    fn conditional_formatting_with_data_bar() {
        let cf = ConditionalFormatting {
            sqref: "C1:C50".to_string(),
            pivot: false,
            rules: vec![CfRule {
                rule_type: CfRuleType::DataBar,
                priority: 1,
                data_bar: Some(DataBar {
                    cfvo: vec![
                        Cfvo {
                            cfvo_type: CfvoType::Min,
                            val: None,
                            gte: true,
                        },
                        Cfvo {
                            cfvo_type: CfvoType::Max,
                            val: None,
                            gte: true,
                        },
                    ],
                    color: CfColor {
                        rgb: Some("FF638EC6".to_string()),
                        ..Default::default()
                    },
                    ..Default::default()
                }),
                ..Default::default()
            }],
        };
        assert_eq!(cf.rules[0].rule_type, CfRuleType::DataBar);
        let db = cf.rules[0].data_bar.as_ref().unwrap();
        assert_eq!(db.cfvo.len(), 2);
        assert_eq!(db.color.rgb.as_deref(), Some("FF638EC6"));
    }

    // -----------------------------------------------------------------------
    // CfRuleX14
    // -----------------------------------------------------------------------

    #[test]
    fn cf_rule_x14_with_data_bar() {
        let rule = CfRuleX14 {
            rule_type: CfRuleType::DataBar,
            priority: 1,
            id: "{00000000-0000-0000-0000-000000000001}".to_string(),
            data_bar: Some(DataBar {
                gradient: false,
                direction: DataBarDirection::LeftToRight,
                ..Default::default()
            }),
            icon_set: None,
        };
        assert_eq!(rule.rule_type, CfRuleType::DataBar);
        assert!(!rule.data_bar.as_ref().unwrap().gradient);
    }

    #[test]
    fn cf_rule_signed_priority_and_std_dev() {
        let rule = CfRule {
            rule_type: CfRuleType::AboveAverage,
            priority: -1,
            std_dev: Some(-2),
            ..Default::default()
        };
        assert_eq!(rule.priority, -1);
        assert_eq!(rule.std_dev, Some(-2));
    }

    #[test]
    fn conditional_formatting_x14_default() {
        let cf = ConditionalFormattingX14::default();
        assert!(cf.id.is_empty());
        assert!(cf.sqref.is_empty());
        assert!(cf.rules.is_empty());
    }

    // -----------------------------------------------------------------------
    // Serde <-> OOXML token equivalence
    //
    // Domain-types CF enum fields are typed as these ooxml enums directly
    // instead of `String` fields holding OOXML tokens. The JSON / Yrs wire
    // format produced by `serde::Serialize` must remain byte-identical to the
    // legacy `String` content, which was `to_ooxml().to_string()`. These tests
    // lock that invariant.
    // -----------------------------------------------------------------------

    #[test]
    fn cf_operator_serde_matches_ooxml_token() {
        let all = [
            CfOperator::LessThan,
            CfOperator::LessThanOrEqual,
            CfOperator::Equal,
            CfOperator::NotEqual,
            CfOperator::GreaterThanOrEqual,
            CfOperator::GreaterThan,
            CfOperator::Between,
            CfOperator::NotBetween,
            CfOperator::ContainsText,
            CfOperator::NotContains,
            CfOperator::BeginsWith,
            CfOperator::EndsWith,
        ];
        for v in all {
            let json = serde_json::to_string(&v).unwrap();
            assert_eq!(json, format!("\"{}\"", v.to_ooxml()));
            let back: CfOperator = serde_json::from_str(&json).unwrap();
            assert_eq!(back, v);
        }
    }

    #[test]
    fn cf_time_period_serde_matches_ooxml_token() {
        let all = [
            CfTimePeriod::Today,
            CfTimePeriod::Yesterday,
            CfTimePeriod::Tomorrow,
            CfTimePeriod::Last7Days,
            CfTimePeriod::ThisMonth,
            CfTimePeriod::LastMonth,
            CfTimePeriod::NextMonth,
            CfTimePeriod::ThisWeek,
            CfTimePeriod::LastWeek,
            CfTimePeriod::NextWeek,
        ];
        for v in all {
            let json = serde_json::to_string(&v).unwrap();
            assert_eq!(json, format!("\"{}\"", v.to_ooxml()));
            let back: CfTimePeriod = serde_json::from_str(&json).unwrap();
            assert_eq!(back, v);
        }
    }

    #[test]
    fn cfvo_type_serde_matches_ooxml_token() {
        let all = [
            CfvoType::Num,
            CfvoType::Percent,
            CfvoType::Max,
            CfvoType::Min,
            CfvoType::Formula,
            CfvoType::Percentile,
            CfvoType::AutoMin,
            CfvoType::AutoMax,
        ];
        for v in all {
            let json = serde_json::to_string(&v).unwrap();
            assert_eq!(json, format!("\"{}\"", v.to_ooxml()));
            let back: CfvoType = serde_json::from_str(&json).unwrap();
            assert_eq!(back, v);
        }
    }

    #[test]
    fn data_bar_direction_serde_matches_ooxml_token() {
        let all = [
            DataBarDirection::Context,
            DataBarDirection::LeftToRight,
            DataBarDirection::RightToLeft,
        ];
        for v in all {
            let json = serde_json::to_string(&v).unwrap();
            assert_eq!(json, format!("\"{}\"", v.to_ooxml()));
            let back: DataBarDirection = serde_json::from_str(&json).unwrap();
            assert_eq!(back, v);
        }
    }

    #[test]
    fn data_bar_axis_position_serde_matches_ooxml_token() {
        let all = [
            DataBarAxisPosition::Automatic,
            DataBarAxisPosition::Middle,
            DataBarAxisPosition::None,
        ];
        for v in all {
            let json = serde_json::to_string(&v).unwrap();
            assert_eq!(json, format!("\"{}\"", v.to_ooxml()));
            let back: DataBarAxisPosition = serde_json::from_str(&json).unwrap();
            assert_eq!(back, v);
        }
    }

    #[test]
    fn icon_set_type_serde_matches_ooxml_token() {
        let all = [
            IconSetType::ThreeTrafficLights1,
            IconSetType::ThreeArrows,
            IconSetType::ThreeArrowsGray,
            IconSetType::ThreeFlags,
            IconSetType::ThreeTrafficLights2,
            IconSetType::ThreeSigns,
            IconSetType::ThreeSymbols,
            IconSetType::ThreeSymbols2,
            IconSetType::FourArrows,
            IconSetType::FourArrowsGray,
            IconSetType::FourRedToBlack,
            IconSetType::FourRating,
            IconSetType::FourTrafficLights,
            IconSetType::FiveArrows,
            IconSetType::FiveArrowsGray,
            IconSetType::FiveRating,
            IconSetType::FiveQuarters,
            IconSetType::ThreeStars,
            IconSetType::ThreeTriangles,
            IconSetType::FiveBoxes,
            IconSetType::NoIcons,
        ];
        for v in all {
            let json = serde_json::to_string(&v).unwrap();
            assert_eq!(json, format!("\"{}\"", v.to_ooxml()));
            let back: IconSetType = serde_json::from_str(&json).unwrap();
            assert_eq!(back, v);
        }
    }
}
