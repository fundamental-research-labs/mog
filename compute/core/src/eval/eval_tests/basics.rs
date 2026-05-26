//! Basic evaluation: literals, operators, errors, references, core functions.

use super::*;

// -----------------------------------------------------------------------
// Literal evaluation
// -----------------------------------------------------------------------

#[test]
fn test_number_literal() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(eval(&ASTNode::Number(42.5), &ctx), CellValue::number(42.5));
}

#[test]
fn test_text_literal() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(&ASTNode::Text("hello".into()), &ctx),
        CellValue::Text("hello".into())
    );
}

#[test]
fn test_boolean_literal() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(&ASTNode::Boolean(true), &ctx),
        CellValue::Boolean(true)
    );
}

#[test]
fn test_error_literal() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(&ASTNode::Error(CellError::Na), &ctx),
        CellValue::Error(CellError::Na, None)
    );
}

// -----------------------------------------------------------------------
// Arithmetic operations
// -----------------------------------------------------------------------

#[test]
fn test_add() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(
            &binop(BinOp::Add, ASTNode::Number(2.0), ASTNode::Number(3.0)),
            &ctx
        ),
        CellValue::number(5.0)
    );
}

#[test]
fn test_sub() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(
            &binop(BinOp::Sub, ASTNode::Number(10.0), ASTNode::Number(3.0)),
            &ctx
        ),
        CellValue::number(7.0)
    );
}

#[test]
fn test_mul() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(
            &binop(BinOp::Mul, ASTNode::Number(4.0), ASTNode::Number(5.0)),
            &ctx
        ),
        CellValue::number(20.0)
    );
}

#[test]
fn test_div() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(
            &binop(BinOp::Div, ASTNode::Number(10.0), ASTNode::Number(4.0)),
            &ctx
        ),
        CellValue::number(2.5)
    );
}

#[test]
fn test_div_by_zero() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(
            &binop(BinOp::Div, ASTNode::Number(1.0), ASTNode::Number(0.0)),
            &ctx
        ),
        CellValue::Error(CellError::Div0, None)
    );
}

#[test]
fn test_pow() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(
            &binop(BinOp::Pow, ASTNode::Number(2.0), ASTNode::Number(10.0)),
            &ctx
        ),
        CellValue::number(1024.0)
    );
}

// -----------------------------------------------------------------------
// String concatenation
// -----------------------------------------------------------------------

#[test]
fn test_concat() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(
            &binop(
                BinOp::Concat,
                ASTNode::Text("hello".into()),
                ASTNode::Text(" world".into())
            ),
            &ctx
        ),
        CellValue::Text("hello world".into())
    );
}

#[test]
fn test_concat_number() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(
            &binop(
                BinOp::Concat,
                ASTNode::Text("val:".into()),
                ASTNode::Number(42.0)
            ),
            &ctx
        ),
        CellValue::Text("val:42".into())
    );
}

// -----------------------------------------------------------------------
// Comparison operators
// -----------------------------------------------------------------------

#[test]
fn test_eq() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(
            &binop(BinOp::Eq, ASTNode::Number(5.0), ASTNode::Number(5.0)),
            &ctx
        ),
        CellValue::Boolean(true)
    );
    assert_eq!(
        eval(
            &binop(BinOp::Eq, ASTNode::Number(5.0), ASTNode::Number(6.0)),
            &ctx
        ),
        CellValue::Boolean(false)
    );
}

#[test]
fn test_lt_gt() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(
            &binop(BinOp::Lt, ASTNode::Number(3.0), ASTNode::Number(5.0)),
            &ctx
        ),
        CellValue::Boolean(true)
    );
    assert_eq!(
        eval(
            &binop(BinOp::Gt, ASTNode::Number(3.0), ASTNode::Number(5.0)),
            &ctx
        ),
        CellValue::Boolean(false)
    );
}

#[test]
fn test_mixed_type_comparison() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Number < Text in Excel ordering
    assert_eq!(
        eval(
            &binop(BinOp::Lt, ASTNode::Number(999.0), ASTNode::Text("a".into())),
            &ctx
        ),
        CellValue::Boolean(true)
    );
}

// -----------------------------------------------------------------------
// Unary operators
// -----------------------------------------------------------------------

#[test]
fn test_unary_minus() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = ASTNode::UnaryOp {
        op: UnaryOp::Minus,
        operand: Box::new(ASTNode::Number(5.0)),
    };
    assert_eq!(eval(&node, &ctx), CellValue::number(-5.0));
}

#[test]
fn test_unary_plus() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Unary plus coerces to number (Excel semantics): +TRUE → 1
    let node = ASTNode::UnaryOp {
        op: UnaryOp::Plus,
        operand: Box::new(ASTNode::Boolean(true)),
    };
    assert_eq!(eval(&node, &ctx), CellValue::number(1.0));
    // +5 → 5
    let node2 = ASTNode::UnaryOp {
        op: UnaryOp::Plus,
        operand: Box::new(ASTNode::Number(5.0)),
    };
    assert_eq!(eval(&node2, &ctx), CellValue::number(5.0));
    // +FALSE → 0
    let node3 = ASTNode::UnaryOp {
        op: UnaryOp::Plus,
        operand: Box::new(ASTNode::Boolean(false)),
    };
    assert_eq!(eval(&node3, &ctx), CellValue::number(0.0));
    // +"hello" → "hello" (non-numeric text passes through, Excel Lotus-compat behavior)
    let node4 = ASTNode::UnaryOp {
        op: UnaryOp::Plus,
        operand: Box::new(ASTNode::Text("hello".into())),
    };
    assert_eq!(eval(&node4, &ctx), CellValue::Text("hello".into()));
    // +"2019" → 2019 (numeric text coerces to number)
    let node5 = ASTNode::UnaryOp {
        op: UnaryOp::Plus,
        operand: Box::new(ASTNode::Text("2019".into())),
    };
    assert_eq!(eval(&node5, &ctx), CellValue::number(2019.0));
}

#[test]
fn test_unary_percent() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = ASTNode::UnaryOp {
        op: UnaryOp::Percent,
        operand: Box::new(ASTNode::Number(50.0)),
    };
    assert_eq!(eval(&node, &ctx), CellValue::number(0.5));
}

// -----------------------------------------------------------------------
// Error propagation
// -----------------------------------------------------------------------

#[test]
fn test_error_propagation_binary() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(
            &binop(
                BinOp::Add,
                ASTNode::Error(CellError::Div0),
                ASTNode::Number(1.0)
            ),
            &ctx
        ),
        CellValue::Error(CellError::Div0, None)
    );
}

#[test]
fn test_error_propagation_unary() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = ASTNode::UnaryOp {
        op: UnaryOp::Minus,
        operand: Box::new(ASTNode::Error(CellError::Na)),
    };
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Na, None));
}

// -----------------------------------------------------------------------
// Null coercion
// -----------------------------------------------------------------------

#[test]
fn test_null_in_arithmetic() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Null -> 0 in arithmetic
    let ref_node = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 99,
            col: 99,
        }, // empty cell
        abs_row: false,
        abs_col: false,
    });
    let result = eval(&binop(BinOp::Add, ref_node, ASTNode::Number(5.0)), &ctx);
    assert_eq!(result, CellValue::number(5.0));
}

// -----------------------------------------------------------------------
// Cell reference resolution
// -----------------------------------------------------------------------

#[test]
fn test_cell_ref_resolved() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Cell at (0,0) has value 0.0
    let node = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Resolved(cell_id_at(0, 0)),
        abs_row: false,
        abs_col: false,
    });
    assert_eq!(eval(&node, &ctx), CellValue::number(0.0));
}

#[test]
fn test_cell_ref_positional() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Cell at (2,3) has value 23.0
    let node = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 2,
            col: 3,
        },
        abs_row: false,
        abs_col: false,
    });
    assert_eq!(eval(&node, &ctx), CellValue::number(23.0));
}

// -----------------------------------------------------------------------
// Range evaluation
// -----------------------------------------------------------------------

#[test]
fn test_range() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 0,
        },
        end: CellRef::Positional {
            sheet: s,
            row: 1,
            col: 1,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    });
    let result = eval(&node, &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 2);
            assert_eq!(arr.cols(), 2);
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::number(0.0));
            assert_eq!(*arr.get(0, 1).unwrap(), CellValue::number(1.0));
            assert_eq!(*arr.get(1, 0).unwrap(), CellValue::number(10.0));
            assert_eq!(*arr.get(1, 1).unwrap(), CellValue::number(11.0));
        }
        _ => panic!("Expected Array"),
    }
}

// -----------------------------------------------------------------------
// Core function evaluation
// -----------------------------------------------------------------------

#[test]
fn test_sum() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let range = ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 0,
        },
        end: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 2,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    });
    // SUM of row 0, cols 0-2: 0 + 1 + 2 = 3
    assert_eq!(
        eval(&func("SUM", vec![range]), &ctx),
        CellValue::number(3.0)
    );
}

#[test]
fn test_average() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(
            &func(
                "AVERAGE",
                vec![ASTNode::Number(10.0), ASTNode::Number(20.0)]
            ),
            &ctx
        ),
        CellValue::number(15.0)
    );
}

#[test]
fn test_if_true() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "IF",
        vec![
            ASTNode::Boolean(true),
            ASTNode::Text("yes".into()),
            ASTNode::Text("no".into()),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Text("yes".into()));
}

#[test]
fn test_if_false() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "IF",
        vec![
            ASTNode::Boolean(false),
            ASTNode::Text("yes".into()),
            ASTNode::Text("no".into()),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Text("no".into()));
}

#[test]
fn test_iferror() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "IFERROR",
        vec![
            binop(BinOp::Div, ASTNode::Number(1.0), ASTNode::Number(0.0)),
            ASTNode::Number(0.0),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(0.0));
}

#[test]
fn test_and_or_not() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(
            &func("AND", vec![ASTNode::Boolean(true), ASTNode::Boolean(false)]),
            &ctx
        ),
        CellValue::Boolean(false)
    );
    assert_eq!(
        eval(
            &func("OR", vec![ASTNode::Boolean(false), ASTNode::Boolean(true)]),
            &ctx
        ),
        CellValue::Boolean(true)
    );
    assert_eq!(
        eval(&func("NOT", vec![ASTNode::Boolean(true)]), &ctx),
        CellValue::Boolean(false)
    );
    assert_eq!(
        eval(&func("NOT", vec![ASTNode::Boolean(false)]), &ctx),
        CellValue::Boolean(true)
    );
}
