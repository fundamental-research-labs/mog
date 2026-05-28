use crate::support::{
    assert_number, build_snapshot, investments_cells, investments_table,
    query_plus_investments_snapshot, recalc_snapshot,
};
use value_types::CellValue;

#[test]
fn test_xlookup_with_structured_table_ref() {
    let snapshot = build_snapshot(
        vec![
            ("Investments", 10, 10, investments_cells()),
            (
                "Query",
                10,
                10,
                vec![(
                    0,
                    0,
                    CellValue::Null,
                    Some(
                        "XLOOKUP(\"AcctA\"&\"Deal1\",Investments9[Account]&Investments9[Deal],Investments9[Base%],0)"
                            .to_string(),
                    ),
                )],
            ),
        ],
        vec![investments_table(0)],
    );

    let result = recalc_snapshot(snapshot);

    assert_number(
        &result,
        1,
        0,
        0,
        0.05,
        "XLOOKUP should resolve structured table columns and concatenated lookup arrays",
    );
}

#[test]
fn test_xlookup_cross_sheet_with_concat() {
    let snapshot = query_plus_investments_snapshot(vec![
        (4, 1, CellValue::Text("AcctA".into()), None),
        (4, 2, CellValue::Text("Deal1".into()), None),
        (
            4,
            3,
            CellValue::Null,
            Some(
                "XLOOKUP(B5&C5,Investments9[Account]&Investments9[Deal],Investments9[Base%],0)"
                    .to_string(),
            ),
        ),
    ]);

    let result = recalc_snapshot(snapshot);

    assert_number(
        &result,
        0,
        4,
        3,
        0.05,
        "cross-sheet XLOOKUP should preserve the Query!B5&Query!C5 table lookup pattern",
    );
}
