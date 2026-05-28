use super::support::{
    SHEET1_UUID, assert_number_value, formula_cell, init_core, sheet_snapshot, val_cell,
    workbook_snapshot,
};
use value_types::CellValue;

/// Test 12: INDEX with row_num=0 returns entire column, col_num=0 returns entire row.
/// In a single-cell formula context, the array result is spill-handled:
/// the formula cell gets the first element, and phantom cells get the rest.
#[test]
fn test_index_row_zero_col_zero() {
    let cells = vec![
        val_cell(1, 0, 0, CellValue::number(10.0)),
        val_cell(1, 0, 1, CellValue::number(20.0)),
        val_cell(1, 0, 2, CellValue::number(30.0)),
        val_cell(1, 1, 0, CellValue::number(40.0)),
        val_cell(1, 1, 1, CellValue::number(50.0)),
        val_cell(1, 1, 2, CellValue::number(60.0)),
        val_cell(1, 2, 0, CellValue::number(70.0)),
        val_cell(1, 2, 1, CellValue::number(80.0)),
        val_cell(1, 2, 2, CellValue::number(90.0)),
        formula_cell(1, 0, 3, "INDEX(A1:C3,0,2)"),
        formula_cell(1, 0, 4, "INDEX(A1:C3,2,0)"),
    ];
    let snapshot = workbook_snapshot(vec![sheet_snapshot(SHEET1_UUID, "Sheet1", 3, 8, cells)]);
    let (mirror, _core, result) = init_core(snapshot);

    assert_number_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        3,
        20.0,
        "D0: first element of column 2 (B0=20)",
    );
    assert_number_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        4,
        40.0,
        "E0: first element of row 2 (A1=40)",
    );
}

/// Test 13: INDEX 2-arg form on single-row and single-col ranges.
#[test]
fn test_index_two_arg_single_row_col() {
    let cells = vec![
        val_cell(1, 0, 0, CellValue::number(10.0)),
        val_cell(1, 0, 1, CellValue::number(20.0)),
        val_cell(1, 0, 2, CellValue::number(30.0)),
        val_cell(1, 1, 0, CellValue::number(200.0)),
        val_cell(1, 2, 0, CellValue::number(300.0)),
        formula_cell(1, 0, 3, "INDEX(A1:C1,2)"),
        formula_cell(1, 1, 3, "INDEX(A1:A3,2)"),
    ];
    let snapshot = workbook_snapshot(vec![sheet_snapshot(SHEET1_UUID, "Sheet1", 3, 4, cells)]);
    let (mirror, _core, result) = init_core(snapshot);

    assert_number_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        3,
        20.0,
        "INDEX(A1:C1, 2) on single-row should treat 2 as column index",
    );
    assert_number_value(
        &mirror,
        &result,
        SHEET1_UUID,
        1,
        3,
        200.0,
        "INDEX(A1:A3, 2) on single-col should treat 2 as row index",
    );
}
