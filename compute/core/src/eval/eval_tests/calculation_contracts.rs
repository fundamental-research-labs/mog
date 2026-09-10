//! Workbook-dependent formatting and exact ranking contracts through evaluator dispatch.

use super::*;

#[test]
fn rank_primitives_keep_distinct_tiny_numbers_and_exact_ties() {
    let (cell_store, sheet) = test_store();
    let context = make_ctx(&cell_store, sheet);
    let array = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(0.0),
            ASTNode::Number(1e-307),
            ASTNode::Number(1e-307),
            ASTNode::Number(5e-307),
            ASTNode::Number(1e-100),
        ]],
    };
    for (name, expected) in [("RANK", 3.0), ("RANK.EQ", 3.0), ("RANK.AVG", 3.5)] {
        assert_eq!(
            eval(
                &func(name, vec![ASTNode::Number(1e-307), array.clone()]),
                &context
            ),
            CellValue::number(expected),
            "{name}",
        );
        assert_eq!(
            eval(
                &func(name, vec![ASTNode::Number(2e-307), array.clone()]),
                &context
            ),
            CellValue::Error(CellError::Na, None),
            "{name} rejects a value absent from its reference",
        );
    }
}

#[test]
fn text_uses_workbook_date_system_for_scalars_and_broadcast_arrays() {
    let (mut cell_store, sheet) = test_store();
    for (date1904, first_date, second_date) in [
        (false, "1900-01-01", "1900-01-02"),
        (true, "1904-01-02", "1904-01-03"),
        (false, "1900-01-01", "1900-01-02"),
    ] {
        cell_store.date1904 = date1904;
        // Direct evaluator calls bypass the scheduler's epoch setup. A settings
        // change starts a new calculation epoch in the production engine.
        crate::eval::cache::subexpr_cache::clear();
        let context = make_ctx(&cell_store, sheet);
        let code = ASTNode::Text("yyyy-mm-dd".into());
        assert_eq!(
            eval(
                &func("TEXT", vec![ASTNode::Number(1.0), code.clone()]),
                &context
            ),
            CellValue::Text(first_date.into()),
        );
        assert_eq!(
            eval(
                &func(
                    "TEXT",
                    vec![
                        ASTNode::Array {
                            rows: vec![vec![ASTNode::Number(1.0), ASTNode::Number(2.0)]]
                        },
                        code
                    ]
                ),
                &context
            ),
            CellValue::from_rows(vec![vec![
                CellValue::Text(first_date.into()),
                CellValue::Text(second_date.into())
            ]]),
        );
        for (value, code, expected) in [(1.5, "[h]:mm", "36:00"), (1.5, "0.0", "1.5")] {
            assert_eq!(
                eval(
                    &func(
                        "TEXT",
                        vec![ASTNode::Number(value), ASTNode::Text(code.into())]
                    ),
                    &context
                ),
                CellValue::Text(expected.into())
            );
        }
    }
}
