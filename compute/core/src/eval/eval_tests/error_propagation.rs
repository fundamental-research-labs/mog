//! Error propagation through LET bindings and SCAN accumulator semantics.

use super::*;

// -----------------------------------------------------------------------
// LET: error-with-message in binding must propagate
// -----------------------------------------------------------------------
// Root cause: `special_forms.rs:51-54` — pattern match is Error(e, None)
// which misses Error(e, Some(msg)). Errors carrying a message leak into
// the lambda body instead of short-circuiting.

/// Baseline: LET("x", 1/0, x+1) — error without message propagates.
#[test]
fn let_error_propagation_none_message() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let div_by_zero = binop(BinOp::Div, ASTNode::Number(1.0), ASTNode::Number(0.0));
    let body = binop(BinOp::Add, ident("x"), ASTNode::Number(1.0));
    let node = func(
        "LET",
        vec![ASTNode::Identifier("x".into()), div_by_zero, body],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Div0, None));
}

/// Baseline: LET("x", #N/A, x+1) — error literal propagates.
#[test]
fn let_error_literal_propagation() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let body = binop(BinOp::Add, ident("x"), ASTNode::Number(1.0));
    let node = func(
        "LET",
        vec![
            ASTNode::Identifier("x".into()),
            ASTNode::Error(CellError::Na),
            body,
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Na, None));
}

/// LET("x", <cell-with-error+message>, x+1) — error WITH a message must
/// also propagate. This is the broken path.
#[test]
fn let_error_with_message_should_propagate() {
    use crate::mirror::CellMirror;
    use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};

    // Build mirror where cell (0,0) has Error(Div0, Some("division by zero"))
    let mut cells = Vec::new();
    for r in 0..5u32 {
        for c in 0..5u32 {
            let value = if r == 0 && c == 0 {
                CellValue::Error(CellError::Div0, Some("division by zero".into()))
            } else {
                CellValue::number((r * 10 + c) as f64)
            };
            cells.push(CellData {
                cell_id: cell_uuid(r, c),
                row: r,
                col: c,
                value,
                formula: None,
                identity_formula: None,
                array_ref: None,
            });
        }
    }
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: TEST_SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells,
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
    };
    let m = CellMirror::from_snapshot(snapshot).unwrap();
    let s = m.sheet_by_name("Sheet1").unwrap();
    let ctx = make_ctx(&m, s);

    // LET("x", A1, x + 1) where A1 = Error(Div0, Some("division by zero"))
    let a1_ref = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 0,
        },
        abs_row: false,
        abs_col: false,
    });
    let body = binop(BinOp::Add, ident("x"), ASTNode::Number(1.0));
    let node = func("LET", vec![ASTNode::Identifier("x".into()), a1_ref, body]);

    let result = eval(&node, &ctx);
    match &result {
        CellValue::Error(CellError::Div0, _) => {} // correct
        other => panic!(
            "LET did not propagate error-with-message from binding. \
             Expected #DIV/0!, got: {:?}. \
             Fix: special_forms.rs:51 — change Error(e, None) to Error(e, _).",
            other
        ),
    }
}

// -----------------------------------------------------------------------
// SCAN: mid-array errors must stay in the output array
// -----------------------------------------------------------------------
// Root cause: `higher_order.rs:243-246` — early returns scalar error
// instead of placing it at the array position and continuing.

/// Baseline: SCAN(0, {1,2,3}, LAMBDA(acc,x, acc+x)) → {1, 3, 6}
#[test]
fn scan_cumulative_sum() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let array = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(1.0),
            ASTNode::Number(2.0),
            ASTNode::Number(3.0),
        ]],
    };
    let lambda = func(
        "LAMBDA",
        vec![
            ASTNode::Identifier("acc".into()),
            ASTNode::Identifier("x".into()),
            binop(BinOp::Add, ident("acc"), ident("x")),
        ],
    );
    let node = func("SCAN", vec![ASTNode::Number(0.0), array, lambda]);
    let result = eval(&node, &ctx);
    assert_eq!(
        result,
        CellValue::array(
            vec![
                CellValue::number(1.0),
                CellValue::number(3.0),
                CellValue::number(6.0),
            ],
            3,
        ),
    );
}

/// SCAN(0, {1,0,3}, LAMBDA(acc,x, 1/x)) — div-by-zero at position 2.
/// Lambda body `1/x` doesn't reference `acc`, so the error at position 2
/// does NOT propagate to position 3 (1/3 = 0.333...).
/// Key assertion: error stays in the array (not returned as scalar).
#[test]
fn scan_error_mid_array_returns_array_not_scalar() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let array = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(1.0),
            ASTNode::Number(0.0),
            ASTNode::Number(3.0),
        ]],
    };
    let lambda = func(
        "LAMBDA",
        vec![
            ASTNode::Identifier("acc".into()),
            ASTNode::Identifier("x".into()),
            binop(BinOp::Div, ASTNode::Number(1.0), ident("x")),
        ],
    );
    let node = func("SCAN", vec![ASTNode::Number(0.0), array, lambda]);
    let result = eval(&node, &ctx);
    // Position 1: 1/1 = 1.0, Position 2: 1/0 = #DIV/0!, Position 3: 1/3 ≈ 0.333
    // (lambda doesn't use acc, so error at pos 2 doesn't propagate to pos 3)
    match &result {
        CellValue::Array(arr) => {
            assert_eq!(arr.cols(), 3);
            assert_eq!(arr.get(0, 0), Some(&CellValue::number(1.0)));
            assert!(matches!(
                arr.get(0, 1),
                Some(CellValue::Error(CellError::Div0, _))
            ));
            // Position 3: 1/3 — lambda doesn't reference accumulator
            assert_eq!(arr.get(0, 2), Some(&CellValue::number(1.0 / 3.0)));
        }
        other => panic!("Expected array, got: {:?}", other),
    }
}

/// SCAN(0, {2,0,0}, LAMBDA(acc,x, acc+1/x)) — error propagates through
/// accumulator. Excel: {0.5, #DIV/0!, #DIV/0!}
#[test]
fn scan_error_propagates_through_accumulator() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let array = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(2.0),
            ASTNode::Number(0.0),
            ASTNode::Number(0.0),
        ]],
    };
    let one_over_x = binop(BinOp::Div, ASTNode::Number(1.0), ident("x"));
    let lambda = func(
        "LAMBDA",
        vec![
            ASTNode::Identifier("acc".into()),
            ASTNode::Identifier("x".into()),
            binop(BinOp::Add, ident("acc"), one_over_x),
        ],
    );
    let node = func("SCAN", vec![ASTNode::Number(0.0), array, lambda]);
    let result = eval(&node, &ctx);
    let expected = CellValue::array(
        vec![
            CellValue::number(0.5),
            CellValue::Error(CellError::Div0, None),
            CellValue::Error(CellError::Div0, None),
        ],
        3,
    );
    assert_eq!(result, expected);
}
