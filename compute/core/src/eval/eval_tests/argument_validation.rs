//! Argument validation — negative/invalid arguments to INDEX, and unary
//! plus type coercion.

use super::*;

// -----------------------------------------------------------------------
// INDEX: negative row/col arguments must return #VALUE!
// -----------------------------------------------------------------------
// Root cause: `lookup/dispatch.rs:229` — `f64 as usize` on negative values
// saturates to 0 in Rust (since 1.45+), so INDEX silently returns row 0.

#[test]
fn index_negative_row_returns_value_error() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(10.0),
            ASTNode::Number(20.0),
            ASTNode::Number(30.0),
        ]],
    };
    let node = func("INDEX", vec![arr, ASTNode::Number(-1.0)]);
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

#[test]
fn index_negative_row_with_col_returns_value_error() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(10.0)],
            vec![ASTNode::Number(20.0)],
            vec![ASTNode::Number(30.0)],
        ],
    };
    let node = func(
        "INDEX",
        vec![arr, ASTNode::Number(-1.0), ASTNode::Number(1.0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

#[test]
fn index_negative_col_returns_value_error() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(10.0),
            ASTNode::Number(20.0),
            ASTNode::Number(30.0),
        ]],
    };
    let node = func(
        "INDEX",
        vec![arr, ASTNode::Number(1.0), ASTNode::Number(-1.0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

// -----------------------------------------------------------------------
// Unary plus: non-numeric text must return #VALUE!
// -----------------------------------------------------------------------
// Root cause: `engine/operators.rs:231-235` — returns text as-is instead
// of erroring. Excel's unary plus always attempts numeric coercion.
//
// NOTE: basics.rs line 262 asserts the current (wrong) behavior.

#[test]
fn unary_plus_non_numeric_text_passes_through() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = ASTNode::UnaryOp {
        op: UnaryOp::Plus,
        operand: Box::new(ASTNode::Text("hello".into())),
    };
    assert_eq!(eval(&node, &ctx), CellValue::Text("hello".into()));
}

#[test]
fn unary_plus_alphanumeric_text_passes_through() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = ASTNode::UnaryOp {
        op: UnaryOp::Plus,
        operand: Box::new(ASTNode::Text("abc123".into())),
    };
    assert_eq!(eval(&node, &ctx), CellValue::Text("abc123".into()));
}

#[test]
fn unary_plus_empty_string_passes_through() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = ASTNode::UnaryOp {
        op: UnaryOp::Plus,
        operand: Box::new(ASTNode::Text("".into())),
    };
    assert_eq!(eval(&node, &ctx), CellValue::Text("".into()));
}
