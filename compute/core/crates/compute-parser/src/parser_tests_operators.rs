use super::*;
use crate::ast::{BinOp, UnaryOp};

// ===== Operators =====

#[test]
fn test_addition() {
    let ast = parse_formula("=1+2", None).unwrap().into_inner();
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
fn test_subtraction() {
    let ast = parse_formula("=5-3", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::BinaryOp {
            op: BinOp::Sub,
            left: Box::new(ASTNode::Number(5.0)),
            right: Box::new(ASTNode::Number(3.0)),
        }
    );
}

#[test]
fn test_multiplication() {
    let ast = parse_formula("=2*3", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::BinaryOp {
            op: BinOp::Mul,
            left: Box::new(ASTNode::Number(2.0)),
            right: Box::new(ASTNode::Number(3.0)),
        }
    );
}

#[test]
fn test_division() {
    let ast = parse_formula("=10/2", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::BinaryOp {
            op: BinOp::Div,
            left: Box::new(ASTNode::Number(10.0)),
            right: Box::new(ASTNode::Number(2.0)),
        }
    );
}

#[test]
fn test_power() {
    let ast = parse_formula("=2^3", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::BinaryOp {
            op: BinOp::Pow,
            left: Box::new(ASTNode::Number(2.0)),
            right: Box::new(ASTNode::Number(3.0)),
        }
    );
}

#[test]
fn test_concat() {
    let ast = parse_formula("=\"a\"&\"b\"", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::BinaryOp {
            op: BinOp::Concat,
            left: Box::new(ASTNode::Text("a".to_string())),
            right: Box::new(ASTNode::Text("b".to_string())),
        }
    );
}

#[test]
fn test_comparison_eq() {
    let ast = parse_formula("=1=2", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::BinaryOp {
            op: BinOp::Eq,
            left: Box::new(ASTNode::Number(1.0)),
            right: Box::new(ASTNode::Number(2.0)),
        }
    );
}

#[test]
fn test_comparison_neq() {
    let ast = parse_formula("=1<>2", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::BinaryOp {
            op: BinOp::Neq,
            left: Box::new(ASTNode::Number(1.0)),
            right: Box::new(ASTNode::Number(2.0)),
        }
    );
}

#[test]
fn test_comparison_lt() {
    let ast = parse_formula("=1<2", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::BinaryOp {
            op: BinOp::Lt,
            left: Box::new(ASTNode::Number(1.0)),
            right: Box::new(ASTNode::Number(2.0)),
        }
    );
}

#[test]
fn test_comparison_gt() {
    let ast = parse_formula("=1>2", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::BinaryOp {
            op: BinOp::Gt,
            left: Box::new(ASTNode::Number(1.0)),
            right: Box::new(ASTNode::Number(2.0)),
        }
    );
}

#[test]
fn test_comparison_lte() {
    let ast = parse_formula("=1<=2", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::BinaryOp {
            op: BinOp::Lte,
            left: Box::new(ASTNode::Number(1.0)),
            right: Box::new(ASTNode::Number(2.0)),
        }
    );
}

#[test]
fn test_comparison_gte() {
    let ast = parse_formula("=1>=2", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::BinaryOp {
            op: BinOp::Gte,
            left: Box::new(ASTNode::Number(1.0)),
            right: Box::new(ASTNode::Number(2.0)),
        }
    );
}

// ===== Operator Precedence =====

#[test]
fn test_precedence_mul_over_add() {
    // 1+2*3 should parse as 1+(2*3)
    let ast = parse_formula("=1+2*3", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::BinaryOp {
            op: BinOp::Add,
            left: Box::new(ASTNode::Number(1.0)),
            right: Box::new(ASTNode::BinaryOp {
                op: BinOp::Mul,
                left: Box::new(ASTNode::Number(2.0)),
                right: Box::new(ASTNode::Number(3.0)),
            }),
        }
    );
}

#[test]
fn test_precedence_concat_over_comparison() {
    // "a"&"b"="ab" should parse as ("a"&"b")="ab"
    let ast = parse_formula("=\"a\"&\"b\"=\"ab\"", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::BinaryOp {
            op: BinOp::Eq,
            left,
            ..
        } => match left.as_ref() {
            ASTNode::BinaryOp {
                op: BinOp::Concat, ..
            } => {}
            _ => panic!("Expected Concat on left of Eq"),
        },
        _ => panic!("Expected Eq at top"),
    }
}

#[test]
fn test_precedence_add_over_concat() {
    // 1+2&"x" should parse as (1+2)&"x"
    let ast = parse_formula("=1+2&\"x\"", None).unwrap().into_inner();
    match &ast {
        ASTNode::BinaryOp {
            op: BinOp::Concat,
            left,
            ..
        } => match left.as_ref() {
            ASTNode::BinaryOp { op: BinOp::Add, .. } => {}
            _ => panic!("Expected Add on left of Concat"),
        },
        _ => panic!("Expected Concat at top"),
    }
}

#[test]
fn test_power_right_associative() {
    // 2^3^4 should parse as 2^(3^4)
    let ast = parse_formula("=2^3^4", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::BinaryOp {
            op: BinOp::Pow,
            left: Box::new(ASTNode::Number(2.0)),
            right: Box::new(ASTNode::BinaryOp {
                op: BinOp::Pow,
                left: Box::new(ASTNode::Number(3.0)),
                right: Box::new(ASTNode::Number(4.0)),
            }),
        }
    );
}

// ===== Unary Operators =====

#[test]
fn test_unary_minus() {
    let ast = parse_formula("=-5", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::UnaryOp {
            op: UnaryOp::Minus,
            operand: Box::new(ASTNode::Number(5.0)),
        }
    );
}

#[test]
fn test_unary_plus() {
    let ast = parse_formula("=+5", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::UnaryOp {
            op: UnaryOp::Plus,
            operand: Box::new(ASTNode::Number(5.0)),
        }
    );
}

#[test]
fn test_unary_minus_cell_ref() {
    let ast = parse_formula("=-A1", None).unwrap().into_inner();
    match &ast {
        ASTNode::UnaryOp {
            op: UnaryOp::Minus,
            operand,
        } => match operand.as_ref() {
            ASTNode::CellReference(..) => {}
            _ => panic!("Expected CellReference"),
        },
        _ => panic!("Expected UnaryOp"),
    }
}

#[test]
fn test_percent() {
    let ast = parse_formula("=50%", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::UnaryOp {
            op: UnaryOp::Percent,
            operand: Box::new(ASTNode::Number(50.0)),
        }
    );
}

// ===== Spilled-range operator (#) =====

#[test]
fn test_hash_postfix_desugars_to_anchorarray() {
    let ast = parse_formula("=A1#", None).unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "ANCHORARRAY");
            assert_eq!(args.len(), 1);
            assert!(matches!(&args[0], ASTNode::CellReference(_)));
        }
        _ => panic!("Expected Function ANCHORARRAY, got {ast:?}"),
    }
}

#[test]
fn test_hash_postfix_inside_sum() {
    let ast = parse_formula("=SUM(A1#)", None).unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, args } if name == "SUM" => match &args[0] {
            ASTNode::Function { name, .. } => assert_eq!(name, "ANCHORARRAY"),
            other => panic!("Expected nested ANCHORARRAY, got {other:?}"),
        },
        _ => panic!("Expected Function SUM, got {ast:?}"),
    }
}

#[test]
fn test_hash_postfix_with_arithmetic() {
    let ast = parse_formula("=A1#*10", None).unwrap().into_inner();
    match &ast {
        ASTNode::BinaryOp {
            op: BinOp::Mul,
            left,
            right,
        } => {
            match left.as_ref() {
                ASTNode::Function { name, .. } => assert_eq!(name, "ANCHORARRAY"),
                other => panic!("Expected ANCHORARRAY on lhs, got {other:?}"),
            }
            assert_eq!(right.as_ref(), &ASTNode::Number(10.0));
        }
        _ => panic!("Expected BinaryOp Mul, got {ast:?}"),
    }
}

#[test]
fn test_hash_postfix_does_not_consume_error_literal() {
    // `#NAME?` must remain an error literal even if it follows an `A1` in
    // a syntactically-impossible position; the postfix-# helper must not
    // greedily eat the `#`.
    let ast = parse_formula("=#NAME?", None).unwrap().into_inner();
    assert!(matches!(ast, ASTNode::Error(_)));
}

#[test]
fn test_hash_postfix_sheet_qualified() {
    // Sheet-qualified anchor: `Sheet1!A1#` should also desugar.
    let ast = parse_formula("=Sheet1!A1#", None).unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "ANCHORARRAY");
            assert_eq!(args.len(), 1);
            // The argument is the sheet-qualified cell ref (resolved or not).
            assert!(matches!(
                &args[0],
                ASTNode::SheetRef { .. } | ASTNode::UnresolvedSheetRef { .. }
            ));
        }
        _ => panic!("Expected ANCHORARRAY wrapping Sheet1!A1, got {ast:?}"),
    }
}

#[test]
fn test_hash_postfix_display_canonicalizes_to_anchorarray() {
    let ast = parse_formula("=A1#", None).unwrap().into_inner();
    assert_eq!(ast.to_string(), "ANCHORARRAY(A1)");
}

#[test]
fn test_hash_postfix_cross_sheet_display_canonicalizes_to_anchorarray() {
    let ast = parse_formula("=Sheet1!A1#", None).unwrap().into_inner();
    assert_eq!(ast.to_string(), "ANCHORARRAY(Sheet1!A1)");
}

#[test]
fn test_anchorarray_function_display_round_trip() {
    let ast = parse_formula("=ANCHORARRAY(A1)", None)
        .unwrap()
        .into_inner();
    assert_eq!(ast.to_string(), "ANCHORARRAY(A1)");
}

// ===== Implicit-intersection (`@`) prefix operator =====

#[test]
fn test_at_operator_on_cell_ref() {
    // `=@A1` parses as `@(A1)` — the @ is a prefix that wraps any expression,
    // even though for a single cell it is a no-op semantically.
    let ast = parse_formula("=@A1", None).unwrap().into_inner();
    match &ast {
        ASTNode::UnaryOp { op, operand } => {
            assert_eq!(*op, UnaryOp::ImplicitIntersection);
            assert!(matches!(operand.as_ref(), ASTNode::CellReference(..)));
        }
        _ => panic!("Expected UnaryOp(ImplicitIntersection), got {ast:?}"),
    }
}

#[test]
fn test_at_operator_on_range() {
    // `=@A1:A5` is the canonical implicit-intersection form: collapse a column
    // range to a single row-aligned scalar at evaluation time.
    let ast = parse_formula("=@A1:A5", None).unwrap().into_inner();
    match &ast {
        ASTNode::UnaryOp { op, operand } => {
            assert_eq!(*op, UnaryOp::ImplicitIntersection);
            assert!(matches!(operand.as_ref(), ASTNode::Range(..)));
        }
        _ => panic!("Expected UnaryOp(ImplicitIntersection) wrapping Range, got {ast:?}"),
    }
}

#[test]
fn test_at_operator_cross_sheet_display_round_trip() {
    let ast = parse_formula("=@Sheet1!A1:A5", None).unwrap().into_inner();
    assert_eq!(ast.to_string(), "@Sheet1!A1:A5");
}

#[test]
fn test_at_operator_inside_function_call() {
    // `=SUM(@A1:A5)` — the @ applies to the inner range, NOT to the SUM call.
    let ast = parse_formula("=SUM(@A1:A5)", None).unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name.as_ref(), "SUM");
            assert_eq!(args.len(), 1);
            match &args[0] {
                ASTNode::UnaryOp { op, operand } => {
                    assert_eq!(*op, UnaryOp::ImplicitIntersection);
                    assert!(matches!(operand.as_ref(), ASTNode::Range(..)));
                }
                other => panic!("Expected UnaryOp arg, got {other:?}"),
            }
        }
        _ => panic!("Expected Function(SUM), got {ast:?}"),
    }
}

#[test]
fn test_at_operator_does_not_break_structured_ref() {
    // Inside `[ ]`, `@` is a structured-table specifier (this row), NOT a unary
    // operator. The parser must dispatch to the structured-ref path before the
    // unary `@` branch fires. `Sales[@Revenue]` should produce a StructuredRef,
    // not a UnaryOp wrapping anything.
    let ast = parse_formula("=Sales[@Revenue]", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::StructuredRef(sr) => {
            assert_eq!(sr.table_name, "Sales");
            assert!(!sr.specifiers.is_empty());
        }
        _ => panic!("Expected StructuredRef for Sales[@Revenue], got {ast:?}"),
    }
}

#[test]
fn test_at_operator_with_sheet_qualified_range() {
    // `=@Sheet1!A1:A5` — must wrap the SheetRef'd range, not crash.
    let ast = parse_formula("=@Sheet1!A1:A5", None).unwrap().into_inner();
    match &ast {
        ASTNode::UnaryOp { op, operand } => {
            assert_eq!(*op, UnaryOp::ImplicitIntersection);
            // The operand may be SheetRef or UnresolvedSheetRef depending on
            // whether a resolver was provided; without one, it's Unresolved.
            assert!(
                matches!(
                    operand.as_ref(),
                    ASTNode::SheetRef { .. } | ASTNode::UnresolvedSheetRef { .. }
                ),
                "Expected (Unresolved)SheetRef inside @, got {operand:?}"
            );
        }
        _ => panic!("Expected UnaryOp(ImplicitIntersection), got {ast:?}"),
    }
}

#[test]
fn test_at_operator_display_round_trip() {
    // Display impl must emit `@` so the round-trip `parse → format → parse`
    // preserves semantics.
    let ast = parse_formula("=@A1:A5", None).unwrap().into_inner();
    let formatted = format!("{ast}");
    assert_eq!(formatted, "@A1:A5");
}
