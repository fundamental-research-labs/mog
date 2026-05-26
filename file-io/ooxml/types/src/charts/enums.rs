//! Chart enum types (ECMA-376 Part 1, Section 21.2 -- DrawingML Charts).

// =============================================================================
// ChartType -- primary chart type
// =============================================================================

/// Primary chart type (ECMA-376 chart element types).
///
/// This is the **read-side** design which maps 1:1 to OOXML element names.
/// The write side's composite presets (e.g. `BarStacked`, `ColumnStacked100`)
/// are expressed as a `ChartType` + [`Grouping`] + [`BarDirection`] combination.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum ChartType {
    /// Unknown or unsupported chart type
    #[default]
    Unknown,
    /// Bar chart -- horizontal bars or vertical columns (`barChart`)
    Bar,
    /// 3-D bar chart (`bar3DChart`)
    Bar3D,
    /// Line chart (`lineChart`)
    Line,
    /// 3-D line chart (`line3DChart`)
    Line3D,
    /// Pie chart (`pieChart`)
    Pie,
    /// 3-D pie chart (`pie3DChart`)
    Pie3D,
    /// Doughnut chart -- pie with a hole (`doughnutChart`)
    Doughnut,
    /// Area chart (`areaChart`)
    Area,
    /// 3-D area chart (`area3DChart`)
    Area3D,
    /// Scatter (XY) chart (`scatterChart`)
    Scatter,
    /// Bubble chart (`bubbleChart`)
    Bubble,
    /// Radar (spider) chart (`radarChart`)
    Radar,
    /// Surface chart (`surfaceChart`)
    Surface,
    /// 3-D surface chart (`surface3DChart`)
    Surface3D,
    /// Stock chart -- HLC, OHLC variants (`stockChart`)
    Stock,
    /// Of-pie chart -- pie of pie or bar of pie (`ofPieChart`)
    OfPie,
    /// Combo chart -- multiple chart types combined
    Combo,
}

impl ChartType {
    /// Parse chart type from an OOXML element name (e.g. `"barChart"`).
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "barChart" => Self::Bar,
            "bar3DChart" => Self::Bar3D,
            "lineChart" => Self::Line,
            "line3DChart" => Self::Line3D,
            "pieChart" => Self::Pie,
            "pie3DChart" => Self::Pie3D,
            "doughnutChart" => Self::Doughnut,
            "areaChart" => Self::Area,
            "area3DChart" => Self::Area3D,
            "scatterChart" => Self::Scatter,
            "bubbleChart" => Self::Bubble,
            "radarChart" => Self::Radar,
            "surfaceChart" => Self::Surface,
            "surface3DChart" => Self::Surface3D,
            "stockChart" => Self::Stock,
            "ofPieChart" => Self::OfPie,
            _ => Self::Unknown,
        }
    }

    /// Serialize to the OOXML element name.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Unknown => "unknownChart",
            Self::Bar => "barChart",
            Self::Bar3D => "bar3DChart",
            Self::Line => "lineChart",
            Self::Line3D => "line3DChart",
            Self::Pie => "pieChart",
            Self::Pie3D => "pie3DChart",
            Self::Doughnut => "doughnutChart",
            Self::Area => "areaChart",
            Self::Area3D => "area3DChart",
            Self::Scatter => "scatterChart",
            Self::Bubble => "bubbleChart",
            Self::Radar => "radarChart",
            Self::Surface => "surfaceChart",
            Self::Surface3D => "surface3DChart",
            Self::Stock => "stockChart",
            Self::OfPie => "ofPieChart",
            Self::Combo => "comboChart",
        }
    }

    /// Whether this is a 3-D chart variant.
    #[must_use]
    pub fn is_3d(&self) -> bool {
        matches!(
            self,
            Self::Bar3D | Self::Line3D | Self::Pie3D | Self::Area3D | Self::Surface3D
        )
    }

    /// Whether this chart type uses category labels (as opposed to XY scatter).
    #[must_use]
    pub fn uses_categories(&self) -> bool {
        !matches!(self, Self::Scatter | Self::Bubble)
    }

    /// Whether this chart type supports more than one data series.
    #[must_use]
    pub fn supports_multiple_series(&self) -> bool {
        !matches!(self, Self::Pie | Self::Pie3D | Self::Doughnut)
    }
}

// =============================================================================
// BarDirection
// =============================================================================

/// Bar chart direction (ST_BarDir).
///
/// Note: The XSD default for CT_BarDir is `"col"` (vertical), and we also default to
/// `Column` (vertical) to match the spec.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum BarDirection {
    /// Horizontal bars
    Bar,
    /// Vertical columns (default)
    #[default]
    Column,
}

impl BarDirection {
    /// Parse from an OOXML attribute value (`"bar"` or `"col"`).
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "bar" => Self::Bar,
            "col" => Self::Column,
            _ => Self::Column,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Bar => "bar",
            Self::Column => "col",
        }
    }
}

// =============================================================================
// Grouping
// =============================================================================

/// Bar/area/line chart grouping (ST_Grouping / ST_BarGrouping).
///
/// The XSD defines two separate types:
/// - **ST_Grouping** (line, area, radar): `standard`, `stacked`, `percentStacked` (default: `standard`)
/// - **ST_BarGrouping** (bar only): `clustered`, `standard`, `stacked`, `percentStacked` (default: `clustered`)
///
/// This enum is a unified superset of both. Bar chart configs should explicitly set
/// `Clustered` rather than relying on the default, which matches ST_Grouping's `standard`.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum Grouping {
    /// Standard grouping (overlapping for area, default for line)
    #[default]
    Standard,
    /// Clustered (side by side)
    Clustered,
    /// Stacked (on top of each other)
    Stacked,
    /// Percent stacked (100% stacked)
    PercentStacked,
}

impl Grouping {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "standard" => Self::Standard,
            "clustered" => Self::Clustered,
            "stacked" => Self::Stacked,
            "percentStacked" => Self::PercentStacked,
            _ => Self::Standard,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Clustered => "clustered",
            Self::Stacked => "stacked",
            Self::PercentStacked => "percentStacked",
        }
    }
}

// =============================================================================
// BarShape
// =============================================================================

/// Bar chart shape for 3-D charts (ST_Shape).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum BarShape {
    /// Box (rectangular prism, default)
    #[default]
    Box,
    /// Cone
    Cone,
    /// Cone to max
    ConeToMax,
    /// Cylinder
    Cylinder,
    /// Pyramid
    Pyramid,
    /// Pyramid to max
    PyramidToMax,
}

impl BarShape {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "box" => Self::Box,
            "cone" => Self::Cone,
            "coneToMax" => Self::ConeToMax,
            "cylinder" => Self::Cylinder,
            "pyramid" => Self::Pyramid,
            "pyramidToMax" => Self::PyramidToMax,
            _ => Self::Box,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Box => "box",
            Self::Cone => "cone",
            Self::ConeToMax => "coneToMax",
            Self::Cylinder => "cylinder",
            Self::Pyramid => "pyramid",
            Self::PyramidToMax => "pyramidToMax",
        }
    }
}

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
// ScatterStyle
// =============================================================================

/// Scatter chart style (ST_ScatterStyle).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum ScatterStyle {
    /// No lines, no markers
    None,
    /// Lines connecting points
    Line,
    /// Lines with markers
    LineMarker,
    /// Markers only, no connecting lines (default per CT_ScatterStyle)
    #[default]
    Marker,
    /// Smooth curves
    Smooth,
    /// Smooth curves with markers
    SmoothMarker,
}

impl ScatterStyle {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "none" => Self::None,
            "line" => Self::Line,
            "lineMarker" => Self::LineMarker,
            "marker" => Self::Marker,
            "smooth" => Self::Smooth,
            "smoothMarker" => Self::SmoothMarker,
            _ => Self::Marker,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Line => "line",
            Self::LineMarker => "lineMarker",
            Self::Marker => "marker",
            Self::Smooth => "smooth",
            Self::SmoothMarker => "smoothMarker",
        }
    }
}

// =============================================================================
// RadarStyle
// =============================================================================

/// Radar chart style (ST_RadarStyle).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum RadarStyle {
    /// Standard radar chart (default)
    #[default]
    Standard,
    /// Radar with markers
    Marker,
    /// Filled radar (area)
    Filled,
}

impl RadarStyle {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "standard" => Self::Standard,
            "marker" => Self::Marker,
            "filled" => Self::Filled,
            _ => Self::Standard,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Marker => "marker",
            Self::Filled => "filled",
        }
    }
}

// =============================================================================
// StockType
// =============================================================================

/// Stock chart sub-type.
///
/// Determined by the number and order of series, not by an OOXML attribute.
/// Included here for downstream consumers that need to distinguish variants.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum StockType {
    /// High-Low-Close (3 series)
    #[default]
    HLC,
    /// Open-High-Low-Close (4 series)
    OHLC,
    /// Volume-High-Low-Close (4 series, volume on secondary axis)
    VolumeHLC,
    /// Volume-Open-High-Low-Close (5 series)
    VolumeOHLC,
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

// =============================================================================
// LayoutTarget
// =============================================================================

/// Layout target (ST_LayoutTarget).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum LayoutTarget {
    /// Inner plot area
    Inner,
    /// Outer chart area (default per ST_LayoutTarget)
    #[default]
    Outer,
}

impl LayoutTarget {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "inner" => Self::Inner,
            "outer" => Self::Outer,
            _ => Self::Outer,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Inner => "inner",
            Self::Outer => "outer",
        }
    }
}

// =============================================================================
// LayoutMode
// =============================================================================

/// Layout mode (ST_LayoutMode).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum LayoutMode {
    /// Relative to edge
    Edge,
    /// Factor of chart dimension (default per ST_LayoutMode)
    #[default]
    Factor,
}

impl LayoutMode {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "edge" => Self::Edge,
            "factor" => Self::Factor,
            _ => Self::Factor,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Edge => "edge",
            Self::Factor => "factor",
        }
    }
}

// =============================================================================
// AnchorType
// =============================================================================

/// Drawing anchor type for chart placement.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum AnchorType {
    /// Two-cell anchor -- moves and resizes with cells (default)
    #[default]
    TwoCell,
    /// One-cell anchor -- moves with cell, fixed size
    OneCell,
    /// Absolute position -- fixed position and size
    Absolute,
}

impl AnchorType {
    /// Parse from an OOXML element name.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "twoCellAnchor" => Self::TwoCell,
            "oneCellAnchor" => Self::OneCell,
            "absoluteAnchor" => Self::Absolute,
            _ => Self::TwoCell,
        }
    }

    /// Serialize to the OOXML element name.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::TwoCell => "twoCellAnchor",
            Self::OneCell => "oneCellAnchor",
            Self::Absolute => "absoluteAnchor",
        }
    }
}

// =============================================================================
// OfPieType (ST_OfPieType)
// =============================================================================

/// Of-pie chart sub-type (ST_OfPieType).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum OfPieType {
    /// Pie of pie
    #[default]
    Pie,
    /// Bar of pie
    Bar,
}

impl OfPieType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "pie" => Self::Pie,
            "bar" => Self::Bar,
            _ => Self::Pie,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Pie => "pie",
            Self::Bar => "bar",
        }
    }
}

// =============================================================================
// SplitType (ST_SplitType)
// =============================================================================

/// Split type for of-pie charts (ST_SplitType).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum SplitType {
    /// Automatic split
    #[default]
    Auto,
    /// Custom split
    Custom,
    /// Split by percent
    Percent,
    /// Split by position
    Position,
    /// Split by value
    Value,
}

impl SplitType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "auto" => Self::Auto,
            "cust" => Self::Custom,
            "percent" => Self::Percent,
            "pos" => Self::Position,
            "val" => Self::Value,
            _ => Self::Auto,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Custom => "cust",
            Self::Percent => "percent",
            Self::Position => "pos",
            Self::Value => "val",
        }
    }
}

// =============================================================================
// SizeRepresents (ST_SizeRepresents)
// =============================================================================

/// What the bubble size represents (ST_SizeRepresents).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum SizeRepresents {
    /// Area of the bubble (default)
    #[default]
    Area,
    /// Width of the bubble
    Width,
}

impl SizeRepresents {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "area" => Self::Area,
            "w" => Self::Width,
            _ => Self::Area,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Area => "area",
            Self::Width => "w",
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

// =============================================================================
// PageOrientation -- page setup orientation
// =============================================================================

/// Page orientation for chart print settings (ST_PageSetupOrientation).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Default, serde::Serialize, serde::Deserialize,
)]
pub enum PageOrientation {
    /// Default orientation (let application decide)
    #[default]
    Default,
    /// Portrait orientation
    Portrait,
    /// Landscape orientation
    Landscape,
}

impl PageOrientation {
    /// Parse from OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "default" => Self::Default,
            "portrait" => Self::Portrait,
            "landscape" => Self::Landscape,
            _ => Self::Default,
        }
    }

    /// Serialize to OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Portrait => "portrait",
            Self::Landscape => "landscape",
        }
    }
}
