use super::support::{
    SHEET1_UUID, SHEET2_UUID, assert_number_value, assert_text_value, formula_cell, init_core,
    sheet_snapshot, val_cell, workbook_snapshot,
};
use value_types::CellValue;

/// Test 7: IF in array context should produce an array for MATCH.
///
/// This is the core of Issue #4. The formula pattern is:
///   MATCH(target, IF(condition_range=criteria, value_range), 0)
///
/// In Excel (with Ctrl+Shift+Enter or dynamic arrays), IF evaluates element-wise:
///   IF({"Closed","Open","Closed","Open"}="Closed", {100,200,300,400})
///   -> {100, FALSE, 300, FALSE}
#[test]
fn test_if_produces_array_for_match() {
    let data_cells = vec![
        val_cell(1, 0, 0, CellValue::Text("Closed".into())),
        val_cell(1, 1, 0, CellValue::Text("Open".into())),
        val_cell(1, 2, 0, CellValue::Text("Closed".into())),
        val_cell(1, 3, 0, CellValue::Text("Open".into())),
        val_cell(1, 0, 1, CellValue::number(100.0)),
        val_cell(1, 1, 1, CellValue::number(200.0)),
        val_cell(1, 2, 1, CellValue::number(300.0)),
        val_cell(1, 3, 1, CellValue::number(400.0)),
    ];
    let results_cells = vec![formula_cell(
        2,
        0,
        0,
        "MATCH(300,IF(Data!A1:A4=\"Closed\",Data!B1:B4),0)",
    )];

    let snapshot = workbook_snapshot(vec![
        sheet_snapshot(SHEET1_UUID, "Data", 4, 2, data_cells),
        sheet_snapshot(SHEET2_UUID, "Results", 1, 1, results_cells),
    ]);
    let (mirror, _core, result) = init_core(snapshot);

    assert_number_value(
        &mirror,
        &result,
        SHEET2_UUID,
        0,
        0,
        3.0,
        "MATCH(300, IF(cond_range=\"Closed\", val_range), 0) should return 3",
    );
}

/// Test 8: Full corpus pattern — IFERROR(INDEX(C:C, MATCH(LARGE(IF(Q="X", K), 1), K:K, 0)), "--")
///
/// This is the exact formula from the corpus that causes 1,112+ errors.
#[test]
fn test_iferror_index_match_with_array_if() {
    let query_cells = vec![
        // Col A: Names
        val_cell(1, 0, 0, CellValue::Text("Item1".into())),
        val_cell(1, 1, 0, CellValue::Text("Item2".into())),
        val_cell(1, 2, 0, CellValue::Text("Item3".into())),
        val_cell(1, 3, 0, CellValue::Text("Item4".into())),
        val_cell(1, 4, 0, CellValue::Text("Item5".into())),
        // Col B: Status
        val_cell(1, 0, 1, CellValue::Text("Open".into())),
        val_cell(1, 1, 1, CellValue::Text("Closed".into())),
        val_cell(1, 2, 1, CellValue::Text("Closed".into())),
        val_cell(1, 3, 1, CellValue::Text("Open".into())),
        val_cell(1, 4, 1, CellValue::Text("Closed".into())),
        // Col C: Values
        val_cell(1, 0, 2, CellValue::number(50.0)),
        val_cell(1, 1, 2, CellValue::number(200.0)),
        val_cell(1, 2, 2, CellValue::number(300.0)),
        val_cell(1, 3, 2, CellValue::number(150.0)),
        val_cell(1, 4, 2, CellValue::number(100.0)),
    ];
    let results_cells = vec![formula_cell(
        2,
        0,
        0,
        "IFERROR(INDEX(Query!A1:A5,MATCH(LARGE(IF(Query!B1:B5=\"Closed\",Query!C1:C5),1),Query!C1:C5,0)),\"--\")",
    )];

    let snapshot = workbook_snapshot(vec![
        sheet_snapshot(SHEET1_UUID, "Query", 5, 3, query_cells),
        sheet_snapshot(SHEET2_UUID, "Results", 1, 1, results_cells),
    ]);
    let (mirror, _core, result) = init_core(snapshot);

    assert_text_value(
        &mirror,
        &result,
        SHEET2_UUID,
        0,
        0,
        "Item3",
        "Should return \"Item3\" — the name of the row with the largest Closed value",
    );
}

/// Test 9: LARGE with a mixed array containing FALSE and numbers.
/// LARGE should find the largest number, ignoring FALSE values.
#[test]
fn test_large_with_mixed_array() {
    let cells = vec![
        val_cell(1, 0, 0, CellValue::Boolean(false)),
        val_cell(1, 1, 0, CellValue::number(200.0)),
        val_cell(1, 2, 0, CellValue::number(300.0)),
        val_cell(1, 3, 0, CellValue::Boolean(false)),
        val_cell(1, 4, 0, CellValue::number(100.0)),
        formula_cell(1, 0, 1, "LARGE(A1:A5,1)"),
        formula_cell(1, 1, 1, "LARGE(A1:A5,2)"),
        formula_cell(1, 2, 1, "LARGE(A1:A5,3)"),
    ];
    let snapshot = workbook_snapshot(vec![sheet_snapshot(SHEET1_UUID, "Sheet1", 5, 2, cells)]);
    let (mirror, _core, result) = init_core(snapshot);

    assert_number_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        1,
        300.0,
        "LARGE([FALSE, 200, 300, FALSE, 100], 1) should be 300",
    );
    assert_number_value(
        &mirror,
        &result,
        SHEET1_UUID,
        1,
        1,
        200.0,
        "LARGE([FALSE, 200, 300, FALSE, 100], 2) should be 200",
    );
    assert_number_value(
        &mirror,
        &result,
        SHEET1_UUID,
        2,
        1,
        100.0,
        "LARGE([FALSE, 200, 300, FALSE, 100], 3) should be 100",
    );
}

/// Integration test with two sheets: "Data" and "Results".
///
/// Data sheet:
///   A: Name       B: Status    C: Value
///   0: "Alpha"    "Open"       100
///   1: "Beta"     "Closed"     200
///   2: "Gamma"    "Closed"     300
///   3: "Delta"    "Open"       150
///
/// Results sheet:
///   A0: =MATCH("Beta", Data!A1:A4, 0)                          -> 2
///   B0: =INDEX(Data!C1:C4, MATCH("Beta", Data!A1:A4, 0))       -> 200
///   C0: =IFERROR(INDEX(Data!A1:A4, MATCH(LARGE(IF(Data!B1:B4="Closed", Data!C1:C4), 1), Data!C1:C4, 0)), "--")
///         -> "Gamma" (300 is largest closed value, at position 3 in C, name is "Gamma")
#[test]
fn test_full_integration_two_sheet_index_match() {
    let data_cells = vec![
        // Column A: Names
        val_cell(1, 0, 0, CellValue::Text("Alpha".into())),
        val_cell(1, 1, 0, CellValue::Text("Beta".into())),
        val_cell(1, 2, 0, CellValue::Text("Gamma".into())),
        val_cell(1, 3, 0, CellValue::Text("Delta".into())),
        // Column B: Status
        val_cell(1, 0, 1, CellValue::Text("Open".into())),
        val_cell(1, 1, 1, CellValue::Text("Closed".into())),
        val_cell(1, 2, 1, CellValue::Text("Closed".into())),
        val_cell(1, 3, 1, CellValue::Text("Open".into())),
        // Column C: Values
        val_cell(1, 0, 2, CellValue::number(100.0)),
        val_cell(1, 1, 2, CellValue::number(200.0)),
        val_cell(1, 2, 2, CellValue::number(300.0)),
        val_cell(1, 3, 2, CellValue::number(150.0)),
    ];
    let results_cells = vec![
        formula_cell(2, 0, 0, "MATCH(\"Beta\",Data!A1:A4,0)"),
        formula_cell(2, 0, 1, "INDEX(Data!C1:C4,MATCH(\"Beta\",Data!A1:A4,0))"),
        formula_cell(
            2,
            0,
            2,
            "IFERROR(INDEX(Data!A1:A4,MATCH(LARGE(IF(Data!B1:B4=\"Closed\",Data!C1:C4),1),Data!C1:C4,0)),\"--\")",
        ),
    ];

    let snapshot = workbook_snapshot(vec![
        sheet_snapshot(SHEET1_UUID, "Data", 4, 3, data_cells),
        sheet_snapshot(SHEET2_UUID, "Results", 1, 3, results_cells),
    ]);
    let (mirror, _core, result) = init_core(snapshot);

    assert_number_value(
        &mirror,
        &result,
        SHEET2_UUID,
        0,
        0,
        2.0,
        "MATCH('Beta', Data!A1:A4, 0) should return 2",
    );
    assert_number_value(
        &mirror,
        &result,
        SHEET2_UUID,
        0,
        1,
        200.0,
        "INDEX(Data!C1:C4, MATCH('Beta', Data!A1:A4, 0)) should return 200",
    );
    assert_text_value(
        &mirror,
        &result,
        SHEET2_UUID,
        0,
        2,
        "Gamma",
        "Should return \"Gamma\" — the name with the largest Closed value",
    );
}
