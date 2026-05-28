use super::support::{
    assert_cell_number, recalc_snapshot, single_sheet_table_with_outside_formulas,
};
use value_types::CellValue;

/// `SUMIF(Deals[Sponsor], "Alice", Deals[Amount])` should sum Amount where Sponsor="Alice".
/// This tests structured refs resolving to full column arrays.
#[test]
fn test_sumif_with_structured_ref_column() {
    let formulas = [
        (
            6,
            0,
            r#"SUMIF(Deals[Sponsor],"Alice",Deals[Amount])"#,
            400.0,
        ),
        (7, 0, r#"COUNTIF(Deals[Sponsor],"Alice")"#, 2.0),
        (
            8,
            0,
            r#"AVERAGEIF(Deals[Sponsor],"Alice",Deals[Amount])"#,
            200.0,
        ),
    ];
    let snapshot = single_sheet_table_with_outside_formulas(
        "Sheet1",
        "Deals",
        &["Sponsor", "Amount"],
        vec![
            vec![CellValue::Text("Alice".into()), CellValue::number(100.0)],
            vec![CellValue::Text("Bob".into()), CellValue::number(200.0)],
            vec![CellValue::Text("Alice".into()), CellValue::number(300.0)],
            vec![CellValue::Text("Carol".into()), CellValue::number(400.0)],
        ],
        formulas
            .iter()
            .map(|(row, col, formula, _)| (*row, *col, *formula))
            .collect(),
    );

    let result = recalc_snapshot(snapshot);
    for (row, col, _, expected) in formulas {
        assert_cell_number(&result, 0, row, col, expected);
    }
}
