//! First-principles tests for range and intersection operator semantics.
//!
//! These tests verify what SHOULD happen according to Excel's range (`:`) and
//! intersection (space) operator rules, not merely what the parser currently does.

use super::*;
use crate::ast::BinOp;
use crate::test_helpers::TestResolver;
use cell_types::SheetId;
use formula_types::{CellRef, RangeType};

#[path = "range_intersection_tests/display_round_trip.rs"]
mod display_round_trip;
#[path = "range_intersection_tests/error_cases.rs"]
mod error_cases;
#[path = "range_intersection_tests/intersection_operator.rs"]
mod intersection_operator;
#[path = "range_intersection_tests/literal_ranges.rs"]
mod literal_ranges;
#[path = "range_intersection_tests/non_intersection.rs"]
mod non_intersection;
#[path = "range_intersection_tests/range_operator.rs"]
mod range_operator;

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
