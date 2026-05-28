use serde::{Deserialize, Serialize};

use super::ChartOoxmlProps;
use crate::domain::chart::{
    AxisData, ChartDataTableData, ChartFormatData, ChartFormatStringData, ChartSeriesData,
    ChartSubType, ChartType, ChartView3DData, DataLabelData, LegendData, PieSliceData,
    PivotChartOptionsData, SeriesOrientation, TrendlineData, WaterfallOptions,
};
use crate::domain::conditional_format::CellIdRange;

/// Chart-specific data for the `FloatingObjectData::Chart` variant.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartData {
    // -- Type --
    pub chart_type: ChartType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_type: Option<ChartSubType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series_orientation: Option<SeriesOrientation>,

    // -- Data ranges (A1-style for display, CellId-based for identity) --
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_range: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_range_identity: Option<CellIdRange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series_range: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series_range_identity: Option<CellIdRange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_range: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_range_identity: Option<CellIdRange>,

    // -- Display config --
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legend: Option<LegendData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub axis: Option<AxisData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub colors: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series: Option<Vec<ChartSeriesData>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_labels: Option<DataLabelData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pie_slice: Option<PieSliceData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trendline: Option<Vec<TrendlineData>>,

    // -- Type-specific display flags --
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_lines: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub smooth_lines: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub radar_filled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub radar_markers: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub waterfall: Option<WaterfallOptions>,

    // -- Chart-level display properties (OOXML threading) --
    /// How blank cells are plotted: "gap", "zero", or "span"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_blanks_as: Option<String>,
    /// Whether to plot only visible cells
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plot_visible_only: Option<bool>,
    /// Gap width between bars/columns (0-500%)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gap_width: Option<u32>,
    /// Overlap between bars/columns (-100 to 100)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overlap: Option<i32>,
    /// Doughnut hole size (10-90%)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doughnut_hole_size: Option<u32>,
    /// First slice angle for pie/doughnut (0-360 degrees)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_slice_angle: Option<u32>,
    /// Bubble scale percentage (0-300%)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bubble_scale: Option<u32>,
    /// Split type for of-pie charts
    #[serde(skip_serializing_if = "Option::is_none")]
    pub split_type: Option<String>,
    /// Split value threshold for of-pie charts
    #[serde(skip_serializing_if = "Option::is_none")]
    pub split_value: Option<f64>,

    // ── Simple config properties ──
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub category_label_level: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub series_name_level: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_all_field_buttons: Option<bool>,

    // ── Chart-level series properties ──
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub second_plot_size: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub vary_by_categories: Option<bool>,

    // ── Title alignment/shadow ──
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_h_align: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_v_align: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_show_shadow: Option<bool>,

    // ── Pivot chart options ──
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub pivot_options: Option<PivotChartOptionsData>,

    // ── Bubble / Surface / Theming ──
    /// Whether 3D effect is applied to bubble charts.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bubble_3d_effect: Option<bool>,
    /// Whether surface chart uses wireframe rendering.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub wireframe: Option<bool>,
    /// Whether surface chart shows top view only.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub surface_top_view: Option<bool>,
    /// Chart color scheme index (1-based).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub color_scheme: Option<u8>,

    // ── Position in points ──
    /// Height in points.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub height_pt: Option<f64>,
    /// Width in points.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub width_pt: Option<f64>,
    /// Left offset in points.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub left_pt: Option<f64>,
    /// Top offset in points.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub top_pt: Option<f64>,

    // ── API-exposed fields ──
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub style: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub rounded_corners: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub auto_title_deleted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_data_labels_over_max: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub chart_format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub plot_format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_rich_text: Option<Vec<ChartFormatStringData>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_formula: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub data_table: Option<ChartDataTableData>,

    // ── Bar shape (3D decorative charts) ──
    /// Mark shape for 3D bar/column charts: "box", "cylinder", "cone", "pyramid".
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bar_shape: Option<String>,

    // ── 3D ──
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub view_3d: Option<ChartView3DData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub floor_format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub side_wall_format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub back_wall_format: Option<ChartFormatData>,

    // -- Table linking --
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_table_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table_data_columns: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table_category_column: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_table_column_names_as_labels: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table_column_names: Option<Vec<String>>,

    // -- Sizing in cell units (for oneCell anchor charts) --
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width_cells: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height_cells: Option<f64>,

    /// Typed OOXML preservation data for chart parts and drawing frames.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ooxml: Option<ChartOoxmlProps>,
}
