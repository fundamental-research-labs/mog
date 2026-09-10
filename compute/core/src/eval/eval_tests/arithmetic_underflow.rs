//! Formula arithmetic boundaries for Office's non-denormal numeric domain.

use super::*;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};

fn unary(op: UnaryOp, value: f64) -> ASTNode {
    ASTNode::UnaryOp {
        op,
        operand: Box::new(ASTNode::Number(value)),
    }
}

#[test]
fn scalar_arithmetic_flushes_subnormal_results() {
    let (cell_store, sheet) = test_store();
    let context = make_ctx(&cell_store, sheet);
    let min_normal = f64::MIN_POSITIVE;
    let next_normal = f64::from_bits(min_normal.to_bits() + 1);

    let cases = [
        binop(
            BinOp::Add,
            ASTNode::Number(min_normal),
            ASTNode::Number(-next_normal),
        ),
        binop(
            BinOp::Sub,
            ASTNode::Number(min_normal),
            ASTNode::Number(next_normal),
        ),
        binop(
            BinOp::Mul,
            ASTNode::Number(min_normal),
            ASTNode::Number(0.5),
        ),
        binop(BinOp::Div, ASTNode::Number(1.0), ASTNode::Number(f64::MAX)),
        unary(UnaryOp::Percent, min_normal),
    ];

    for node in cases {
        assert_eq!(eval(&node, &context), CellValue::number(0.0));
    }

    assert_eq!(
        eval(
            &binop(
                BinOp::Add,
                ASTNode::Number(min_normal),
                ASTNode::Number(min_normal),
            ),
            &context,
        ),
        CellValue::number(min_normal * 2.0),
    );
}

#[test]
fn array_broadcast_flushes_each_subnormal_result_and_preserves_shape() {
    let (cell_store, sheet) = test_store();
    let context = make_ctx(&cell_store, sheet);
    let min_normal = f64::MIN_POSITIVE;
    let array = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(min_normal),
            ASTNode::Number(min_normal * 2.0),
        ]],
    };
    let result = eval(&binop(BinOp::Mul, array, ASTNode::Number(0.5)), &context);

    assert_eq!(
        result,
        CellValue::row_array(vec![CellValue::number(0.0), CellValue::number(min_normal)]),
    );
}

#[test]
fn function_and_operator_alias_results_use_the_same_boundary() {
    let (cell_store, sheet) = test_store();
    let context = make_ctx(&cell_store, sheet);
    let subnormal = f64::MIN_POSITIVE / 2.0;

    assert_eq!(
        eval(&func("ABS", vec![ASTNode::Number(subnormal)]), &context),
        CellValue::number(0.0),
    );
    assert_eq!(
        eval(
            &func(
                "DIVIDE",
                vec![ASTNode::Number(1.0), ASTNode::Number(subnormal)],
            ),
            &context,
        ),
        CellValue::Error(CellError::Div0, None),
    );
}

#[test]
fn arithmetic_overflow_remains_num_and_exact_boundary_is_preserved() {
    let (cell_store, sheet) = test_store();
    let context = make_ctx(&cell_store, sheet);

    assert_eq!(
        eval(
            &binop(BinOp::Mul, ASTNode::Number(f64::MAX), ASTNode::Number(2.0),),
            &context,
        ),
        CellValue::Error(CellError::Num, None),
    );
    assert_eq!(
        eval(
            &binop(
                BinOp::Mul,
                ASTNode::Number(f64::MIN_POSITIVE),
                ASTNode::Number(1.0),
            ),
            &context,
        ),
        CellValue::number(f64::MIN_POSITIVE),
    );
}

#[test]
fn aggregate_function_result_flushes_subnormal_without_changing_input_storage() {
    let (cell_store, sheet) = test_store();
    let context = make_ctx(&cell_store, sheet);
    let subnormal = f64::MIN_POSITIVE / 2.0;
    let values = ASTNode::Array {
        rows: vec![vec![ASTNode::Number(subnormal)]],
    };

    assert_eq!(
        eval(&func("SUM", vec![values]), &context),
        CellValue::number(0.0),
    );
}

#[test]
fn formula_result_boundary_covers_literals_references_let_lambda_and_arrays() {
    let subnormal = f64::MIN_POSITIVE / 2.0;
    let min_normal = f64::MIN_POSITIVE;
    let (cell_store, sheet) = {
        let snapshot = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                identities: vec![],
                row_axis: None,
                col_axis: None,
                id: TEST_SHEET_UUID.to_string(),
                name: "Sheet1".to_string(),
                rows: 1,
                cols: 1,
                cells: vec![CellData {
                    cell_id: cell_uuid(0, 0),
                    row: 0,
                    col: 0,
                    value: CellValue::number(subnormal),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                }],
                ranges: vec![],
            }],
            named_ranges: vec![],
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: 100,
            max_change: value_types::FiniteF64::must(0.001),
            calculation_settings: None,
            ..Default::default()
        };
        let cell_store = crate::cells::CellStore::from_snapshot(snapshot).unwrap();
        let sheet = cell_store.sheet_by_name("Sheet1").unwrap();
        (cell_store, sheet)
    };
    let context = make_ctx(&cell_store, sheet);

    // A raw literal is a formula result and is normalized at the evaluator
    // boundary, while the storage value below remains subnormal.
    assert_eq!(
        eval(&ASTNode::Number(subnormal), &context),
        CellValue::number(0.0)
    );
    assert_eq!(
        eval(
            &ASTNode::Array {
                rows: vec![vec![
                    ASTNode::Number(subnormal),
                    ASTNode::Number(min_normal),
                ]],
            },
            &context,
        ),
        CellValue::row_array(vec![CellValue::number(0.0), CellValue::number(min_normal)])
    );

    let let_node = func(
        "LET",
        vec![ident("x"), ASTNode::Number(subnormal), ident("x")],
    );
    assert_eq!(eval(&let_node, &context), CellValue::number(0.0));

    let lambda = func("LAMBDA", vec![ident("x"), ident("x")]);
    let lambda_call = ASTNode::CallExpression {
        callee: Box::new(ASTNode::Paren(Box::new(lambda))),
        args: vec![ASTNode::Number(subnormal)],
    };
    assert_eq!(eval(&lambda_call, &context), CellValue::number(0.0));

    let reference = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet,
            row: 0,
            col: 0,
        },
        abs_row: false,
        abs_col: false,
    });
    assert_eq!(eval(&reference, &context), CellValue::number(0.0));
    assert_eq!(
        cell_store
            .get_cell_value_at(&sheet, cell_types::SheetPos::new(0, 0))
            .cloned(),
        Some(CellValue::number(subnormal))
    );
}
