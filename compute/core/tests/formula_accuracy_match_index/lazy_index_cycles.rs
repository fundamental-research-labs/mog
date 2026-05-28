use super::support::{
    SHEET1_UUID, SHEET2_UUID, assert_no_recalc_errors, assert_number_value, formula_cell,
    init_core, sheet_snapshot, val_cell, workbook_snapshot,
};
use value_types::CellValue;

/// Test 11: Cross-sheet INDEX/MATCH with whole-column refs should NOT produce #REF!.
///
/// This is the core false-cycle pattern from the LBO financial model:
///   Sheet A has INDEX(Sheet B!A:C, MATCH(..., Sheet B!A:A, 0), ...)
///   Sheet B has INDEX(Sheet A!A:C, MATCH(..., Sheet A!A:A, 0), ...)
///
/// Before the lazy INDEX fix, the eager `eval_node` on the range `Sheet B!A:C`
/// would demand-evaluate ALL dirty cells in that range, which includes cells
/// that reference back to Sheet A, creating a false cycle.
///
/// With lazy INDEX, only the single target cell (determined by MATCH) is
/// demand-evaluated, so no false cycle occurs.
#[test]
fn test_cross_sheet_index_match_no_false_cycle() {
    let debt_cells = vec![
        val_cell(1, 0, 0, CellValue::Text("Interest".into())),
        val_cell(1, 0, 1, CellValue::number(100.0)),
        formula_cell(1, 0, 2, "INDEX(Core!A:C,MATCH(\"Revenue\",Core!A:A,0),2)"),
        val_cell(1, 1, 0, CellValue::Text("Principal".into())),
        val_cell(1, 1, 1, CellValue::number(200.0)),
        formula_cell(1, 1, 2, "INDEX(Core!A:C,MATCH(\"Costs\",Core!A:A,0),2)"),
    ];
    let core_cells = vec![
        val_cell(2, 0, 0, CellValue::Text("Revenue".into())),
        val_cell(2, 0, 1, CellValue::number(500.0)),
        formula_cell(2, 0, 2, "INDEX(Debt!A:C,MATCH(\"Interest\",Debt!A:A,0),2)"),
        val_cell(2, 1, 0, CellValue::Text("Costs".into())),
        val_cell(2, 1, 1, CellValue::number(300.0)),
        formula_cell(2, 1, 2, "INDEX(Debt!A:C,MATCH(\"Principal\",Debt!A:A,0),2)"),
    ];

    let snapshot = workbook_snapshot(vec![
        sheet_snapshot(SHEET1_UUID, "Debt", 2, 3, debt_cells),
        sheet_snapshot(SHEET2_UUID, "Core", 2, 3, core_cells),
    ]);
    let (mirror, _core, result) = init_core(snapshot);

    assert_number_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        2,
        500.0,
        "Debt!C0: INDEX(Core!A:C, MATCH('Revenue',...), 2) should return 500, not #REF!",
    );
    assert_number_value(
        &mirror,
        &result,
        SHEET1_UUID,
        1,
        2,
        300.0,
        "Debt!C1: INDEX(Core!A:C, MATCH('Costs',...), 2) should return 300, not #REF!",
    );
    assert_number_value(
        &mirror,
        &result,
        SHEET2_UUID,
        0,
        2,
        100.0,
        "Core!C0: INDEX(Debt!A:C, MATCH('Interest',...), 2) should return 100, not #REF!",
    );
    assert_number_value(
        &mirror,
        &result,
        SHEET2_UUID,
        1,
        2,
        200.0,
        "Core!C1: INDEX(Debt!A:C, MATCH('Principal',...), 2) should return 200, not #REF!",
    );
    assert_no_recalc_errors(
        &result,
        "cross-sheet whole-column INDEX/MATCH should not report false cycles",
    );
}

/// Test 14: Same-sheet INDEX with whole-column ref containing formulas.
/// INDEX(A:A, 3) where column A has formulas that reference the INDEX cell.
/// Should NOT create a false cycle — INDEX only needs cell A2.
#[test]
fn test_same_sheet_index_whole_column_no_false_cycle() {
    // A0: 10
    // A1: 20
    // A2: 30
    // B0: =INDEX(A:A, 3)    -> should return A2 = 30
    // A3: =B1*2             -> depends on B0, but INDEX(A:A,3) should NOT eval A3
    let cells = vec![
        val_cell(1, 0, 0, CellValue::number(10.0)),
        val_cell(1, 1, 0, CellValue::number(20.0)),
        val_cell(1, 2, 0, CellValue::number(30.0)),
        formula_cell(1, 0, 1, "INDEX(A:A,3)"),
        formula_cell(1, 3, 0, "B1*2"),
    ];
    let snapshot = workbook_snapshot(vec![sheet_snapshot(SHEET1_UUID, "Sheet1", 4, 2, cells)]);
    let (mirror, _core, result) = init_core(snapshot);

    assert_number_value(
        &mirror,
        &result,
        SHEET1_UUID,
        0,
        1,
        30.0,
        "INDEX(A:A, 3) should return 30 (A2), not #REF!",
    );
    assert_number_value(
        &mirror,
        &result,
        SHEET1_UUID,
        3,
        0,
        60.0,
        "A3: =B1*2 should be 60 (B0=30, 30*2=60)",
    );
    assert_no_recalc_errors(
        &result,
        "same-sheet whole-column INDEX should not report false cycles",
    );
}
