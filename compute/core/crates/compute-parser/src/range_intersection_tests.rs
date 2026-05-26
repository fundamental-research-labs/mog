//! First-principles tests for range and intersection operator semantics.
//!
//! These tests verify what SHOULD happen according to Excel's range (`:`) and
//! intersection (space) operator rules, not merely what the parser currently does.

use super::*;
use crate::ast::BinOp;
use crate::test_helpers::TestResolver;
use cell_types::SheetId;
use formula_types::{CellRef, RangeType};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Parse a formula (without resolver) and return the bare `ASTNode`.
fn p(formula: &str) -> ASTNode {
    parse_formula(formula, None)
        .unwrap_or_else(|e| panic!("parse_formula({formula:?}) failed: {e}"))
        .into_inner()
}

/// Parse with the test resolver.
fn pr(formula: &str) -> ASTNode {
    let resolver = TestResolver::new();
    parse_formula(formula, Some(&resolver))
        .unwrap_or_else(|e| panic!("parse_formula({formula:?}) with resolver failed: {e}"))
        .into_inner()
}

/// Assert that `formula` fails to parse.
fn p_err(formula: &str) {
    assert!(
        parse_formula(formula, None).is_err(),
        "Expected parse error for {:?}, but it succeeded with: {:?}",
        formula,
        parse_formula(formula, None).unwrap().into_inner()
    );
}

/// Check that an `ASTNode` is a Range with the given `range_type`.
fn assert_range(node: &ASTNode, expected_type: RangeType) {
    match node {
        ASTNode::Range(r) => assert_eq!(
            r.range_type, expected_type,
            "Expected {:?}, got {:?}",
            expected_type, r.range_type
        ),
        other => panic!("Expected Range({expected_type:?}), got {other:?}"),
    }
}

/// Check that an `ASTNode` is a `BinaryOp` with the given operator.
fn assert_binop(node: &ASTNode, expected_op: BinOp) -> (&ASTNode, &ASTNode) {
    match node {
        ASTNode::BinaryOp { op, left, right } => {
            assert_eq!(
                *op, expected_op,
                "Expected BinOp::{expected_op:?}, got BinOp::{op:?}"
            );
            (left.as_ref(), right.as_ref())
        }
        other => panic!("Expected BinaryOp({expected_op:?}), got {other:?}"),
    }
}

// ===========================================================================
// 1. Range Operator Binding Power
// ===========================================================================

mod range_binding_power {
    use super::*;

    #[test]
    fn range_binds_tighter_than_add() {
        // A1:B1+C1 should parse as (A1:B1)+C1
        let ast = p("A1:B1+C1");
        let (left, right) = assert_binop(&ast, BinOp::Add);
        assert_range(left, RangeType::CellRange);
        assert!(matches!(right, ASTNode::CellReference(..)));
    }

    #[test]
    fn range_binds_tighter_than_sub() {
        let ast = p("A1:B1-C1");
        let (left, _right) = assert_binop(&ast, BinOp::Sub);
        assert_range(left, RangeType::CellRange);
    }

    #[test]
    fn range_binds_tighter_than_mul() {
        // A1:B1*C1 should parse as (A1:B1)*C1
        let ast = p("A1:B1*C1");
        let (left, right) = assert_binop(&ast, BinOp::Mul);
        assert_range(left, RangeType::CellRange);
        assert!(matches!(right, ASTNode::CellReference(..)));
    }

    #[test]
    fn range_binds_tighter_than_concat() {
        // A1:B1&C1 should parse as (A1:B1)&C1
        let ast = p("A1:B1&C1");
        let (left, right) = assert_binop(&ast, BinOp::Concat);
        assert_range(left, RangeType::CellRange);
        assert!(matches!(right, ASTNode::CellReference(..)));
    }

    #[test]
    fn range_binds_tighter_than_eq() {
        // A1:B1=C1 should parse as (A1:B1)=C1
        let ast = p("A1:B1=C1");
        let (left, right) = assert_binop(&ast, BinOp::Eq);
        assert_range(left, RangeType::CellRange);
        assert!(matches!(right, ASTNode::CellReference(..)));
    }

    #[test]
    fn range_binds_tighter_than_lt() {
        let ast = p("A1:B1<C1");
        let (left, _) = assert_binop(&ast, BinOp::Lt);
        assert_range(left, RangeType::CellRange);
    }

    #[test]
    fn range_binds_tighter_than_gt() {
        let ast = p("A1:B1>C1");
        let (left, _) = assert_binop(&ast, BinOp::Gt);
        assert_range(left, RangeType::CellRange);
    }

    #[test]
    fn range_inside_function_arg() {
        // SUM(A1:B1+C1) should parse as SUM((A1:B1)+C1) — one arg
        let ast = p("SUM(A1:B1+C1)");
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name.as_ref(), "SUM");
                assert_eq!(args.len(), 1);
                let (left, _) = assert_binop(&args[0], BinOp::Add);
                assert_range(left, RangeType::CellRange);
            }
            other => panic!("Expected Function, got {other:?}"),
        }
    }

    #[test]
    fn range_on_both_sides_of_add() {
        // A1:B1+C1:D1 should parse as (A1:B1)+(C1:D1)
        let ast = p("A1:B1+C1:D1");
        let (left, right) = assert_binop(&ast, BinOp::Add);
        assert_range(left, RangeType::CellRange);
        assert_range(right, RangeType::CellRange);
    }

    #[test]
    #[allow(clippy::float_cmp)]
    fn range_binds_tighter_than_pow() {
        // A1:B1^2 should parse as (A1:B1)^2
        let ast = p("A1:B1^2");
        let (left, right) = assert_binop(&ast, BinOp::Pow);
        assert_range(left, RangeType::CellRange);
        assert!(matches!(right, ASTNode::Number(n) if *n == 2.0));
    }
}

// ===========================================================================
// 2. Expression-Level Range Operator (RangeOp)
// ===========================================================================

mod expression_level_range {
    use super::*;

    #[test]
    fn index_colon_index_produces_range_op() {
        // INDEX(A1:B5,1,1):INDEX(A1:B5,1,2) -> RangeOp(Function, Function)
        let ast = p("INDEX(A1:B5,1,1):INDEX(A1:B5,1,2)");
        match &ast {
            ASTNode::RangeOp { start, end } => {
                assert!(
                    matches!(start.as_ref(), ASTNode::Function { name, .. } if name.as_ref() == "INDEX"),
                    "Expected Function(INDEX) as start, got {start:?}"
                );
                assert!(
                    matches!(end.as_ref(), ASTNode::Function { name, .. } if name.as_ref() == "INDEX"),
                    "Expected Function(INDEX) as end, got {end:?}"
                );
            }
            other => panic!("Expected RangeOp, got {other:?}"),
        }
    }

    #[test]
    fn paren_colon_paren_produces_range_op() {
        // (A1):(B1) -> RangeOp(Paren, Paren)
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
    fn row_range_1_5_is_range_not_range_op() {
        // 1:5 should parse as a Range node (row range), not a RangeOp
        let ast = p("1:5");
        assert_range(&ast, RangeType::RowRange);
        // Verify the row values
        match &ast {
            ASTNode::Range(r) => {
                match (&r.start, &r.end) {
                    (CellRef::Positional { row: r1, .. }, CellRef::Positional { row: r2, .. }) => {
                        assert_eq!(*r1, 0); // 1-indexed "1" -> 0-indexed 0
                        assert_eq!(*r2, 4); // 1-indexed "5" -> 0-indexed 4
                    }
                    _ => panic!("Expected Positional refs"),
                }
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn literal_range_a1_b10_is_range_not_range_op() {
        // A1:B10 is a literal range — produces Range, not RangeOp
        let ast = p("A1:B10");
        assert_range(&ast, RangeType::CellRange);
    }

    #[test]
    fn cell_ref_colon_function_produces_range_op() {
        // A1:INDEX(B1:B10,1) — left side is literal but right side is function
        // The literal parser tries A1:INDEX but that fails, so `:` becomes infix
        let ast = p("A1:INDEX(B1:B10,1)");
        match &ast {
            ASTNode::RangeOp { start, end } => {
                assert!(
                    matches!(start.as_ref(), ASTNode::CellReference(..)),
                    "Expected CellReference as start, got {start:?}"
                );
                assert!(
                    matches!(end.as_ref(), ASTNode::Function { name, .. } if name.as_ref() == "INDEX"),
                    "Expected Function(INDEX) as end, got {end:?}"
                );
            }
            other => panic!("Expected RangeOp, got {other:?}"),
        }
    }
}

// ===========================================================================
// 3. Intersection Operator Basics
// ===========================================================================

mod intersection_basics {
    use super::*;

    #[test]
    fn two_ranges_with_space() {
        // A1:B10 B5:C20 -> BinaryOp(Intersect, Range, Range)
        let ast = p("A1:B10 B5:C20");
        let (left, right) = assert_binop(&ast, BinOp::Intersect);
        assert_range(left, RangeType::CellRange);
        assert_range(right, RangeType::CellRange);
    }

    #[test]
    fn two_cell_refs_with_space() {
        // A1 B1 -> BinaryOp(Intersect, CellReference, CellReference)
        let ast = p("A1 B1");
        let (left, right) = assert_binop(&ast, BinOp::Intersect);
        assert!(matches!(left, ASTNode::CellReference(..)));
        assert!(matches!(right, ASTNode::CellReference(..)));
    }

    #[test]
    fn absolute_refs_intersection() {
        // $A$1:$B$10 $B$5:$C$20 -> intersection with absolute refs
        let ast = p("$A$1:$B$10 $B$5:$C$20");
        let (left, right) = assert_binop(&ast, BinOp::Intersect);
        assert_range(left, RangeType::CellRange);
        assert_range(right, RangeType::CellRange);

        // Verify absoluteness flags on left range
        match left {
            ASTNode::Range(r) => {
                assert!(r.abs_start.col);
                assert!(r.abs_start.row);
                assert!(r.abs_end.col);
                assert!(r.abs_end.row);
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn intersection_with_multiple_spaces() {
        // A1:B10   C1:D10 (multiple spaces) -> still intersection
        let ast = p("A1:B10   C1:D10");
        let (left, right) = assert_binop(&ast, BinOp::Intersect);
        assert_range(left, RangeType::CellRange);
        assert_range(right, RangeType::CellRange);
    }
}

// ===========================================================================
// 4. Intersection Left-Associativity
// ===========================================================================

mod intersection_associativity {
    use super::*;

    #[test]
    fn three_way_intersection_is_left_assoc() {
        // A1:B10 B5:C20 C1:D5 -> (A1:B10 intersect B5:C20) intersect C1:D5
        let ast = p("A1:B10 B5:C20 C1:D5");
        // Outer is Intersect
        let (left, right) = assert_binop(&ast, BinOp::Intersect);
        // Right is the last range
        assert_range(right, RangeType::CellRange);
        // Left is itself an Intersect
        let (ll, lr) = assert_binop(left, BinOp::Intersect);
        assert_range(ll, RangeType::CellRange);
        assert_range(lr, RangeType::CellRange);
    }

    #[test]
    fn four_way_intersection() {
        // A1:B10 B1:C10 C1:D10 D1:E10 -> left-assoc chain
        let ast = p("A1:B10 B1:C10 C1:D10 D1:E10");
        // Outermost: (...) intersect D1:E10
        let (left3, right3) = assert_binop(&ast, BinOp::Intersect);
        assert_range(right3, RangeType::CellRange);
        // Next: (...) intersect C1:D10
        let (left2, right2) = assert_binop(left3, BinOp::Intersect);
        assert_range(right2, RangeType::CellRange);
        // Innermost: A1:B10 intersect B1:C10
        let (left1, right1) = assert_binop(left2, BinOp::Intersect);
        assert_range(left1, RangeType::CellRange);
        assert_range(right1, RangeType::CellRange);
    }
}

// ===========================================================================
// 5. Intersection with Sheet-Qualified Refs
// ===========================================================================

mod intersection_sheet_qualified {
    use super::*;

    #[test]
    fn two_sheet_qualified_ranges() {
        // Sheet1!A1:B10 Sheet1!B5:C20 -> intersection of two sheet-qualified ranges
        let ast = pr("Sheet1!A1:B10 Sheet1!B5:C20");
        let (left, right) = assert_binop(&ast, BinOp::Intersect);
        // Both sides should be SheetRef wrapping a Range
        match left {
            ASTNode::SheetRef { sheet, inner } => {
                assert_eq!(*sheet, SheetId::from_raw(1));
                assert_range(inner.as_ref(), RangeType::CellRange);
            }
            other => panic!("Expected SheetRef on left, got {other:?}"),
        }
        match right {
            ASTNode::SheetRef { sheet, inner } => {
                assert_eq!(*sheet, SheetId::from_raw(1));
                assert_range(inner.as_ref(), RangeType::CellRange);
            }
            other => panic!("Expected SheetRef on right, got {other:?}"),
        }
    }

    #[test]
    fn sheet_ref_intersect_cell_ref() {
        // Sheet1!A1 B1 -> intersection of sheet ref with plain cell ref
        let ast = pr("Sheet1!A1 B1");
        let (left, right) = assert_binop(&ast, BinOp::Intersect);
        assert!(
            matches!(left, ASTNode::SheetRef { .. }),
            "Expected SheetRef on left, got {left:?}"
        );
        assert!(
            matches!(right, ASTNode::CellReference(..)),
            "Expected CellReference on right, got {right:?}"
        );
    }

    #[test]
    fn different_sheets_intersection() {
        // Sheet1!A1:B10 Sheet2!B5:C20 -> intersection (Excel allows this; eval may error)
        let ast = pr("Sheet1!A1:B10 Sheet2!B5:C20");
        let (left, right) = assert_binop(&ast, BinOp::Intersect);
        match left {
            ASTNode::SheetRef { sheet, .. } => assert_eq!(*sheet, SheetId::from_raw(1)),
            other => panic!("Expected SheetRef(1), got {other:?}"),
        }
        match right {
            ASTNode::SheetRef { sheet, .. } => assert_eq!(*sheet, SheetId::from_raw(2)),
            other => panic!("Expected SheetRef(2), got {other:?}"),
        }
    }
}

// ===========================================================================
// 6. Intersection with Column/Row Ranges
// ===========================================================================

mod intersection_col_row_ranges {
    use super::*;

    #[test]
    fn two_column_ranges() {
        // A:C B:D -> intersection of two column ranges
        let ast = p("A:C B:D");
        let (left, right) = assert_binop(&ast, BinOp::Intersect);
        assert_range(left, RangeType::ColumnRange);
        assert_range(right, RangeType::ColumnRange);
    }

    #[test]
    fn two_row_ranges_not_detected_as_intersection() {
        // 1:5 3:7 -> In Excel, this would be an intersection of two row ranges.
        // However, our parser's intersection heuristic only fires when the next
        // byte after whitespace is alpha or `$`. Since `3` is a digit, the
        // intersection is not detected, and we get a trailing-input error.
        // This is a known limitation: row-range intersection requires explicit
        // wrapping, e.g., SUM((1:5) (3:7)) would need different handling.
        assert!(parse_formula("1:5 3:7", None).is_err());
    }

    #[test]
    fn column_range_intersect_row_range_not_detected() {
        // A:C 1:5 -> In Excel, this is an intersection of a column range with a
        // row range. Our parser's intersection heuristic only fires when the next
        // byte after whitespace is alpha or `$`. Since `1` is a digit, the
        // intersection is not detected, producing a trailing-input error.
        // This is a known limitation of the digit-starting row range case.
        assert!(parse_formula("A:C 1:5", None).is_err());
    }
}

// ===========================================================================
// 7. Intersection Followed by Operators
// ===========================================================================

mod intersection_with_arithmetic {
    use super::*;

    #[test]
    #[allow(clippy::float_cmp)]
    fn intersection_binds_tighter_than_add() {
        // A1:B10 B5:C20+1 -> (A1:B10 intersect B5:C20)+1
        // Intersection bp (15) > Add bp (6), so intersection consumes B5:C20
        // before + can claim it.
        let ast = p("A1:B10 B5:C20+1");
        let (left, right) = assert_binop(&ast, BinOp::Add);
        // left should be the intersection
        let (il, ir) = assert_binop(left, BinOp::Intersect);
        assert_range(il, RangeType::CellRange);
        assert_range(ir, RangeType::CellRange);
        // right should be 1
        assert!(
            matches!(right, ASTNode::Number(n) if *n == 1.0),
            "Expected Number(1), got {right:?}"
        );
    }

    #[test]
    #[allow(clippy::float_cmp)]
    fn intersection_binds_tighter_than_mul() {
        // A1:B10 B5:C20*2 -> (A1:B10 intersect B5:C20)*2
        let ast = p("A1:B10 B5:C20*2");
        let (left, right) = assert_binop(&ast, BinOp::Mul);
        assert_binop(left, BinOp::Intersect);
        assert!(matches!(right, ASTNode::Number(n) if *n == 2.0));
    }

    #[test]
    fn intersection_binds_tighter_than_eq() {
        // A1:B10 B5:C20=0 -> (A1:B10 intersect B5:C20)=0
        let ast = p("A1:B10 B5:C20=0");
        let (left, _right) = assert_binop(&ast, BinOp::Eq);
        assert_binop(left, BinOp::Intersect);
    }

    #[test]
    fn intersection_binds_tighter_than_concat() {
        // A1 B1&"x" -> (A1 intersect B1)&"x"
        let ast = p("A1 B1&\"x\"");
        let (left, right) = assert_binop(&ast, BinOp::Concat);
        assert_binop(left, BinOp::Intersect);
        assert!(matches!(right, ASTNode::Text(s) if s == "x"));
    }
}

// ===========================================================================
// 8. Intersection in Function Arguments
// ===========================================================================

mod intersection_in_functions {
    use super::*;

    #[test]
    fn sum_with_intersection_arg() {
        // SUM(A1:B10 B5:C20) -> SUM with one arg that's an intersection
        let ast = p("SUM(A1:B10 B5:C20)");
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name.as_ref(), "SUM");
                assert_eq!(args.len(), 1);
                let (left, right) = assert_binop(&args[0], BinOp::Intersect);
                assert_range(left, RangeType::CellRange);
                assert_range(right, RangeType::CellRange);
            }
            other => panic!("Expected Function(SUM), got {other:?}"),
        }
    }

    #[test]
    fn if_with_intersection_first_arg() {
        // IF(A1:B10 B5:C20, 1, 0) -> intersection as first arg of IF
        let ast = p("IF(A1:B10 B5:C20,1,0)");
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name.as_ref(), "IF");
                assert_eq!(args.len(), 3);
                assert_binop(&args[0], BinOp::Intersect);
                assert_eq!(args[1], ASTNode::Number(1.0));
                assert_eq!(args[2], ASTNode::Number(0.0));
            }
            other => panic!("Expected Function(IF), got {other:?}"),
        }
    }

    #[test]
    fn sumproduct_with_intersection() {
        // SUMPRODUCT(A1:C10 B1:B10) -> one intersection arg
        let ast = p("SUMPRODUCT(A1:C10 B1:B10)");
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name.as_ref(), "SUMPRODUCT");
                assert_eq!(args.len(), 1);
                assert_binop(&args[0], BinOp::Intersect);
            }
            other => panic!("Expected Function(SUMPRODUCT), got {other:?}"),
        }
    }
}

// ===========================================================================
// 9. Non-Intersection Whitespace (False Positives)
// ===========================================================================

mod non_intersection {
    use super::*;

    #[test]
    fn addition_with_spaces_is_not_intersection() {
        // A1 + B1 -> BinaryOp(Add), not Intersect
        let ast = p("A1 + B1");
        assert_binop(&ast, BinOp::Add);
    }

    #[test]
    fn function_args_separated_by_comma_not_intersection() {
        // SUM(A1, B1) -> two separate args, not intersection
        let ast = p("SUM(A1, B1)");
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name.as_ref(), "SUM");
                assert_eq!(args.len(), 2);
                assert!(matches!(&args[0], ASTNode::CellReference(..)));
                assert!(matches!(&args[1], ASTNode::CellReference(..)));
            }
            other => panic!("Expected Function(SUM) with 2 args, got {other:?}"),
        }
    }

    #[test]
    fn cell_ref_space_string_is_not_intersection() {
        // A1 "text" -> should NOT be intersection (string doesn't start with alpha/$)
        // The parser sees A1, then whitespace, then `"` which is not alpha/$.
        // Since `"` doesn't start an infix op either, it should be trailing input error
        // or A1 followed by unconsumed text.
        assert!(parse_formula("A1 \"text\"", None).is_err());
    }

    #[test]
    fn cell_ref_space_number_is_not_intersection() {
        // A1 123 -> NOT intersection (number doesn't start with alpha/$)
        assert!(parse_formula("A1 123", None).is_err());
    }

    #[test]
    fn non_range_like_space_non_range_like() {
        // 1+2 3+4 -> 1+2 is Number, not range-like, so no intersection
        // Should error due to trailing input
        assert!(parse_formula("1+2 3+4", None).is_err());
    }

    #[test]
    fn subtraction_not_intersection() {
        // A1 - B1 -> subtraction, not intersection
        let ast = p("A1 - B1");
        assert_binop(&ast, BinOp::Sub);
    }

    #[test]
    fn multiplication_not_intersection() {
        // A1 * B1 -> multiplication
        let ast = p("A1 * B1");
        assert_binop(&ast, BinOp::Mul);
    }

    #[test]
    fn comparison_not_intersection() {
        // A1 = B1 -> comparison, not intersection
        let ast = p("A1 = B1");
        assert_binop(&ast, BinOp::Eq);
    }
}

// ===========================================================================
// 10. Row Ranges
// ===========================================================================

mod row_ranges {
    use super::*;

    #[test]
    fn single_row_range() {
        // 1:1 -> Range(RowRange) for row 1
        let ast = p("1:1");
        match &ast {
            ASTNode::Range(r) => {
                assert_eq!(r.range_type, RangeType::RowRange);
                match (&r.start, &r.end) {
                    (CellRef::Positional { row: r1, .. }, CellRef::Positional { row: r2, .. }) => {
                        assert_eq!(*r1, 0); // row "1" is 0-indexed
                        assert_eq!(*r2, 0);
                    }
                    _ => panic!("Expected Positional refs"),
                }
            }
            other => panic!("Expected Range(RowRange), got {other:?}"),
        }
    }

    #[test]
    fn full_row_range() {
        // 1:1048576 -> max valid row range
        let ast = p("1:1048576");
        match &ast {
            ASTNode::Range(r) => {
                assert_eq!(r.range_type, RangeType::RowRange);
                match (&r.start, &r.end) {
                    (CellRef::Positional { row: r1, .. }, CellRef::Positional { row: r2, .. }) => {
                        assert_eq!(*r1, 0);
                        assert_eq!(*r2, 1_048_575);
                    }
                    _ => panic!("Expected Positional refs"),
                }
            }
            other => panic!("Expected Range(RowRange), got {other:?}"),
        }
    }

    #[test]
    fn absolute_row_range() {
        // $1:$5 -> absolute row range
        let ast = p("$1:$5");
        match &ast {
            ASTNode::Range(r) => {
                assert_eq!(r.range_type, RangeType::RowRange);
                assert!(r.abs_start.row);
                assert!(r.abs_end.row);
                match (&r.start, &r.end) {
                    (CellRef::Positional { row: r1, .. }, CellRef::Positional { row: r2, .. }) => {
                        assert_eq!(*r1, 0);
                        assert_eq!(*r2, 4);
                    }
                    _ => panic!("Expected Positional refs"),
                }
            }
            other => panic!("Expected Range(RowRange), got {other:?}"),
        }
    }

    #[test]
    fn mixed_absolute_row_range() {
        // $1:5 -> mixed: start absolute, end relative
        let ast = p("$1:5");
        match &ast {
            ASTNode::Range(r) => {
                assert_eq!(r.range_type, RangeType::RowRange);
                assert!(r.abs_start.row);
                assert!(!r.abs_end.row);
            }
            other => panic!("Expected Range(RowRange), got {other:?}"),
        }
    }

    #[test]
    fn multi_row_range() {
        // 5:10 -> rows 5 through 10
        let ast = p("5:10");
        match &ast {
            ASTNode::Range(r) => {
                assert_eq!(r.range_type, RangeType::RowRange);
                match (&r.start, &r.end) {
                    (CellRef::Positional { row: r1, .. }, CellRef::Positional { row: r2, .. }) => {
                        assert_eq!(*r1, 4);
                        assert_eq!(*r2, 9);
                    }
                    _ => panic!("Expected Positional refs"),
                }
            }
            other => panic!("Expected Range(RowRange), got {other:?}"),
        }
    }
}

// ===========================================================================
// 11. Column Ranges
// ===========================================================================

mod column_ranges {
    use super::*;

    #[test]
    fn single_column_range() {
        // A:A -> single column
        let ast = p("A:A");
        match &ast {
            ASTNode::Range(r) => {
                assert_eq!(r.range_type, RangeType::ColumnRange);
                match (&r.start, &r.end) {
                    (CellRef::Positional { col: c1, .. }, CellRef::Positional { col: c2, .. }) => {
                        assert_eq!(*c1, 0);
                        assert_eq!(*c2, 0);
                    }
                    _ => panic!("Expected Positional refs"),
                }
            }
            other => panic!("Expected Range(ColumnRange), got {other:?}"),
        }
    }

    #[test]
    fn full_column_range() {
        // A:XFD -> max valid column range
        let ast = p("A:XFD");
        match &ast {
            ASTNode::Range(r) => {
                assert_eq!(r.range_type, RangeType::ColumnRange);
                match (&r.start, &r.end) {
                    (CellRef::Positional { col: c1, .. }, CellRef::Positional { col: c2, .. }) => {
                        assert_eq!(*c1, 0);
                        assert_eq!(*c2, 16383);
                    }
                    _ => panic!("Expected Positional refs"),
                }
            }
            other => panic!("Expected Range(ColumnRange), got {other:?}"),
        }
    }

    #[test]
    fn absolute_column_range() {
        // $A:$C -> absolute column range
        let ast = p("$A:$C");
        match &ast {
            ASTNode::Range(r) => {
                assert_eq!(r.range_type, RangeType::ColumnRange);
                assert!(r.abs_start.col);
                assert!(r.abs_end.col);
                match (&r.start, &r.end) {
                    (CellRef::Positional { col: c1, .. }, CellRef::Positional { col: c2, .. }) => {
                        assert_eq!(*c1, 0);
                        assert_eq!(*c2, 2);
                    }
                    _ => panic!("Expected Positional refs"),
                }
            }
            other => panic!("Expected Range(ColumnRange), got {other:?}"),
        }
    }

    #[test]
    fn mixed_absolute_column_range() {
        // $A:C -> mixed: start absolute, end relative
        let ast = p("$A:C");
        match &ast {
            ASTNode::Range(r) => {
                assert_eq!(r.range_type, RangeType::ColumnRange);
                assert!(r.abs_start.col);
                assert!(!r.abs_end.col);
            }
            other => panic!("Expected Range(ColumnRange), got {other:?}"),
        }
    }

    #[test]
    fn multi_column_range() {
        // B:F -> columns B through F
        let ast = p("B:F");
        match &ast {
            ASTNode::Range(r) => {
                assert_eq!(r.range_type, RangeType::ColumnRange);
                match (&r.start, &r.end) {
                    (CellRef::Positional { col: c1, .. }, CellRef::Positional { col: c2, .. }) => {
                        assert_eq!(*c1, 1); // B
                        assert_eq!(*c2, 5); // F
                    }
                    _ => panic!("Expected Positional refs"),
                }
            }
            other => panic!("Expected Range(ColumnRange), got {other:?}"),
        }
    }
}

// ===========================================================================
// 12. Range with Absolute Refs
// ===========================================================================

mod absolute_ranges {
    use super::*;

    #[test]
    fn all_absolute() {
        // $A$1:$B$10 -> all flags true
        let ast = p("$A$1:$B$10");
        match &ast {
            ASTNode::Range(r) => {
                assert_eq!(r.range_type, RangeType::CellRange);
                assert!(r.abs_start.col, "start col should be absolute");
                assert!(r.abs_start.row, "start row should be absolute");
                assert!(r.abs_end.col, "end col should be absolute");
                assert!(r.abs_end.row, "end row should be absolute");
                match (&r.start, &r.end) {
                    (
                        CellRef::Positional {
                            row: r1, col: c1, ..
                        },
                        CellRef::Positional {
                            row: r2, col: c2, ..
                        },
                    ) => {
                        assert_eq!(*r1, 0);
                        assert_eq!(*c1, 0);
                        assert_eq!(*r2, 9);
                        assert_eq!(*c2, 1);
                    }
                    _ => panic!("Expected Positional refs"),
                }
            }
            other => panic!("Expected Range, got {other:?}"),
        }
    }

    #[test]
    fn row_absolute_only() {
        // A$1:B$10 -> only row absolute
        let ast = p("A$1:B$10");
        match &ast {
            ASTNode::Range(r) => {
                assert_eq!(r.range_type, RangeType::CellRange);
                assert!(!r.abs_start.col);
                assert!(r.abs_start.row);
                assert!(!r.abs_end.col);
                assert!(r.abs_end.row);
            }
            other => panic!("Expected Range, got {other:?}"),
        }
    }

    #[test]
    fn col_absolute_only() {
        // $A1:$B10 -> only col absolute
        let ast = p("$A1:$B10");
        match &ast {
            ASTNode::Range(r) => {
                assert_eq!(r.range_type, RangeType::CellRange);
                assert!(r.abs_start.col);
                assert!(!r.abs_start.row);
                assert!(r.abs_end.col);
                assert!(!r.abs_end.row);
            }
            other => panic!("Expected Range, got {other:?}"),
        }
    }

    #[test]
    fn mixed_absolute_start_end() {
        // $A$1:B10 -> start all absolute, end all relative
        let ast = p("$A$1:B10");
        match &ast {
            ASTNode::Range(r) => {
                assert_eq!(r.range_type, RangeType::CellRange);
                assert!(r.abs_start.col);
                assert!(r.abs_start.row);
                assert!(!r.abs_end.col);
                assert!(!r.abs_end.row);
            }
            other => panic!("Expected Range, got {other:?}"),
        }
    }

    #[test]
    fn all_relative() {
        // A1:B10 -> all relative (baseline)
        let ast = p("A1:B10");
        match &ast {
            ASTNode::Range(r) => {
                assert!(!r.abs_start.col);
                assert!(!r.abs_start.row);
                assert!(!r.abs_end.col);
                assert!(!r.abs_end.row);
            }
            other => panic!("Expected Range, got {other:?}"),
        }
    }
}

// ===========================================================================
// 13. Display Round-Trip for Range Types
// ===========================================================================

mod display_round_trip {
    use super::*;

    fn round_trip(formula: &str) {
        let ast1 = parse_formula(formula, None).unwrap().into_inner();
        let display = format!("{ast1}");
        let ast2 = parse_formula(&display, None).unwrap_or_else(|e| {
            panic!("Round-trip re-parse failed for '{formula}' -> '{display}': {e}")
        });
        let ast2 = ast2.into_inner();
        assert_eq!(
            ast1, ast2,
            "Round-trip failed for '{formula}' -> '{display}'"
        );
    }

    #[test]
    fn round_trip_cell_range() {
        round_trip("A1:B10");
    }

    #[test]
    fn round_trip_absolute_range() {
        round_trip("$A$1:$B$10");
    }

    #[test]
    fn round_trip_mixed_absolute_range() {
        round_trip("$A1:B$10");
    }

    #[test]
    fn round_trip_row_range() {
        round_trip("1:5");
    }

    #[test]
    fn round_trip_absolute_row_range() {
        round_trip("$1:$5");
    }

    #[test]
    fn round_trip_column_range() {
        round_trip("A:C");
    }

    #[test]
    fn round_trip_absolute_column_range() {
        round_trip("$A:$C");
    }

    #[test]
    fn round_trip_single_row() {
        round_trip("1:1");
    }

    #[test]
    fn round_trip_single_column() {
        round_trip("A:A");
    }

    #[test]
    fn round_trip_max_row_range() {
        round_trip("1:1048576");
    }

    #[test]
    fn round_trip_max_column_range() {
        round_trip("A:XFD");
    }

    #[test]
    fn round_trip_range_plus_arithmetic() {
        // A1:B1+C1 -> display -> re-parse should match
        round_trip("A1:B1+C1");
    }

    #[test]
    fn round_trip_intersection() {
        // A1:B10 B5:C20 -> display -> re-parse
        // Display for Intersect uses a space separator
        round_trip("A1:B10 B5:C20");
    }

    #[test]
    fn round_trip_range_op() {
        // (A1):(B1) -> display -> re-parse
        round_trip("(A1):(B1)");
    }

    #[test]
    fn round_trip_nested_intersection() {
        // Three-way intersection round-trip
        round_trip("A1:B10 B5:C20 C1:D5");
    }
}

// ===========================================================================
// 14. Error Cases
// ===========================================================================

mod error_cases {
    use super::*;

    #[test]
    fn trailing_colon_errors() {
        // A1: -> trailing colon should error
        p_err("A1:");
    }

    #[test]
    fn leading_colon_errors() {
        // :A1 -> leading colon should error
        p_err(":A1");
    }

    #[test]
    fn double_colon_errors() {
        // A1::B1 -> double colon should error
        p_err("A1::B1");
    }

    #[test]
    fn colon_alone_errors() {
        // Just a colon
        p_err(":");
    }

    #[test]
    fn colon_in_expression_context() {
        // 1+: -> colon after operator
        p_err("1+:");
    }

    #[test]
    fn row_range_overflow() {
        // Row beyond max
        p_err("1:1048577");
    }
}
