use cell_types::SheetId;

use super::super::*;
use crate::storage::YrsStorage;

pub fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

pub fn storage_with_sheet() -> (YrsStorage, SheetId) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sheet_id = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sheet_id, "Sheet1", 100, 26)
        .expect("add_sheet should succeed");
    (storage, sheet_id)
}

pub fn default_visual() -> SparklineVisualSettings {
    SparklineVisualSettings {
        color: "#4285F4".to_string(),
        negative_color: None,
        show_markers: None,
        marker_color: None,
        high_point_color: None,
        low_point_color: None,
        first_point_color: None,
        last_point_color: None,
        line_weight: None,
        column_gap: None,
        bar_gap: None,
    }
}

pub fn default_axis() -> SparklineAxisSettings {
    SparklineAxisSettings {
        min_value: AxisBound::Label(AxisBoundLabel::Auto),
        max_value: AxisBound::Label(AxisBoundLabel::Auto),
        show_axis: None,
        axis_color: None,
        display_empty_cells: EmptyCellDisplay::Gaps,
        right_to_left: None,
    }
}

pub fn make_sparkline(id: &str, sheet_id: &str, row: u32, col: u32) -> Sparkline {
    Sparkline {
        id: id.to_string(),
        sheet_id: sheet_id.to_string(),
        cell: SparklineCellAddress {
            sheet_id: sheet_id.to_string(),
            row,
            col,
        },
        data_range: SparklineDataRange {
            start_row: row,
            start_col: col + 1,
            end_row: row,
            end_col: col + 5,
        },
        sparkline_type: SparklineType::Line,
        data_in_rows: true,
        group_id: None,
        visual: default_visual(),
        axis: default_axis(),
        created_at: Some(1000),
        updated_at: Some(1000),
    }
}

pub fn make_group(id: &str, sheet_id: &str, sparkline_ids: Vec<&str>) -> SparklineGroup {
    SparklineGroup {
        id: id.to_string(),
        sheet_id: sheet_id.to_string(),
        sparkline_ids: sparkline_ids.into_iter().map(String::from).collect(),
        sparkline_type: SparklineType::Line,
        visual: default_visual(),
        axis: default_axis(),
        created_at: Some(1000),
        updated_at: Some(1000),
    }
}

pub fn sheet_hex(n: u128) -> String {
    format!("{:032x}", n)
}
