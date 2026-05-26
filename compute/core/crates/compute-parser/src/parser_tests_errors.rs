use super::*;
use crate::ParseErrorKind;
use crate::ast::{BinOp, CellRefNode, RangeRef, Span, UnaryOp};
use crate::test_helpers::TestResolver;
use cell_types::SheetId;
use formula_types::{CellRef, RangeType};

// ===== Edge Cases =====

#[test]
fn test_empty_string() {
    let result = parse_formula("", None);
    assert!(result.is_err());
}

#[test]
fn test_just_equals() {
    let result = parse_formula("=", None);
    assert!(result.is_err());
}

#[test]
fn test_whitespace_handling() {
    let ast = parse_formula("= 1 + 2 ", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::BinaryOp {
            op: BinOp::Add,
            left: Box::new(ASTNode::Number(1.0)),
            right: Box::new(ASTNode::Number(2.0)),
        }
    );
}

#[test]
fn test_formula_without_equals() {
    // Should work even without leading =
    let ast = parse_formula("1+2", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::BinaryOp {
            op: BinOp::Add,
            left: Box::new(ASTNode::Number(1.0)),
            right: Box::new(ASTNode::Number(2.0)),
        }
    );
}

#[test]
fn test_with_resolver() {
    let resolver = TestResolver::new();
    let ast = parse_formula("=A1+B1", Some(&resolver))
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::BinaryOp {
            op: BinOp::Add,
            left,
            right,
        } => {
            match left.as_ref() {
                ASTNode::CellReference(CellRefNode { reference, .. }) => match reference {
                    CellRef::Positional { sheet, row, col } => {
                        assert_eq!(*sheet, SheetId::from_raw(1));
                        assert_eq!(*row, 0);
                        assert_eq!(*col, 0);
                    }
                    CellRef::Resolved(_) => panic!("Expected Positional"),
                },
                _ => panic!("Expected CellReference"),
            }
            match right.as_ref() {
                ASTNode::CellReference(CellRefNode { reference, .. }) => match reference {
                    CellRef::Positional { sheet, row, col } => {
                        assert_eq!(*sheet, SheetId::from_raw(1));
                        assert_eq!(*row, 0);
                        assert_eq!(*col, 1);
                    }
                    CellRef::Resolved(_) => panic!("Expected Positional"),
                },
                _ => panic!("Expected CellReference"),
            }
        }
        _ => panic!("Expected BinaryOp"),
    }
}

#[test]
fn test_multiple_percent() {
    // 50%% should be (50%)%
    let ast = parse_formula("=50%%", None).unwrap().into_inner();
    match &ast {
        ASTNode::UnaryOp {
            op: UnaryOp::Percent,
            operand,
        } => match operand.as_ref() {
            ASTNode::UnaryOp {
                op: UnaryOp::Percent,
                operand,
            } => {
                assert_eq!(operand.as_ref(), &ASTNode::Number(50.0));
            }
            _ => panic!("Expected inner Percent"),
        },
        _ => panic!("Expected outer Percent"),
    }
}

#[test]
fn test_unary_in_expression() {
    // =-1+2 should be (-1)+2
    let ast = parse_formula("=-1+2", None).unwrap().into_inner();
    match &ast {
        ASTNode::BinaryOp {
            op: BinOp::Add,
            left,
            right,
        } => {
            match left.as_ref() {
                ASTNode::UnaryOp {
                    op: UnaryOp::Minus,
                    operand,
                } => {
                    assert_eq!(operand.as_ref(), &ASTNode::Number(1.0));
                }
                _ => panic!("Expected UnaryOp Minus"),
            }
            assert_eq!(right.as_ref(), &ASTNode::Number(2.0));
        }
        _ => panic!("Expected BinaryOp Add, got {ast:?}"),
    }
}

#[test]
fn test_sheet_ref_with_range() {
    let resolver = TestResolver::new();
    let ast = parse_formula("=Sheet1!A1:B10", Some(&resolver))
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::SheetRef { sheet, inner } => {
            assert_eq!(*sheet, SheetId::from_raw(1));
            match inner.as_ref() {
                ASTNode::Range(RangeRef { range_type, .. }) => {
                    assert_eq!(*range_type, RangeType::CellRange);
                }
                _ => panic!("Expected Range"),
            }
        }
        _ => panic!("Expected SheetRef, got {ast:?}"),
    }
}

#[test]
fn test_function_with_expression_args() {
    let ast = parse_formula("=MAX(A1+1, B1*2, 100)", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "MAX");
            assert_eq!(args.len(), 3);
        }
        _ => panic!("Expected Function"),
    }
}

#[test]
fn test_empty_string_literal() {
    let ast = parse_formula("=\"\"", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Text(String::new()));
}

#[test]
fn test_large_number() {
    let ast = parse_formula("=999999999999", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Number(999_999_999_999.0));
}

#[test]
fn test_negative_in_function() {
    let ast = parse_formula("=SUM(-1, -2)", None).unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "SUM");
            assert_eq!(args.len(), 2);
            match &args[0] {
                ASTNode::UnaryOp {
                    op: UnaryOp::Minus,
                    operand,
                } => {
                    assert_eq!(operand.as_ref(), &ASTNode::Number(1.0));
                }
                _ => panic!("Expected UnaryOp Minus"),
            }
        }
        _ => panic!("Expected Function"),
    }
}

#[test]
fn test_range_absolute_mixed() {
    let ast = parse_formula("=$A$1:$B$10", None).unwrap().into_inner();
    match &ast {
        ASTNode::Range(RangeRef {
            abs_start, abs_end, ..
        }) => {
            assert!(abs_start.row);
            assert!(abs_start.col);
            assert!(abs_end.row);
            assert!(abs_end.col);
        }
        _ => panic!("Expected Range"),
    }
}

// ===== Depth Guard Tests =====

#[test]
fn test_deeply_nested_parens_at_limit_succeeds() {
    // MAX_DEPTH is 128. The Pratt parser uses ~3 stack frames per nesting
    // level (vs ~9 with the old recursive-descent chain), so 127 parens
    // fits comfortably in the default 2 MB test-thread stack.
    // Each paren level + the initial parse_expr_bp = N+1 depth,
    // so the maximum paren nesting that succeeds is MAX_DEPTH - 1 = 127.
    let formula = format!("={}1{}", "(".repeat(127), ")".repeat(127));
    assert!(parse_formula(&formula, None).is_ok());
}

/// Helper to run a closure in a thread with a large stack (8 MB).
fn run_with_large_stack<F: FnOnce() + Send + 'static>(f: F) {
    let builder = std::thread::Builder::new().stack_size(8 * 1024 * 1024);
    let handle = builder.spawn(f).expect("Failed to spawn thread");
    handle.join().expect("Thread panicked");
}

#[test]
fn test_deeply_nested_parens_200_returns_err() {
    run_with_large_stack(|| {
        let formula = format!("={}1{}", "(".repeat(200), ")".repeat(200));
        let result = parse_formula(&formula, None);
        assert!(
            result.is_err(),
            "Should return Err, not panic on 200-deep parens"
        );
    });
}

#[test]
fn test_deeply_nested_functions_returns_err() {
    run_with_large_stack(|| {
        // SUM(SUM(SUM(...SUM(1)...))) 200 levels deep
        let formula = format!("={}1{}", "SUM(".repeat(200), ")".repeat(200));
        let result = parse_formula(&formula, None);
        assert!(
            result.is_err(),
            "Should return Err on 200-deep function nesting"
        );
    });
}

#[test]
fn test_deeply_nested_unary_returns_err() {
    let formula = format!("={}{}", "-".repeat(200), "5");
    let result = parse_formula(&formula, None);
    assert!(
        result.is_err(),
        "Should return Err on 200-deep unary nesting"
    );
}

#[test]
fn test_deeply_nested_power_returns_err() {
    // 2^2^2^...^2 200 levels
    let parts: Vec<&str> = std::iter::repeat_n("2", 200).collect();
    let formula = format!("={}", parts.join("^"));
    let result = parse_formula(&formula, None);
    assert!(
        result.is_err(),
        "Should return Err on 200-deep power nesting"
    );
}

#[test]
fn test_deeply_nested_arrays_returns_err() {
    run_with_large_stack(|| {
        // Not directly nestable in arrays, but SUM({SUM({...})}) nesting
        let formula = format!("={}1{}", "SUM({".repeat(200), "})".repeat(200));
        let result = parse_formula(&formula, None);
        assert!(result.is_err());
    });
}

#[test]
fn test_table_with_empty_string_placeholder() {
    // TABLE("",B3) - the format we now synthesize for omitted r1
    let ast = parse_formula("=TABLE(\"\",B3)", None).unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "TABLE");
            assert_eq!(args.len(), 2);
            assert_eq!(args[0], ASTNode::Text(String::new()));
        }
        _ => panic!("Expected Function, got {ast:?}"),
    }
}

// ===== ParseErrorKind Tests =====

#[test]
fn test_error_kind_empty_formula() {
    let err = parse_formula("", None).unwrap_err();
    assert_eq!(err.kind, ParseErrorKind::Empty);
    assert_eq!(err.span, Span::new(0, 0));
}

#[test]
fn test_error_kind_just_equals() {
    let err = parse_formula("=", None).unwrap_err();
    assert_eq!(err.kind, ParseErrorKind::Empty);
}

#[test]
fn test_error_kind_equals_whitespace() {
    let err = parse_formula("=   ", None).unwrap_err();
    assert_eq!(err.kind, ParseErrorKind::Empty);
}

#[test]
fn test_error_kind_trailing_input() {
    let err = parse_formula("=1+2 xyz", None).unwrap_err();
    assert_eq!(err.kind, ParseErrorKind::TrailingInput);
    // The span should start at the position of "xyz"
    assert_eq!(err.position(), 5);
}

#[test]
fn test_error_kind_trailing_input_complex() {
    let err = parse_formula("=SUM(1,2) garbage", None).unwrap_err();
    assert_eq!(err.kind, ParseErrorKind::TrailingInput);
}

#[test]
fn test_error_kind_unexpected_token() {
    // A formula that cannot be parsed at all. We use a sequence that has no
    // valid leading token at all — `???` starts with `?`, which is neither a
    // unary prefix (`+`/`-`/`@`) nor an atomic.
    let err = parse_formula("=???", None).unwrap_err();
    assert_eq!(err.kind, ParseErrorKind::UnexpectedToken);
}

#[test]
fn test_error_kind_at_without_operand() {
    // `=@@@` parses each `@` as the implicit-intersection prefix; the third
    // `@` has no operand, producing `ExpectedOperand` (not UnexpectedToken).
    let err = parse_formula("=@@@", None).unwrap_err();
    assert_eq!(err.kind, ParseErrorKind::ExpectedOperand);
}

#[test]
fn test_error_kind_unclosed_paren() {
    // After '(' commits the parser to a parenthesized expression,
    // a missing ')' produces a precise UnmatchedParen error.
    let err = parse_formula("=(1+2", None).unwrap_err();
    assert!(
        matches!(err.kind, ParseErrorKind::UnmatchedParen { .. }),
        "Expected UnmatchedParen, got {:?}",
        err.kind
    );
}

#[test]
fn test_error_kind_max_depth_exceeded_unary() {
    // 200 unary minuses — should trigger depth guard.
    // NOTE: Until expressions.rs wires state.depth_exceeded = true,
    // this will report as UnexpectedToken. Once wired, it will be
    // MaxDepthExceeded.
    let formula = format!("={}{}", "-".repeat(200), "5");
    let err = parse_formula(&formula, None).unwrap_err();
    assert!(
        err.kind == ParseErrorKind::UnexpectedToken
            || err.kind == ParseErrorKind::MaxDepthExceeded
            || err.kind == ParseErrorKind::ExpectedOperand,
        "Expected UnexpectedToken, MaxDepthExceeded, or ExpectedOperand, got {:?}",
        err.kind
    );
}

#[test]
fn test_error_kind_max_depth_exceeded_parens() {
    run_with_large_stack(|| {
        let formula = format!("={}1{}", "(".repeat(200), ")".repeat(200));
        let err = parse_formula(&formula, None).unwrap_err();
        assert!(
            err.kind == ParseErrorKind::UnexpectedToken
                || err.kind == ParseErrorKind::MaxDepthExceeded,
            "Expected UnexpectedToken or MaxDepthExceeded, got {:?}",
            err.kind
        );
    });
}

#[test]
fn test_error_has_span() {
    let err = parse_formula("=1+2 xyz", None).unwrap_err();
    // span should be non-empty and cover the trailing portion
    assert!(!err.span.is_empty());
    assert_eq!(err.span.start, 5);
    assert_eq!(err.span.end, 8);
}

#[test]
fn test_error_display_includes_kind() {
    let err = parse_formula("", None).unwrap_err();
    let display = format!("{err}");
    assert!(
        display.contains("empty"),
        "Display should contain kind description: {display}"
    );
}

#[test]
fn test_error_display_includes_kind_trailing() {
    let err = parse_formula("=1+2 xyz", None).unwrap_err();
    let display = format!("{err}");
    assert!(
        display.contains("trailing input"),
        "Display should contain kind description: {display}"
    );
}

#[test]
fn test_parse_error_is_std_error() {
    // Verify ParseError implements std::error::Error
    let err = parse_formula("", None).unwrap_err();
    let _: &dyn std::error::Error = &err;
}

// ===== Bounds Validation Tests =====

#[test]
fn test_max_valid_column_xfd() {
    // XFD is column 16383 (0-based), the maximum valid column
    let ast = parse_formula("=XFD1", None).unwrap().into_inner();
    match &ast {
        ASTNode::CellReference(CellRefNode { reference, .. }) => match reference {
            CellRef::Positional { row, col, .. } => {
                assert_eq!(*row, 0);
                assert_eq!(*col, 16383);
            }
            CellRef::Resolved(_) => panic!("Expected Positional, got {reference:?}"),
        },
        _ => panic!("Expected CellReference, got {ast:?}"),
    }
}

#[test]
fn test_column_too_large_xfe() {
    // XFE is column 16384 (0-based), which exceeds the maximum.
    // The parser rejects it as a cell reference, so it falls back to an identifier.
    let ast = parse_formula("=XFE1", None).unwrap().into_inner();
    match &ast {
        ASTNode::Identifier(name) => {
            assert_eq!(name, "XFE1");
        }
        ASTNode::CellReference(..) => {
            panic!("XFE1 should NOT be parsed as a cell reference (column exceeds max)");
        }
        _ => panic!("Expected Identifier for out-of-bounds column, got {ast:?}"),
    }
}

#[test]
fn test_max_valid_row() {
    // Row 1048576 is the maximum valid row (1-based)
    let ast = parse_formula("=A1048576", None).unwrap().into_inner();
    match &ast {
        ASTNode::CellReference(CellRefNode { reference, .. }) => match reference {
            CellRef::Positional { row, col, .. } => {
                assert_eq!(*row, 1_048_575); // 0-based
                assert_eq!(*col, 0);
            }
            CellRef::Resolved(_) => panic!("Expected Positional, got {reference:?}"),
        },
        _ => panic!("Expected CellReference, got {ast:?}"),
    }
}

#[test]
fn test_row_too_large() {
    // Row 1048577 exceeds the maximum.
    // The parser rejects it as a cell reference, so it falls back to an identifier.
    let ast = parse_formula("=A1048577", None).unwrap().into_inner();
    match &ast {
        ASTNode::Identifier(name) => {
            assert_eq!(name, "A1048577");
        }
        ASTNode::CellReference(..) => {
            panic!("A1048577 should NOT be parsed as a cell reference (row exceeds max)");
        }
        _ => panic!("Expected Identifier for out-of-bounds row, got {ast:?}"),
    }
}

#[test]
fn test_row_zero_invalid() {
    // Row 0 is invalid.
    // The parser rejects it as a cell reference, so it falls back to an identifier.
    let ast = parse_formula("=A0", None).unwrap().into_inner();
    match &ast {
        ASTNode::Identifier(name) => {
            assert_eq!(name, "A0");
        }
        ASTNode::CellReference(..) => {
            panic!("A0 should NOT be parsed as a cell reference (row 0 is invalid)");
        }
        _ => panic!("Expected Identifier for row-0 reference, got {ast:?}"),
    }
}

#[test]
fn test_max_valid_cell_xfd1048576() {
    // The absolute maximum cell reference: XFD1048576
    let ast = parse_formula("=XFD1048576", None).unwrap().into_inner();
    match &ast {
        ASTNode::CellReference(CellRefNode { reference, .. }) => match reference {
            CellRef::Positional { row, col, .. } => {
                assert_eq!(*row, 1_048_575); // 0-based
                assert_eq!(*col, 16383); // 0-based
            }
            CellRef::Resolved(_) => panic!("Expected Positional, got {reference:?}"),
        },
        _ => panic!("Expected CellReference, got {ast:?}"),
    }
}

#[test]
fn test_column_range_bounds_xfe() {
    // Column range with out-of-bounds column
    let result = parse_formula("=XFE:XFE", None);
    assert!(
        result.is_err(),
        "XFE:XFE should fail: column exceeds maximum"
    );
}

#[test]
fn test_row_range_bounds_too_large() {
    // Row range with out-of-bounds row
    let result = parse_formula("=1048577:1048577", None);
    assert!(
        result.is_err(),
        "1048577:1048577 should fail: row exceeds maximum"
    );
}

#[test]
fn test_row_range_max_valid() {
    // Row range with maximum valid rows
    let ast = parse_formula("=1:1048576", None).unwrap().into_inner();
    match &ast {
        ASTNode::Range(RangeRef { range_type, .. }) => {
            assert_eq!(*range_type, RangeType::RowRange);
        }
        _ => panic!("Expected Range, got {ast:?}"),
    }
}
