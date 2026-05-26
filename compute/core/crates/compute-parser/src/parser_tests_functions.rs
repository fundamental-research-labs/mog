use super::*;
use crate::ast::{BinOp, RangeRef};
use formula_types::RangeType;

// ===== Function Calls =====

#[test]
fn test_function_no_args() {
    let ast = parse_formula("=NOW()", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::Function {
            name: "NOW".into(),
            args: vec![],
        }
    );
}

#[test]
fn test_function_sum() {
    let ast = parse_formula("=SUM(A1:B10)", None).unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "SUM");
            assert_eq!(args.len(), 1);
            match &args[0] {
                ASTNode::Range(RangeRef { range_type, .. }) => {
                    assert_eq!(*range_type, RangeType::CellRange);
                }
                _ => panic!("Expected Range"),
            }
        }
        _ => panic!("Expected Function, got {ast:?}"),
    }
}

#[test]
fn test_function_if() {
    let ast = parse_formula("=IF(A1>0,1,0)", None).unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "IF");
            assert_eq!(args.len(), 3);
        }
        _ => panic!("Expected Function"),
    }
}

#[test]
fn test_function_nested() {
    let ast = parse_formula("=IF(AND(A1>0,B1<10),C1,D1)", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "IF");
            assert_eq!(args.len(), 3);
            match &args[0] {
                ASTNode::Function { name, args } => {
                    assert_eq!(name, "AND");
                    assert_eq!(args.len(), 2);
                }
                _ => panic!("Expected AND function"),
            }
        }
        _ => panic!("Expected IF function"),
    }
}

#[test]
fn test_function_case_insensitive() {
    let ast = parse_formula("=sum(1,2)", None).unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, .. } => {
            assert_eq!(name, "SUM");
        }
        _ => panic!("Expected Function"),
    }
}

// ===== Array Literals =====

#[test]
fn test_array_literal() {
    let ast = parse_formula("={1,2;3,4}", None).unwrap().into_inner();
    match &ast {
        ASTNode::Array { rows } => {
            assert_eq!(rows.len(), 2);
            assert_eq!(rows[0].len(), 2);
            assert_eq!(rows[1].len(), 2);
            assert_eq!(rows[0][0], ASTNode::Number(1.0));
            assert_eq!(rows[0][1], ASTNode::Number(2.0));
            assert_eq!(rows[1][0], ASTNode::Number(3.0));
            assert_eq!(rows[1][1], ASTNode::Number(4.0));
        }
        _ => panic!("Expected Array, got {ast:?}"),
    }
}

#[test]
fn test_array_single_row() {
    let ast = parse_formula("={1,2,3}", None).unwrap().into_inner();
    match &ast {
        ASTNode::Array { rows } => {
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].len(), 3);
        }
        _ => panic!("Expected Array"),
    }
}

#[test]
fn test_array_with_strings_and_booleans() {
    let ast = parse_formula("={1,\"hello\";TRUE,FALSE}", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::Array { rows } => {
            assert_eq!(rows.len(), 2);
            assert_eq!(rows[0][0], ASTNode::Number(1.0));
            assert_eq!(rows[0][1], ASTNode::Text("hello".to_string()));
            assert_eq!(rows[1][0], ASTNode::Boolean(true));
            assert_eq!(rows[1][1], ASTNode::Boolean(false));
        }
        _ => panic!("Expected Array"),
    }
}

// ===== Complex Formulas =====

#[test]
fn test_complex_sum_plus_mul() {
    // =SUM(A1:B10)+C1*2
    let ast = parse_formula("=SUM(A1:B10)+C1*2", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::BinaryOp {
            op: BinOp::Add,
            left,
            right,
        } => {
            match left.as_ref() {
                ASTNode::Function { name, .. } => assert_eq!(name, "SUM"),
                _ => panic!("Expected SUM function"),
            }
            match right.as_ref() {
                ASTNode::BinaryOp { op: BinOp::Mul, .. } => {}
                _ => panic!("Expected Mul"),
            }
        }
        _ => panic!("Expected BinaryOp Add"),
    }
}

#[test]
fn test_complex_nested_if_and() {
    let ast = parse_formula("=IF(AND(A1>0,B1<10),C1,D1)", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "IF");
            assert_eq!(args.len(), 3);
        }
        _ => panic!("Expected IF"),
    }
}

#[test]
fn test_parenthesized_expression() {
    let ast = parse_formula("=(1+2)*3", None).unwrap().into_inner();
    match &ast {
        ASTNode::BinaryOp {
            op: BinOp::Mul,
            left,
            ..
        } => match left.as_ref() {
            ASTNode::Paren(inner) => match inner.as_ref() {
                ASTNode::BinaryOp { op: BinOp::Add, .. } => {}
                _ => panic!("Expected Add inside Paren"),
            },
            _ => panic!("Expected Paren"),
        },
        _ => panic!("Expected Mul"),
    }
}

#[test]
fn test_deeply_nested_parens() {
    let ast = parse_formula("=(((1)))", None).unwrap().into_inner();
    match &ast {
        ASTNode::Paren(inner) => match inner.as_ref() {
            ASTNode::Paren(inner) => match inner.as_ref() {
                ASTNode::Paren(inner) => {
                    assert_eq!(inner.as_ref(), &ASTNode::Number(1.0));
                }
                _ => panic!("Expected inner Paren"),
            },
            _ => panic!("Expected middle Paren"),
        },
        _ => panic!("Expected outer Paren"),
    }
}

// ===== Structured References =====

#[test]
fn test_structured_ref_simple() {
    let ast = parse_formula("=Table1[Col]", None).unwrap().into_inner();
    match &ast {
        ASTNode::StructuredRef(ref_) => {
            assert_eq!(ref_.table_name, "Table1");
            assert_eq!(ref_.specifiers.len(), 1);
            match &ref_.specifiers[0] {
                formula_types::StructuredRefSpecifier::Column { name } => {
                    assert_eq!(name, "Col");
                }
                other => panic!("Expected Column specifier, got {other:?}"),
            }
        }
        _ => panic!("Expected StructuredRef, got {ast:?}"),
    }
}

#[test]
fn test_structured_ref_with_specifier() {
    let ast = parse_formula("=Table1[[#Headers],[Col1]:[Col2]]", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::StructuredRef(ref_) => {
            assert_eq!(ref_.table_name, "Table1");
            // Should have: Special(Headers), ColumnRange(Col1, Col2)
            assert_eq!(ref_.specifiers.len(), 2);
            assert_eq!(
                ref_.specifiers[0],
                formula_types::StructuredRefSpecifier::Special {
                    item: formula_types::SpecialItem::Headers,
                }
            );
            assert_eq!(
                ref_.specifiers[1],
                formula_types::StructuredRefSpecifier::ColumnRange {
                    start: "Col1".to_string(),
                    end: "Col2".to_string(),
                }
            );
        }
        _ => panic!("Expected StructuredRef, got {ast:?}"),
    }
}

#[test]
fn test_structured_ref_this_row_shorthand() {
    // Table1[@Col] should parse as ThisRow + Column
    let ast = parse_formula("=Table1[@Col]", None).unwrap().into_inner();
    match &ast {
        ASTNode::StructuredRef(ref_) => {
            assert_eq!(ref_.table_name, "Table1");
            assert_eq!(ref_.specifiers.len(), 2);
            assert_eq!(
                ref_.specifiers[0],
                formula_types::StructuredRefSpecifier::ThisRow
            );
            match &ref_.specifiers[1] {
                formula_types::StructuredRefSpecifier::Column { name } => {
                    assert_eq!(name, "Col");
                }
                other => panic!("Expected Column, got {other:?}"),
            }
        }
        _ => panic!("Expected StructuredRef, got {ast:?}"),
    }
}

#[test]
fn test_structured_ref_escaped_bracket() {
    // Table1[['Col]]Name']] should parse with column name "Col]Name"
    // The [[ indicates column range syntax, single quotes wrap the name, ]] is escape for ]
    // find_outer_matching_bracket now correctly handles ]] escape sequences inside single quotes.
    let ast = parse_formula("=Table1[['Col]]Name']]", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::StructuredRef(ref_) => {
            assert_eq!(ref_.table_name, "Table1");
            assert_eq!(ref_.specifiers.len(), 1);
            match &ref_.specifiers[0] {
                formula_types::StructuredRefSpecifier::Column { name } => {
                    assert_eq!(name, "Col]Name");
                }
                other => panic!("Expected Column, got {other:?}"),
            }
        }
        _ => panic!("Expected StructuredRef, got {ast:?}"),
    }
}

#[test]
fn test_structured_ref_special_data() {
    // Table1[#Data] should parse as Special(Data)
    let ast = parse_formula("=Table1[#Data]", None).unwrap().into_inner();
    match &ast {
        ASTNode::StructuredRef(ref_) => {
            assert_eq!(ref_.table_name, "Table1");
            assert_eq!(ref_.specifiers.len(), 1);
            assert_eq!(
                ref_.specifiers[0],
                formula_types::StructuredRefSpecifier::Special {
                    item: formula_types::SpecialItem::Data,
                }
            );
        }
        _ => panic!("Expected StructuredRef, got {ast:?}"),
    }
}

#[test]
fn test_structured_ref_special_all() {
    // Table1[#All] should parse as Special(All)
    let ast = parse_formula("=Table1[#All]", None).unwrap().into_inner();
    match &ast {
        ASTNode::StructuredRef(ref_) => {
            assert_eq!(ref_.table_name, "Table1");
            assert_eq!(ref_.specifiers.len(), 1);
            assert_eq!(
                ref_.specifiers[0],
                formula_types::StructuredRefSpecifier::Special {
                    item: formula_types::SpecialItem::All,
                }
            );
        }
        _ => panic!("Expected StructuredRef, got {ast:?}"),
    }
}

#[test]
fn test_structured_ref_special_this_row() {
    // Table1[#This Row] should parse as ThisRow
    let ast = parse_formula("=Table1[#This Row]", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::StructuredRef(ref_) => {
            assert_eq!(ref_.table_name, "Table1");
            assert_eq!(ref_.specifiers.len(), 1);
            assert_eq!(
                ref_.specifiers[0],
                formula_types::StructuredRefSpecifier::ThisRow
            );
        }
        _ => panic!("Expected StructuredRef, got {ast:?}"),
    }
}

#[test]
#[allow(clippy::float_cmp)]
fn test_structured_ref_in_expression() {
    // =Table1[Col]+1 should parse as BinaryOp(Add, StructuredRef, Number)
    let ast = parse_formula("=Table1[Col]+1", None).unwrap().into_inner();
    match &ast {
        ASTNode::BinaryOp { op, left, right } => {
            assert_eq!(*op, BinOp::Add);
            match left.as_ref() {
                ASTNode::StructuredRef(ref_) => {
                    assert_eq!(ref_.table_name, "Table1");
                    assert_eq!(ref_.specifiers.len(), 1);
                    match &ref_.specifiers[0] {
                        formula_types::StructuredRefSpecifier::Column { name } => {
                            assert_eq!(name, "Col");
                        }
                        other => panic!("Expected Column, got {other:?}"),
                    }
                }
                other => panic!("Expected StructuredRef, got {other:?}"),
            }
            match right.as_ref() {
                ASTNode::Number(n) => assert_eq!(*n, 1.0),
                other => panic!("Expected Number, got {other:?}"),
            }
        }
        _ => panic!("Expected BinaryOp, got {ast:?}"),
    }
}

#[test]
fn test_structured_ref_with_function() {
    // =SUM(Table1[Col]) should parse as Function(SUM, [StructuredRef])
    let ast = parse_formula("=SUM(Table1[Col])", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "SUM");
            assert_eq!(args.len(), 1);
            match &args[0] {
                ASTNode::StructuredRef(ref_) => {
                    assert_eq!(ref_.table_name, "Table1");
                    assert_eq!(ref_.specifiers.len(), 1);
                    match &ref_.specifiers[0] {
                        formula_types::StructuredRefSpecifier::Column { name } => {
                            assert_eq!(name, "Col");
                        }
                        other => panic!("Expected Column, got {other:?}"),
                    }
                }
                other => panic!("Expected StructuredRef, got {other:?}"),
            }
        }
        _ => panic!("Expected Function, got {ast:?}"),
    }
}

// ===== Call Expression (LAMBDA calls) =====

#[test]
fn test_lambda_call_expression() {
    // (LAMBDA(x, x+1))(5)
    let ast = parse_formula("=(LAMBDA(x, x+1))(5)", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::CallExpression { callee, args } => {
            match callee.as_ref() {
                ASTNode::Paren(inner) => match inner.as_ref() {
                    ASTNode::Function { name, args: largs } => {
                        assert_eq!(name, "LAMBDA");
                        assert_eq!(largs.len(), 2);
                    }
                    _ => panic!("Expected Function inside Paren"),
                },
                _ => panic!("Expected Paren as callee"),
            }
            assert_eq!(args.len(), 1);
            assert_eq!(args[0], ASTNode::Number(5.0));
        }
        _ => panic!("Expected CallExpression, got {ast:?}"),
    }
}

#[test]
fn test_lambda_call_multi_args() {
    // (LAMBDA(x, y, x+y))(3, 4)
    let ast = parse_formula("=(LAMBDA(x, y, x+y))(3, 4)", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::CallExpression { callee, args } => {
            match callee.as_ref() {
                ASTNode::Paren(inner) => match inner.as_ref() {
                    ASTNode::Function { name, .. } => assert_eq!(name, "LAMBDA"),
                    _ => panic!("Expected Function"),
                },
                _ => panic!("Expected Paren"),
            }
            assert_eq!(args.len(), 2);
        }
        _ => panic!("Expected CallExpression, got {ast:?}"),
    }
}

#[test]
fn test_lambda_call_no_args() {
    // (LAMBDA(42))()
    let ast = parse_formula("=(LAMBDA(42))()", None).unwrap().into_inner();
    match &ast {
        ASTNode::CallExpression { callee, args } => {
            match callee.as_ref() {
                ASTNode::Paren(_) => {}
                _ => panic!("Expected Paren"),
            }
            assert!(args.is_empty());
        }
        _ => panic!("Expected CallExpression, got {ast:?}"),
    }
}

#[test]
fn test_let_parses_normally() {
    // LET is parsed as a regular Function node
    let ast = parse_formula("=LET(x, 10, x+1)", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "LET");
            assert_eq!(args.len(), 3);
            // First arg is identifier 'x'
            match &args[0] {
                ASTNode::Identifier(n) => assert_eq!(n, "x"),
                _ => panic!("Expected Identifier for first LET arg, got {:?}", args[0]),
            }
        }
        _ => panic!("Expected Function, got {ast:?}"),
    }
}

#[test]
fn test_lambda_parses_as_function() {
    // LAMBDA(x, x+1) should be a Function node
    let ast = parse_formula("=LAMBDA(x, x+1)", None).unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "LAMBDA");
            assert_eq!(args.len(), 2);
            match &args[0] {
                ASTNode::Identifier(n) => assert_eq!(n, "x"),
                _ => panic!("Expected Identifier for LAMBDA param, got {:?}", args[0]),
            }
        }
        _ => panic!("Expected Function, got {ast:?}"),
    }
}

// ===================================================================
// LET with cell-ref-like variable names
// Bug: the parser greedily interprets identifiers as cell references
// when the leading chars form a valid column+digit pattern.
// ===================================================================

#[test]
fn test_let_cellref_like_composite_name() {
    // =LET(t1Payment, 5, t1Payment+1) should parse as a valid LET
    // Currently fails: "t1" consumed as CellRef(T1), "Payment" breaks arg parsing
    let ast = parse_formula("=LET(t1Payment, 5, t1Payment+1)", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "LET");
            assert_eq!(args.len(), 3);
            // First arg must be Identifier("t1Payment"), not CellRef(T1)
            match &args[0] {
                ASTNode::Identifier(n) => assert_eq!(n, "t1Payment"),
                other => panic!("Expected Identifier(\"t1Payment\"), got {other:?}"),
            }
        }
        _ => panic!("Expected Function(LET), got {ast:?}"),
    }
}

#[test]
#[ignore = "parser produces CellRef(T1) for t1 (valid cell ref) — fix is at evaluator level"]
fn test_let_cellref_like_simple_name() {
    // =LET(t1, 5, t1+1) should have Identifier("t1") as first arg
    // Currently: parses successfully but t1 → CellRef(T1), causing #VALUE! at eval
    let ast = parse_formula("=LET(t1, 5, t1+1)", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "LET");
            assert_eq!(args.len(), 3);
            match &args[0] {
                ASTNode::Identifier(n) => assert_eq!(n, "t1"),
                other => panic!("Expected Identifier(\"t1\"), got {other:?}"),
            }
        }
        _ => panic!("Expected Function(LET), got {ast:?}"),
    }
}

#[test]
fn test_let_cellref_boundary_xfd() {
    // XFD is the last valid column. xfd1x should be Identifier, not CellRef(XFD1)+x
    let ast = parse_formula("=LET(xfd1x, 10, xfd1x*2)", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "LET");
            assert_eq!(args.len(), 3);
            match &args[0] {
                ASTNode::Identifier(n) => assert_eq!(n, "xfd1x"),
                other => panic!("Expected Identifier(\"xfd1x\"), got {other:?}"),
            }
        }
        _ => panic!("Expected Function(LET), got {ast:?}"),
    }
}

#[test]
fn test_let_no_ambiguity_names() {
    // Names that don't look like cell refs should already work
    let ast = parse_formula("=LET(tPayment, 5, tPayment+1)", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "LET");
            assert_eq!(args.len(), 3);
            match &args[0] {
                ASTNode::Identifier(n) => assert_eq!(n, "tPayment"),
                other => panic!("Expected Identifier(\"tPayment\"), got {other:?}"),
            }
        }
        _ => panic!("Expected Function(LET), got {ast:?}"),
    }
}

#[test]
fn test_let_multi_binding_cellref_names() {
    // Real-world pattern: financial model with t1Balance, t2Balance, t3Balance
    let ast = parse_formula(
        "=LET(t1Balance, 100, t2Balance, 200, t1Balance+t2Balance)",
        None,
    )
    .unwrap()
    .into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "LET");
            assert_eq!(args.len(), 5);
            match &args[0] {
                ASTNode::Identifier(n) => assert_eq!(n, "t1Balance"),
                other => panic!("Expected Identifier(\"t1Balance\"), got {other:?}"),
            }
            match &args[2] {
                ASTNode::Identifier(n) => assert_eq!(n, "t2Balance"),
                other => panic!("Expected Identifier(\"t2Balance\"), got {other:?}"),
            }
        }
        _ => panic!("Expected Function(LET), got {ast:?}"),
    }
}

#[test]
#[ignore = "parser produces CellRef(A1) for a1 (valid cell ref) — fix is at evaluator level"]
fn test_lambda_cellref_like_param() {
    // LAMBDA(a1, a1*2) — a1 should be a parameter name, not cell A1
    let ast = parse_formula("=LAMBDA(a1, a1*2)", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "LAMBDA");
            assert_eq!(args.len(), 2);
            match &args[0] {
                ASTNode::Identifier(n) => assert_eq!(n, "a1"),
                other => panic!("Expected Identifier(\"a1\"), got {other:?}"),
            }
        }
        _ => panic!("Expected Function(LAMBDA), got {ast:?}"),
    }
}

#[test]
fn test_paren_not_followed_by_call() {
    // (1+2) should still be a plain Paren, not a CallExpression
    let ast = parse_formula("=(1+2)", None).unwrap().into_inner();
    match &ast {
        ASTNode::Paren(_) => {} // correct
        _ => panic!("Expected Paren, got {ast:?}"),
    }
}

#[test]
fn test_paren_then_operator_not_call() {
    // (1+2)*3 should not be a CallExpression
    let ast = parse_formula("=(1+2)*3", None).unwrap().into_inner();
    match &ast {
        ASTNode::BinaryOp {
            op: BinOp::Mul,
            left,
            ..
        } => match left.as_ref() {
            ASTNode::Paren(_) => {}
            _ => panic!("Expected Paren"),
        },
        _ => panic!("Expected BinaryOp Mul, got {ast:?}"),
    }
}

// -----------------------------------------------------------------------
// Empty/omitted function arguments
// -----------------------------------------------------------------------

#[test]
fn test_table_formula_both_args() {
    // TABLE(A1,B1) - both args present, should parse as a normal function call
    let ast = parse_formula("=TABLE(A1,B1)", None).unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "TABLE");
            assert_eq!(args.len(), 2);
        }
        _ => panic!("Expected Function, got {ast:?}"),
    }
}

#[test]
fn test_table_formula_no_args() {
    // TABLE() - no args
    let ast = parse_formula("=TABLE()", None).unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "TABLE");
            assert!(args.is_empty());
        }
        _ => panic!("Expected Function, got {ast:?}"),
    }
}

#[test]
fn test_empty_first_arg() {
    // TABLE(,B3) - omitted first argument should parse with placeholder
    let ast = parse_formula("=TABLE(,B3)", None).unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "TABLE");
            assert_eq!(args.len(), 2);
            // First arg is a zero placeholder for the omitted argument
            assert_eq!(args[0], ASTNode::Omitted);
        }
        _ => panic!("Expected Function, got {ast:?}"),
    }
}

#[test]
fn test_empty_second_arg() {
    // TABLE(B3,) - omitted second argument should parse with placeholder
    let ast = parse_formula("=TABLE(B3,)", None).unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "TABLE");
            assert_eq!(args.len(), 2);
            // Second arg is a zero placeholder for the omitted argument
            assert_eq!(args[1], ASTNode::Omitted);
        }
        _ => panic!("Expected Function, got {ast:?}"),
    }
}

#[test]
fn test_empty_middle_arg() {
    // IF(A1,,0) - omitted second argument in IF
    let ast = parse_formula("=IF(A1,,0)", None).unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "IF");
            assert_eq!(args.len(), 3);
            // Middle arg is a zero placeholder
            assert_eq!(args[1], ASTNode::Omitted);
        }
        _ => panic!("Expected Function, got {ast:?}"),
    }
}

#[test]
fn test_multiple_empty_args() {
    // FUNC(,,) - all three args omitted
    let ast = parse_formula("=FUNC(,,)", None).unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name, "FUNC");
            assert_eq!(args.len(), 3);
            assert_eq!(args[0], ASTNode::Omitted);
            assert_eq!(args[1], ASTNode::Omitted);
            assert_eq!(args[2], ASTNode::Omitted);
        }
        _ => panic!("Expected Function, got {ast:?}"),
    }
}
