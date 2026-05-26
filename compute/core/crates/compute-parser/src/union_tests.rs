//! Tests for the union operator (comma in parenthesized range context).
//!
//! Excel's union operator uses commas inside parenthesized expressions where the
//! content is range-like: `SUM((A1:A5,C1:C5))`. The parser disambiguates commas
//! as union vs. function argument separator based on context.

use super::*;
use crate::ast::ASTNode;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn parse(formula: &str) -> ASTNode {
    parse_formula(formula, None)
        .unwrap_or_else(|e| panic!("Failed to parse '{formula}': {e}"))
        .into_inner()
}

fn display_roundtrip(formula: &str) {
    let ast1 = parse(formula);
    let displayed = format!("{ast1}");
    let ast2 = parse(&displayed);
    assert_eq!(
        ast1, ast2,
        "Round-trip mismatch: '{formula}' -> '{displayed}'"
    );
}

// ---------------------------------------------------------------------------
// Basic union parsing
// ---------------------------------------------------------------------------

#[test]
fn basic_two_range_union() {
    let ast = parse("(A1:A5,C1:C5)");
    match &ast {
        ASTNode::Union { ranges } => {
            assert_eq!(ranges.len(), 2);
            assert!(matches!(&ranges[0], ASTNode::Range(..)));
            assert!(matches!(&ranges[1], ASTNode::Range(..)));
        }
        other => panic!("Expected Union, got {other:?}"),
    }
}

#[test]
fn basic_three_range_union() {
    let ast = parse("(A1:A5,C1:C5,E1:E5)");
    match &ast {
        ASTNode::Union { ranges } => {
            assert_eq!(ranges.len(), 3);
            for range in ranges {
                assert!(matches!(range, ASTNode::Range(..)));
            }
        }
        other => panic!("Expected Union, got {other:?}"),
    }
}

#[test]
fn union_with_single_cell_refs() {
    let ast = parse("(A1,C1)");
    match &ast {
        ASTNode::Union { ranges } => {
            assert_eq!(ranges.len(), 2);
            assert!(matches!(&ranges[0], ASTNode::CellReference(..)));
            assert!(matches!(&ranges[1], ASTNode::CellReference(..)));
        }
        other => panic!("Expected Union, got {other:?}"),
    }
}

#[test]
fn union_mixed_cell_and_range() {
    let ast = parse("(A1,B1:B10)");
    match &ast {
        ASTNode::Union { ranges } => {
            assert_eq!(ranges.len(), 2);
            assert!(matches!(&ranges[0], ASTNode::CellReference(..)));
            assert!(matches!(&ranges[1], ASTNode::Range(..)));
        }
        other => panic!("Expected Union, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Union inside function calls
// ---------------------------------------------------------------------------

#[test]
fn union_in_sum() {
    let ast = parse("SUM((A1:A5,C1:C5))");
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name.as_ref(), "SUM");
            assert_eq!(args.len(), 1);
            assert!(matches!(&args[0], ASTNode::Union { .. }));
        }
        other => panic!("Expected Function, got {other:?}"),
    }
}

#[test]
fn union_in_sum_with_other_args() {
    // SUM((A1:A5,C1:C5),D1) — union as first arg, D1 as second
    let ast = parse("SUM((A1:A5,C1:C5),D1)");
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name.as_ref(), "SUM");
            assert_eq!(args.len(), 2);
            assert!(
                matches!(&args[0], ASTNode::Union { .. }),
                "First arg should be Union, got {:?}",
                args[0]
            );
            assert!(
                matches!(&args[1], ASTNode::CellReference(..)),
                "Second arg should be CellReference, got {:?}",
                args[1]
            );
        }
        other => panic!("Expected Function, got {other:?}"),
    }
}

#[test]
fn union_in_count() {
    let ast = parse("COUNT((A1:A10,C1:C10,E1:E10))");
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name.as_ref(), "COUNT");
            assert_eq!(args.len(), 1);
            match &args[0] {
                ASTNode::Union { ranges } => assert_eq!(ranges.len(), 3),
                other => panic!("Expected Union, got {other:?}"),
            }
        }
        other => panic!("Expected Function, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Normal comma-as-argument-separator must NOT create unions
// ---------------------------------------------------------------------------

#[test]
fn normal_function_args_no_union() {
    let ast = parse("SUM(A1,B1)");
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name.as_ref(), "SUM");
            assert_eq!(args.len(), 2);
            // Each arg should be a CellReference, NOT a Union
            assert!(matches!(&args[0], ASTNode::CellReference(..)));
            assert!(matches!(&args[1], ASTNode::CellReference(..)));
        }
        other => panic!("Expected Function, got {other:?}"),
    }
}

#[test]
fn normal_function_args_ranges_no_union() {
    let ast = parse("SUM(A1:A5,C1:C5)");
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name.as_ref(), "SUM");
            assert_eq!(args.len(), 2);
            assert!(matches!(&args[0], ASTNode::Range(..)));
            assert!(matches!(&args[1], ASTNode::Range(..)));
        }
        other => panic!("Expected Function, got {other:?}"),
    }
}

#[test]
fn if_function_no_union() {
    let ast = parse("IF(A1>0,1,0)");
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name.as_ref(), "IF");
            assert_eq!(args.len(), 3);
            // None of these should be unions
            for arg in args {
                assert!(!matches!(arg, ASTNode::Union { .. }));
            }
        }
        other => panic!("Expected Function, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Parenthesized non-range expressions should NOT create unions
// ---------------------------------------------------------------------------

#[test]
fn paren_arithmetic_no_union() {
    // (1+2) is a parenthesized expression, not a union
    let ast = parse("(1+2)");
    assert!(matches!(ast, ASTNode::Paren(..)));
}

#[test]
fn paren_single_range_no_union() {
    // (A1:B10) is a parenthesized expression, not a union
    let ast = parse("(A1:B10)");
    assert!(matches!(ast, ASTNode::Paren(..)));
}

// ---------------------------------------------------------------------------
// Display / round-trip
// ---------------------------------------------------------------------------

#[test]
fn union_display_basic() {
    let ast = parse("(A1:A5,C1:C5)");
    let displayed = format!("{ast}");
    assert_eq!(displayed, "(A1:A5,C1:C5)");
}

#[test]
fn union_display_three_ranges() {
    let ast = parse("(A1:A5,C1:C5,E1:E5)");
    let displayed = format!("{ast}");
    assert_eq!(displayed, "(A1:A5,C1:C5,E1:E5)");
}

#[test]
fn union_display_in_function() {
    let ast = parse("SUM((A1:A5,C1:C5))");
    let displayed = format!("{ast}");
    assert_eq!(displayed, "SUM((A1:A5,C1:C5))");
}

#[test]
fn union_roundtrip_basic() {
    display_roundtrip("(A1:A5,C1:C5)");
}

#[test]
fn union_roundtrip_three_ranges() {
    display_roundtrip("(A1:A5,C1:C5,E1:E5)");
}

#[test]
fn union_roundtrip_in_function() {
    display_roundtrip("SUM((A1:A5,C1:C5))");
}

#[test]
fn union_roundtrip_nested() {
    display_roundtrip("SUM((A1:A5,C1:C5),D1)");
}

#[test]
fn union_roundtrip_single_cells() {
    display_roundtrip("(A1,B1,C1)");
}

// ---------------------------------------------------------------------------
// Column and row ranges in unions
// ---------------------------------------------------------------------------

#[test]
fn union_column_ranges() {
    let ast = parse("(A:A,C:C)");
    match &ast {
        ASTNode::Union { ranges } => {
            assert_eq!(ranges.len(), 2);
            for range in ranges {
                assert!(matches!(range, ASTNode::Range(..)));
            }
        }
        other => panic!("Expected Union, got {other:?}"),
    }
}

#[test]
fn union_row_ranges() {
    let ast = parse("(1:1,3:3)");
    match &ast {
        ASTNode::Union { ranges } => {
            assert_eq!(ranges.len(), 2);
            for range in ranges {
                assert!(matches!(range, ASTNode::Range(..)));
            }
        }
        other => panic!("Expected Union, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Whitespace handling
// ---------------------------------------------------------------------------

#[test]
fn union_with_spaces() {
    let ast = parse("( A1:A5 , C1:C5 )");
    match &ast {
        ASTNode::Union { ranges } => {
            assert_eq!(ranges.len(), 2);
        }
        other => panic!("Expected Union, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Union with absolute references
// ---------------------------------------------------------------------------

#[test]
fn union_absolute_refs() {
    let ast = parse("($A$1:$A$5,$C$1:$C$5)");
    match &ast {
        ASTNode::Union { ranges } => {
            assert_eq!(ranges.len(), 2);
            for range in ranges {
                assert!(matches!(range, ASTNode::Range(..)));
            }
        }
        other => panic!("Expected Union, got {other:?}"),
    }
    display_roundtrip("($A$1:$A$5,$C$1:$C$5)");
}

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

#[test]
fn union_in_nested_functions() {
    let ast = parse("SUMPRODUCT(SUM((A1:A5,C1:C5)),2)");
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name.as_ref(), "SUMPRODUCT");
            assert_eq!(args.len(), 2);
            match &args[0] {
                ASTNode::Function { name, args } => {
                    assert_eq!(name.as_ref(), "SUM");
                    assert_eq!(args.len(), 1);
                    assert!(matches!(&args[0], ASTNode::Union { .. }));
                }
                other => panic!("Expected inner SUM function, got {other:?}"),
            }
        }
        other => panic!("Expected SUMPRODUCT, got {other:?}"),
    }
}

#[test]
fn union_is_range_like() {
    // Union should be treated as range-like for intersection purposes
    let ast = parse("(A1:A5,C1:C5)");
    assert!(crate::expressions::is_range_like(&ast));
}
