//! Chart-type configuration structs (ECMA-376 Part 1, Section 21.2).

use super::*;

// =============================================================================
// Structs
// =============================================================================

/// 3-D view configuration (CT_View3D).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct View3D {
    /// Rotation around X axis (-90 to 90)
    pub rot_x: Option<i8>,
    /// Rotation around Y axis (0 to 360)
    pub rot_y: Option<u16>,
    /// Whether to use right-angle axes
    pub right_angle_axes: Option<bool>,
    /// Perspective (0 to 240, per ST_Perspective)
    pub perspective: Option<u8>,
    /// Height percent (5 to 500)
    pub height_percent: Option<u16>,
    /// Depth percent (20 to 2000)
    pub depth_percent: Option<u16>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

// =============================================================================
// Chart-type config structs
// =============================================================================

/// Bar chart configuration (CT_BarChart).
///
/// Note: `axId` elements (required [2..2] per XSD) are stored on
/// [`ChartGroup::ax_id`](super::ChartGroup::ax_id), not here, because axis
/// bindings are a property of the chart group placement rather than the
/// chart-type-specific configuration.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BarChartConfig {
    /// Bar direction (horizontal bars or vertical columns)
    pub bar_dir: BarDirection,
    /// Grouping (clustered, stacked, percentStacked)
    pub grouping: Option<Grouping>,
    /// Vary colors by point
    pub vary_colors: Option<bool>,
    /// Gap width between bar groups (0-500)
    pub gap_width: Option<u32>,
    /// Overlap between bars (-100 to 100)
    pub overlap: Option<i32>,
    /// Data series (CT_BarSer, [0..unbounded])
    pub ser: Vec<ChartSeries>,
    /// Default data labels for the chart (CT_DLbls, [0..1])
    pub d_lbls: Option<DataLabelOptions>,
    /// Series lines
    pub ser_lines: Vec<ChartLines>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// 3-D bar chart configuration (CT_Bar3DChart).
///
/// Note: Unlike [`BarChartConfig`] (CT_BarChart), the 3-D bar chart does NOT have
/// `overlap` or `serLines` elements per the ECMA-376 spec (§21.2.2.17).
/// CT_Bar3DChart only has: barDir, grouping, varyColors, ser[], dLbls, gapWidth,
/// gapDepth, shape, axId[].
///
/// Note: `axId` elements (required [2..3] per XSD) are stored on
/// [`ChartGroup::ax_id`](super::ChartGroup::ax_id), not here, because axis
/// bindings are a property of the chart group placement rather than the
/// chart-type-specific configuration.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Bar3DChartConfig {
    /// Bar direction (horizontal bars or vertical columns)
    pub bar_dir: BarDirection,
    /// Grouping (clustered, stacked, percentStacked)
    pub grouping: Option<Grouping>,
    /// Vary colors by point
    pub vary_colors: Option<bool>,
    /// Gap width between bar groups (0-500)
    pub gap_width: Option<u32>,
    /// Gap depth (0-500)
    pub gap_depth: Option<u32>,
    /// 3-D bar shape
    pub shape: Option<BarShape>,
    /// Data series (CT_BarSer, [0..unbounded])
    pub ser: Vec<ChartSeries>,
    /// Default data labels for the chart (CT_DLbls, [0..1])
    pub d_lbls: Option<DataLabelOptions>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Line chart configuration (CT_LineChart).
///
/// Note: `axId` elements (required [2..2] per XSD) are stored on
/// [`ChartGroup::ax_id`](super::ChartGroup::ax_id), not here, because axis
/// bindings are a property of the chart group placement rather than the
/// chart-type-specific configuration.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct LineChartConfig {
    /// Grouping
    pub grouping: Grouping,
    /// Vary colors by point
    pub vary_colors: Option<bool>,
    /// Drop lines
    pub drop_lines: Option<ChartLines>,
    /// High-low lines
    pub hi_low_lines: Option<ChartLines>,
    /// Up/down bars
    pub up_down_bars: Option<UpDownBars>,
    /// Show markers
    pub marker: Option<bool>,
    /// Smooth lines
    pub smooth: Option<bool>,
    /// Data series (CT_LineSer, [0..unbounded])
    pub ser: Vec<ChartSeries>,
    /// Default data labels for the chart (CT_DLbls, [0..1])
    pub d_lbls: Option<DataLabelOptions>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// 3-D line chart configuration (CT_Line3DChart).
///
/// Note: `axId` elements (required [2..3] per XSD) are stored on
/// [`ChartGroup::ax_id`](super::ChartGroup::ax_id), not here, because axis
/// bindings are a property of the chart group placement rather than the
/// chart-type-specific configuration.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Line3DChartConfig {
    /// Grouping
    pub grouping: Grouping,
    /// Vary colors by point
    pub vary_colors: Option<bool>,
    /// Drop lines
    pub drop_lines: Option<ChartLines>,
    /// Gap depth (0-500)
    pub gap_depth: Option<u32>,
    /// Data series (CT_LineSer, [0..unbounded])
    pub ser: Vec<ChartSeries>,
    /// Default data labels for the chart (CT_DLbls, [0..1])
    pub d_lbls: Option<DataLabelOptions>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Pie chart configuration (CT_PieChart).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PieChartConfig {
    /// Vary colors by point
    pub vary_colors: Option<bool>,
    /// First slice angle (0-360 degrees)
    pub first_slice_ang: Option<u32>,
    /// Data series (CT_PieSer, [0..unbounded])
    pub ser: Vec<ChartSeries>,
    /// Default data labels for the chart (CT_DLbls, [0..1])
    pub d_lbls: Option<DataLabelOptions>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// 3-D pie chart configuration (CT_Pie3DChart).
///
/// Unlike [`PieChartConfig`] (CT_PieChart), CT_Pie3DChart does NOT include
/// `firstSliceAng` per ECMA-376 §21.2.2.141.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Pie3DChartConfig {
    /// Vary colors by point
    pub vary_colors: Option<bool>,
    /// Data series (CT_PieSer, [0..unbounded])
    pub ser: Vec<ChartSeries>,
    /// Default data labels for the chart (CT_DLbls, [0..1])
    pub d_lbls: Option<DataLabelOptions>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Doughnut chart configuration (CT_DoughnutChart).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DoughnutChartConfig {
    /// Vary colors by point
    pub vary_colors: Option<bool>,
    /// First slice angle (0-360 degrees)
    pub first_slice_ang: Option<u32>,
    /// Hole size (1-90%)
    pub hole_size: Option<u32>,
    /// Data series (CT_PieSer, [0..unbounded])
    pub ser: Vec<ChartSeries>,
    /// Default data labels for the chart (CT_DLbls, [0..1])
    pub d_lbls: Option<DataLabelOptions>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Area chart configuration (CT_AreaChart).
///
/// Note: `axId` elements (required [2..2] per XSD) are stored on
/// [`ChartGroup::ax_id`](super::ChartGroup::ax_id), not here, because axis
/// bindings are a property of the chart group placement rather than the
/// chart-type-specific configuration.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AreaChartConfig {
    /// Grouping
    pub grouping: Option<Grouping>,
    /// Vary colors by point
    pub vary_colors: Option<bool>,
    /// Drop lines
    pub drop_lines: Option<ChartLines>,
    /// Data series (CT_AreaSer, [0..unbounded])
    pub ser: Vec<ChartSeries>,
    /// Default data labels for the chart (CT_DLbls, [0..1])
    pub d_lbls: Option<DataLabelOptions>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// 3-D area chart configuration (CT_Area3DChart).
///
/// Note: `axId` elements (required [2..3] per XSD) are stored on
/// [`ChartGroup::ax_id`](super::ChartGroup::ax_id), not here, because axis
/// bindings are a property of the chart group placement rather than the
/// chart-type-specific configuration.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Area3DChartConfig {
    /// Grouping
    pub grouping: Option<Grouping>,
    /// Vary colors by point
    pub vary_colors: Option<bool>,
    /// Drop lines
    pub drop_lines: Option<ChartLines>,
    /// Gap depth (0-500)
    pub gap_depth: Option<u32>,
    /// Data series (CT_AreaSer, [0..unbounded])
    pub ser: Vec<ChartSeries>,
    /// Default data labels for the chart (CT_DLbls, [0..1])
    pub d_lbls: Option<DataLabelOptions>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Scatter chart configuration (CT_ScatterChart).
///
/// Note: `axId` elements (required [2..2] per XSD) are stored on
/// [`ChartGroup::ax_id`](super::ChartGroup::ax_id), not here, because axis
/// bindings are a property of the chart group placement rather than the
/// chart-type-specific configuration.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ScatterChartConfig {
    /// Scatter style
    pub scatter_style: ScatterStyle,
    /// Vary colors by point
    pub vary_colors: Option<bool>,
    /// Data series (CT_ScatterSer, [0..unbounded])
    pub ser: Vec<ChartSeries>,
    /// Default data labels for the chart (CT_DLbls, [0..1])
    pub d_lbls: Option<DataLabelOptions>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Bubble chart configuration (CT_BubbleChart).
///
/// Note: `axId` elements (required [2..2] per XSD) are stored on
/// [`ChartGroup::ax_id`](super::ChartGroup::ax_id), not here, because axis
/// bindings are a property of the chart group placement rather than the
/// chart-type-specific configuration.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BubbleChartConfig {
    /// Vary colors by point
    pub vary_colors: Option<bool>,
    /// Data series (CT_BubbleSer, [0..unbounded])
    pub ser: Vec<ChartSeries>,
    /// Default data labels for the chart (CT_DLbls, [0..1])
    pub d_lbls: Option<DataLabelOptions>,
    /// 3-D bubbles
    pub bubble_3d: Option<bool>,
    /// Bubble scale (0-300, default 100)
    pub bubble_scale: Option<u32>,
    /// Show negative bubbles
    pub show_neg_bubbles: Option<bool>,
    /// What the bubble size represents
    pub size_represents: Option<SizeRepresents>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

impl Default for BubbleChartConfig {
    fn default() -> Self {
        Self {
            vary_colors: None,
            ser: Vec::new(),
            d_lbls: None,
            bubble_3d: None,
            bubble_scale: Some(100),
            show_neg_bubbles: None,
            size_represents: None,
            extensions: Vec::new(),
        }
    }
}

/// Radar chart configuration (CT_RadarChart).
///
/// Note: `axId` elements (required [2..2] per XSD) are stored on
/// [`ChartGroup::ax_id`](super::ChartGroup::ax_id), not here, because axis
/// bindings are a property of the chart group placement rather than the
/// chart-type-specific configuration.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RadarChartConfig {
    /// Radar style
    pub radar_style: RadarStyle,
    /// Vary colors by point
    pub vary_colors: Option<bool>,
    /// Data series (CT_RadarSer, [0..unbounded])
    pub ser: Vec<ChartSeries>,
    /// Default data labels for the chart (CT_DLbls, [0..1])
    pub d_lbls: Option<DataLabelOptions>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Surface chart configuration (CT_SurfaceChart / CT_Surface3DChart).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SurfaceChartConfig {
    /// Wireframe mode
    pub wireframe: Option<bool>,
    /// Band formats
    pub band_fmts: Vec<BandFmt>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Stock chart configuration (CT_StockChart).
///
/// Note: `axId` elements (required [2..2] per XSD) are stored on
/// [`ChartGroup::ax_id`](super::ChartGroup::ax_id), not here, because axis
/// bindings are a property of the chart group placement rather than the
/// chart-type-specific configuration.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct StockChartConfig {
    /// Drop lines
    pub drop_lines: Option<ChartLines>,
    /// High-low lines
    pub hi_low_lines: Option<ChartLines>,
    /// Up/down bars
    pub up_down_bars: Option<UpDownBars>,
    /// Default data labels for the chart (CT_DLbls, [0..1])
    pub d_lbls: Option<DataLabelOptions>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Of-pie chart configuration (CT_OfPieChart).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct OfPieChartConfig {
    /// Of-pie type (pie or bar)
    pub of_pie_type: OfPieType,
    /// Vary colors by point
    pub vary_colors: Option<bool>,
    /// Data series (CT_PieSer, [0..unbounded])
    pub ser: Vec<ChartSeries>,
    /// Default data labels for the chart (CT_DLbls, [0..1])
    pub d_lbls: Option<DataLabelOptions>,
    /// Gap width between pie and secondary chart (0-500)
    pub gap_width: Option<u32>,
    /// How to split data between primary and secondary
    pub split_type: Option<SplitType>,
    /// Split position value
    pub split_pos: Option<f64>,
    /// Custom split point indices
    pub cust_split: Option<Vec<u32>>,
    /// Second pie/bar size (5-200, default 75)
    pub second_pie_size: Option<u32>,
    /// Series lines
    pub ser_lines: Vec<ChartLines>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

impl Default for OfPieChartConfig {
    fn default() -> Self {
        Self {
            of_pie_type: OfPieType::Pie,
            vary_colors: None,
            ser: Vec::new(),
            d_lbls: None,
            gap_width: None,
            split_type: None,
            split_pos: None,
            cust_split: None,
            second_pie_size: Some(75),
            ser_lines: Vec::new(),
            extensions: Vec::new(),
        }
    }
}

// =============================================================================
// ChartTypeConfig -- unified chart-type configuration enum
// =============================================================================

/// Unified chart-type configuration carrying per-type settings.
///
/// Each variant wraps a chart-type-specific config struct.
/// The `Combo` variant has no config -- combo charts are expressed as
/// multiple chart type elements in the plot area.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ChartTypeConfig {
    /// Bar chart
    Bar(BarChartConfig),
    /// 3-D bar chart
    Bar3D(Bar3DChartConfig),
    /// Line chart
    Line(LineChartConfig),
    /// 3-D line chart
    Line3D(Line3DChartConfig),
    /// Pie chart
    Pie(PieChartConfig),
    /// 3-D pie chart
    Pie3D(Pie3DChartConfig),
    /// Doughnut chart
    Doughnut(DoughnutChartConfig),
    /// Area chart
    Area(AreaChartConfig),
    /// 3-D area chart
    Area3D(Area3DChartConfig),
    /// Scatter chart
    Scatter(ScatterChartConfig),
    /// Bubble chart
    Bubble(BubbleChartConfig),
    /// Radar chart
    Radar(RadarChartConfig),
    /// Surface chart
    Surface(SurfaceChartConfig),
    /// 3-D surface chart
    Surface3D(SurfaceChartConfig),
    /// Stock chart
    Stock(StockChartConfig),
    /// Of-pie chart (pie of pie / bar of pie)
    OfPie(OfPieChartConfig),
    /// Combo chart -- no per-type config (expressed as multiple chart elements)
    Combo,
}

impl ChartTypeConfig {
    /// Get the base [`ChartType`] for this configuration.
    #[must_use]
    pub fn chart_type(&self) -> ChartType {
        match self {
            Self::Bar(_) => ChartType::Bar,
            Self::Bar3D(_) => ChartType::Bar3D,
            Self::Line(_) => ChartType::Line,
            Self::Line3D(_) => ChartType::Line3D,
            Self::Pie(_) => ChartType::Pie,
            Self::Pie3D(_) => ChartType::Pie3D,
            Self::Doughnut(_) => ChartType::Doughnut,
            Self::Area(_) => ChartType::Area,
            Self::Area3D(_) => ChartType::Area3D,
            Self::Scatter(_) => ChartType::Scatter,
            Self::Bubble(_) => ChartType::Bubble,
            Self::Radar(_) => ChartType::Radar,
            Self::Surface(_) => ChartType::Surface,
            Self::Surface3D(_) => ChartType::Surface3D,
            Self::Stock(_) => ChartType::Stock,
            Self::OfPie(_) => ChartType::OfPie,
            Self::Combo => ChartType::Combo,
        }
    }
}
