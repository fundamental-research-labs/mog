use super::support::{
    assert_cell_number, assert_cell_number_allow_scalar_array, assert_no_engine_error,
    find_changed_value, find_error, format_recalc_diagnostics, recalc_snapshot,
    single_sheet_table_snapshot,
};
use value_types::CellValue;

/// `Data1[[Col1]:[Col3]]` range across multiple columns.
#[test]
fn test_structured_ref_column_range() {
    let snapshot = single_sheet_table_snapshot(
        "Sheet1",
        "Data1",
        &["Col1", "Col2", "Col3", "SumResult"],
        vec![vec![
            CellValue::number(1.0),
            CellValue::number(2.0),
            CellValue::number(3.0),
            CellValue::Null,
        ]],
        vec![(0, 3, "SUM(Data1[[#This Row],[Col1]:[Col3]])")],
    );

    let result = recalc_snapshot(snapshot);
    assert_cell_number(&result, 0, 1, 3, 6.0);
}

/// `Data1[@Col1]` is equivalent to `Data1[[#This Row],[Col1]]`.
#[test]
fn test_structured_ref_at_syntax() {
    let snapshot = single_sheet_table_snapshot(
        "Sheet1",
        "Data1",
        &["Col1", "Result"],
        vec![vec![CellValue::number(42.0), CellValue::Null]],
        vec![(0, 1, "Data1[@Col1]")],
    );

    let result = recalc_snapshot(snapshot);
    assert_cell_number_allow_scalar_array(&result, 0, 1, 1, 42.0);
}

/// Table name and column names should match case-insensitively.
#[test]
fn test_structured_ref_case_insensitive() {
    let snapshot = single_sheet_table_snapshot(
        "Sheet1",
        "Deals8",
        &["Exit CR", "Result"],
        vec![vec![CellValue::number(99.0), CellValue::Null]],
        vec![(0, 1, "deals8[[#This Row],[exit cr]]")],
    );

    let result = recalc_snapshot(snapshot);
    let err = find_error(&result, 0, 1, 1);

    assert!(
        err.is_none(),
        "Case-insensitive table lookup should work. Got error: {:?}. \
         This indicates get_table() in mirror/mod.rs does case-sensitive matching.\n{}",
        err,
        format_recalc_diagnostics(&result)
    );
    assert_no_engine_error(&result, 0, 1, 1);

    match find_changed_value(&result, 0, 1, 1) {
        Some(CellValue::Number(n)) => assert!(
            (n.get() - 99.0).abs() < 1e-10,
            "Expected 99, got {}\n{}",
            n.get(),
            format_recalc_diagnostics(&result)
        ),
        Some(CellValue::Array(arr)) if arr.rows() == 1 && arr.cols() == 1 => {
            match arr.get(0, 0).unwrap() {
                CellValue::Number(n) => assert!(
                    (n.get() - 99.0).abs() < 1e-10,
                    "Expected 99, got {}\n{}",
                    n.get(),
                    format_recalc_diagnostics(&result)
                ),
                other => panic!("Expected Number(99), got {:?}", other),
            }
        }
        other => panic!(
            "Expected case-insensitive structured ref to return Number(99), got {:?}\n{}",
            other,
            format_recalc_diagnostics(&result)
        ),
    }
}
