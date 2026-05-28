use crate::support::{
    assert_error_debug, assert_number, build_snapshot, recalc_snapshot,
    single_sheet_lookup_snapshot,
};
use value_types::CellValue;

#[test]
fn test_xlookup_exact_match_basic() {
    let snapshot = single_sheet_lookup_snapshot(vec![(0, 2, "XLOOKUP(20,A1:A3,B1:B3)")]);

    let result = recalc_snapshot(snapshot);

    assert_number(
        &result,
        0,
        0,
        2,
        200.0,
        "basic scalar exact-match XLOOKUP should return the matched row value",
    );
}

#[test]
fn test_xlookup_not_found_default_na() {
    let snapshot = single_sheet_lookup_snapshot(vec![(0, 2, "XLOOKUP(99,A1:A3,B1:B3)")]);

    let result = recalc_snapshot(snapshot);

    assert_error_debug(
        &result,
        0,
        0,
        2,
        "Na",
        "missing XLOOKUP value without if_not_found should return #N/A",
    );
}

#[test]
fn test_xlookup_not_found_with_fallback() {
    let snapshot = single_sheet_lookup_snapshot(vec![(0, 2, "XLOOKUP(99,A1:A3,B1:B3,0)")]);

    let result = recalc_snapshot(snapshot);

    assert_number(
        &result,
        0,
        0,
        2,
        0.0,
        "missing XLOOKUP value with if_not_found=0 should return zero",
    );
}

#[test]
fn test_xlookup_text_match() {
    let snapshot = build_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                (0, 0, CellValue::Text("Apple".into()), None),
                (1, 0, CellValue::Text("Banana".into()), None),
                (2, 0, CellValue::Text("Cherry".into()), None),
                (0, 1, CellValue::number(1.0), None),
                (1, 1, CellValue::number(2.0), None),
                (2, 1, CellValue::number(3.0), None),
                (
                    0,
                    2,
                    CellValue::Null,
                    Some("XLOOKUP(\"Banana\",A1:A3,B1:B3)"),
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
        2,
        2.0,
        "text XLOOKUP should match text lookup arrays",
    );
}

#[test]
fn test_xlookup_with_concatenated_lookup() {
    let snapshot = build_snapshot(
        vec![(
            "Sheet1",
            10,
            10,
            vec![
                (0, 0, CellValue::Text("AB".into()), None),
                (1, 0, CellValue::Text("CD".into()), None),
                (2, 0, CellValue::Text("EF".into()), None),
                (0, 1, CellValue::number(10.0), None),
                (1, 1, CellValue::number(20.0), None),
                (2, 1, CellValue::number(30.0), None),
                (
                    0,
                    2,
                    CellValue::Null,
                    Some("XLOOKUP(\"A\"&\"B\",A1:A3,B1:B3)"),
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
        2,
        10.0,
        "scalar concatenated lookup value should be evaluated before XLOOKUP",
    );
}
