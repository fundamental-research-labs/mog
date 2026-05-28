use crate::support::{
    assert_array_or_first_number, assert_null_or_zero_or_non_error, assert_number, build_snapshot,
    recalc_snapshot,
};
use value_types::CellValue;

#[test]
fn test_xlookup_fallback_multi_col_return() {
    let snapshot = build_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                (0, 0, CellValue::number(1.0), None),
                (1, 0, CellValue::number(2.0), None),
                (2, 0, CellValue::number(3.0), None),
                (0, 1, CellValue::number(10.0), None),
                (0, 2, CellValue::number(100.0), None),
                (1, 1, CellValue::number(20.0), None),
                (1, 2, CellValue::number(200.0), None),
                (2, 1, CellValue::number(30.0), None),
                (2, 2, CellValue::number(300.0), None),
                (0, 3, CellValue::Null, Some("XLOOKUP(2,A1:A3,B1:C3)")),
            ],
        )],
        vec![],
    );

    let result = recalc_snapshot(snapshot);

    assert_array_or_first_number(
        &result,
        0,
        0,
        3,
        20.0,
        "multi-column XLOOKUP return range should expose the matched row first element",
    );
}

#[test]
fn test_xlookup_return_range_shorter_than_lookup() {
    let snapshot = build_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                (0, 0, CellValue::number(1.0), None),
                (1, 0, CellValue::number(2.0), None),
                (2, 0, CellValue::number(3.0), None),
                (3, 0, CellValue::number(4.0), None),
                (4, 0, CellValue::number(5.0), None),
                (0, 1, CellValue::number(100.0), None),
                (1, 1, CellValue::number(200.0), None),
                (2, 1, CellValue::number(300.0), None),
                (0, 2, CellValue::Null, Some("XLOOKUP(2,A1:A5,B1:B3)")),
                (1, 2, CellValue::Null, Some("XLOOKUP(5,A1:A5,B1:B3)")),
            ],
        )],
        vec![],
    );

    let result = recalc_snapshot(snapshot);

    assert_number(
        &result,
        0,
        0,
        2,
        200.0,
        "shorter return range should still return in-bounds matches",
    );
    assert_null_or_zero_or_non_error(
        &result,
        0,
        1,
        2,
        "matched rows beyond a shorter return range should be handled gracefully",
    );
}

#[test]
fn test_xlookup_cross_sheet_return_range() {
    let snapshot = build_snapshot(
        vec![
            (
                "Lookup",
                10,
                10,
                vec![
                    (0, 0, CellValue::number(1.0), None),
                    (1, 0, CellValue::number(2.0), None),
                    (2, 0, CellValue::number(3.0), None),
                    (0, 1, CellValue::Null, Some("XLOOKUP(2,A1:A3,Data!B1:B3)")),
                ],
            ),
            (
                "Data",
                10,
                10,
                vec![
                    (0, 1, CellValue::number(100.0), None),
                    (1, 1, CellValue::number(200.0), None),
                    (2, 1, CellValue::number(300.0), None),
                ],
            ),
        ],
        vec![],
    );

    let result = recalc_snapshot(snapshot);

    assert_number(
        &result,
        0,
        0,
        1,
        200.0,
        "XLOOKUP should resolve cross-sheet return ranges from the referenced sheet",
    );
}
