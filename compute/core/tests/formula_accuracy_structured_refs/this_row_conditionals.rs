use super::support::{
    assert_cell_boolean, assert_cell_number, recalc_snapshot, single_sheet_table_snapshot,
};
use value_types::CellValue;

/// Full pattern: `IF(Deals8[[#This Row],[Exit CR]]="", 0, Deals8[[#This Row],[Exit CR]]-Deals8[[#This Row],[Entry CR]])`
/// When Exit CR is empty, should return 0.
/// When Exit CR has a number, should return the difference.
#[test]
fn test_structured_ref_with_if_empty_check() {
    let formula = "IF(Deals8[[#This Row],[Exit CR]]=\"\",0,Deals8[[#This Row],[Exit CR]]-Deals8[[#This Row],[Entry CR]])";
    let snapshot = single_sheet_table_snapshot(
        "Deals",
        "Deals8",
        &["Exit CR", "Entry CR", "Result"],
        vec![
            vec![CellValue::Null, CellValue::number(5.0), CellValue::Null],
            vec![
                CellValue::number(10.5),
                CellValue::number(8.3),
                CellValue::Null,
            ],
        ],
        vec![(0, 2, formula), (1, 2, formula)],
    );

    let result = recalc_snapshot(snapshot);
    assert_cell_number(&result, 0, 1, 2, 0.0);
    assert_cell_number(&result, 0, 2, 2, 10.5 - 8.3);
}

/// `IF(OR(Deals8[[#This Row],[Exit CR]]="", Deals8[[#This Row],[Entry CR]]=""), 0, ...)`
/// Tests OR with multiple structured reference conditions.
#[test]
fn test_structured_ref_with_or_conditions() {
    let formula = "IF(OR(Deals8[[#This Row],[Exit CR]]=\"\",Deals8[[#This Row],[Entry CR]]=\"\"),0,Deals8[[#This Row],[Exit CR]]-Deals8[[#This Row],[Entry CR]])";
    let snapshot = single_sheet_table_snapshot(
        "Deals",
        "Deals8",
        &["Exit CR", "Entry CR", "Result"],
        vec![
            vec![
                CellValue::number(10.0),
                CellValue::number(6.0),
                CellValue::Null,
            ],
            vec![CellValue::Null, CellValue::number(5.0), CellValue::Null],
            vec![CellValue::number(7.0), CellValue::Null, CellValue::Null],
            vec![CellValue::Null, CellValue::Null, CellValue::Null],
        ],
        vec![
            (0, 2, formula),
            (1, 2, formula),
            (2, 2, formula),
            (3, 2, formula),
        ],
    );

    let result = recalc_snapshot(snapshot);
    assert_cell_number(&result, 0, 1, 2, 4.0);
    assert_cell_number(&result, 0, 2, 2, 0.0);
    assert_cell_number(&result, 0, 3, 2, 0.0);
    assert_cell_number(&result, 0, 4, 2, 0.0);
}

/// `ISNUMBER(Deals8[[#This Row],[Exit CR]])` should return TRUE when cell has a number,
/// FALSE when empty/text.
#[test]
fn test_structured_ref_isnumber() {
    let formula = "ISNUMBER(Deals8[[#This Row],[Exit CR]])";
    let snapshot = single_sheet_table_snapshot(
        "Deals",
        "Deals8",
        &["Exit CR", "IsNum"],
        vec![
            vec![CellValue::number(10.5), CellValue::Null],
            vec![CellValue::Null, CellValue::Null],
            vec![CellValue::Text("hello".into()), CellValue::Null],
        ],
        vec![(0, 1, formula), (1, 1, formula), (2, 1, formula)],
    );

    let result = recalc_snapshot(snapshot);
    assert_cell_boolean(&result, 0, 1, 1, true);
    assert_cell_boolean(&result, 0, 2, 1, false);
    assert_cell_boolean(&result, 0, 3, 1, false);
}

/// The exact formula shape from the corpus that produced #VALUE! where Excel returns 0.
#[test]
fn test_structured_ref_full_corpus_pattern() {
    let formula = concat!(
        "IF(OR(",
        "Deals8[[#This Row],[Exit CR]]=\"\",",
        "Deals8[[#This Row],[Entry CR]]=\"\",",
        "NOT(ISNUMBER(Deals8[[#This Row],[Exit CR]])),",
        "NOT(ISNUMBER(Deals8[[#This Row],[Entry CR]]))",
        "),0,",
        "Deals8[[#This Row],[Exit CR]]-Deals8[[#This Row],[Entry CR]])"
    );

    let snapshot = single_sheet_table_snapshot(
        "Deals",
        "Deals8",
        &["Exit CR", "Entry CR", "Result"],
        vec![
            vec![
                CellValue::number(10.5),
                CellValue::number(8.3),
                CellValue::Null,
            ],
            vec![CellValue::Null, CellValue::number(5.0), CellValue::Null],
            vec![CellValue::number(7.0), CellValue::Null, CellValue::Null],
            vec![CellValue::Null, CellValue::Null, CellValue::Null],
            vec![
                CellValue::Text("N/A".into()),
                CellValue::number(3.0),
                CellValue::Null,
            ],
        ],
        vec![
            (0, 2, formula),
            (1, 2, formula),
            (2, 2, formula),
            (3, 2, formula),
            (4, 2, formula),
        ],
    );

    let result = recalc_snapshot(snapshot);
    assert_cell_number(&result, 0, 1, 2, 10.5 - 8.3);
    assert_cell_number(&result, 0, 2, 2, 0.0);
    assert_cell_number(&result, 0, 3, 2, 0.0);
    assert_cell_number(&result, 0, 4, 2, 0.0);
    assert_cell_number(&result, 0, 5, 2, 0.0);
}
