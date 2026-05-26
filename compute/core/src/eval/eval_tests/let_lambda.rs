//! SINGLE implicit intersection, LET, LAMBDA, and combined LET+LAMBDA tests.

use super::*;

// =======================================================================
// SINGLE function tests (implicit intersection operator)
// =======================================================================

#[test]
fn test_single_column_range() {
    // SINGLE(col 0, rows 0..4) with formula cell at row 2 → value at (2,0) = 20
    let (m, s) = test_mirror();
    let ctx = MirrorContext::new(&m, cell_id_at(2, 3), s);
    let range = ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 0,
        },
        end: CellRef::Positional {
            sheet: s,
            row: 4,
            col: 0,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    });
    let node = func("SINGLE", vec![range]);
    assert_eq!(eval(&node, &ctx), CellValue::number(20.0));
}

#[test]
fn test_single_row_range() {
    // SINGLE(row 0, cols 0..4) with formula cell at col 3 → value at (0,3) = 3
    let (m, s) = test_mirror();
    let ctx = MirrorContext::new(&m, cell_id_at(1, 3), s);
    let range = ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 0,
        },
        end: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 4,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    });
    let node = func("SINGLE", vec![range]);
    assert_eq!(eval(&node, &ctx), CellValue::number(3.0));
}

#[test]
fn test_single_single_cell() {
    // SINGLE on a single cell reference → just that value
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let cell_ref = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 3,
            col: 2,
        },
        abs_row: false,
        abs_col: false,
    });
    let node = func("SINGLE", vec![cell_ref]);
    assert_eq!(eval(&node, &ctx), CellValue::number(32.0));
}

#[test]
fn test_single_out_of_range() {
    // Formula cell at row 4, range covers rows 0..2 → #VALUE!
    let (m, s) = test_mirror();
    let ctx = MirrorContext::new(&m, cell_id_at(4, 0), s);
    let range = ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 0,
        },
        end: CellRef::Positional {
            sheet: s,
            row: 2,
            col: 0,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    });
    let node = func("SINGLE", vec![range]);
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

#[test]
fn test_single_multi_row_multi_col() {
    // Multi-row, multi-col range picks the both-axes-aligned cell, matching @.
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
            row: 4,
            col: 4,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    });
    let node = func("SINGLE", vec![range]);
    assert_eq!(eval(&node, &ctx), CellValue::number(0.0));
}

#[test]
fn test_single_wrong_arg_count() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Zero args → #VALUE!
    assert_eq!(
        eval(&func("SINGLE", vec![]), &ctx),
        CellValue::Error(CellError::Value, None)
    );
    // Two args → #VALUE!
    assert_eq!(
        eval(
            &func("SINGLE", vec![ASTNode::Number(1.0), ASTNode::Number(2.0)]),
            &ctx
        ),
        CellValue::Error(CellError::Value, None)
    );
}

#[test]
fn test_single_scalar_passthrough() {
    // SINGLE(42) → 42 (scalar pass-through)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func("SINGLE", vec![ASTNode::Number(42.0)]);
    assert_eq!(eval(&node, &ctx), CellValue::number(42.0));
}

#[test]
fn test_single_full_column_range() {
    // Full-column range (ColumnRange type): SINGLE(A:A) with formula at row 3
    let (m, s) = test_mirror();
    let ctx = MirrorContext::new(&m, cell_id_at(3, 2), s);
    let range = ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 0,
        },
        end: CellRef::Positional {
            sheet: s,
            row: u32::MAX,
            col: 0,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::ColumnRange,
    });
    let node = func("SINGLE", vec![range]);
    assert_eq!(eval(&node, &ctx), CellValue::number(30.0));
}

#[test]
fn test_single_full_row_range() {
    // Full-row range (RowRange type): SINGLE(1:1) with formula at col 4
    let (m, s) = test_mirror();
    let ctx = MirrorContext::new(&m, cell_id_at(2, 4), s);
    let range = ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet: s,
            row: 1,
            col: 0,
        },
        end: CellRef::Positional {
            sheet: s,
            row: 1,
            col: u32::MAX,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::RowRange,
    });
    let node = func("SINGLE", vec![range]);
    assert_eq!(eval(&node, &ctx), CellValue::number(14.0));
}

#[test]
fn test_single_range_in_same_row() {
    // Column range where formula cell is at the first row of the range
    let (m, s) = test_mirror();
    let ctx = MirrorContext::new(&m, cell_id_at(0, 2), s);
    let range = ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 1,
        },
        end: CellRef::Positional {
            sheet: s,
            row: 4,
            col: 1,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    });
    let node = func("SINGLE", vec![range]);
    // row 0, col 1 = 0*10+1 = 1
    assert_eq!(eval(&node, &ctx), CellValue::number(1.0));
}

// =======================================================================
// LET function tests
// =======================================================================

#[test]
fn test_let_basic() {
    // =LET(x, 10, x) -> 10
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func("LET", vec![ident("x"), ASTNode::Number(10.0), ident("x")]);
    assert_eq!(eval(&node, &ctx), CellValue::number(10.0));
}

#[test]
fn test_let_multi_binding() {
    // =LET(x, 10, y, 20, x+y) -> 30
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "LET",
        vec![
            ident("x"),
            ASTNode::Number(10.0),
            ident("y"),
            ASTNode::Number(20.0),
            binop(BinOp::Add, ident("x"), ident("y")),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(30.0));
}

#[test]
fn test_let_cascading_bindings() {
    // =LET(x, 5, y, x*2, y+1) -> 11
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "LET",
        vec![
            ident("x"),
            ASTNode::Number(5.0),
            ident("y"),
            binop(BinOp::Mul, ident("x"), ASTNode::Number(2.0)),
            binop(BinOp::Add, ident("y"), ASTNode::Number(1.0)),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(11.0));
}

#[test]
fn test_let_with_text() {
    // =LET(name, "hello", UPPER(name)) -> "HELLO"
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "LET",
        vec![
            ident("name"),
            ASTNode::Text("hello".into()),
            func("UPPER", vec![ident("name")]),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Text("HELLO".into()));
}

#[test]
fn test_let_wrong_arg_count_too_few() {
    // =LET(x, 10) -> #VALUE! (needs at least 3 args)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func("LET", vec![ident("x"), ASTNode::Number(10.0)]);
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

#[test]
fn test_let_wrong_arg_count_even() {
    // =LET(x, 10, y, 20) -> #VALUE! (even count, no final calculation)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "LET",
        vec![
            ident("x"),
            ASTNode::Number(10.0),
            ident("y"),
            ASTNode::Number(20.0),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

#[test]
fn test_let_non_identifier_name() {
    // =LET(10, 20, 30) -> #VALUE! (first arg is not an identifier)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "LET",
        vec![
            ASTNode::Number(10.0),
            ASTNode::Number(20.0),
            ASTNode::Number(30.0),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

#[test]
fn test_let_nested() {
    // =LET(x, 1, LET(y, 2, x+y)) -> 3
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let inner_let = func(
        "LET",
        vec![
            ident("y"),
            ASTNode::Number(2.0),
            binop(BinOp::Add, ident("x"), ident("y")),
        ],
    );
    let node = func("LET", vec![ident("x"), ASTNode::Number(1.0), inner_let]);
    assert_eq!(eval(&node, &ctx), CellValue::number(3.0));
}

#[test]
fn test_let_scope_isolation() {
    // Inner LET's y should not leak to outer scope
    // =LET(x, LET(y, 10, y), x+1) -> 11
    // And y should not be visible in the outer scope
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let inner_let = func("LET", vec![ident("y"), ASTNode::Number(10.0), ident("y")]);
    let node = func(
        "LET",
        vec![
            ident("x"),
            inner_let,
            binop(BinOp::Add, ident("x"), ASTNode::Number(1.0)),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(11.0));

    // And verify y is not accessible
    let node2 = func(
        "LET",
        vec![
            ident("x"),
            func("LET", vec![ident("y"), ASTNode::Number(10.0), ident("y")]),
            ident("y"), // y should not be visible here -> #NAME?
        ],
    );
    assert_eq!(eval(&node2, &ctx), CellValue::Error(CellError::Name, None));
}

#[test]
fn test_let_with_error_in_value() {
    // =LET(x, 1/0, x) -> #DIV/0!
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "LET",
        vec![
            ident("x"),
            binop(BinOp::Div, ASTNode::Number(1.0), ASTNode::Number(0.0)),
            ident("x"),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Div0, None));
}

// =======================================================================
// LAMBDA function tests
// =======================================================================

#[test]
fn test_lambda_basic_call() {
    // =(LAMBDA(x, x+1))(5) -> 6
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let lambda = func(
        "LAMBDA",
        vec![
            ident("x"),
            binop(BinOp::Add, ident("x"), ASTNode::Number(1.0)),
        ],
    );
    let node = ASTNode::CallExpression {
        callee: Box::new(ASTNode::Paren(Box::new(lambda))),
        args: vec![ASTNode::Number(5.0)],
    };
    assert_eq!(eval(&node, &ctx), CellValue::number(6.0));
}

#[test]
fn test_lambda_multi_param() {
    // =(LAMBDA(x, y, x*y))(3, 4) -> 12
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let lambda = func(
        "LAMBDA",
        vec![
            ident("x"),
            ident("y"),
            binop(BinOp::Mul, ident("x"), ident("y")),
        ],
    );
    let node = ASTNode::CallExpression {
        callee: Box::new(ASTNode::Paren(Box::new(lambda))),
        args: vec![ASTNode::Number(3.0), ASTNode::Number(4.0)],
    };
    assert_eq!(eval(&node, &ctx), CellValue::number(12.0));
}

#[test]
fn test_lambda_zero_params() {
    // =(LAMBDA(42))() -> 42
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let lambda = func("LAMBDA", vec![ASTNode::Number(42.0)]);
    let node = ASTNode::CallExpression {
        callee: Box::new(ASTNode::Paren(Box::new(lambda))),
        args: vec![],
    };
    assert_eq!(eval(&node, &ctx), CellValue::number(42.0));
}

#[test]
fn test_lambda_wrong_arg_count() {
    // =(LAMBDA(x, y, x+y))(1) -> #VALUE! (expected 2 args, got 1)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let lambda = func(
        "LAMBDA",
        vec![
            ident("x"),
            ident("y"),
            binop(BinOp::Add, ident("x"), ident("y")),
        ],
    );
    let node = ASTNode::CallExpression {
        callee: Box::new(ASTNode::Paren(Box::new(lambda))),
        args: vec![ASTNode::Number(1.0)],
    };
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

#[test]
fn test_lambda_no_args_error() {
    // =LAMBDA() -> #VALUE! (needs at least body)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func("LAMBDA", vec![]);
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

#[test]
fn test_lambda_non_identifier_param() {
    // =LAMBDA(10, 20) -> #VALUE! (first arg is not an identifier)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func("LAMBDA", vec![ASTNode::Number(10.0), ASTNode::Number(20.0)]);
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

#[test]
fn test_lambda_returns_lambda_value() {
    // =LAMBDA(x, x+1) — a bare lambda at the evaluator boundary collapses
    // to #CALC! because EvalValue::Lambda is internal-only and cannot escape.
    // (Lambda values are first-class inside the evaluator but converted at
    // the boundary by `into_cell_value()`.)
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "LAMBDA",
        vec![
            ident("x"),
            binop(BinOp::Add, ident("x"), ASTNode::Number(1.0)),
        ],
    );
    let result = eval(&node, &ctx);
    assert_eq!(result, CellValue::Error(CellError::Calc, None));
}

// =======================================================================
// LET + LAMBDA combined tests
// =======================================================================

#[test]
fn test_let_with_lambda() {
    // =LET(f, LAMBDA(x, x^2), f(5)) -> 25
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let lambda = func(
        "LAMBDA",
        vec![
            ident("x"),
            binop(BinOp::Pow, ident("x"), ASTNode::Number(2.0)),
        ],
    );
    let call_f = ASTNode::CallExpression {
        callee: Box::new(ident("f")),
        args: vec![ASTNode::Number(5.0)],
    };
    let node = func("LET", vec![ident("f"), lambda, call_f]);
    assert_eq!(eval(&node, &ctx), CellValue::number(25.0));
}

#[test]
fn test_let_with_lambda_multi_param() {
    // =LET(add, LAMBDA(a, b, a+b), add(10, 20)) -> 30
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let lambda = func(
        "LAMBDA",
        vec![
            ident("a"),
            ident("b"),
            binop(BinOp::Add, ident("a"), ident("b")),
        ],
    );
    let call_add = ASTNode::CallExpression {
        callee: Box::new(ident("add")),
        args: vec![ASTNode::Number(10.0), ASTNode::Number(20.0)],
    };
    let node = func("LET", vec![ident("add"), lambda, call_add]);
    assert_eq!(eval(&node, &ctx), CellValue::number(30.0));
}

#[test]
fn test_let_lambda_with_let_variable() {
    // =LET(base, 10, f, LAMBDA(x, x+base), f(5)) -> 15
    // Lambda body captures 'base' from LET scope
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let lambda = func(
        "LAMBDA",
        vec![ident("x"), binop(BinOp::Add, ident("x"), ident("base"))],
    );
    let call_f = ASTNode::CallExpression {
        callee: Box::new(ident("f")),
        args: vec![ASTNode::Number(5.0)],
    };
    let node = func(
        "LET",
        vec![
            ident("base"),
            ASTNode::Number(10.0),
            ident("f"),
            lambda,
            call_f,
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(15.0));
}

#[test]
fn test_lambda_scope_isolation() {
    // Lambda parameters should not leak to outer scope
    // =LET(f, LAMBDA(x, x+1), LET(r, f(10), x))
    // x should be #NAME? in the outer scope
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let lambda = func(
        "LAMBDA",
        vec![
            ident("x"),
            binop(BinOp::Add, ident("x"), ASTNode::Number(1.0)),
        ],
    );
    let call_f = ASTNode::CallExpression {
        callee: Box::new(ident("f")),
        args: vec![ASTNode::Number(10.0)],
    };
    let inner_let = func(
        "LET",
        vec![
            ident("r"),
            call_f,
            ident("x"), // x should not be visible here
        ],
    );
    let node = func("LET", vec![ident("f"), lambda, inner_let]);
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Name, None));
}

#[test]
fn test_calling_non_lambda() {
    // Calling a number should return #VALUE!
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = ASTNode::CallExpression {
        callee: Box::new(ASTNode::Paren(Box::new(ASTNode::Number(42.0)))),
        args: vec![ASTNode::Number(1.0)],
    };
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Value, None));
}

#[test]
fn test_calling_error_propagates() {
    // Calling an error should propagate
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = ASTNode::CallExpression {
        callee: Box::new(ASTNode::Paren(Box::new(ASTNode::Error(CellError::Na)))),
        args: vec![],
    };
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Na, None));
}

#[test]
fn test_let_with_function_calls_in_body() {
    // =LET(x, 10, y, 20, SUM(x, y)) -> 30
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "LET",
        vec![
            ident("x"),
            ASTNode::Number(10.0),
            ident("y"),
            ASTNode::Number(20.0),
            func("SUM", vec![ident("x"), ident("y")]),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(30.0));
}

#[test]
fn test_let_shadowing() {
    // Inner LET shadows outer variable
    // =LET(x, 10, LET(x, 20, x)) -> 20
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let inner = func("LET", vec![ident("x"), ASTNode::Number(20.0), ident("x")]);
    let node = func("LET", vec![ident("x"), ASTNode::Number(10.0), inner]);
    assert_eq!(eval(&node, &ctx), CellValue::number(20.0));
}

#[test]
fn test_let_shadowing_restores() {
    // After inner LET, outer value should be restored
    // We can't directly test this in a single expression since LET doesn't
    // have "and then" semantics, but we can test via SUM:
    // =LET(x, 10, SUM(LET(x, 20, x), x)) -> 20 + 10 = 30
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let inner = func("LET", vec![ident("x"), ASTNode::Number(20.0), ident("x")]);
    let node = func(
        "LET",
        vec![
            ident("x"),
            ASTNode::Number(10.0),
            func("SUM", vec![inner, ident("x")]),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(30.0));
}

#[test]
fn test_scope_depth_limit() {
    // Build deeply nested LETs to hit MAX_SCOPE_DEPTH (512).
    // Each LET nesting level adds ~2 eval_node depth increments plus one
    // scope push, so MAX_DEPTH (512) and MAX_SCOPE_DEPTH (512) both guard
    // against runaway recursion — whichever fires first stops evaluation.
    // Needs a large stack because eval_function's match dispatch has a big
    // stack frame in debug builds (~30KB per recursion level).
    let result = std::thread::Builder::new()
        .stack_size(64 * 1024 * 1024) // 64 MB
        .spawn(|| {
            let (m, s) = test_mirror();
            let ctx = make_ctx(&m, s);
            // Build 600 nested LETs (exceeds MAX_SCOPE_DEPTH of 512)
            let mut node = ident("x");
            for i in 0..600 {
                node = func("LET", vec![ident("x"), ASTNode::Number(i as f64), node]);
            }
            super::context::traits::sync_block_on(Evaluator::evaluate(&node, &ctx, &ctx))
        })
        .unwrap()
        .join()
        .unwrap();
    assert!(matches!(result, Err(ComputeError::DepthLimit)));
}

#[test]
fn test_lambda_with_expression_body() {
    // =(LAMBDA(x, y, IF(x>y, x, y)))(3, 7) -> 7
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let lambda = func(
        "LAMBDA",
        vec![
            ident("x"),
            ident("y"),
            func(
                "IF",
                vec![
                    binop(BinOp::Gt, ident("x"), ident("y")),
                    ident("x"),
                    ident("y"),
                ],
            ),
        ],
    );
    let node = ASTNode::CallExpression {
        callee: Box::new(ASTNode::Paren(Box::new(lambda))),
        args: vec![ASTNode::Number(3.0), ASTNode::Number(7.0)],
    };
    assert_eq!(eval(&node, &ctx), CellValue::number(7.0));
}

#[test]
fn test_lambda_error_in_arg_propagates() {
    // =(LAMBDA(x, x+1))(1/0) -> #DIV/0!
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let lambda = func(
        "LAMBDA",
        vec![
            ident("x"),
            binop(BinOp::Add, ident("x"), ASTNode::Number(1.0)),
        ],
    );
    let node = ASTNode::CallExpression {
        callee: Box::new(ASTNode::Paren(Box::new(lambda))),
        args: vec![binop(
            BinOp::Div,
            ASTNode::Number(1.0),
            ASTNode::Number(0.0),
        )],
    };
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Div0, None));
}

#[test]
fn test_let_variable_in_condition() {
    // =LET(threshold, 50, val, 75, IF(val>threshold, "pass", "fail")) -> "pass"
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "LET",
        vec![
            ident("threshold"),
            ASTNode::Number(50.0),
            ident("val"),
            ASTNode::Number(75.0),
            func(
                "IF",
                vec![
                    binop(BinOp::Gt, ident("val"), ident("threshold")),
                    ASTNode::Text("pass".into()),
                    ASTNode::Text("fail".into()),
                ],
            ),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Text("pass".into()));
}

#[test]
fn test_lambda_coerce_types() {
    // =(LAMBDA(x, x & " world"))("hello") -> "hello world"
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let lambda = func(
        "LAMBDA",
        vec![
            ident("x"),
            binop(BinOp::Concat, ident("x"), ASTNode::Text(" world".into())),
        ],
    );
    let node = ASTNode::CallExpression {
        callee: Box::new(ASTNode::Paren(Box::new(lambda))),
        args: vec![ASTNode::Text("hello".into())],
    };
    assert_eq!(eval(&node, &ctx), CellValue::Text("hello world".into()));
}

// =======================================================================
// LET/LAMBDA with cell-ref-like variable names
//
// Bug: the parser produces CellRef nodes for variable names like "t1"
// (column T, row 1). The evaluator's eval_let expects Identifier nodes
// at name positions → #VALUE!. And in body expressions, CellRef(T1)
// resolves to the cell, not the LET variable.
//
// Fix 2 (evaluator-level): eval_let should accept CellRef at name
// positions by converting to A1 text. CellRef evaluation should check
// the scope stack before resolving as a cell.
// =======================================================================

#[test]
fn test_let_cellref_name_position() {
    // =LET(t1, 5, t1+1) → should be 6
    // Currently: parser produces CellRef(T1) for "t1", eval_let rejects it
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Simulate what the parser currently produces: CellRef instead of Identifier
    let t1_ref = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 19,
        }, // T1
        abs_row: false,
        abs_col: false,
    });
    let t1_ref2 = t1_ref.clone();
    let node = func(
        "LET",
        vec![
            t1_ref,
            ASTNode::Number(5.0),
            binop(BinOp::Add, t1_ref2, ASTNode::Number(1.0)),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(6.0));
}

#[test]
fn test_let_cellref_body_resolution() {
    // Even if we fix eval_let to accept CellRef at name positions,
    // the body expression also has CellRef(T1) that needs to resolve
    // to the LET variable, not to the actual cell T1.
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let t1_ref = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 19,
        }, // T1
        abs_row: false,
        abs_col: false,
    });
    // Build: LET(Identifier("t1"), 5, CellRef(T1)+1)
    // The body uses CellRef(T1) which should resolve to LET var "t1"=5
    let node = func(
        "LET",
        vec![
            ident("t1"), // Name position: correctly an Identifier
            ASTNode::Number(5.0),
            binop(BinOp::Add, t1_ref, ASTNode::Number(1.0)),
        ],
    );
    // Currently: CellRef(T1) in body resolves to cell T1 (empty → 0), not var t1=5
    // Expected: 6 (t1=5, then 5+1=6)
    assert_eq!(eval(&node, &ctx), CellValue::number(6.0));
}

#[test]
fn test_lambda_cellref_param_resolution() {
    // =MAP({1,2,3}, LAMBDA(a1, a1*2)) — a1 is a parameter, not cell A1
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let a1_ref = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 0,
        }, // A1
        abs_row: false,
        abs_col: false,
    });
    // LAMBDA with CellRef(A1) as parameter name → should work as variable "a1"
    let lambda = func(
        "LAMBDA",
        vec![
            ident("a1"), // Parser might or might not fix this to Identifier
            binop(BinOp::Mul, a1_ref, ASTNode::Number(2.0)),
        ],
    );
    // Direct call: (LAMBDA(a1, CellRef(A1)*2))(5)
    let node = ASTNode::CallExpression {
        callee: Box::new(ASTNode::Paren(Box::new(lambda))),
        args: vec![ASTNode::Number(5.0)],
    };
    // Expected: 10 (a1=5, then 5*2=10)
    // Currently: CellRef(A1) resolves to cell A1 value (0 or some test data)
    assert_eq!(eval(&node, &ctx), CellValue::number(10.0));
}

#[test]
fn test_let_cellref_case_insensitive() {
    // Excel: =LET(t1, 5, T1+1) → 6 (case-insensitive)
    // The parser produces CellRef(T1) for both "t1" and "T1"
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let t1_ref = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 19,
        }, // T1
        abs_row: false,
        abs_col: false,
    });
    let node = func(
        "LET",
        vec![
            ident("t1"),
            ASTNode::Number(5.0),
            binop(BinOp::Add, t1_ref, ASTNode::Number(1.0)),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(6.0));
}

#[test]
fn test_let_nested_cellref_names() {
    // =LET(x1, 10, LET(y1, x1*2, y1+1)) → 21
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let x1_ref = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 23,
        }, // X1
        abs_row: false,
        abs_col: false,
    });
    let y1_ref = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional {
            sheet: s,
            row: 0,
            col: 24,
        }, // Y1
        abs_row: false,
        abs_col: false,
    });
    let inner_let = func(
        "LET",
        vec![
            ident("y1"),
            binop(BinOp::Mul, x1_ref, ASTNode::Number(2.0)),
            binop(BinOp::Add, y1_ref, ASTNode::Number(1.0)),
        ],
    );
    let node = func("LET", vec![ident("x1"), ASTNode::Number(10.0), inner_let]);
    assert_eq!(eval(&node, &ctx), CellValue::number(21.0));
}
