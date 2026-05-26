//! Boundary conditions for PERCENTRANK (single-element array),
//! MAKEARRAY (invalid dimensions), and SUBTOTAL baselines.

use super::*;

// -----------------------------------------------------------------------
// PERCENTRANK: single-element array must return 0, not NaN
// -----------------------------------------------------------------------
// Root cause: `engine/eval_primitives.rs:987` — `pos / (n - 1)` where n=1
// divides by zero. Excel returns 0 for PERCENTRANK({x}, x).

#[test]
fn percentrank_single_element_returns_zero() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![vec![ASTNode::Number(5.0)]],
    };
    let node = func("PERCENTRANK", vec![arr, ASTNode::Number(5.0)]);
    assert_eq!(eval(&node, &ctx), CellValue::number(0.0));
}

#[test]
fn percentrank_inc_single_element_returns_zero() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![vec![ASTNode::Number(5.0)]],
    };
    let node = func("PERCENTRANK.INC", vec![arr, ASTNode::Number(5.0)]);
    assert_eq!(eval(&node, &ctx), CellValue::number(0.0));
}

#[test]
fn percentrank_single_element_with_significance() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![vec![ASTNode::Number(7.0)]],
    };
    let node = func(
        "PERCENTRANK",
        vec![arr, ASTNode::Number(7.0), ASTNode::Number(6.0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(0.0));
}

// -----------------------------------------------------------------------
// MAKEARRAY: zero/negative dimensions must return #VALUE!
// -----------------------------------------------------------------------
// Root cause: `engine/higher_order.rs:287-310` — no dimension validation.
// Negative f64 cast to usize wraps/saturates; zero dimensions produce
// nonsensical empty arrays.

#[test]
fn makearray_zero_rows_returns_value_error() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let lambda = func(
        "LAMBDA",
        vec![
            ident("r"),
            ident("c"),
            binop(BinOp::Add, ident("r"), ident("c")),
        ],
    );
    let node = func(
        "MAKEARRAY",
        vec![ASTNode::Number(0.0), ASTNode::Number(5.0), lambda],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

#[test]
fn makearray_negative_rows_returns_value_error() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let lambda = func(
        "LAMBDA",
        vec![
            ident("r"),
            ident("c"),
            binop(BinOp::Add, ident("r"), ident("c")),
        ],
    );
    let node = func(
        "MAKEARRAY",
        vec![ASTNode::Number(-1.0), ASTNode::Number(5.0), lambda],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

#[test]
fn makearray_negative_cols_returns_value_error() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let lambda = func(
        "LAMBDA",
        vec![
            ident("r"),
            ident("c"),
            binop(BinOp::Add, ident("r"), ident("c")),
        ],
    );
    let node = func(
        "MAKEARRAY",
        vec![ASTNode::Number(5.0), ASTNode::Number(-1.0), lambda],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

// -----------------------------------------------------------------------
// SUBTOTAL: baselines (should pass)
// -----------------------------------------------------------------------
// Bug F2 (_xlfn. prefix) operates on cell formula metadata, not the eval
// path, so it can't be directly triggered here. These verify baseline
// correctness.

#[test]
fn subtotal_sum() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(1.0),
            ASTNode::Number(2.0),
            ASTNode::Number(3.0),
            ASTNode::Number(4.0),
            ASTNode::Number(5.0),
        ]],
    };
    let node = func("SUBTOTAL", vec![ASTNode::Number(9.0), arr]);
    assert_eq!(eval(&node, &ctx), CellValue::number(15.0));
}

#[test]
fn subtotal_average() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(10.0),
            ASTNode::Number(20.0),
            ASTNode::Number(30.0),
        ]],
    };
    let node = func("SUBTOTAL", vec![ASTNode::Number(1.0), arr]);
    assert_eq!(eval(&node, &ctx), CellValue::number(20.0));
}
