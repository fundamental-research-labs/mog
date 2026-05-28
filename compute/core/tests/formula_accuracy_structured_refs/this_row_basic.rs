use super::support::{
    assert_cell_number, assert_cell_number_allow_scalar_array, recalc_snapshot,
    single_sheet_table_snapshot,
};
use value_types::CellValue;

/// Table with numeric columns. Formula in data row: `Deals8[[#This Row],[Col1]]`
/// should return the value in Col1 of that row.
#[test]
fn test_structured_ref_this_row_basic() {
    let snapshot = single_sheet_table_snapshot(
        "Deals",
        "Deals8",
        &["Exit CR", "Entry CR", "Result"],
        vec![vec![
            CellValue::number(10.5),
            CellValue::number(8.3),
            CellValue::Null,
        ]],
        vec![(0, 2, "Deals8[[#This Row],[Exit CR]]")],
    );

    let result = recalc_snapshot(snapshot);
    assert_cell_number_allow_scalar_array(&result, 0, 1, 2, 10.5);
}

/// `Deals8[[#This Row],[Exit CR]]-Deals8[[#This Row],[Entry CR]]` should compute the difference.
#[test]
fn test_structured_ref_this_row_subtraction() {
    let snapshot = single_sheet_table_snapshot(
        "Deals",
        "Deals8",
        &["Exit CR", "Entry CR", "Result"],
        vec![vec![
            CellValue::number(10.5),
            CellValue::number(8.3),
            CellValue::Null,
        ]],
        vec![(
            0,
            2,
            "Deals8[[#This Row],[Exit CR]]-Deals8[[#This Row],[Entry CR]]",
        )],
    );

    let result = recalc_snapshot(snapshot);
    assert_cell_number(&result, 0, 1, 2, 10.5 - 8.3);
}

/// Multiple data rows in the table, each with a formula using #This Row.
/// Each row should resolve to its own row's data.
#[test]
fn test_structured_ref_multiple_rows() {
    let snapshot = single_sheet_table_snapshot(
        "Sheet1",
        "Data1",
        &["Value", "Double"],
        vec![
            vec![CellValue::number(1.0), CellValue::Null],
            vec![CellValue::number(2.0), CellValue::Null],
            vec![CellValue::number(3.0), CellValue::Null],
            vec![CellValue::number(4.0), CellValue::Null],
            vec![CellValue::number(5.0), CellValue::Null],
        ],
        vec![
            (0, 1, "Data1[[#This Row],[Value]]*2"),
            (1, 1, "Data1[[#This Row],[Value]]*2"),
            (2, 1, "Data1[[#This Row],[Value]]*2"),
            (3, 1, "Data1[[#This Row],[Value]]*2"),
            (4, 1, "Data1[[#This Row],[Value]]*2"),
        ],
    );

    let result = recalc_snapshot(snapshot);
    for i in 0..5u32 {
        assert_cell_number(&result, 0, i + 1, 1, (i as f64 + 1.0) * 2.0);
    }
}
