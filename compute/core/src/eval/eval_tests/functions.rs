//! Function tests: NOT broadcasting, math/text, lookup basics, aggregation, IS*, array broadcasting.

use super::*;

fn cellref(sheet: SheetId, row: u32, col: u32) -> ASTNode {
    ASTNode::CellReference(CellRefNode {
        reference: CellRef::Positional { sheet, row, col },
        abs_row: false,
        abs_col: false,
    })
}

fn range(sheet: SheetId, sr: u32, sc: u32, er: u32, ec: u32) -> ASTNode {
    ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet,
            row: sr,
            col: sc,
        },
        end: CellRef::Positional {
            sheet,
            row: er,
            col: ec,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    })
}

// -----------------------------------------------------------------------
// NOT() array broadcasting
// -----------------------------------------------------------------------

#[test]
fn test_not_horizontal_array() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // NOT({TRUE,FALSE,TRUE}) → {FALSE,TRUE,FALSE}
    let arr = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Boolean(true),
            ASTNode::Boolean(false),
            ASTNode::Boolean(true),
        ]],
    };
    let result = eval(&func("NOT", vec![arr]), &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 3);
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::Boolean(false));
            assert_eq!(*arr.get(0, 1).unwrap(), CellValue::Boolean(true));
            assert_eq!(*arr.get(0, 2).unwrap(), CellValue::Boolean(false));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_not_vertical_array() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // NOT({TRUE;FALSE;TRUE}) → {FALSE;TRUE;FALSE}
    let arr = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Boolean(true)],
            vec![ASTNode::Boolean(false)],
            vec![ASTNode::Boolean(true)],
        ],
    };
    let result = eval(&func("NOT", vec![arr]), &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 3);
            assert_eq!(arr.cols(), 1);
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::Boolean(false));
            assert_eq!(*arr.get(1, 0).unwrap(), CellValue::Boolean(true));
            assert_eq!(*arr.get(2, 0).unwrap(), CellValue::Boolean(false));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_not_mixed_types_array() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // NOT({1,0,"text"}) → {FALSE,TRUE,#VALUE!}
    // 1 coerces to TRUE → NOT gives FALSE
    // 0 coerces to FALSE → NOT gives TRUE
    // "text" cannot coerce to bool → #VALUE!
    let arr = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(1.0),
            ASTNode::Number(0.0),
            ASTNode::Text("text".into()),
        ]],
    };
    let result = eval(&func("NOT", vec![arr]), &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 3);
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::Boolean(false));
            assert_eq!(*arr.get(0, 1).unwrap(), CellValue::Boolean(true));
            assert_eq!(
                *arr.get(0, 2).unwrap(),
                CellValue::Error(CellError::Value, None)
            );
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_abs_sqrt() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(&func("ABS", vec![ASTNode::Number(-7.0)]), &ctx),
        CellValue::number(7.0)
    );
    assert_eq!(
        eval(&func("SQRT", vec![ASTNode::Number(16.0)]), &ctx),
        CellValue::number(4.0)
    );
    assert_eq!(
        eval(&func("SQRT", vec![ASTNode::Number(-1.0)]), &ctx),
        CellValue::Error(CellError::Num, None)
    );
}

#[test]
fn test_len_upper_lower_trim() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(&func("LEN", vec![ASTNode::Text("hello".into())]), &ctx),
        CellValue::number(5.0)
    );
    assert_eq!(
        eval(&func("UPPER", vec![ASTNode::Text("hello".into())]), &ctx),
        CellValue::Text("HELLO".into())
    );
    assert_eq!(
        eval(&func("LOWER", vec![ASTNode::Text("HELLO".into())]), &ctx),
        CellValue::Text("hello".into())
    );
    assert_eq!(
        eval(&func("TRIM", vec![ASTNode::Text("  a  b  ".into())]), &ctx),
        CellValue::Text("a b".into())
    );
}

#[test]
fn test_left_right_mid() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(
            &func(
                "LEFT",
                vec![ASTNode::Text("hello".into()), ASTNode::Number(3.0)]
            ),
            &ctx
        ),
        CellValue::Text("hel".into())
    );
    assert_eq!(
        eval(
            &func(
                "RIGHT",
                vec![ASTNode::Text("hello".into()), ASTNode::Number(3.0)]
            ),
            &ctx
        ),
        CellValue::Text("llo".into())
    );
    assert_eq!(
        eval(
            &func(
                "MID",
                vec![
                    ASTNode::Text("hello".into()),
                    ASTNode::Number(2.0),
                    ASTNode::Number(3.0)
                ]
            ),
            &ctx
        ),
        CellValue::Text("ell".into())
    );
}

#[test]
fn test_vlookup_exact() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // Build a table array inline: {1,"a";2,"b";3,"c"}
    let table = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0), ASTNode::Text("a".into())],
            vec![ASTNode::Number(2.0), ASTNode::Text("b".into())],
            vec![ASTNode::Number(3.0), ASTNode::Text("c".into())],
        ],
    };
    let node = func(
        "VLOOKUP",
        vec![
            ASTNode::Number(2.0),
            table,
            ASTNode::Number(2.0),
            ASTNode::Boolean(false),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Text("b".into()));
}

#[test]
fn test_vlookup_not_found() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let table = ASTNode::Array {
        rows: vec![vec![ASTNode::Number(1.0), ASTNode::Text("a".into())]],
    };
    let node = func(
        "VLOOKUP",
        vec![
            ASTNode::Number(99.0),
            table,
            ASTNode::Number(2.0),
            ASTNode::Boolean(false),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Na, None));
}

#[test]
fn test_match_exact() {
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
        "MATCH",
        vec![ASTNode::Number(20.0), arr, ASTNode::Number(0.0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(2.0));
}

#[test]
fn test_index() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0), ASTNode::Number(2.0)],
            vec![ASTNode::Number(3.0), ASTNode::Number(4.0)],
        ],
    };
    let node = func(
        "INDEX",
        vec![arr, ASTNode::Number(2.0), ASTNode::Number(1.0)],
    );
    assert_eq!(eval(&node, &ctx), CellValue::number(3.0));
}

// -----------------------------------------------------------------------
// Nested function calls
// -----------------------------------------------------------------------

#[test]
fn test_nested_functions() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // IF(SUM(1,2) > 2, "big", "small")
    let sum = func("SUM", vec![ASTNode::Number(1.0), ASTNode::Number(2.0)]);
    let cond = binop(BinOp::Gt, sum, ASTNode::Number(2.0));
    let node = func(
        "IF",
        vec![
            cond,
            ASTNode::Text("big".into()),
            ASTNode::Text("small".into()),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Text("big".into()));
}

// -----------------------------------------------------------------------
// Array broadcasting
// -----------------------------------------------------------------------

#[test]
fn test_array_scalar_broadcast() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![
            vec![ASTNode::Number(1.0), ASTNode::Number(2.0)],
            vec![ASTNode::Number(3.0), ASTNode::Number(4.0)],
        ],
    };
    let result = eval(&binop(BinOp::Mul, arr, ASTNode::Number(10.0)), &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::number(10.0));
            assert_eq!(*arr.get(0, 1).unwrap(), CellValue::number(20.0));
            assert_eq!(*arr.get(1, 0).unwrap(), CellValue::number(30.0));
            assert_eq!(*arr.get(1, 1).unwrap(), CellValue::number(40.0));
        }
        _ => panic!("Expected Array"),
    }
}

#[test]
fn test_array_array_broadcast() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let a = ASTNode::Array {
        rows: vec![vec![ASTNode::Number(1.0), ASTNode::Number(2.0)]],
    };
    let b = ASTNode::Array {
        rows: vec![vec![ASTNode::Number(10.0), ASTNode::Number(20.0)]],
    };
    let result = eval(&binop(BinOp::Add, a, b), &ctx);
    match result {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(*arr.get(0, 0).unwrap(), CellValue::number(11.0));
            assert_eq!(*arr.get(0, 1).unwrap(), CellValue::number(22.0));
        }
        _ => panic!("Expected Array"),
    }
}

// -----------------------------------------------------------------------
// Safety limits
// -----------------------------------------------------------------------

#[test]
fn test_max_depth_exceeded() {
    // Run in a thread with a large stack to avoid real stack overflow
    // before our depth limit fires.
    let result = std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024) // 16 MB
        .spawn(|| {
            let (m, s) = test_mirror();
            let ctx = make_ctx(&m, s);
            // Build deeply nested parens past MAX_DEPTH (512)
            let mut node = ASTNode::Number(1.0);
            for _ in 0..600 {
                node = ASTNode::Paren(Box::new(node));
            }
            super::context::traits::sync_block_on(Evaluator::evaluate(&node, &ctx, &ctx))
        })
        .unwrap()
        .join()
        .unwrap();
    assert!(matches!(result, Err(ComputeError::DepthLimit)));
}

// -----------------------------------------------------------------------
// Unknown function
// -----------------------------------------------------------------------

#[test]
fn test_unknown_function() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(&func("DOESNOTEXIST", vec![]), &ctx),
        CellValue::Error(CellError::Name, None)
    );
}

// -----------------------------------------------------------------------
// Identifier / defined name
// -----------------------------------------------------------------------

#[test]
fn test_identifier_not_found() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(&ASTNode::Identifier("mystery".into()), &ctx),
        CellValue::Error(CellError::Name, None)
    );
}

// -----------------------------------------------------------------------
// UnresolvedSheetRef
// -----------------------------------------------------------------------

#[test]
fn test_unresolved_sheet_ref() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = ASTNode::UnresolvedSheetRef {
        sheet_name: "NoSheet".into(),
        inner: Box::new(ASTNode::Number(1.0)),
    };
    assert_eq!(eval(&node, &ctx), CellValue::Error(CellError::Ref, None));
}

// -----------------------------------------------------------------------
// Paren
// -----------------------------------------------------------------------

#[test]
fn test_paren() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = ASTNode::Paren(Box::new(ASTNode::Number(99.0)));
    assert_eq!(eval(&node, &ctx), CellValue::number(99.0));
}

// -----------------------------------------------------------------------
// MirrorContext integration
// -----------------------------------------------------------------------

#[test]
fn test_mirror_context_range_sum() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    // SUM(A1:A3) -> cells (0,0),(1,0),(2,0) -> 0+10+20 = 30
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
    assert_eq!(
        eval(&func("SUM", vec![range]), &ctx),
        CellValue::number(30.0)
    );
}

#[test]
fn test_mirror_context_row_col() {
    let (m, s) = test_mirror();
    // current cell is at (0,0), id=1000
    let ctx = make_ctx(&m, s);
    assert_eq!(eval(&func("ROW", vec![]), &ctx), CellValue::number(1.0));
    assert_eq!(eval(&func("COLUMN", vec![]), &ctx), CellValue::number(1.0));
}

// -----------------------------------------------------------------------
// COUNT, COUNTA, MIN, MAX
// -----------------------------------------------------------------------

#[test]
fn test_count_counta() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(1.0),
            ASTNode::Text("x".into()),
            ASTNode::Boolean(true),
        ]],
    };
    assert_eq!(
        eval(&func("COUNT", vec![arr.clone()]), &ctx),
        CellValue::number(1.0)
    );
    assert_eq!(
        eval(&func("COUNTA", vec![arr]), &ctx),
        CellValue::number(3.0)
    );
}

#[test]
fn test_min_max() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node_min = func(
        "MIN",
        vec![
            ASTNode::Number(5.0),
            ASTNode::Number(3.0),
            ASTNode::Number(9.0),
        ],
    );
    let node_max = func(
        "MAX",
        vec![
            ASTNode::Number(5.0),
            ASTNode::Number(3.0),
            ASTNode::Number(9.0),
        ],
    );
    assert_eq!(eval(&node_min, &ctx), CellValue::number(3.0));
    assert_eq!(eval(&node_max, &ctx), CellValue::number(9.0));
}

// -----------------------------------------------------------------------
// ROUND, MOD, POWER, INT
// -----------------------------------------------------------------------

#[test]
fn test_round() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(
            &func("ROUND", vec![ASTNode::Number(2.567), ASTNode::Number(2.0)]),
            &ctx
        ),
        CellValue::number(2.57)
    );
}

#[test]
fn test_mod_fn() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(
            &func("MOD", vec![ASTNode::Number(7.0), ASTNode::Number(3.0)]),
            &ctx
        ),
        CellValue::number(1.0)
    );
    assert_eq!(
        eval(
            &func("MOD", vec![ASTNode::Number(7.0), ASTNode::Number(0.0)]),
            &ctx
        ),
        CellValue::Error(CellError::Div0, None)
    );
}

#[test]
fn test_int_fn() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(&func("INT", vec![ASTNode::Number(7.9)]), &ctx),
        CellValue::number(7.0)
    );
}

// -----------------------------------------------------------------------
// IS functions
// -----------------------------------------------------------------------

#[test]
fn test_is_functions() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(
        eval(&func("ISERROR", vec![ASTNode::Error(CellError::Na)]), &ctx),
        CellValue::Boolean(true)
    );
    assert_eq!(
        eval(&func("ISERROR", vec![ASTNode::Number(1.0)]), &ctx),
        CellValue::Boolean(false)
    );
    assert_eq!(
        eval(&func("ISNA", vec![ASTNode::Error(CellError::Na)]), &ctx),
        CellValue::Boolean(true)
    );
    assert_eq!(
        eval(&func("ISNA", vec![ASTNode::Error(CellError::Value)]), &ctx),
        CellValue::Boolean(false)
    );
    assert_eq!(
        eval(&func("ISNUMBER", vec![ASTNode::Number(1.0)]), &ctx),
        CellValue::Boolean(true)
    );
    assert_eq!(
        eval(&func("ISTEXT", vec![ASTNode::Text("x".into())]), &ctx),
        CellValue::Boolean(true)
    );
}

// -----------------------------------------------------------------------
// TRUE, FALSE, NA, NOW, TODAY
// -----------------------------------------------------------------------

#[test]
fn test_constant_functions() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    assert_eq!(eval(&func("TRUE", vec![]), &ctx), CellValue::Boolean(true));
    assert_eq!(
        eval(&func("FALSE", vec![]), &ctx),
        CellValue::Boolean(false)
    );
    assert_eq!(
        eval(&func("NA", vec![]), &ctx),
        CellValue::Error(CellError::Na, None)
    );
    assert!(matches!(
        eval(&func("NOW", vec![]), &ctx),
        CellValue::Number(_)
    ));
    assert!(matches!(
        eval(&func("TODAY", vec![]), &ctx),
        CellValue::Number(_)
    ));
}

// -----------------------------------------------------------------------
// CONCATENATE
// -----------------------------------------------------------------------

#[test]
fn test_concatenate() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = func(
        "CONCATENATE",
        vec![
            ASTNode::Text("a".into()),
            ASTNode::Text("b".into()),
            ASTNode::Text("c".into()),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Text("abc".into()));
}

// -----------------------------------------------------------------------
// HLOOKUP
// -----------------------------------------------------------------------

#[test]
fn test_hlookup_exact() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let table = ASTNode::Array {
        rows: vec![
            vec![
                ASTNode::Number(1.0),
                ASTNode::Number(2.0),
                ASTNode::Number(3.0),
            ],
            vec![
                ASTNode::Text("a".into()),
                ASTNode::Text("b".into()),
                ASTNode::Text("c".into()),
            ],
        ],
    };
    let node = func(
        "HLOOKUP",
        vec![
            ASTNode::Number(2.0),
            table,
            ASTNode::Number(2.0),
            ASTNode::Boolean(false),
        ],
    );
    assert_eq!(eval(&node, &ctx), CellValue::Text("b".into()));
}

// -----------------------------------------------------------------------
// ROWS / COLUMNS
// -----------------------------------------------------------------------

#[test]
fn test_rows_columns() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![
            vec![
                ASTNode::Number(1.0),
                ASTNode::Number(2.0),
                ASTNode::Number(3.0),
            ],
            vec![
                ASTNode::Number(4.0),
                ASTNode::Number(5.0),
                ASTNode::Number(6.0),
            ],
        ],
    };
    assert_eq!(
        eval(&func("ROWS", vec![arr.clone()]), &ctx),
        CellValue::number(2.0)
    );
    assert_eq!(
        eval(&func("COLUMNS", vec![arr]), &ctx),
        CellValue::number(3.0)
    );
}

#[test]
fn test_areas_counts_reference_union_members() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);

    assert_eq!(
        eval(&func("AREAS", vec![cellref(s, 0, 0)]), &ctx),
        CellValue::number(1.0)
    );
    assert_eq!(
        eval(&func("AREAS", vec![range(s, 0, 0, 1, 1)]), &ctx),
        CellValue::number(1.0)
    );

    let union = ASTNode::Union {
        ranges: vec![cellref(s, 0, 0), cellref(s, 0, 1)],
    };
    assert_eq!(
        eval(&func("AREAS", vec![ASTNode::Paren(Box::new(union))]), &ctx),
        CellValue::number(2.0)
    );

    let nested_paren_union = ASTNode::Paren(Box::new(ASTNode::Paren(Box::new(ASTNode::Union {
        ranges: vec![cellref(s, 0, 0), cellref(s, 0, 1)],
    }))));
    assert_eq!(
        eval(&func("AREAS", vec![nested_paren_union]), &ctx),
        CellValue::number(2.0)
    );
}

#[test]
fn test_areas_counts_wrapped_nested_reference_unions() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);

    let wrapped_union = ASTNode::SheetRef {
        sheet: s,
        inner: Box::new(ASTNode::Paren(Box::new(ASTNode::Union {
            ranges: vec![
                range(s, 0, 0, 1, 0),
                ASTNode::UnresolvedSheetRef {
                    sheet_name: "Sheet1".into(),
                    inner: Box::new(ASTNode::Union {
                        ranges: vec![cellref(s, 0, 1), cellref(s, 0, 2)],
                    }),
                },
            ],
        }))),
    };

    assert_eq!(
        eval(&func("AREAS", vec![wrapped_union]), &ctx),
        CellValue::number(3.0)
    );
}

// -----------------------------------------------------------------------
// Array literal
// -----------------------------------------------------------------------

#[test]
fn test_array_literal() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let node = ASTNode::Array {
        rows: vec![vec![ASTNode::Number(1.0), ASTNode::Number(2.0)]],
    };
    match eval(&node, &ctx) {
        CellValue::Array(arr) => {
            assert_eq!(arr.rows(), 1);
            assert_eq!(arr.cols(), 2);
        }
        _ => panic!("Expected Array"),
    }
}

// -----------------------------------------------------------------------
// SUM with error in range propagates
// -----------------------------------------------------------------------

#[test]
fn test_sum_with_error() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![vec![
            ASTNode::Number(1.0),
            ASTNode::Error(CellError::Value),
            ASTNode::Number(3.0),
        ]],
    };
    assert_eq!(
        eval(&func("SUM", vec![arr]), &ctx),
        CellValue::Error(CellError::Value, None)
    );
}

// -----------------------------------------------------------------------
// AVERAGE with no numbers -> #DIV/0!
// -----------------------------------------------------------------------

#[test]
fn test_average_no_numbers() {
    let (m, s) = test_mirror();
    let ctx = make_ctx(&m, s);
    let arr = ASTNode::Array {
        rows: vec![vec![ASTNode::Text("a".into()), ASTNode::Text("b".into())]],
    };
    assert_eq!(
        eval(&func("AVERAGE", vec![arr]), &ctx),
        CellValue::Error(CellError::Div0, None)
    );
}
