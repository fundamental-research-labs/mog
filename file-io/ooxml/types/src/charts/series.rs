//! Chart series types (ECMA-376 dml-chart.xsd).

use super::*;

/// Unified chart data series (superset of CT_BarSer, CT_LineSer, etc.).
///
/// The OOXML spec has 8 distinct series types that share most fields
/// (EG_SerShared). Rather than 8 separate structs, we use a single
/// struct with optional fields. Type-specific fields are documented
/// with which series types use them.
///
/// | Field            | Bar | Line | Pie | Scatter | Bubble | Area | Radar | Surface |
/// |------------------|-----|------|-----|---------|--------|------|-------|---------|
/// | cat              |  ✓  |  ✓   |  ✓  |         |        |  ✓   |  ✓    |   ✓     |
/// | val              |  ✓  |  ✓   |  ✓  |         |        |  ✓   |  ✓    |   ✓     |
/// | x_val            |     |      |     |   ✓     |   ✓    |      |       |         |
/// | y_val            |     |      |     |   ✓     |   ✓    |      |       |         |
/// | bubble_size      |     |      |     |         |   ✓    |      |       |         |
/// | marker           |     |  ✓   |     |   ✓     |        |      |  ✓    |         |
/// | smooth           |     |  ✓   |     |   ✓     |        |      |       |         |
/// | explosion        |     |      |  ✓  |         |        |      |       |         |
/// | invert_if_neg    |  ✓  |      |     |         |   ✓    |      |       |         |
/// | bubble_3d        |     |      |     |         |   ✓    |      |       |         |
/// | picture_options  |  ✓  |      |     |         |        |  ✓   |       |   ✓     |
/// | shape            |  ✓  |      |     |         |        |      |       |         |
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartSeries {
    // --- EG_SerShared (common to all series types) ---
    /// Series index (0-based), unique within chart type element
    pub idx: u32,
    /// Plot order (determines drawing order)
    pub order: u32,
    /// Series name/title
    pub tx: Option<SeriesTextSource>,
    /// Shape properties (fill, outline, effects for the series)
    pub sp_pr: Option<ShapeProperties>,

    // --- Category / value data (varies by chart type) ---
    /// Category data (bar, line, pie, area, radar, surface)
    pub cat: Option<CatDataSource>,
    /// Value data (bar, line, pie, area, radar, surface, stock)
    pub val: Option<NumDataSource>,
    /// X values (scatter, bubble)
    pub x_val: Option<CatDataSource>,
    /// Y values (scatter, bubble)
    pub y_val: Option<NumDataSource>,
    /// Bubble sizes (bubble only)
    pub bubble_size: Option<NumDataSource>,

    // --- Visual properties ---
    /// Marker configuration (line, scatter, radar)
    pub marker: Option<Marker>,
    /// Whether line is smooth (line, scatter)
    pub smooth: Option<bool>,
    /// Explosion percentage for pie slices (pie, doughnut: 0-400)
    pub explosion: Option<u32>,
    /// Invert if negative (bar)
    pub invert_if_negative: Option<bool>,
    /// 3-D bubble (bubble only)
    pub bubble_3d: Option<bool>,
    /// Picture options (bar, bar3d, surface)
    pub picture_options: Option<PictureOptions>,
    /// Per-series bar shape override (bar3D only, CT_Shape)
    pub shape: Option<BarShape>,

    // --- Data labels ---
    /// Series-level data label defaults
    pub d_lbls: Option<DataLabelOptions>,
    /// Individual data label overrides
    pub d_lbl: Vec<DataLabel>,

    // --- Data point overrides ---
    /// Individual data point formatting
    pub d_pt: Vec<DataPointOverride>,

    // --- Trendlines and error bars ---
    /// Trendlines (line, bar, scatter, area)
    pub trendline: Vec<Trendline>,
    /// Error bars (line, bar, scatter, area)
    pub err_bars: Vec<ErrorBars>,

    // --- Extension list ---
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,

    /// True when the original XML contained an empty `<c:extLst/>` (no children).
    /// The writer uses this to emit the empty element for round-trip fidelity.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub has_empty_ext_lst: bool,

    /// Non-standard `seriesType` attribute (Google Sheets) — preserved for round-trip.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_series_type_attr: Option<String>,
}

/// Marker configuration (CT_Marker).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Marker {
    /// Marker symbol
    pub symbol: Option<MarkerStyle>,
    /// Marker size (2-72 points)
    pub size: Option<u32>,
    /// Shape properties for the marker
    pub sp_pr: Option<ShapeProperties>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Individual data point override (CT_DPt).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DataPointOverride {
    /// Data point index
    pub idx: u32,
    /// Invert if negative
    pub invert_if_negative: Option<bool>,
    /// Marker override
    pub marker: Option<Marker>,
    /// 3-D bubble
    pub bubble_3d: Option<bool>,
    /// Explosion (pie/doughnut)
    pub explosion: Option<u32>,
    /// Shape properties
    pub sp_pr: Option<ShapeProperties>,
    /// Picture options
    pub picture_options: Option<PictureOptions>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Trendline definition (CT_Trendline).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Trendline {
    /// Trendline name
    pub name: Option<String>,
    /// Shape properties
    pub sp_pr: Option<ShapeProperties>,
    /// Trendline type
    pub trendline_type: TrendlineType,
    /// Polynomial order (2-6)
    pub order: Option<u32>,
    /// Moving average period (2+)
    pub period: Option<u32>,
    /// Forward forecast periods
    pub forward: Option<f64>,
    /// Backward forecast periods
    pub backward: Option<f64>,
    /// Intercept value
    pub intercept: Option<f64>,
    /// Display R-squared
    pub disp_r_sqr: Option<bool>,
    /// Display equation
    pub disp_eq: Option<bool>,
    /// Trendline label
    pub trendline_lbl: Option<TrendlineLabel>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}

/// Error bars definition (CT_ErrBars).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ErrorBars {
    /// Direction (X or Y). Optional per spec (minOccurs="0"); absent for some chart types.
    pub err_dir: Option<ErrorBarDirection>,
    /// Type (both, plus, minus)
    pub err_bar_type: ErrorBarType,
    /// Value type
    pub err_val_type: ErrorValueType,
    /// No end cap
    pub no_end_cap: Option<bool>,
    /// Error value
    pub val: Option<f64>,
    /// Shape properties
    pub sp_pr: Option<ShapeProperties>,
    /// Custom plus values
    pub plus: Option<NumDataSource>,
    /// Custom minus values
    pub minus: Option<NumDataSource>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}
