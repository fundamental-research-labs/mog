//! Yrs schema for [`Sparkline`] and [`SparklineGroup`] — flat Y.Map with all
//! fields as native Yrs keys, matching compute-core's `sp_keys` exactly.

use std::sync::Arc;
use yrs::types::map::MapRef;
use yrs::{Any, Map, ReadTxn, TransactionMut};

use super::helpers::*;
use crate::domain::sparkline::{
    AxisBound, AxisBoundLabel, EmptyCellDisplay, Sparkline, SparklineAxisSettings,
    SparklineCellAddress, SparklineDataRange, SparklineGroup, SparklineType,
    SparklineVisualSettings,
};

// ============================================================================
// Key constants — mirror compute-core sp_keys exactly
// ============================================================================

pub const KEY_ID: &str = "id";
pub const KEY_SHEET_ID: &str = "sheetId";
pub const KEY_TYPE: &str = "type";
pub const KEY_DATA_IN_ROWS: &str = "dataInRows";
pub const KEY_GROUP_ID: &str = "groupId";
pub const KEY_CREATED_AT: &str = "createdAt";
pub const KEY_UPDATED_AT: &str = "updatedAt";
// Cell address (flattened)
pub const KEY_CELL_SHEET_ID: &str = "cellSheetId";
pub const KEY_CELL_ROW: &str = "cellRow";
pub const KEY_CELL_COL: &str = "cellCol";
// Data range (flattened)
pub const KEY_DATA_SOURCE_SHEET_NAME: &str = "dataSourceSheetName";
pub const KEY_DATA_START_ROW: &str = "dataStartRow";
pub const KEY_DATA_START_COL: &str = "dataStartCol";
pub const KEY_DATA_END_ROW: &str = "dataEndRow";
pub const KEY_DATA_END_COL: &str = "dataEndCol";
// Visual settings (flattened with vis* prefix)
pub const KEY_VIS_COLOR: &str = "visColor";
pub const KEY_VIS_NEGATIVE_COLOR: &str = "visNegativeColor";
pub const KEY_VIS_SHOW_NEGATIVE_POINTS: &str = "visShowNegativePoints";
pub const KEY_VIS_SHOW_MARKERS: &str = "visShowMarkers";
pub const KEY_VIS_MARKER_COLOR: &str = "visMarkerColor";
pub const KEY_VIS_SHOW_HIGH_POINT: &str = "visShowHighPoint";
pub const KEY_VIS_HIGH_POINT_COLOR: &str = "visHighPointColor";
pub const KEY_VIS_SHOW_LOW_POINT: &str = "visShowLowPoint";
pub const KEY_VIS_LOW_POINT_COLOR: &str = "visLowPointColor";
pub const KEY_VIS_SHOW_FIRST_POINT: &str = "visShowFirstPoint";
pub const KEY_VIS_FIRST_POINT_COLOR: &str = "visFirstPointColor";
pub const KEY_VIS_SHOW_LAST_POINT: &str = "visShowLastPoint";
pub const KEY_VIS_LAST_POINT_COLOR: &str = "visLastPointColor";
pub const KEY_VIS_LINE_WEIGHT: &str = "visLineWeight";
pub const KEY_VIS_COLUMN_GAP: &str = "visColumnGap";
pub const KEY_VIS_BAR_GAP: &str = "visBarGap";
// Axis settings (flattened with axis* prefix)
pub const KEY_AXIS_MIN: &str = "axisMin";
pub const KEY_AXIS_MAX: &str = "axisMax";
pub const KEY_AXIS_SHOW: &str = "axisShow";
pub const KEY_AXIS_COLOR: &str = "axisColor";
pub const KEY_AXIS_EMPTY_CELLS: &str = "axisEmptyCells";
pub const KEY_AXIS_RTL: &str = "axisRtl";
// Group-specific
pub const KEY_SPARKLINE_IDS: &str = "sparklineIds";

// ============================================================================
// Enum conversion helpers
// ============================================================================

fn sparkline_type_to_str(t: &SparklineType) -> &'static str {
    match t {
        SparklineType::Line => "line",
        SparklineType::Column => "column",
        SparklineType::WinLoss => "winLoss",
    }
}

fn sparkline_type_from_str(s: &str) -> SparklineType {
    match s {
        "column" => SparklineType::Column,
        "winLoss" => SparklineType::WinLoss,
        _ => SparklineType::Line,
    }
}

fn axis_bound_to_any(bound: &AxisBound) -> Any {
    match bound {
        AxisBound::Label(AxisBoundLabel::Auto) => Any::String(Arc::from("auto")),
        AxisBound::Label(AxisBoundLabel::Same) => Any::String(Arc::from("same")),
        AxisBound::Value(v) => Any::Number(*v),
    }
}

fn axis_bound_from_value(out: &yrs::Out) -> AxisBound {
    match out {
        yrs::Out::Any(Any::String(s)) if &**s == "same" => AxisBound::Label(AxisBoundLabel::Same),
        yrs::Out::Any(Any::Number(n)) => AxisBound::Value(*n),
        // "auto" or anything unrecognized -> default
        _ => AxisBound::Label(AxisBoundLabel::Auto),
    }
}

fn empty_cell_display_to_str(d: &EmptyCellDisplay) -> &'static str {
    match d {
        EmptyCellDisplay::Gaps => "gaps",
        EmptyCellDisplay::Zero => "zero",
        EmptyCellDisplay::Connect => "connect",
    }
}

fn empty_cell_display_from_str(s: &str) -> EmptyCellDisplay {
    match s {
        "zero" => EmptyCellDisplay::Zero,
        "connect" => EmptyCellDisplay::Connect,
        _ => EmptyCellDisplay::Gaps,
    }
}

// ============================================================================
// Sparkline -> Y.Map
// ============================================================================

/// Convert a [`Sparkline`] to Yrs prelim entries for initial hydration.
pub fn to_yrs_prelim(spark: &Sparkline) -> Vec<(&str, Any)> {
    let mut entries: Vec<(&str, Any)> = vec![
        (KEY_ID, Any::String(Arc::from(spark.id.as_str()))),
        (
            KEY_SHEET_ID,
            Any::String(Arc::from(spark.sheet_id.as_str())),
        ),
        (
            KEY_TYPE,
            Any::String(Arc::from(sparkline_type_to_str(&spark.sparkline_type))),
        ),
        (KEY_DATA_IN_ROWS, Any::Bool(spark.data_in_rows)),
        // Cell address (flattened)
        (
            KEY_CELL_SHEET_ID,
            Any::String(Arc::from(spark.cell.sheet_id.as_str())),
        ),
        (KEY_CELL_ROW, Any::Number(spark.cell.row as f64)),
        (KEY_CELL_COL, Any::Number(spark.cell.col as f64)),
        // Data range (flattened)
        (
            KEY_DATA_START_ROW,
            Any::Number(spark.data_range.start_row as f64),
        ),
        (
            KEY_DATA_START_COL,
            Any::Number(spark.data_range.start_col as f64),
        ),
        (
            KEY_DATA_END_ROW,
            Any::Number(spark.data_range.end_row as f64),
        ),
        (
            KEY_DATA_END_COL,
            Any::Number(spark.data_range.end_col as f64),
        ),
        // Visual — always-present color
        (
            KEY_VIS_COLOR,
            Any::String(Arc::from(spark.visual.color.as_str())),
        ),
        // Axis — always-present fields
        (KEY_AXIS_MIN, axis_bound_to_any(&spark.axis.min_value)),
        (KEY_AXIS_MAX, axis_bound_to_any(&spark.axis.max_value)),
        (
            KEY_AXIS_EMPTY_CELLS,
            Any::String(Arc::from(empty_cell_display_to_str(
                &spark.axis.display_empty_cells,
            ))),
        ),
    ];

    // Optional fields — only written when Some
    if let Some(ref gid) = spark.group_id {
        entries.push((KEY_GROUP_ID, Any::String(Arc::from(gid.as_str()))));
    }
    if let Some(ts) = spark.created_at {
        entries.push((KEY_CREATED_AT, Any::Number(ts as f64)));
    }
    if let Some(ts) = spark.updated_at {
        entries.push((KEY_UPDATED_AT, Any::Number(ts as f64)));
    }
    if let Some(ref source_sheet_name) = spark.data_range.source_sheet_name {
        entries.push((
            KEY_DATA_SOURCE_SHEET_NAME,
            Any::String(Arc::from(source_sheet_name.as_str())),
        ));
    }
    // Visual optionals
    if let Some(ref c) = spark.visual.negative_color {
        entries.push((KEY_VIS_NEGATIVE_COLOR, Any::String(Arc::from(c.as_str()))));
    }
    if let Some(b) = spark.visual.show_negative_points {
        entries.push((KEY_VIS_SHOW_NEGATIVE_POINTS, Any::Bool(b)));
    }
    if let Some(b) = spark.visual.show_markers {
        entries.push((KEY_VIS_SHOW_MARKERS, Any::Bool(b)));
    }
    if let Some(ref c) = spark.visual.marker_color {
        entries.push((KEY_VIS_MARKER_COLOR, Any::String(Arc::from(c.as_str()))));
    }
    if let Some(b) = spark.visual.show_high_point {
        entries.push((KEY_VIS_SHOW_HIGH_POINT, Any::Bool(b)));
    }
    if let Some(ref c) = spark.visual.high_point_color {
        entries.push((KEY_VIS_HIGH_POINT_COLOR, Any::String(Arc::from(c.as_str()))));
    }
    if let Some(b) = spark.visual.show_low_point {
        entries.push((KEY_VIS_SHOW_LOW_POINT, Any::Bool(b)));
    }
    if let Some(ref c) = spark.visual.low_point_color {
        entries.push((KEY_VIS_LOW_POINT_COLOR, Any::String(Arc::from(c.as_str()))));
    }
    if let Some(b) = spark.visual.show_first_point {
        entries.push((KEY_VIS_SHOW_FIRST_POINT, Any::Bool(b)));
    }
    if let Some(ref c) = spark.visual.first_point_color {
        entries.push((
            KEY_VIS_FIRST_POINT_COLOR,
            Any::String(Arc::from(c.as_str())),
        ));
    }
    if let Some(b) = spark.visual.show_last_point {
        entries.push((KEY_VIS_SHOW_LAST_POINT, Any::Bool(b)));
    }
    if let Some(ref c) = spark.visual.last_point_color {
        entries.push((KEY_VIS_LAST_POINT_COLOR, Any::String(Arc::from(c.as_str()))));
    }
    if let Some(w) = spark.visual.line_weight {
        entries.push((KEY_VIS_LINE_WEIGHT, Any::Number(w)));
    }
    if let Some(g) = spark.visual.column_gap {
        entries.push((KEY_VIS_COLUMN_GAP, Any::Number(g)));
    }
    if let Some(g) = spark.visual.bar_gap {
        entries.push((KEY_VIS_BAR_GAP, Any::Number(g)));
    }
    // Axis optionals
    if let Some(b) = spark.axis.show_axis {
        entries.push((KEY_AXIS_SHOW, Any::Bool(b)));
    }
    if let Some(ref c) = spark.axis.axis_color {
        entries.push((KEY_AXIS_COLOR, Any::String(Arc::from(c.as_str()))));
    }
    if let Some(b) = spark.axis.right_to_left {
        entries.push((KEY_AXIS_RTL, Any::Bool(b)));
    }

    entries
}

/// Read a [`Sparkline`] from a Y.Map. Returns `None` if required `id` is missing.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<Sparkline> {
    let id = read_string(map, txn, KEY_ID)?;
    Some(Sparkline {
        id,
        sheet_id: read_string(map, txn, KEY_SHEET_ID).unwrap_or_default(),
        sparkline_type: read_string(map, txn, KEY_TYPE)
            .map(|s| sparkline_type_from_str(&s))
            .unwrap_or(SparklineType::Line),
        data_in_rows: read_bool(map, txn, KEY_DATA_IN_ROWS).unwrap_or(false),
        group_id: read_string(map, txn, KEY_GROUP_ID),
        cell: SparklineCellAddress {
            sheet_id: read_string(map, txn, KEY_CELL_SHEET_ID).unwrap_or_default(),
            row: read_u32(map, txn, KEY_CELL_ROW).unwrap_or(0),
            col: read_u32(map, txn, KEY_CELL_COL).unwrap_or(0),
        },
        data_range: SparklineDataRange {
            source_sheet_name: read_string(map, txn, KEY_DATA_SOURCE_SHEET_NAME),
            start_row: read_u32(map, txn, KEY_DATA_START_ROW).unwrap_or(0),
            start_col: read_u32(map, txn, KEY_DATA_START_COL).unwrap_or(0),
            end_row: read_u32(map, txn, KEY_DATA_END_ROW).unwrap_or(0),
            end_col: read_u32(map, txn, KEY_DATA_END_COL).unwrap_or(0),
        },
        visual: SparklineVisualSettings {
            color: read_string(map, txn, KEY_VIS_COLOR).unwrap_or_default(),
            negative_color: read_string(map, txn, KEY_VIS_NEGATIVE_COLOR),
            show_negative_points: read_bool(map, txn, KEY_VIS_SHOW_NEGATIVE_POINTS),
            show_markers: read_bool(map, txn, KEY_VIS_SHOW_MARKERS),
            marker_color: read_string(map, txn, KEY_VIS_MARKER_COLOR),
            show_high_point: read_bool(map, txn, KEY_VIS_SHOW_HIGH_POINT),
            high_point_color: read_string(map, txn, KEY_VIS_HIGH_POINT_COLOR),
            show_low_point: read_bool(map, txn, KEY_VIS_SHOW_LOW_POINT),
            low_point_color: read_string(map, txn, KEY_VIS_LOW_POINT_COLOR),
            show_first_point: read_bool(map, txn, KEY_VIS_SHOW_FIRST_POINT),
            first_point_color: read_string(map, txn, KEY_VIS_FIRST_POINT_COLOR),
            show_last_point: read_bool(map, txn, KEY_VIS_SHOW_LAST_POINT),
            last_point_color: read_string(map, txn, KEY_VIS_LAST_POINT_COLOR),
            line_weight: read_number(map, txn, KEY_VIS_LINE_WEIGHT),
            column_gap: read_number(map, txn, KEY_VIS_COLUMN_GAP),
            bar_gap: read_number(map, txn, KEY_VIS_BAR_GAP),
        },
        axis: SparklineAxisSettings {
            min_value: map
                .get(txn, KEY_AXIS_MIN)
                .map(|o| axis_bound_from_value(&o))
                .unwrap_or(AxisBound::Label(AxisBoundLabel::Auto)),
            max_value: map
                .get(txn, KEY_AXIS_MAX)
                .map(|o| axis_bound_from_value(&o))
                .unwrap_or(AxisBound::Label(AxisBoundLabel::Auto)),
            show_axis: read_bool(map, txn, KEY_AXIS_SHOW),
            axis_color: read_string(map, txn, KEY_AXIS_COLOR),
            display_empty_cells: read_string(map, txn, KEY_AXIS_EMPTY_CELLS)
                .map(|s| empty_cell_display_from_str(&s))
                .unwrap_or(EmptyCellDisplay::Gaps),
            right_to_left: read_bool(map, txn, KEY_AXIS_RTL),
        },
        created_at: read_u64(map, txn, KEY_CREATED_AT),
        updated_at: read_u64(map, txn, KEY_UPDATED_AT),
    })
}

// ============================================================================
// SparklineGroup -> Y.Map
// ============================================================================

/// Convert a [`SparklineGroup`] to Yrs prelim entries for initial hydration.
pub fn group_to_yrs_prelim(group: &SparklineGroup) -> Vec<(&str, Any)> {
    // Serialize sparkline_ids as a JSON string array
    let ids_json = serde_json::to_string(&group.sparkline_ids).unwrap_or_else(|_| "[]".to_string());

    let mut entries: Vec<(&str, Any)> = vec![
        (KEY_ID, Any::String(Arc::from(group.id.as_str()))),
        (
            KEY_SHEET_ID,
            Any::String(Arc::from(group.sheet_id.as_str())),
        ),
        (KEY_SPARKLINE_IDS, Any::String(Arc::from(ids_json.as_str()))),
        (
            KEY_TYPE,
            Any::String(Arc::from(sparkline_type_to_str(&group.sparkline_type))),
        ),
        // Visual — always-present color
        (
            KEY_VIS_COLOR,
            Any::String(Arc::from(group.visual.color.as_str())),
        ),
        // Axis — always-present fields
        (KEY_AXIS_MIN, axis_bound_to_any(&group.axis.min_value)),
        (KEY_AXIS_MAX, axis_bound_to_any(&group.axis.max_value)),
        (
            KEY_AXIS_EMPTY_CELLS,
            Any::String(Arc::from(empty_cell_display_to_str(
                &group.axis.display_empty_cells,
            ))),
        ),
    ];

    // Optional fields
    if let Some(ts) = group.created_at {
        entries.push((KEY_CREATED_AT, Any::Number(ts as f64)));
    }
    if let Some(ts) = group.updated_at {
        entries.push((KEY_UPDATED_AT, Any::Number(ts as f64)));
    }
    // Visual optionals
    if let Some(ref c) = group.visual.negative_color {
        entries.push((KEY_VIS_NEGATIVE_COLOR, Any::String(Arc::from(c.as_str()))));
    }
    if let Some(b) = group.visual.show_negative_points {
        entries.push((KEY_VIS_SHOW_NEGATIVE_POINTS, Any::Bool(b)));
    }
    if let Some(b) = group.visual.show_markers {
        entries.push((KEY_VIS_SHOW_MARKERS, Any::Bool(b)));
    }
    if let Some(ref c) = group.visual.marker_color {
        entries.push((KEY_VIS_MARKER_COLOR, Any::String(Arc::from(c.as_str()))));
    }
    if let Some(b) = group.visual.show_high_point {
        entries.push((KEY_VIS_SHOW_HIGH_POINT, Any::Bool(b)));
    }
    if let Some(ref c) = group.visual.high_point_color {
        entries.push((KEY_VIS_HIGH_POINT_COLOR, Any::String(Arc::from(c.as_str()))));
    }
    if let Some(b) = group.visual.show_low_point {
        entries.push((KEY_VIS_SHOW_LOW_POINT, Any::Bool(b)));
    }
    if let Some(ref c) = group.visual.low_point_color {
        entries.push((KEY_VIS_LOW_POINT_COLOR, Any::String(Arc::from(c.as_str()))));
    }
    if let Some(b) = group.visual.show_first_point {
        entries.push((KEY_VIS_SHOW_FIRST_POINT, Any::Bool(b)));
    }
    if let Some(ref c) = group.visual.first_point_color {
        entries.push((
            KEY_VIS_FIRST_POINT_COLOR,
            Any::String(Arc::from(c.as_str())),
        ));
    }
    if let Some(b) = group.visual.show_last_point {
        entries.push((KEY_VIS_SHOW_LAST_POINT, Any::Bool(b)));
    }
    if let Some(ref c) = group.visual.last_point_color {
        entries.push((KEY_VIS_LAST_POINT_COLOR, Any::String(Arc::from(c.as_str()))));
    }
    if let Some(w) = group.visual.line_weight {
        entries.push((KEY_VIS_LINE_WEIGHT, Any::Number(w)));
    }
    if let Some(g) = group.visual.column_gap {
        entries.push((KEY_VIS_COLUMN_GAP, Any::Number(g)));
    }
    if let Some(g) = group.visual.bar_gap {
        entries.push((KEY_VIS_BAR_GAP, Any::Number(g)));
    }
    // Axis optionals
    if let Some(b) = group.axis.show_axis {
        entries.push((KEY_AXIS_SHOW, Any::Bool(b)));
    }
    if let Some(ref c) = group.axis.axis_color {
        entries.push((KEY_AXIS_COLOR, Any::String(Arc::from(c.as_str()))));
    }
    if let Some(b) = group.axis.right_to_left {
        entries.push((KEY_AXIS_RTL, Any::Bool(b)));
    }

    entries
}

/// Read a [`SparklineGroup`] from a Y.Map. Returns `None` if required `id` is missing.
pub fn group_from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<SparklineGroup> {
    let id = read_string(map, txn, KEY_ID)?;
    let sparkline_ids: Vec<String> = read_string(map, txn, KEY_SPARKLINE_IDS)
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    Some(SparklineGroup {
        id,
        sheet_id: read_string(map, txn, KEY_SHEET_ID).unwrap_or_default(),
        sparkline_ids,
        sparkline_type: read_string(map, txn, KEY_TYPE)
            .map(|s| sparkline_type_from_str(&s))
            .unwrap_or(SparklineType::Line),
        visual: SparklineVisualSettings {
            color: read_string(map, txn, KEY_VIS_COLOR).unwrap_or_default(),
            negative_color: read_string(map, txn, KEY_VIS_NEGATIVE_COLOR),
            show_negative_points: read_bool(map, txn, KEY_VIS_SHOW_NEGATIVE_POINTS),
            show_markers: read_bool(map, txn, KEY_VIS_SHOW_MARKERS),
            marker_color: read_string(map, txn, KEY_VIS_MARKER_COLOR),
            show_high_point: read_bool(map, txn, KEY_VIS_SHOW_HIGH_POINT),
            high_point_color: read_string(map, txn, KEY_VIS_HIGH_POINT_COLOR),
            show_low_point: read_bool(map, txn, KEY_VIS_SHOW_LOW_POINT),
            low_point_color: read_string(map, txn, KEY_VIS_LOW_POINT_COLOR),
            show_first_point: read_bool(map, txn, KEY_VIS_SHOW_FIRST_POINT),
            first_point_color: read_string(map, txn, KEY_VIS_FIRST_POINT_COLOR),
            show_last_point: read_bool(map, txn, KEY_VIS_SHOW_LAST_POINT),
            last_point_color: read_string(map, txn, KEY_VIS_LAST_POINT_COLOR),
            line_weight: read_number(map, txn, KEY_VIS_LINE_WEIGHT),
            column_gap: read_number(map, txn, KEY_VIS_COLUMN_GAP),
            bar_gap: read_number(map, txn, KEY_VIS_BAR_GAP),
        },
        axis: SparklineAxisSettings {
            min_value: map
                .get(txn, KEY_AXIS_MIN)
                .map(|o| axis_bound_from_value(&o))
                .unwrap_or(AxisBound::Label(AxisBoundLabel::Auto)),
            max_value: map
                .get(txn, KEY_AXIS_MAX)
                .map(|o| axis_bound_from_value(&o))
                .unwrap_or(AxisBound::Label(AxisBoundLabel::Auto)),
            show_axis: read_bool(map, txn, KEY_AXIS_SHOW),
            axis_color: read_string(map, txn, KEY_AXIS_COLOR),
            display_empty_cells: read_string(map, txn, KEY_AXIS_EMPTY_CELLS)
                .map(|s| empty_cell_display_from_str(&s))
                .unwrap_or(EmptyCellDisplay::Gaps),
            right_to_left: read_bool(map, txn, KEY_AXIS_RTL),
        },
        created_at: read_u64(map, txn, KEY_CREATED_AT),
        updated_at: read_u64(map, txn, KEY_UPDATED_AT),
    })
}

// ============================================================================
// Generic field updater
// ============================================================================

/// Update a single field on an existing Sparkline/SparklineGroup Y.Map.
pub fn update_field(map: &MapRef, txn: &mut TransactionMut, key: &str, value: Any) {
    map.insert(txn, key, value);
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::{Doc, Map, MapPrelim, Transact};

    /// Helper: write prelim entries to a Y.Doc, read back via from_fn.
    fn yrs_roundtrip<T, F>(entries: Vec<(&str, Any)>, from_fn: F) -> T
    where
        F: FnOnce(&MapRef, &yrs::Transaction) -> Option<T>,
    {
        let doc = Doc::new();
        let root = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            let prelim: MapPrelim = entries.into_iter().collect();
            root.insert(&mut txn, "item", prelim);
        }
        let txn = doc.transact();
        let map_ref = root
            .get(&txn, "item")
            .unwrap()
            .cast::<yrs::MapRef>()
            .unwrap();
        from_fn(&map_ref, &txn).unwrap()
    }

    #[test]
    fn test_sparkline_yrs_roundtrip() {
        let original = Sparkline {
            id: "spark-1".to_string(),
            sheet_id: "sheet-abc".to_string(),
            cell: SparklineCellAddress {
                sheet_id: "sheet-abc".to_string(),
                row: 9,
                col: 3,
            },
            data_range: SparklineDataRange {
                source_sheet_name: Some("Data".to_string()),
                start_row: 0,
                start_col: 0,
                end_row: 9,
                end_col: 0,
            },
            sparkline_type: SparklineType::Column,
            data_in_rows: true,
            group_id: Some("grp_001".to_string()),
            visual: SparklineVisualSettings {
                color: "#336699".to_string(),
                negative_color: Some("#CC0000".to_string()),
                show_negative_points: Some(true),
                show_markers: Some(true),
                marker_color: Some("#000000".to_string()),
                show_high_point: Some(true),
                high_point_color: Some("#00FF00".to_string()),
                show_low_point: Some(true),
                low_point_color: Some("#FF0000".to_string()),
                show_first_point: Some(true),
                first_point_color: Some("#0000FF".to_string()),
                show_last_point: Some(true),
                last_point_color: Some("#FFFF00".to_string()),
                line_weight: Some(1.5),
                column_gap: None,
                bar_gap: None,
            },
            axis: SparklineAxisSettings {
                min_value: AxisBound::Value(-10.0),
                max_value: AxisBound::Value(100.0),
                show_axis: Some(true),
                axis_color: Some("#000000".to_string()),
                display_empty_cells: EmptyCellDisplay::Zero,
                right_to_left: Some(true),
            },
            created_at: Some(1700000000),
            updated_at: Some(1700000001),
        };

        let restored: Sparkline =
            yrs_roundtrip(to_yrs_prelim(&original), |map, txn| from_yrs_map(map, txn));
        assert_eq!(original, restored);
    }

    #[test]
    fn test_sparkline_minimal_yrs_roundtrip() {
        let original = Sparkline {
            id: "spark-min".to_string(),
            sheet_id: "sh1".to_string(),
            cell: SparklineCellAddress {
                sheet_id: "sh1".to_string(),
                row: 0,
                col: 0,
            },
            data_range: SparklineDataRange {
                source_sheet_name: None,
                start_row: 0,
                start_col: 0,
                end_row: 0,
                end_col: 0,
            },
            sparkline_type: SparklineType::Line,
            data_in_rows: false,
            group_id: None,
            visual: SparklineVisualSettings::default(),
            axis: SparklineAxisSettings::default(),
            created_at: None,
            updated_at: None,
        };

        let restored: Sparkline =
            yrs_roundtrip(to_yrs_prelim(&original), |map, txn| from_yrs_map(map, txn));
        assert_eq!(original, restored);
    }

    #[test]
    fn test_sparkline_group_yrs_roundtrip() {
        let original = SparklineGroup {
            id: "group-1".to_string(),
            sheet_id: "sheet-abc".to_string(),
            sparkline_ids: vec![
                "spark-1".to_string(),
                "spark-2".to_string(),
                "spark-3".to_string(),
            ],
            sparkline_type: SparklineType::Column,
            visual: SparklineVisualSettings {
                color: "#376092".to_string(),
                negative_color: Some("#D00000".to_string()),
                show_negative_points: Some(true),
                show_markers: None,
                marker_color: None,
                show_high_point: Some(true),
                high_point_color: Some("#00B050".to_string()),
                show_low_point: Some(true),
                low_point_color: Some("#FF0000".to_string()),
                show_first_point: None,
                first_point_color: None,
                show_last_point: None,
                last_point_color: None,
                line_weight: Some(0.75),
                column_gap: Some(1.0),
                bar_gap: None,
            },
            axis: SparklineAxisSettings {
                min_value: AxisBound::Label(AxisBoundLabel::Same),
                max_value: AxisBound::Label(AxisBoundLabel::Auto),
                show_axis: None,
                axis_color: None,
                display_empty_cells: EmptyCellDisplay::Connect,
                right_to_left: None,
            },
            created_at: Some(1700000000),
            updated_at: None,
        };

        let restored: SparklineGroup = yrs_roundtrip(group_to_yrs_prelim(&original), |map, txn| {
            group_from_yrs_map(map, txn)
        });
        assert_eq!(original, restored);
    }

    #[test]
    fn test_sparkline_winloss_type_roundtrip() {
        let original = Sparkline {
            id: "spark-wl".to_string(),
            sheet_id: "sh1".to_string(),
            cell: SparklineCellAddress {
                sheet_id: "sh1".to_string(),
                row: 5,
                col: 10,
            },
            data_range: SparklineDataRange {
                source_sheet_name: Some("Data".to_string()),
                start_row: 0,
                start_col: 0,
                end_row: 4,
                end_col: 0,
            },
            sparkline_type: SparklineType::WinLoss,
            data_in_rows: true,
            group_id: None,
            visual: SparklineVisualSettings {
                color: "#FF6600".to_string(),
                ..Default::default()
            },
            axis: SparklineAxisSettings {
                min_value: AxisBound::Label(AxisBoundLabel::Same),
                max_value: AxisBound::Label(AxisBoundLabel::Same),
                ..Default::default()
            },
            created_at: None,
            updated_at: None,
        };

        let restored: Sparkline =
            yrs_roundtrip(to_yrs_prelim(&original), |map, txn| from_yrs_map(map, txn));
        assert_eq!(original, restored);
    }

    #[test]
    fn test_missing_id_returns_none() {
        let doc = Doc::new();
        let root = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            // Insert a map with no "id" key
            let prelim: MapPrelim = vec![("sheetId", Any::String(Arc::from("sh1")))]
                .into_iter()
                .collect();
            root.insert(&mut txn, "item", prelim);
        }
        let txn = doc.transact();
        let map_ref = root
            .get(&txn, "item")
            .unwrap()
            .cast::<yrs::MapRef>()
            .unwrap();
        assert!(from_yrs_map(&map_ref, &txn).is_none());
        assert!(group_from_yrs_map(&map_ref, &txn).is_none());
    }
}
