use crate::support::{assert_array_or_first_text, assert_number, build_snapshot, recalc_snapshot};
use value_types::CellValue;

#[test]
fn test_array_concatenation_operator() {
    let snapshot = build_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                (0, 0, CellValue::Text("John".into()), None),
                (1, 0, CellValue::Text("Jane".into()), None),
                (2, 0, CellValue::Text("Bob".into()), None),
                (0, 1, CellValue::Text("Active".into()), None),
                (1, 1, CellValue::Text("Inactive".into()), None),
                (2, 1, CellValue::Text("Active".into()), None),
                (0, 2, CellValue::Null, Some("A1:A3&B1:B3")),
            ],
        )],
        vec![],
    );

    let result = recalc_snapshot(snapshot);

    assert_array_or_first_text(
        &result,
        0,
        0,
        2,
        &["JohnActive", "JaneInactive", "BobActive"],
        "array & array should support element-wise text concatenation",
    );
}

#[test]
fn test_xlookup_with_array_concat_lookup_array() {
    let snapshot = build_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                (0, 0, CellValue::Text("John".into()), None),
                (1, 0, CellValue::Text("Jane".into()), None),
                (2, 0, CellValue::Text("Bob".into()), None),
                (0, 1, CellValue::Text("Active".into()), None),
                (1, 1, CellValue::Text("Inactive".into()), None),
                (2, 1, CellValue::Text("Active".into()), None),
                (0, 2, CellValue::number(100.0), None),
                (1, 2, CellValue::number(200.0), None),
                (2, 2, CellValue::number(300.0), None),
                (
                    0,
                    3,
                    CellValue::Null,
                    Some("XLOOKUP(\"JohnActive\",A1:A3&B1:B3,C1:C3,0)"),
                ),
            ],
        )],
        vec![],
    );

    let result = recalc_snapshot(snapshot);

    assert_number(
        &result,
        0,
        0,
        3,
        100.0,
        "XLOOKUP should search a computed concatenated lookup array",
    );
}
