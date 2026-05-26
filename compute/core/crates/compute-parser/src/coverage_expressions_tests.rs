//! Coverage-focused tests for `expressions.rs` — targeting branches not covered
//! by `parser_tests.rs`, `edge_case_tests.rs`, or other test files.

use super::*;
use crate::ast::{ASTNode, BinOp, UnaryOp};
use crate::test_helpers::TestResolver;
use value_types::CellError;

use TestResolver as TR;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn p(formula: &str) -> ASTNode {
    parse_formula(formula, None)
        .unwrap_or_else(|e| panic!("parse_formula({formula:?}) failed: {e}"))
        .into_inner()
}

fn pr(formula: &str) -> ASTNode {
    let resolver = TR::new();
    parse_formula(formula, Some(&resolver))
        .unwrap_or_else(|e| panic!("parse_formula({formula:?}) with resolver failed: {e}"))
        .into_inner()
}

fn p_err(formula: &str) {
    assert!(
        parse_formula(formula, None).is_err(),
        "Expected parse error for {:?}, but it succeeded with: {:?}",
        formula,
        parse_formula(formula, None).unwrap().into_inner()
    );
}

// ===========================================================================
// 1. parse_alpha_starting — unique branches
// ===========================================================================

mod alpha_starting {
    use super::*;

    #[test]
    fn boolean_true_not_consumed_by_function_path() {
        // TRUE() should be parsed as a function call, not a boolean
        let ast = p("TRUE()");
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name.as_ref(), "TRUE");
                assert!(args.is_empty());
            }
            other => panic!("Expected Function TRUE(), got {other:?}"),
        }
    }

    #[test]
    fn false_function_call() {
        let ast = p("FALSE()");
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name.as_ref(), "FALSE");
                assert!(args.is_empty());
            }
            other => panic!("Expected Function FALSE(), got {other:?}"),
        }
    }

    #[test]
    fn plain_identifier() {
        let ast = p("myVar");
        assert_eq!(ast, ASTNode::Identifier("myVar".to_string()));
    }

    #[test]
    fn underscore_identifier() {
        let ast = p("_name");
        assert_eq!(ast, ASTNode::Identifier("_name".to_string()));
    }

    #[test]
    fn single_letter_identifier() {
        let ast = p("x");
        assert_eq!(ast, ASTNode::Identifier("x".to_string()));
    }

    #[test]
    fn identifier_with_dots() {
        let ast = p("my.name");
        assert_eq!(ast, ASTNode::Identifier("my.name".to_string()));
    }

    #[test]
    fn boolean_false_not_prefix_falsehood() {
        let ast = p("FALSEHOOD");
        assert_eq!(ast, ASTNode::Identifier("FALSEHOOD".to_string()));
    }
}

// ===========================================================================
// 2. Cell ref word boundary
// ===========================================================================

mod cell_or_range_or_func {
    use super::*;

    #[test]
    fn cell_ref_word_boundary_rejection() {
        // t1Payment — "T1" is a valid cell ref but "Payment" follows without separator
        let ast = p("t1Payment");
        assert_eq!(ast, ASTNode::Identifier("t1Payment".to_string()));
    }
}

// ===========================================================================
// 3. Array literal unique branches
// ===========================================================================

mod array_literal {
    use super::*;

    #[test]
    fn unclosed_brace_error() {
        p_err("{1,2");
    }

    #[test]
    fn error_in_array() {
        let ast = p("{#N/A}");
        match &ast {
            ASTNode::Array { rows } => {
                assert_eq!(rows[0][0], ASTNode::Error(CellError::Na));
            }
            other => panic!("Expected Array, got {other:?}"),
        }
    }

    #[test]
    fn negative_number_in_array() {
        let ast = p("{-5}");
        match &ast {
            ASTNode::Array { rows } => match &rows[0][0] {
                ASTNode::UnaryOp { op, operand } => {
                    assert_eq!(*op, UnaryOp::Minus);
                    assert_eq!(**operand, ASTNode::Number(5.0));
                }
                other => panic!("Expected UnaryOp(Minus), got {other:?}"),
            },
            other => panic!("Expected Array, got {other:?}"),
        }
    }

    #[test]
    fn positive_unary_in_array() {
        let ast = p("{+5}");
        match &ast {
            ASTNode::Array { rows } => match &rows[0][0] {
                ASTNode::UnaryOp { op, operand } => {
                    assert_eq!(*op, UnaryOp::Plus);
                    assert_eq!(**operand, ASTNode::Number(5.0));
                }
                other => panic!("Expected UnaryOp(Plus), got {other:?}"),
            },
            other => panic!("Expected Array, got {other:?}"),
        }
    }

    #[test]
    fn leading_dot_number_in_array() {
        let ast = p("{.5}");
        match &ast {
            ASTNode::Array { rows } => {
                assert_eq!(rows[0][0], ASTNode::Number(0.5));
            }
            other => panic!("Expected Array, got {other:?}"),
        }
    }

    #[test]
    fn ref_error_in_array() {
        let ast = p("{#REF!}");
        match &ast {
            ASTNode::Array { rows } => {
                assert_eq!(rows[0][0], ASTNode::Error(CellError::Ref));
            }
            other => panic!("Expected Array, got {other:?}"),
        }
    }

    #[test]
    fn three_rows() {
        let ast = p("{1;2;3}");
        match &ast {
            ASTNode::Array { rows } => {
                assert_eq!(rows.len(), 3);
                assert_eq!(rows[0][0], ASTNode::Number(1.0));
                assert_eq!(rows[1][0], ASTNode::Number(2.0));
                assert_eq!(rows[2][0], ASTNode::Number(3.0));
            }
            other => panic!("Expected Array, got {other:?}"),
        }
    }
}

// ===========================================================================
// 4. External ref — unclosed bracket
// ===========================================================================

mod external_ref {
    use super::*;

    #[test]
    fn no_closing_bracket_error() {
        p_err("[1Sheet1!A1");
    }
}

// ===========================================================================
// 5. Arg list — unique patterns
// ===========================================================================

mod arg_list {
    use super::*;

    #[test]
    fn single_arg_abs() {
        let ast = p("ABS(A1)");
        match &ast {
            ASTNode::Function { args, .. } => {
                assert_eq!(args.len(), 1);
                assert!(matches!(&args[0], ASTNode::CellReference(..)));
            }
            other => panic!("Expected Function, got {other:?}"),
        }
    }

    #[test]
    fn many_omitted() {
        let ast = p("FUNC(,,,,,)");
        match &ast {
            ASTNode::Function { args, .. } => {
                assert_eq!(args.len(), 6);
                for arg in args {
                    assert_eq!(*arg, ASTNode::Omitted);
                }
            }
            other => panic!("Expected Function, got {other:?}"),
        }
    }
}

// ===========================================================================
// 6. Expression-level range operator (unique)
// ===========================================================================

mod range_op {
    use super::*;

    #[test]
    fn index_to_index_range() {
        let ast = p("INDEX(A:A,1):INDEX(B:B,1)");
        match &ast {
            ASTNode::RangeOp { start, end } => {
                assert!(matches!(start.as_ref(), ASTNode::Function { .. }));
                assert!(matches!(end.as_ref(), ASTNode::Function { .. }));
            }
            other => panic!("Expected RangeOp, got {other:?}"),
        }
    }

    #[test]
    fn paren_to_paren_range() {
        let ast = p("(A1):(B1)");
        match &ast {
            ASTNode::RangeOp { start, end } => {
                assert!(matches!(start.as_ref(), ASTNode::Paren(..)));
                assert!(matches!(end.as_ref(), ASTNode::Paren(..)));
            }
            other => panic!("Expected RangeOp, got {other:?}"),
        }
    }

    #[test]
    fn function_to_cell_range() {
        let ast = p("INDEX(A:A,1):B1");
        match &ast {
            ASTNode::RangeOp { start, .. } => {
                assert!(matches!(start.as_ref(), ASTNode::Function { .. }));
            }
            other => panic!("Expected RangeOp, got {other:?}"),
        }
    }

    #[test]
    fn sheet_ref_is_range_endpoint() {
        let ast = pr("INDEX(Sheet1!A:A,1):INDEX(Sheet1!B:B,1)");
        match &ast {
            ASTNode::RangeOp { start, end } => {
                assert!(matches!(start.as_ref(), ASTNode::Function { .. }));
                assert!(matches!(end.as_ref(), ASTNode::Function { .. }));
            }
            other => panic!("Expected RangeOp, got {other:?}"),
        }
    }
}

// ===========================================================================
// 7. Binary operators — unique associativity tests
// ===========================================================================

mod binary_ops {
    use super::*;

    #[test]
    fn mul_div_left_associative() {
        let ast = p("2*3/4");
        match &ast {
            ASTNode::BinaryOp { op, left, .. } => {
                assert_eq!(*op, BinOp::Div);
                match left.as_ref() {
                    ASTNode::BinaryOp { op: inner, .. } => {
                        assert_eq!(*inner, BinOp::Mul);
                    }
                    other => panic!("Expected inner Mul, got {other:?}"),
                }
            }
            other => panic!("Expected Div, got {other:?}"),
        }
    }

    #[test]
    fn add_sub_left_associative() {
        let ast = p("1+2-3");
        match &ast {
            ASTNode::BinaryOp { op, left, .. } => {
                assert_eq!(*op, BinOp::Sub);
                match left.as_ref() {
                    ASTNode::BinaryOp { op: inner, .. } => {
                        assert_eq!(*inner, BinOp::Add);
                    }
                    other => panic!("Expected inner Add, got {other:?}"),
                }
            }
            other => panic!("Expected Sub, got {other:?}"),
        }
    }
}

// ===========================================================================
// 8. Intersection — unique tests (sheet ref + column range)
// ===========================================================================

mod intersection {
    use super::*;

    #[test]
    fn sheet_ref_intersection_with_resolver() {
        let ast = pr("Sheet1!A1:B10 Sheet1!B5:C20");
        match &ast {
            ASTNode::BinaryOp { op, left, right } => {
                assert_eq!(*op, BinOp::Intersect);
                assert!(matches!(left.as_ref(), ASTNode::SheetRef { .. }));
                assert!(matches!(right.as_ref(), ASTNode::SheetRef { .. }));
            }
            other => panic!("Expected Intersect of SheetRefs, got {other:?}"),
        }
    }

    #[test]
    fn column_range_intersection() {
        let ast = p("A:C B:D");
        match &ast {
            ASTNode::BinaryOp { op, left, right } => {
                assert_eq!(*op, BinOp::Intersect);
                assert!(matches!(left.as_ref(), ASTNode::Range(..)));
                assert!(matches!(right.as_ref(), ASTNode::Range(..)));
            }
            other => panic!("Expected Intersect of column ranges, got {other:?}"),
        }
    }

    #[test]
    fn intersection_with_dollar_sign() {
        let ast = p("$A$1:$B$10 $B$5:$C$20");
        match &ast {
            ASTNode::BinaryOp { op, .. } => {
                assert_eq!(*op, BinOp::Intersect);
            }
            other => panic!("Expected Intersect, got {other:?}"),
        }
    }
}

// ===========================================================================
// 9. Call expression — chained call (unique)
// ===========================================================================

mod call_expression {
    use super::*;

    #[test]
    fn chained_call() {
        let ast = p("(LAMBDA(x,LAMBDA(y,x+y)))(1)(2)");
        match &ast {
            ASTNode::CallExpression { callee, args } => {
                assert_eq!(args.len(), 1);
                assert!(matches!(callee.as_ref(), ASTNode::CallExpression { .. }));
            }
            other => panic!("Expected nested CallExpression, got {other:?}"),
        }
    }

    #[test]
    fn paren_expr_call() {
        let ast = p("(A1+B1)(5)");
        match &ast {
            ASTNode::CallExpression { callee, args } => {
                assert!(matches!(callee.as_ref(), ASTNode::Paren(..)));
                assert_eq!(args.len(), 1);
            }
            other => panic!("Expected CallExpression, got {other:?}"),
        }
    }
}

// ===========================================================================
// 10. Whitespace handling
// ===========================================================================

mod whitespace {
    use super::*;

    #[test]
    fn leading_whitespace() {
        let ast = p("  1+2");
        assert!(matches!(ast, ASTNode::BinaryOp { .. }));
    }

    #[test]
    fn trailing_whitespace() {
        let ast = p("1+2  ");
        assert!(matches!(ast, ASTNode::BinaryOp { .. }));
    }

    #[test]
    fn whitespace_in_function_args() {
        let ast = p("SUM( A1 , B1 )");
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name.as_ref(), "SUM");
                assert_eq!(args.len(), 2);
            }
            other => panic!("Expected Function, got {other:?}"),
        }
    }
}

// ===========================================================================
// 11. Complex / integration expressions (unique)
// ===========================================================================

mod complex {
    use super::*;

    #[test]
    fn sumproduct() {
        let ast = p("SUMPRODUCT(A1:A10,B1:B10)");
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name.as_ref(), "SUMPRODUCT");
                assert_eq!(args.len(), 2);
            }
            other => panic!("Expected Function, got {other:?}"),
        }
    }

    #[test]
    fn complex_if_formula() {
        let ast = p("IF(AND(A1>0,B1<100),SUM(C1:C10),0)");
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name.as_ref(), "IF");
                assert_eq!(args.len(), 3);
            }
            other => panic!("Expected IF function, got {other:?}"),
        }
    }

    #[test]
    fn formula_with_string_concat() {
        let ast = p("\"Hello \"&\" World\"");
        match &ast {
            ASTNode::BinaryOp { op, .. } => {
                assert_eq!(*op, BinOp::Concat);
            }
            other => panic!("Expected Concat, got {other:?}"),
        }
    }

    #[test]
    fn mixed_absolute_relative() {
        let ast = p("$A1:B$10");
        match &ast {
            ASTNode::Range(r) => {
                assert!(r.abs_start.col);
                assert!(!r.abs_start.row);
                assert!(!r.abs_end.col);
                assert!(r.abs_end.row);
            }
            other => panic!("Expected Range, got {other:?}"),
        }
    }

    #[test]
    fn error_in_expression() {
        let ast = p("#N/A+1");
        match &ast {
            ASTNode::BinaryOp { op, left, .. } => {
                assert_eq!(*op, BinOp::Add);
                assert_eq!(**left, ASTNode::Error(CellError::Na));
            }
            other => panic!("Expected Add with error, got {other:?}"),
        }
    }

    #[test]
    fn external_ref_in_expression() {
        let ast = p("[1]Sheet1!A1+1");
        match &ast {
            ASTNode::BinaryOp { op, left, .. } => {
                assert_eq!(*op, BinOp::Add);
                match left.as_ref() {
                    ASTNode::ExternalSheetRef {
                        sheet_name, inner, ..
                    } => {
                        assert_eq!(sheet_name, "Sheet1");
                        assert!(matches!(inner.as_ref(), ASTNode::CellReference(_)));
                    }
                    other => panic!("Expected ExternalSheetRef, got: {other:?}"),
                }
            }
            other => panic!("Expected Add with external ref, got {other:?}"),
        }
    }

    #[test]
    fn array_in_function() {
        let ast = p("SUM({1,2,3})");
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name.as_ref(), "SUM");
                assert_eq!(args.len(), 1);
                assert!(matches!(&args[0], ASTNode::Array { .. }));
            }
            other => panic!("Expected SUM with array, got {other:?}"),
        }
    }

    #[test]
    fn let_function() {
        let ast = p("LET(x,1,y,2,x+y)");
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name.as_ref(), "LET");
                assert_eq!(args.len(), 5);
                assert_eq!(args[0], ASTNode::Identifier("x".to_string()));
                assert_eq!(args[1], ASTNode::Number(1.0));
                assert_eq!(args[2], ASTNode::Identifier("y".to_string()));
                assert_eq!(args[3], ASTNode::Number(2.0));
            }
            other => panic!("Expected LET, got {other:?}"),
        }
    }
}
