use super::helpers::*;
use domain_types::{
    Sparkline, SparklineAxisSettings, SparklineCellAddress, SparklineDataRange, SparklineType,
    SparklineVisualSettings,
};
use value_types::{CellValue, FiniteF64};

#[test]
fn roundtrip_sparkline_line() {
    let mut output = make_single_sheet(
        "Sheet1",
        vec![
            cell(0, 0, CellValue::Number(FiniteF64::new(10.0).unwrap())),
            cell(0, 1, CellValue::Number(FiniteF64::new(20.0).unwrap())),
            cell(0, 2, CellValue::Number(FiniteF64::new(30.0).unwrap())),
            cell(0, 3, CellValue::Number(FiniteF64::new(40.0).unwrap())),
            // Sparkline target cell
            cell(1, 0, CellValue::Null),
        ],
    );
    output.sheets[0].sparklines = vec![Sparkline {
        id: "sparkline-0".to_string(),
        sheet_id: "Sheet1".to_string(),
        sparkline_type: SparklineType::Line,
        cell: SparklineCellAddress {
            sheet_id: "Sheet1".to_string(),
            row: 1,
            col: 0,
        },
        data_range: SparklineDataRange {
            start_row: 0,
            start_col: 0,
            end_row: 0,
            end_col: 3,
        },
        data_in_rows: false,
        group_id: None,
        visual: SparklineVisualSettings {
            show_markers: Some(true),
            high_point_color: Some("#00B050".to_string()),
            low_point_color: Some("#FF0000".to_string()),
            ..Default::default()
        },
        axis: SparklineAxisSettings::default(),
        created_at: None,
        updated_at: None,
    }];
    let rt = roundtrip(&output);
    assert!(
        !rt.sheets[0].sparklines.is_empty(),
        "sparklines should survive round-trip"
    );
    let sp = &rt.sheets[0].sparklines[0];
    assert_eq!(sp.sparkline_type, SparklineType::Line);
    assert_eq!(sp.cell.row, 1);
    assert_eq!(sp.cell.col, 0);
    assert_eq!(sp.data_range.start_row, 0);
    assert_eq!(sp.data_range.end_col, 3);
    assert_eq!(sp.visual.show_markers, Some(true));
    assert!(sp.visual.high_point_color.is_some());
    assert!(sp.visual.low_point_color.is_some());
}

#[test]
fn roundtrip_sparkline_column() {
    let mut output = make_single_sheet(
        "Sheet1",
        vec![
            cell(0, 0, CellValue::Number(FiniteF64::new(5.0).unwrap())),
            cell(1, 0, CellValue::Number(FiniteF64::new(15.0).unwrap())),
            cell(2, 0, CellValue::Number(FiniteF64::new(25.0).unwrap())),
            cell(3, 0, CellValue::Null),
        ],
    );
    output.sheets[0].sparklines = vec![Sparkline {
        id: "sparkline-0".to_string(),
        sheet_id: "Sheet1".to_string(),
        sparkline_type: SparklineType::Column,
        cell: SparklineCellAddress {
            sheet_id: "Sheet1".to_string(),
            row: 3,
            col: 0,
        },
        data_range: SparklineDataRange {
            start_row: 0,
            start_col: 0,
            end_row: 2,
            end_col: 0,
        },
        data_in_rows: false,
        group_id: None,
        visual: SparklineVisualSettings {
            first_point_color: Some("#00B050".to_string()),
            last_point_color: Some("#376092".to_string()),
            negative_color: Some("#D00000".to_string()),
            ..Default::default()
        },
        axis: SparklineAxisSettings::default(),
        created_at: None,
        updated_at: None,
    }];
    let rt = roundtrip(&output);
    assert!(
        !rt.sheets[0].sparklines.is_empty(),
        "sparklines should survive round-trip"
    );
    let sp = &rt.sheets[0].sparklines[0];
    assert_eq!(sp.sparkline_type, SparklineType::Column);
    assert_eq!(sp.cell.row, 3);
    assert_eq!(sp.cell.col, 0);
    assert!(sp.visual.first_point_color.is_some());
    assert!(sp.visual.last_point_color.is_some());
    assert!(sp.visual.negative_color.is_some());
}
