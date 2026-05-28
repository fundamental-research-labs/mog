use super::super::*;
use super::support::*;

#[test]
fn test_sparkline_serde_roundtrip() {
    let sp = Sparkline {
        id: "sp-test".to_string(),
        sheet_id: "sheet-1".to_string(),
        cell: SparklineCellAddress {
            sheet_id: "sheet-1".to_string(),
            row: 5,
            col: 3,
        },
        data_range: SparklineDataRange {
            start_row: 5,
            start_col: 4,
            end_row: 5,
            end_col: 10,
        },
        sparkline_type: SparklineType::Column,
        data_in_rows: false,
        group_id: Some("g-1".to_string()),
        visual: SparklineVisualSettings {
            color: "#4285F4".to_string(),
            negative_color: Some("#EA4335".to_string()),
            show_markers: Some(true),
            marker_color: Some("#000000".to_string()),
            high_point_color: None,
            low_point_color: None,
            first_point_color: None,
            last_point_color: None,
            line_weight: Some(1.5),
            column_gap: Some(0.2),
            bar_gap: None,
        },
        axis: SparklineAxisSettings {
            min_value: AxisBound::Value(0.0),
            max_value: AxisBound::Label(AxisBoundLabel::Auto),
            show_axis: Some(true),
            axis_color: Some("#CCCCCC".to_string()),
            display_empty_cells: EmptyCellDisplay::Zero,
            right_to_left: Some(false),
        },
        created_at: Some(1700000000000),
        updated_at: Some(1700000000001),
    };

    let json = serde_json::to_string(&sp).unwrap();
    let deserialized: Sparkline = serde_json::from_str(&json).unwrap();
    assert_eq!(sp, deserialized);
}

#[test]
fn test_sparkline_group_serde_roundtrip() {
    let group = SparklineGroup {
        id: "g-test".to_string(),
        sheet_id: "sheet-1".to_string(),
        sparkline_ids: vec!["sp-1".to_string(), "sp-2".to_string()],
        sparkline_type: SparklineType::WinLoss,
        visual: default_visual(),
        axis: default_axis(),
        created_at: Some(1000),
        updated_at: Some(2000),
    };

    let json = serde_json::to_string(&group).unwrap();
    let deserialized: SparklineGroup = serde_json::from_str(&json).unwrap();
    assert_eq!(group, deserialized);
}

#[test]
fn test_axis_bound_serde_roundtrip() {
    let auto = AxisBound::Label(AxisBoundLabel::Auto);
    let json = serde_json::to_string(&auto).unwrap();
    let parsed: AxisBound = serde_json::from_str(&json).unwrap();
    assert_eq!(auto, parsed);

    let same = AxisBound::Label(AxisBoundLabel::Same);
    let json = serde_json::to_string(&same).unwrap();
    let parsed: AxisBound = serde_json::from_str(&json).unwrap();
    assert_eq!(same, parsed);

    let val = AxisBound::Value(42.5);
    let json = serde_json::to_string(&val).unwrap();
    let parsed: AxisBound = serde_json::from_str(&json).unwrap();
    assert_eq!(val, parsed);
}
