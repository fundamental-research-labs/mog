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
