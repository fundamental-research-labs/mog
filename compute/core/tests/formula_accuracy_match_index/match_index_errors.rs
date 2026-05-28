use super::support::{
    SHEET1_UUID, assert_error_value, assert_number_value, formula_cell, init_core, sheet_snapshot,
    val_cell, workbook_snapshot,
};
use value_types::{CellError, CellValue};

/// Test 4: #N/A from MATCH cascades through arithmetic.
/// This reproduces Issue #2: `D22+D23` produces #N/A because dependent cells
/// contain MATCH errors.
#[test]
fn test_match_na_cascades_through_arithmetic() {
    let cells = vec![
        val_cell(1, 0, 1, CellValue::Text("X".into())),
        val_cell(1, 1, 1, CellValue::Text("Y".into())),
        val_cell(1, 2, 1, CellValue::Text("Z".into())),
        formula_cell(1, 0, 0, "MATCH(\"Missing\",B1:B3,0)"),
        formula_cell(1, 0, 2, "A1+1"),
        formula_cell(1, 1, 2, "A1*2"),
        formula_cell(1, 2, 2, "100/A1"),
    ];
    let snapshot = workbook_snapshot(vec![sheet_snapshot(SHEET1_UUID, "Sheet1", 3, 3, cells)]);
    let (mirror, _core, result) = init_core(snapshot);

    assert_error_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        0,
        CellError::Na,
        "A0: MATCH should be #N/A",
    );
    assert_error_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        2,
        CellError::Na,
        "C0: #N/A + 1 should propagate #N/A, not produce a different error",
    );
    assert_error_value(
        &mirror,
        &result,
        SHEET1_UUID,
        1,
        2,
        CellError::Na,
        "C1: #N/A * 2 should propagate #N/A",
    );
    assert_error_value(
        &mirror,
        &result,
        SHEET1_UUID,
        2,
        2,
        CellError::Na,
        "C2: 100 / #N/A should propagate #N/A, not #DIV/0!",
    );
}

/// Test 5: INDEX(range, MATCH(...)) where MATCH fails returns #N/A, not #REF!.
/// This tests the error cascade through INDEX.
#[test]
fn test_index_match_error_cascade() {
    let cells = vec![
        val_cell(1, 0, 0, CellValue::Text("Alpha".into())),
        val_cell(1, 1, 0, CellValue::Text("Beta".into())),
        val_cell(1, 0, 1, CellValue::number(100.0)),
        val_cell(1, 1, 1, CellValue::number(200.0)),
        formula_cell(1, 0, 2, "INDEX(B1:B2,MATCH(\"Missing\",A1:A2,0))"),
    ];
    let snapshot = workbook_snapshot(vec![sheet_snapshot(SHEET1_UUID, "Sheet1", 2, 3, cells)]);
    let (mirror, _core, result) = init_core(snapshot);

    assert_error_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        2,
        CellError::Na,
        "INDEX(range, MATCH(missing)) should be #N/A, not #REF!",
    );
}

/// Test 5b: INDEX/MATCH with successful match returns correct value.
#[test]
fn test_index_match_success() {
    let cells = vec![
        val_cell(1, 0, 0, CellValue::Text("Alpha".into())),
        val_cell(1, 1, 0, CellValue::Text("Beta".into())),
        val_cell(1, 2, 0, CellValue::Text("Gamma".into())),
        val_cell(1, 0, 1, CellValue::number(100.0)),
        val_cell(1, 1, 1, CellValue::number(200.0)),
        val_cell(1, 2, 1, CellValue::number(300.0)),
        formula_cell(1, 0, 2, "INDEX(B1:B3,MATCH(\"Beta\",A1:A3,0))"),
    ];
    let snapshot = workbook_snapshot(vec![sheet_snapshot(SHEET1_UUID, "Sheet1", 3, 3, cells)]);
    let (mirror, _core, result) = init_core(snapshot);

    assert_number_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        2,
        200.0,
        "INDEX(B1:B3, MATCH('Beta', A1:A3, 0)) should return 200",
    );
}

/// Test 5c: Multi-step error cascade: MATCH -> INDEX -> arithmetic.
/// Reproduces the Issue #2 pattern: (P19-D19)/D19/J19 yields #DIV/0! because
/// upstream cells resolve to MATCH errors.
#[test]
fn test_multi_step_error_cascade_match_to_arithmetic() {
    let cells = vec![
        val_cell(1, 0, 0, CellValue::Text("Alpha".into())),
        val_cell(1, 1, 0, CellValue::Text("Beta".into())),
        val_cell(1, 0, 1, CellValue::number(100.0)),
        val_cell(1, 1, 1, CellValue::number(200.0)),
        formula_cell(1, 0, 3, "INDEX(B1:B2,MATCH(\"NotFound\",A1:A2,0))"),
        formula_cell(1, 0, 4, "D1-100"),
        formula_cell(1, 0, 5, "(E1-D1)/D1/50"),
    ];
    let snapshot = workbook_snapshot(vec![sheet_snapshot(SHEET1_UUID, "Sheet1", 2, 6, cells)]);
    let (mirror, _core, result) = init_core(snapshot);

    assert_error_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        3,
        CellError::Na,
        "D0: INDEX/MATCH should be #N/A",
    );
    assert_error_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        4,
        CellError::Na,
        "E0: #N/A - 100 should propagate #N/A",
    );
    assert_error_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        5,
        CellError::Na,
        "F0: (#N/A-#N/A)/#N/A/50 should propagate #N/A, not produce #DIV/0!",
    );
}

/// Test 5d: Addition of two cells that both contain MATCH errors.
/// Reproduces the `D22+D23` pattern from Issue #2.
#[test]
fn test_addition_of_two_match_error_cells() {
    let cells = vec![
        val_cell(1, 0, 1, CellValue::Text("P".into())),
        val_cell(1, 1, 1, CellValue::Text("Q".into())),
        val_cell(1, 2, 1, CellValue::Text("R".into())),
        formula_cell(1, 0, 0, "MATCH(\"X\",B1:B3,0)"),
        formula_cell(1, 1, 0, "MATCH(\"Y\",B1:B3,0)"),
        formula_cell(1, 0, 2, "A1+A2"),
    ];
    let snapshot = workbook_snapshot(vec![sheet_snapshot(SHEET1_UUID, "Sheet1", 3, 3, cells)]);
    let (mirror, _core, result) = init_core(snapshot);

    assert_error_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        0,
        CellError::Na,
        "A0 should be #N/A",
    );
    assert_error_value(
        &mirror,
        &result,
        SHEET1_UUID,
        1,
        0,
        CellError::Na,
        "A1 should be #N/A",
    );
    assert_error_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        2,
        CellError::Na,
        "A1+A2 where both are #N/A should produce #N/A",
    );
}
