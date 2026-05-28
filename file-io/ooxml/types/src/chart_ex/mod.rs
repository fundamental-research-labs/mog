//! ChartEx types (Microsoft Office 2014+ extension — `cx:chart` namespace).
//!
//! ChartEx is a Microsoft extension NOT in ECMA-376. It uses the namespace
//! `http://schemas.microsoft.com/office/drawing/2014/chartex` and covers
//! modern chart types: Waterfall, Treemap, Sunburst, Funnel, RegionMap,
//! Histogram, Pareto, BoxWhisker, and more.
//!
//! Content type: `application/vnd.ms-office.chartex+xml`
//! Relationship type: `http://schemas.microsoft.com/office/2014/relationships/chartEx`
//!
//! This is a SEPARATE type system from standard ECMA-376 charts (`c:chart`).
//! The `cx:` model is cleaner: unified axes, data-driven series via `layoutId`,
//! simpler hierarchy.
//!
//! This module describes the Microsoft extension vocabulary only. It does not
//! by itself guarantee editable ChartEx support; package relationship policy and
//! raw replay decisions live in the parser/writer integration layer.

use crate::drawings::{ShapeProperties, TextBody};

// =============================================================================
// Constants
// =============================================================================

/// ChartEx namespace URI.
pub const NS_CHART_EX: &str = "http://schemas.microsoft.com/office/drawing/2014/chartex";

/// ChartEx content type for `[Content_Types].xml`.
pub const CT_CHART_EX: &str = "application/vnd.ms-office.chartex+xml";

/// ChartEx relationship type (used in drawing .rels).
pub const REL_CHART_EX: &str = "http://schemas.microsoft.com/office/2014/relationships/chartEx";

/// ChartEx graphic data URI (used in `a:graphicData` within drawings).
pub const GRAPHIC_DATA_URI_CHART_EX: &str =
    "http://schemas.microsoft.com/office/drawing/2014/chartex";

// =============================================================================
// Root: ChartExSpace
// =============================================================================

/// Root element of a ChartEx part (`cx:chartSpace`).
///
/// Corresponds to `xl/charts/chartExN.xml` in the ZIP archive.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExSpace {
    /// Chart data definitions (`cx:chartData`).
    pub chart_data: ChartExChartData,
    /// The chart model (`cx:chart`).
    pub chart: ChartExChart,
    /// Format overrides (`cx:fmtOvrs`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fmt_ovrs: Vec<ChartExFormatOverride>,
    /// ChartSpace-level shape properties (`cx:spPr`).
    pub sp_pr: Option<ShapeProperties>,
    /// ChartSpace-level text properties (`cx:txPr`).
    pub tx_pr: Option<TextBody>,
    /// Print settings (`cx:printSettings`).
    pub print_settings: Option<ChartExPrintSettings>,
}

// =============================================================================
// ChartData
// =============================================================================

/// Chart data container (`cx:chartData`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExChartData {
    /// Data sources, each with a unique `id`.
    pub data: Vec<ChartExData>,
}

/// A single data source (`cx:data`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExData {
    /// Data source ID (referenced by `cx:dataId val="N"` in series).
    pub id: u32,
    /// Dimensions (string and/or numeric).
    pub dimensions: Vec<ChartExDimension>,
}

/// A dimension within a data source — either string or numeric.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ChartExDimension {
    /// String dimension (`cx:strDim`).
    String {
        /// Dimension type attribute (e.g., `"cat"`, `"colorStr"`).
        dim_type: String,
        /// Formula reference.
        formula: ChartExFormula,
    },
    /// Numeric dimension (`cx:numDim`).
    Numeric {
        /// Dimension type attribute (e.g., `"val"`, `"colorVal"`, `"size"`).
        dim_type: String,
        /// Formula reference.
        formula: ChartExFormula,
    },
}

/// Formula reference within a dimension (`cx:f`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExFormula {
    /// Direction attribute (`"row"` or `"col"`). Optional.
    pub dir: Option<String>,
    /// Formula text content (e.g., `"_xlchart.v1.1"` or a sheet reference).
    pub content: String,
}

// =============================================================================
// Chart
// =============================================================================

/// The chart model (`cx:chart`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExChart {
    /// Chart title (`cx:title`).
    pub title: Option<ChartExTitle>,
    /// Plot area (`cx:plotArea`).
    pub plot_area: ChartExPlotArea,
    /// Legend (`cx:legend`).
    pub legend: Option<ChartExLegend>,
}

// =============================================================================
// Title
// =============================================================================

/// Chart or axis title (`cx:title`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExTitle {
    /// Position attribute (e.g., `"t"`, `"b"`, `"l"`, `"r"`).
    pub pos: Option<String>,
    /// Alignment attribute (e.g., `"ctr"`, `"l"`, `"r"`).
    pub align: Option<String>,
    /// Overlay attribute.
    pub overlay: Option<bool>,
    /// Title text (`cx:tx`).
    pub tx: Option<ChartExText>,
    /// Text properties (`cx:txPr`).
    pub tx_pr: Option<TextBody>,
    /// Shape properties (`cx:spPr`).
    pub sp_pr: Option<ShapeProperties>,
}

/// Title text content (`cx:tx` > `cx:txData`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExText {
    /// Rich text body (`cx:rich`) — DrawingML text body. Optional.
    pub rich: Option<TextBody>,
    /// Text data (`cx:txData`).
    pub tx_data: Option<ChartExTxData>,
}

/// Text data content (`cx:txData`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExTxData {
    /// Formula reference (`cx:f`).
    pub formula: Option<String>,
    /// Plain text value (`cx:v`).
    pub value: Option<String>,
}

// =============================================================================
// PlotArea
// =============================================================================

/// Plot area (`cx:plotArea`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExPlotArea {
    /// Plot area region (`cx:plotAreaRegion`).
    pub plot_area_region: ChartExPlotAreaRegion,
    /// Axes (`cx:axis`).
    pub axes: Vec<ChartExAxis>,
    /// Shape properties (`cx:spPr`).
    pub sp_pr: Option<ShapeProperties>,
}

/// Plot area region containing series (`cx:plotAreaRegion`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExPlotAreaRegion {
    /// Shape properties for the region.
    pub sp_pr: Option<ShapeProperties>,
    /// Series in this region.
    pub series: Vec<ChartExSeries>,
}

// =============================================================================
// Series
// =============================================================================

/// A chart series (`cx:series`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExSeries {
    /// Layout ID — determines chart type (e.g., `"waterfall"`, `"treemap"`).
    pub layout_id: ChartExLayoutId,
    /// Unique identifier (UUID string).
    pub unique_id: Option<String>,
    /// Format index.
    pub format_idx: Option<u32>,
    /// Whether this series is hidden.
    pub hidden: Option<bool>,
    /// Series name (`cx:tx`).
    pub tx: Option<ChartExText>,
    /// Shape properties (`cx:spPr`).
    pub sp_pr: Option<ShapeProperties>,
    /// Per-data-point style overrides (`cx:dataPt`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub data_points: Vec<ChartExDataPoint>,
    /// Data labels (`cx:dataLabels`).
    pub data_labels: Option<ChartExDataLabels>,
    /// Data ID reference (`cx:dataId val="N"`).
    pub data_id: Option<u32>,
    /// Layout properties (`cx:layoutPr`).
    pub layout_pr: Option<ChartExLayoutProperties>,
}

/// Layout ID enum — determines the chart type.
///
/// Maps to the `layoutId` attribute on `cx:series`.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ChartExLayoutId {
    #[default]
    Waterfall,
    Treemap,
    Sunburst,
    Funnel,
    RegionMap,
    Histogram,
    Pareto,
    BoxWhisker,
    ClusteredBar,
    /// Unknown layout ID — preserves the raw string for round-trip.
    Other(String),
}

impl ChartExLayoutId {
    /// Parse from the OOXML `layoutId` attribute value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "waterfall" => Self::Waterfall,
            "treemap" => Self::Treemap,
            "sunburst" => Self::Sunburst,
            "funnel" => Self::Funnel,
            "regionMap" => Self::RegionMap,
            "histogram" => Self::Histogram,
            "paretoLine" | "pareto" => Self::Pareto,
            "boxWhisker" => Self::BoxWhisker,
            "clusteredBar" | "clusteredColumn" => Self::ClusteredBar,
            other => Self::Other(other.to_string()),
        }
    }

    /// Convert to the OOXML `layoutId` attribute value.
    pub fn to_ooxml(&self) -> &str {
        match self {
            Self::Waterfall => "waterfall",
            Self::Treemap => "treemap",
            Self::Sunburst => "sunburst",
            Self::Funnel => "funnel",
            Self::RegionMap => "regionMap",
            Self::Histogram => "histogram",
            Self::Pareto => "paretoLine",
            Self::BoxWhisker => "boxWhisker",
            Self::ClusteredBar => "clusteredBar",
            Self::Other(s) => s,
        }
    }
}

// =============================================================================
// Data Point Override
// =============================================================================

/// Per-data-point style override (`cx:dataPt`).
///
/// Allows individual data points (e.g., a single bar in a waterfall chart) to
/// have custom formatting that overrides the series-level shape properties.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExDataPoint {
    /// Zero-based index of the data point.
    pub idx: u32,
    /// Shape properties override (`cx:spPr`).
    pub sp_pr: Option<ShapeProperties>,
}

// =============================================================================
// DataLabels
// =============================================================================

/// Data labels (`cx:dataLabels`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExDataLabels {
    /// Position attribute (e.g., `"outEnd"`, `"ctr"`).
    pub pos: Option<String>,
    /// Visibility settings (`cx:visibility`).
    pub visibility: Option<ChartExDataLabelVisibility>,
    /// Text properties (`cx:txPr`).
    pub tx_pr: Option<TextBody>,
    /// Number format (`cx:numFmt`).
    pub num_fmt: Option<ChartExNumberFormat>,
    /// Shape properties (`cx:spPr`).
    pub sp_pr: Option<ShapeProperties>,
    /// Separator string.
    pub separator: Option<String>,
}

/// Data label visibility flags (`cx:visibility`).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ChartExDataLabelVisibility {
    /// Show series name.
    pub series_name: Option<bool>,
    /// Show category name.
    pub category_name: Option<bool>,
    /// Show value.
    pub value: Option<bool>,
}

/// Number format (`cx:numFmt`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExNumberFormat {
    /// Format code.
    pub format_code: String,
    /// Whether linked to source.
    pub source_linked: Option<bool>,
}

// =============================================================================
// Layout Properties
// =============================================================================

/// Layout-specific properties (`cx:layoutPr`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExLayoutProperties {
    /// Visibility flags (e.g., connectorLines).
    pub visibility: Option<ChartExLayoutVisibility>,
    /// Subtotals element (`cx:subtotals`).
    /// Contains indices of subtotal data points.
    pub subtotals: Option<ChartExSubtotals>,
    /// Parent label layout for treemap (`cx:parentLabelLayout`).
    pub parent_label_layout: Option<String>,
    /// Binning for histogram (`cx:binning`).
    pub binning: Option<ChartExBinning>,
    /// Statistics for box & whisker.
    pub statistics: Option<ChartExStatistics>,
}

/// Layout visibility flags (`cx:visibility` inside `cx:layoutPr`).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ChartExLayoutVisibility {
    /// Show connector lines (waterfall).
    pub connector_lines: Option<bool>,
    /// Show mean line.
    pub mean_line: Option<bool>,
    /// Show mean marker.
    pub mean_marker: Option<bool>,
    /// Show non-outlier points.
    pub non_outlier_points: Option<bool>,
    /// Show outlier points.
    pub outlier_points: Option<bool>,
}

/// Subtotals definition (`cx:subtotals`).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ChartExSubtotals {
    /// Indices of subtotal data points.
    pub idx: Vec<u32>,
}

/// Binning for histogram charts (`cx:binning`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExBinning {
    /// Interval closed side (`"l"` or `"r"`).
    pub interval_closed: Option<String>,
    /// Underflow value.
    pub underflow: Option<ChartExBoundValue>,
    /// Overflow value.
    pub overflow: Option<ChartExBoundValue>,
    /// Bin size.
    pub bin_size: Option<f64>,
    /// Bin count.
    pub bin_count: Option<u32>,
}

/// A bound value for histogram binning — either `"auto"` or a numeric value.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ChartExBoundValue {
    Auto,
    Value(f64),
}

/// Statistics for box & whisker (`cx:statistics`).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ChartExStatistics {
    /// Quartile method.
    pub quartile_method: Option<String>,
}

// =============================================================================
// Axis
// =============================================================================

/// Unified axis model (`cx:axis`).
///
/// Unlike standard charts which split into catAx/valAx/dateAx/serAx,
/// ChartEx uses a single axis type with a scaling variant.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExAxis {
    /// Axis ID.
    pub id: Option<u32>,
    /// Whether this axis is hidden.
    pub hidden: Option<bool>,
    /// Scaling configuration — determines axis type.
    pub scaling: Option<ChartExScaling>,
    /// Axis title (`cx:title`).
    pub title: Option<ChartExTitle>,
    /// Major gridlines (`cx:majorGridlines`).
    pub major_gridlines: Option<ChartExGridlines>,
    /// Minor gridlines (`cx:minorGridlines`).
    pub minor_gridlines: Option<ChartExGridlines>,
    /// Major tick marks (`cx:majorTickMarks`).
    pub major_tick_marks: Option<ChartExTickMarks>,
    /// Minor tick marks (`cx:minorTickMarks`).
    pub minor_tick_marks: Option<ChartExTickMarks>,
    /// Tick labels (`cx:tickLabels`).
    /// `true` means the empty `<cx:tickLabels/>` element was present.
    #[serde(default)]
    pub tick_labels: bool,
    /// Number format (`cx:numFmt`).
    pub num_fmt: Option<ChartExNumberFormat>,
    /// Shape properties (`cx:spPr`).
    pub sp_pr: Option<ShapeProperties>,
    /// Text properties (`cx:txPr`).
    pub tx_pr: Option<TextBody>,
}

/// Axis scaling variant.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ChartExScaling {
    /// Category scaling (`cx:catScaling`).
    Category {
        /// Gap width (e.g., `"0.5"`).
        gap_width: Option<String>,
    },
    /// Value scaling (`cx:valScaling`).
    Value {
        /// Maximum value.
        max: Option<String>,
        /// Minimum value.
        min: Option<String>,
    },
}

/// Gridlines (`cx:majorGridlines` or `cx:minorGridlines`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExGridlines {
    /// Shape properties for gridlines.
    pub sp_pr: Option<ShapeProperties>,
}

/// Tick marks on an axis (`cx:majorTickMarks` or `cx:minorTickMarks`).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ChartExTickMarks {
    /// Tick mark type (e.g., `"none"`, `"cross"`, `"in"`, `"out"`).
    pub tick_type: Option<String>,
}

// =============================================================================
// Legend
// =============================================================================

/// Chart legend (`cx:legend`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExLegend {
    /// Position (e.g., `"t"`, `"b"`, `"l"`, `"r"`).
    pub pos: Option<String>,
    /// Alignment (e.g., `"ctr"`).
    pub align: Option<String>,
    /// Whether legend overlays chart.
    pub overlay: Option<bool>,
    /// Shape properties.
    pub sp_pr: Option<ShapeProperties>,
    /// Text properties.
    pub tx_pr: Option<TextBody>,
}

// =============================================================================
// Format Overrides
// =============================================================================

/// Per-series format override (`cx:fmtOvr`).
///
/// Allows overriding shape properties for a specific series by index.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExFormatOverride {
    /// Series index.
    pub idx: u32,
    /// Shape properties override.
    pub sp_pr: Option<ShapeProperties>,
}

// =============================================================================
// Print Settings
// =============================================================================

/// Print settings (`cx:printSettings`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartExPrintSettings {
    /// Raw XML of the print settings for round-trip fidelity.
    /// Contains `cx:headerFooter`, `cx:pageMargins`, `cx:pageSetup`.
    pub raw_xml: Option<String>,
}
