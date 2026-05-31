use serde::{Deserialize, Serialize};

use super::formatting::{ChartColorData, ChartFormatData, ChartLineData};
use super::{ChartType, DataLabelData, ErrorBarData, TrendlineData};

/// Imported chart dimension source authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChartSeriesDimensionSourceKindData {
    Ref,
    Literal,
    CacheFallback,
}

/// Imported x/category dimension role.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChartSeriesXRoleData {
    Category,
    Quantitative,
}

/// Runtime series data — carries both range references and visual config.
/// bridge-ts generates the TS equivalent, replacing hand-written SeriesConfig.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartSeriesData {
    /// Series name (from c:tx)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Series-specific chart type override (for combo charts)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<ChartType>,
    /// Fill/line color (hex, e.g., "#4472C4")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,

    // -- Data ranges (A1-notation formulas from OOXML c:f elements) --
    /// Values range: c:val (bar/line/pie) or c:yVal (scatter/bubble)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub values: Option<String>,
    /// Imported cached values from the source chart data reference.
    ///
    /// OOXML caches preserve omitted point indices separately from explicit
    /// zero values. Runtime renderers can use this as a source fallback when
    /// live cell resolution cannot provide a point.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub value_cache: Option<ChartSeriesPointCacheData>,
    /// Source authority for the value/y dimension.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub value_source_kind: Option<ChartSeriesDimensionSourceKindData>,
    /// Categories range: c:cat (bar/line/pie) or c:xVal (scatter/bubble)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub categories: Option<String>,
    /// Whether `categories` should be interpreted as category labels or x values.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub x_role: Option<ChartSeriesXRoleData>,
    /// Imported cached category/x values from the source chart data reference.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub category_cache: Option<ChartSeriesPointCacheData>,
    /// Source authority for the category/x dimension.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub category_source_kind: Option<ChartSeriesDimensionSourceKindData>,
    /// Imported cached multi-level category labels, keyed by point index.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub category_levels: Option<ChartSeriesCategoryLevelsCacheData>,
    /// Cached category number format metadata, including per-point overrides.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub category_label_format: Option<CategoryLabelFormatData>,
    /// Bubble sizes range: c:bubbleSize (bubble only)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bubble_size: Option<String>,
    /// Imported cached bubble sizes from the source chart data reference.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bubble_size_cache: Option<ChartSeriesPointCacheData>,
    /// Source authority for the bubble-size dimension.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bubble_size_source_kind: Option<ChartSeriesDimensionSourceKindData>,

    // -- Visual properties --
    /// Smooth line (line, scatter)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub smooth: Option<bool>,
    /// Whether this series requests a connecting line/path.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_lines: Option<bool>,
    /// Explosion percentage for pie slices (0-400)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explosion: Option<u32>,
    /// Invert fill for negative values (bar)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invert_if_negative: Option<bool>,
    /// Which Y-axis this series binds to (0 = primary, 1 = secondary)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y_axis_index: Option<u8>,

    // -- Markers --
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_markers: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marker_size: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marker_style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_width: Option<f64>,

    // -- Per-point overrides --
    #[serde(skip_serializing_if = "Option::is_none")]
    pub points: Option<Vec<PointFormatData>>,

    // -- Series-level data labels --
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_labels: Option<DataLabelData>,

    // -- Trendlines --
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trendlines: Option<Vec<TrendlineData>>,

    // -- Error bars --
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_bars: Option<ErrorBarData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x_error_bars: Option<ErrorBarData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y_error_bars: Option<ErrorBarData>,

    // -- OOXML plot ordering --
    /// Series index (c:idx)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idx: Option<u32>,
    /// Plot order (c:order)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<u32>,

    // -- Rich formatting --
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bar_shape: Option<String>,
    /// Color used for inverted (negative-value) data points.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub invert_color: Option<ChartColorData>,

    // -- Additional series properties --
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub marker_background_color: Option<ChartColorData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub marker_foreground_color: Option<ChartColorData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub filtered: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_shadow: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_connector_lines: Option<bool>,

    // -- Leader lines --
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub leader_line_format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_leader_lines: Option<bool>,
}

/// Imported per-point cache for one chart data dimension.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartSeriesPointCacheData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub point_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format_code: Option<String>,
    #[serde(default)]
    pub points: Vec<ChartSeriesPointCachePointData>,
}

/// Imported cached chart point value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartSeriesPointCachePointData {
    #[serde(default)]
    pub idx: u32,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format_code: Option<String>,
}

/// Imported multi-level category cache for one chart series.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartSeriesCategoryLevelsCacheData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub point_count: Option<u32>,
    #[serde(default)]
    pub levels: Vec<ChartSeriesCategoryLevelCacheData>,
}

/// One imported category label level from an OOXML multi-level string cache.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartSeriesCategoryLevelCacheData {
    #[serde(default)]
    pub level: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub point_count: Option<u32>,
    #[serde(default)]
    pub points: Vec<ChartSeriesPointCachePointData>,
}

/// Category-axis label formatting captured from the series category cache.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryLabelFormatData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub points: Option<Vec<CategoryPointLabelFormatData>>,
}

/// Per-category point label format override.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryPointLabelFormatData {
    #[serde(default)]
    pub idx: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format_code: Option<String>,
}

/// Per-point formatting override.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointFormatData {
    #[serde(default)]
    pub idx: u32,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub invert_if_negative: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub explosion: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bubble_3d: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border: Option<ChartBorderData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub line_format: Option<ChartLineData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_label: Option<DataLabelData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visual_format: Option<ChartFormatData>,
    // -- Additional point properties --
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub marker_background_color: Option<ChartColorData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub marker_foreground_color: Option<ChartColorData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub marker_size: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub marker_style: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartBorderData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
}

/// Histogram-specific configuration (ChartEx histogram series).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HistogramConfigData {
    /// Number of bins.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bin_count: Option<u32>,
    /// Bin width (overrides bin_count when set).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bin_width: Option<f64>,
    /// Whether an overflow bin is enabled.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub overflow_bin: Option<bool>,
    /// Overflow bin threshold value.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub overflow_bin_value: Option<f64>,
    /// Whether an underflow bin is enabled.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub underflow_bin: Option<bool>,
    /// Underflow bin threshold value.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub underflow_bin_value: Option<f64>,
}

/// Boxplot-specific configuration (box-and-whisker charts).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BoxplotConfigData {
    /// Whether to show outlier points.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_outlier_points: Option<bool>,
    /// Whether to show mean markers.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_mean_markers: Option<bool>,
    /// Whether to show mean lines.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_mean_line: Option<bool>,
    /// Quartile calculation method: "exclusive" or "inclusive".
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub quartile_method: Option<String>,
}

/// One imported hierarchy row for ChartEx treemap/sunburst projection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HierarchyChartRowData {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub parent_id: Option<String>,
    pub label: String,
    #[serde(default)]
    pub level: u32,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub category_formula: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub value_formula: Option<String>,
}

/// Typed ChartEx hierarchy projection for treemap/sunburst families.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HierarchyChartConfigData {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rows: Vec<HierarchyChartRowData>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub category_formulas: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub value_formula: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub parent_label_layout: Option<String>,
}

/// Typed ChartEx region-map projection contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RegionMapConfigData {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub region_formula: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub value_formula: Option<String>,
}
