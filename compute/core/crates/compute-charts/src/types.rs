//! Chart transform specification types.
//!
//! These mirror the TypeScript `Transform` discriminated union from
//! `charts/src/grammar/spec.ts` and are designed for zero-copy
//! deserialization from the JS side via `serde_json`.

use serde::{Deserialize, Serialize};

// =============================================================================
// DataRow — the universal chart data row
// =============================================================================

/// A single row of chart data.
///
/// Maps directly to the JS `Record<string, unknown>`.
/// Using `serde_json::Map` gives us O(1) field access and
/// zero-overhead round-trip through the WASM boundary.
pub type DataRow = serde_json::Map<String, serde_json::Value>;

// =============================================================================
// Transform — discriminated union (tag = "type")
// =============================================================================

/// A chart data transform step.
///
/// Discriminated by the `type` field, matching the TS `Transform` union:
/// ```ts
/// | { type: 'filter'; filter: FilterSpec | string }
/// | { type: 'aggregate'; aggregate: AggregateSpec[] }
/// | { type: 'bin'; bin: BinSpec }
/// | { type: 'sort'; sort: ChartSortSpec[] }
/// | { type: 'calculate'; calculate: string; as: string }
/// | { type: 'fold'; fold: string[]; as: [string, string] }
/// | { type: 'regression'; regression: string; on: string; ... }
/// | { type: 'density'; density: string; ... }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Transform {
    /// Filter rows by predicate.
    Filter {
        /// Either a `FilterSpec` object or a string expression.
        filter: FilterInput,
    },
    /// Group and aggregate.
    Aggregate {
        /// One or more aggregate specs (applied sequentially).
        aggregate: Vec<AggregateSpec>,
    },
    /// Bin a numeric field into histogram buckets.
    Bin {
        /// Binning specification.
        bin: BinSpec,
    },
    /// Sort rows by one or more fields.
    Sort {
        /// Sort specifications (multi-field).
        sort: Vec<ChartSortSpec>,
    },
    /// Derive a new field from an expression.
    Calculate {
        /// Expression string (e.g. `"datum.price * datum.quantity"`).
        calculate: String,
        /// Output field name.
        #[serde(rename = "as")]
        as_field: String,
    },
    /// Pivot wide → long (fold columns into key/value rows).
    Fold {
        /// Fields to fold.
        fold: Vec<String>,
        /// Output field names `[key_field, value_field]`.
        #[serde(rename = "as")]
        as_fields: Option<(String, String)>,
    },
    /// Compute a regression trendline.
    Regression {
        /// X field name.
        regression: String,
        /// Y field name.
        on: String,
        /// Regression method.
        #[serde(default = "default_regression_method")]
        method: Option<RegressionMethod>,
        /// Polynomial order (only for `poly`/`quad`).
        #[serde(default)]
        order: Option<u32>,
        /// Output field names `[x_field, y_field]`.
        #[serde(rename = "as")]
        as_fields: Option<(String, String)>,
    },
    /// Compute kernel density estimation.
    Density {
        /// Field name containing numeric values.
        density: String,
        /// KDE bandwidth (default: Silverman's rule).
        #[serde(default)]
        bandwidth: Option<f64>,
        /// Domain extent `[min, max]`.
        #[serde(default)]
        extent: Option<(f64, f64)>,
        /// Number of output points (default: 100).
        #[serde(default)]
        steps: Option<usize>,
        /// Output field names `[value_field, density_field]`.
        #[serde(rename = "as")]
        as_fields: Option<(String, String)>,
    },
}

fn default_regression_method() -> Option<RegressionMethod> {
    Some(RegressionMethod::Linear)
}

// =============================================================================
// Filter types
// =============================================================================

/// Filter input — either a structured spec or a string expression.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FilterInput {
    /// String expression (e.g. `"datum.x > 10"`).
    Expression(String),
    /// Structured filter specification.
    Spec(FilterSpec),
}

/// Structured filter predicate.
///
/// All conditions are AND-combined (a row must satisfy all present predicates).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterSpec {
    /// Field name to filter on.
    pub field: String,
    /// Exact equality match.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub equal: Option<serde_json::Value>,
    /// Less than.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lt: Option<f64>,
    /// Less than or equal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lte: Option<f64>,
    /// Greater than.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gt: Option<f64>,
    /// Greater than or equal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gte: Option<f64>,
    /// Value must be one of these.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "oneOf")]
    pub one_of: Option<Vec<serde_json::Value>>,
    /// Value must be in numeric range `[min, max]`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<(f64, f64)>,
}

// =============================================================================
// Aggregate types
// =============================================================================

/// Aggregation specification — group by fields and compute aggregates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregateSpec {
    /// Fields to group by.
    pub groupby: Vec<String>,
    /// Aggregate operations to compute.
    pub aggregate: Vec<AggregateOp>,
}

/// A single aggregate operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregateOp {
    /// Aggregate function name.
    pub op: AggregateOpKind,
    /// Field to aggregate (not needed for `count`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    /// Output field name.
    #[serde(rename = "as")]
    pub as_field: String,
}

/// Supported aggregate operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AggregateOpKind {
    /// Count rows in group.
    Count,
    /// Sum numeric values.
    Sum,
    /// Arithmetic mean.
    Mean,
    /// Average (alias for mean).
    Average,
    /// Median (50th percentile).
    Median,
    /// Minimum value.
    Min,
    /// Maximum value.
    Max,
    /// Sample variance (N-1).
    Variance,
    /// Sample standard deviation.
    Stdev,
    /// First quartile (25th percentile).
    Q1,
    /// Third quartile (75th percentile).
    Q3,
    /// 95% CI lower bound.
    Ci0,
    /// 95% CI upper bound.
    Ci1,
    /// Count of distinct values.
    Distinct,
    /// Collect all values.
    Values,
}

// =============================================================================
// Bin types
// =============================================================================

/// Binning specification for histograms.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinSpec {
    /// Field to bin.
    pub field: String,
    /// Output field name for bin start.
    #[serde(rename = "as")]
    pub as_field: String,
    /// Maximum number of bins (default: 10).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maxbins: Option<usize>,
    /// Explicit bin step size (overrides maxbins).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>,
    /// Whether to use nice round boundaries (default: true).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nice: Option<bool>,
}

// =============================================================================
// Sort types
// =============================================================================

/// Sort specification for chart data — one sort key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartSortSpec {
    /// Field to sort by.
    pub field: String,
    /// Sort direction (default: ascending).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<ChartSortOrder>,
}

/// Sort order direction for chart transforms.
///
/// Named `ChartSortOrder` (rather than `SortOrder`) to avoid collision with
/// `domain_types::SortOrder` in the bridge-ts codegen, which used to collapse
/// both enums into a single TS alias with the wrong literal union.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChartSortOrder {
    /// Ascending (A-Z, 0-9).
    Ascending,
    /// Descending (Z-A, 9-0).
    Descending,
}

// =============================================================================
// Regression types (re-exported from compute-stats)
// =============================================================================

pub use compute_stats::{Point, RegressionMethod, RegressionOutput};

// =============================================================================
// Density types
// =============================================================================

/// Result of kernel density estimation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DensityResult {
    /// X values of the density curve.
    pub x: Vec<f64>,
    /// Density values at each x.
    pub density: Vec<f64>,
    /// Bandwidth used.
    pub bandwidth: f64,
    /// Maximum density value.
    pub max_density: f64,
}

// =============================================================================
// Stacking types
// =============================================================================

/// Stack mode — matches `ConfigSpec.stack` in TS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StackMode {
    /// Standard stacking from zero baseline.
    Zero,
    /// Normalized to 100% per category.
    Normalize,
    /// Centered around zero (stream graph).
    Center,
}

/// Input for a single stack segment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackInput {
    /// Category key (x-axis value).
    pub category: String,
    /// Numeric value to stack.
    pub value: f64,
    /// Group/series key.
    pub group: String,
}

/// Output for a stacked segment — includes computed start/end positions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackOutput {
    /// Category key.
    pub category: String,
    /// Group/series key.
    pub group: String,
    /// Original value.
    pub value: f64,
    /// Start position (cumulative bottom).
    pub start: f64,
    /// End position (cumulative top).
    pub end: f64,
}

// =============================================================================
// Histogram types (output from bin statistics)
// =============================================================================

/// A histogram bin with count.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistogramBin {
    /// Bin start (inclusive).
    pub bin0: f64,
    /// Bin end (exclusive, except last bin).
    pub bin1: f64,
    /// Count of values in bin.
    pub count: usize,
}

// =============================================================================
// Per-Series Bin Config
// =============================================================================

/// Per-series histogram/bin configuration that can override chart-level defaults.
///
/// Mirrors the TS `HistogramConfig` type in `contracts/src/data/charts.ts`.
/// When computing bins for a specific series, per-series values take
/// precedence over chart-level values.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerSeriesBinConfig {
    /// Number of bins (per-series override).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bin_count: Option<usize>,
    /// Explicit bin width (per-series override).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bin_width: Option<f64>,
    /// Whether to accumulate bins cumulatively (per-series override).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cumulative: Option<bool>,
}

// =============================================================================
// Per-Series Boxwhisker Config
// =============================================================================

/// Per-series box/whisker configuration that can override chart-level defaults.
///
/// Mirrors the TS `BoxplotConfig` type in `contracts/src/data/charts.ts`.
/// When computing boxplot statistics for a specific series, per-series values
/// take precedence over chart-level values.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerSeriesBoxwhiskerConfig {
    /// Whether to show outlier points (per-series override).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_outliers: Option<bool>,
    /// Whether to show mean marker (per-series override).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_mean: Option<bool>,
    /// Whisker calculation method (per-series override).
    /// Values: "tukey", "minMax", "percentile".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub whisker_type: Option<String>,
}

/// Resolve boxwhisker parameters by checking per-series config before chart-level defaults.
///
/// Returns `(show_outliers, show_mean, whisker_type)` with per-series values taking precedence.
pub fn resolve_boxwhisker_params(
    series_config: Option<&PerSeriesBoxwhiskerConfig>,
    chart_show_outliers: Option<bool>,
    chart_show_mean: Option<bool>,
    chart_whisker_type: Option<&str>,
) -> (bool, bool, String) {
    let show_outliers = series_config
        .and_then(|c| c.show_outliers)
        .or(chart_show_outliers)
        .unwrap_or(true);
    let show_mean = series_config
        .and_then(|c| c.show_mean)
        .or(chart_show_mean)
        .unwrap_or(false);
    let whisker_type = series_config
        .and_then(|c| c.whisker_type.clone())
        .or_else(|| chart_whisker_type.map(|s| s.to_string()))
        .unwrap_or_else(|| "tukey".to_string());
    (show_outliers, show_mean, whisker_type)
}

// =============================================================================
// Violin shape types
// =============================================================================

/// Violin plot shape — left and right contours plus summary statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViolinShape {
    /// Left contour points (negative x = width).
    pub left: Vec<Point>,
    /// Right contour points (positive x = width).
    pub right: Vec<Point>,
    /// Summary statistics for the distribution.
    pub stats: ViolinStats,
}

/// Summary statistics for a violin plot.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ViolinStats {
    /// Minimum value.
    pub min: f64,
    /// Maximum value.
    pub max: f64,
    /// Median (50th percentile).
    pub median: f64,
    /// First quartile (25th percentile).
    pub q1: f64,
    /// Third quartile (75th percentile).
    pub q3: f64,
    /// Arithmetic mean.
    pub mean: f64,
}
