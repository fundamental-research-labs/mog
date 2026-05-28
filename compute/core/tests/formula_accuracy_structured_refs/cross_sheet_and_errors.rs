use super::support::{
    assert_cell_error, assert_cell_number, cross_sheet_table_summary_snapshot,
    no_table_formula_snapshot, recalc_snapshot,
};
use value_types::{CellError, CellValue};

/// Table on Sheet1, SUMIF formula on Sheet2 referencing the table.
#[test]
fn test_sumif_cross_sheet_structured_ref() {
    let snapshot = cross_sheet_table_summary_snapshot(
        "DataSheet",
        "Summary",
        "Sales",
        &["Name", "Amount"],
        vec![
            vec![CellValue::Text("Alice".into()), CellValue::number(100.0)],
            vec![CellValue::Text("Bob".into()), CellValue::number(200.0)],
            vec![CellValue::Text("Alice".into()), CellValue::number(300.0)],
        ],
        vec![(0, 0, r#"SUMIF(Sales[Name],"Alice",Sales[Amount])"#)],
    );

    let result = recalc_snapshot(snapshot);
    assert_cell_number(&result, 1, 0, 0, 400.0);
}

/// When the table doesn't exist, SUMIF and COUNTIF should return #REF!, not 0.
#[test]
fn test_sumif_nonexistent_table_returns_error() {
    let snapshot = no_table_formula_snapshot(vec![
        (0, 0, r#"SUMIF(NonExistent[Col],"x")"#),
        (1, 0, r#"COUNTIF(NonExistent[Col],"x")"#),
    ]);

    let result = recalc_snapshot(snapshot);
    assert_cell_error(&result, 0, 0, 0, CellError::Ref);
    assert_cell_error(&result, 0, 1, 0, CellError::Ref);
}
