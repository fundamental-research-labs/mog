use super::support::{
    SHEET1_UUID, assert_error_value, assert_number_value, formula_cell, init_core, sheet_snapshot,
    val_cell, workbook_snapshot,
};
use value_types::{CellError, CellValue};

/// Test 1: Basic MATCH with exact match (match_type=0) finds correct position.
#[test]
fn test_match_exact_basic() {
    // Sheet layout:
    //   A0: "Alpha"   B0: 100
    //   A1: "Beta"    B1: 200
    //   A2: "Gamma"   B2: 300
    //   A3: "Delta"   B3: 400
    //   C0: =MATCH("Beta", A0:A3, 0)   -> expected: 2
    //   C1: =MATCH("Gamma", A0:A3, 0)  -> expected: 3
    //   C2: =MATCH("Missing", A0:A3, 0) -> expected: #N/A
    let cells = vec![
        val_cell(1, 0, 0, CellValue::Text("Alpha".into())),
        val_cell(1, 1, 0, CellValue::Text("Beta".into())),
        val_cell(1, 2, 0, CellValue::Text("Gamma".into())),
        val_cell(1, 3, 0, CellValue::Text("Delta".into())),
        val_cell(1, 0, 1, CellValue::number(100.0)),
        val_cell(1, 1, 1, CellValue::number(200.0)),
        val_cell(1, 2, 1, CellValue::number(300.0)),
        val_cell(1, 3, 1, CellValue::number(400.0)),
        formula_cell(1, 0, 2, "MATCH(\"Beta\",A1:A4,0)"),
        formula_cell(1, 1, 2, "MATCH(\"Gamma\",A1:A4,0)"),
        formula_cell(1, 2, 2, "MATCH(\"Missing\",A1:A4,0)"),
    ];
    let snapshot = workbook_snapshot(vec![sheet_snapshot(SHEET1_UUID, "Sheet1", 4, 3, cells)]);
    let (mirror, _core, result) = init_core(snapshot);

    assert_number_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        2,
        2.0,
        "MATCH('Beta') should return 2",
    );
    assert_number_value(
        &mirror,
        &result,
        SHEET1_UUID,
        1,
        2,
        3.0,
        "MATCH('Gamma') should return 3",
    );
    assert_error_value(
        &mirror,
        &result,
        SHEET1_UUID,
        2,
        2,
        CellError::Na,
        "MATCH('Missing') should return #N/A",
    );
}

/// Test 2: When the lookup value is an error, MATCH should propagate that error.
#[test]
fn test_match_error_in_lookup_value() {
    // A0: =1/0  (produces #DIV/0!)
    // B0: 10   B1: 20   B2: 30
    // C0: =MATCH(A1, B1:B3, 0)  -> should propagate #DIV/0!
    let cells = vec![
        formula_cell(1, 0, 0, "1/0"),
        val_cell(1, 0, 1, CellValue::number(10.0)),
        val_cell(1, 1, 1, CellValue::number(20.0)),
        val_cell(1, 2, 1, CellValue::number(30.0)),
        formula_cell(1, 0, 2, "MATCH(A1,B1:B3,0)"),
    ];
    let snapshot = workbook_snapshot(vec![sheet_snapshot(SHEET1_UUID, "Sheet1", 3, 3, cells)]);
    let (mirror, _core, result) = init_core(snapshot);

    assert_error_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        0,
        CellError::Div0,
        "A0 should be #DIV/0!",
    );
    assert_error_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        2,
        CellError::Div0,
        "MATCH with #DIV/0! lookup should propagate #DIV/0!",
    );
}

/// Test 3: MATCH returns #N/A when value isn't found.
#[test]
fn test_match_not_found_returns_na() {
    let cells = vec![
        val_cell(1, 0, 0, CellValue::number(10.0)),
        val_cell(1, 1, 0, CellValue::number(20.0)),
        val_cell(1, 2, 0, CellValue::number(30.0)),
        formula_cell(1, 0, 1, "MATCH(99,A1:A3,0)"),
    ];
    let snapshot = workbook_snapshot(vec![sheet_snapshot(SHEET1_UUID, "Sheet1", 3, 2, cells)]);
    let (mirror, _core, result) = init_core(snapshot);

    assert_error_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        1,
        CellError::Na,
        "MATCH(99,...) should return #N/A",
    );
}

/// Test 6: MATCH with an array containing mixed types (numbers and FALSE/booleans).
/// When IF produces an array like [FALSE, 200, 300, FALSE], MATCH should be able
/// to search through it for a number.
#[test]
fn test_match_with_mixed_type_array() {
    // Manually test MATCH with an array argument that contains FALSE and numbers.
    // We can't easily produce this via formulas without the array-IF bug, so we
    // test the downstream behavior: can MATCH find a number in a column that
    // also contains booleans?
    let cells = vec![
        val_cell(1, 0, 0, CellValue::Boolean(false)),
        val_cell(1, 1, 0, CellValue::number(200.0)),
        val_cell(1, 2, 0, CellValue::number(300.0)),
        val_cell(1, 3, 0, CellValue::Boolean(false)),
        formula_cell(1, 0, 1, "MATCH(300,A1:A4,0)"),
    ];
    let snapshot = workbook_snapshot(vec![sheet_snapshot(SHEET1_UUID, "Sheet1", 4, 2, cells)]);
    let (mirror, _core, result) = init_core(snapshot);

    assert_number_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        1,
        3.0,
        "MATCH(300, [FALSE, 200, 300, FALSE], 0) should return 3",
    );
}

/// Test 10: MATCH against a large range (simulating full column reference).
/// Tests that MATCH handles ranges with many empty cells correctly.
#[test]
fn test_match_with_large_range() {
    // 100 rows of data in column A, with MATCH looking through A1:A100.
    // Only 10 rows have actual data; the rest are empty.
    let mut cells = Vec::new();

    // Place data in rows 0, 10, 20, ... 90
    for i in 0..10u32 {
        let row = i * 10;
        cells.push(val_cell(
            1,
            row,
            0,
            CellValue::number((i + 1) as f64 * 100.0),
        ));
    }

    // MATCH formula looking for 500 (which is at row 40, position depends on range)
    cells.push(formula_cell(1, 0, 1, "MATCH(500,A1:A100,0)"));

    let snapshot = workbook_snapshot(vec![sheet_snapshot(SHEET1_UUID, "Sheet1", 100, 2, cells)]);
    let (mirror, _core, result) = init_core(snapshot);

    // 500 is at row 40 (0-indexed), which is position 41 in the range A1:A100.
    assert_number_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        1,
        41.0,
        "MATCH(500, A1:A100, 0) should find 500 at row 41",
    );
}
