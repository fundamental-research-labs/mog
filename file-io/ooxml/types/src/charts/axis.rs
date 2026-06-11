//! Chart axis types (ECMA-376 dml-chart.xsd).

use super::*;

/// Unified chart axis (superset of CT_CatAx, CT_ValAx, CT_DateAx, CT_SerAx).
///
/// Models EG_AxShared + type-specific fields. The `axis_type` field
/// determines which optional fields are meaningful.
///
/// | Field              | CatAx | ValAx | DateAx | SerAx |
/// |--------------------|-------|-------|--------|-------|
/// | auto               |   ✓   |       |        |       |
/// | lbl_algn           |   ✓   |       |        |       |
/// | lbl_offset         |   ✓   |       |        |       |
/// | tick_lbl_skip      |   ✓   |       |        |   ✓   |
/// | tick_mark_skip     |   ✓   |       |        |   ✓   |
/// | no_multi_lvl_lbl   |   ✓   |       |        |       |
/// | cross_between      |       |   ✓   |        |       |
/// | major_unit         |       |   ✓   |   ✓    |       |
/// | minor_unit         |       |   ✓   |   ✓    |       |
/// | disp_units         |       |   ✓   |        |       |
/// | base_time_unit     |       |       |   ✓    |       |
/// | major_time_unit    |       |       |   ✓    |       |
/// | minor_time_unit    |       |       |   ✓    |       |
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ChartAxis {
    // --- EG_AxShared ---
    /// Axis type (category, value, date, series)
    pub axis_type: AxisType,
    /// Axis ID (unique within chart)
    pub ax_id: u32,
    /// Scaling (orientation, min, max, logBase)
    pub scaling: Scaling,
    /// Whether to delete (hide) the axis
    pub delete: bool,
    /// Whether the source axis explicitly contained a `<c:delete>` element.
    #[serde(default)]
    pub delete_explicit: bool,
    /// Axis position (bottom, top, left, right)
    pub ax_pos: ChartAxisPosition,
    /// Show major gridlines
    pub major_gridlines: Option<ChartLines>,
    /// Show minor gridlines
    pub minor_gridlines: Option<ChartLines>,
    /// Axis title
    pub title: Option<Title>,
    /// Number format
    pub num_fmt: Option<NumFmt>,
    /// Major tick mark style
    pub major_tick_mark: TickMark,
    /// Whether the source axis explicitly contained `<c:majorTickMark>`.
    #[serde(default)]
    pub major_tick_mark_explicit: bool,
    /// Minor tick mark style
    pub minor_tick_mark: TickMark,
    /// Whether the source axis explicitly contained `<c:minorTickMark>`.
    #[serde(default)]
    pub minor_tick_mark_explicit: bool,
    /// Tick label position
    pub tick_lbl_pos: TickLabelPosition,
    /// Whether the source axis explicitly contained `<c:tickLblPos>`.
    #[serde(default)]
    pub tick_lbl_pos_explicit: bool,
    /// Shape properties (axis line)
    pub sp_pr: Option<ShapeProperties>,
    /// Text body properties (axis labels)
    pub tx_pr: Option<TextBody>,
    /// ID of crossing axis
    pub cross_ax: u32,
    /// Where the axis crosses
    pub crosses: AxisCrosses,
    /// Whether the source axis explicitly contained `<c:crosses>`.
    #[serde(default)]
    pub crosses_explicit: bool,
    /// Specific crossing value (when crosses=autoZero is overridden)
    pub crosses_at: Option<f64>,

    // --- CT_CatAx specific ---
    /// Auto categories
    pub auto: Option<bool>,
    /// Label alignment (catAx)
    pub lbl_algn: Option<LabelAlignment>,
    /// Label offset (catAx, 0-1000)
    pub lbl_offset: Option<u32>,
    /// Tick label skip interval (catAx)
    pub tick_lbl_skip: Option<u32>,
    /// Tick mark skip interval (catAx)
    pub tick_mark_skip: Option<u32>,
    /// No multi-level labels (catAx)
    pub no_multi_lvl_lbl: Option<bool>,

    // --- CT_ValAx specific ---
    /// Cross between categories or at midpoint (valAx)
    pub cross_between: Option<CrossBetween>,
    /// Major unit (valAx, dateAx)
    pub major_unit: Option<f64>,
    /// Minor unit (valAx, dateAx)
    pub minor_unit: Option<f64>,
    /// Display units (valAx)
    pub disp_units: Option<DisplayUnits>,

    // --- CT_DateAx specific ---
    /// Base time unit (dateAx)
    pub base_time_unit: Option<TimeUnit>,
    /// Major time unit (dateAx)
    pub major_time_unit: Option<TimeUnit>,
    /// Minor time unit (dateAx)
    pub minor_time_unit: Option<TimeUnit>,

    // --- Extension list ---
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,

    /// Non-standard `axisType` attribute (Google Sheets) — preserved for round-trip.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_axis_type_attr: Option<String>,
}

/// Axis scaling (CT_Scaling).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Scaling {
    /// Axis orientation
    pub orientation: Orientation,
    /// Minimum value
    pub min: Option<f64>,
    /// Maximum value
    pub max: Option<f64>,
    /// Log scale base (e.g. 10)
    pub log_base: Option<f64>,
    /// Extension list (extLst) for forward-compatible round-tripping
    #[serde(default)]
    pub extensions: Vec<ExtensionEntry>,
}
