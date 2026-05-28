use crate::ast::{ASTNode, AbsFlags, BinOp, RangeRef, UnaryOp};
use formula_types::RangeType;

use super::fixtures::pos;

#[test]
fn binop_display_tokens() {
    let cases = [
        (BinOp::Add, "+"),
        (BinOp::Sub, "-"),
        (BinOp::Mul, "*"),
        (BinOp::Div, "/"),
        (BinOp::Pow, "^"),
        (BinOp::Concat, "&"),
        (BinOp::Eq, "="),
        (BinOp::Neq, "<>"),
        (BinOp::Lt, "<"),
        (BinOp::Gt, ">"),
        (BinOp::Lte, "<="),
        (BinOp::Gte, ">="),
        (BinOp::Intersect, " "),
    ];

    for (op, expected) in cases {
        assert_eq!(format!("{op}"), expected);
    }
}

#[test]
fn unaryop_display_tokens() {
    let cases = [
        (UnaryOp::Plus, "+"),
        (UnaryOp::Minus, "-"),
        (UnaryOp::Percent, "%"),
        (UnaryOp::ImplicitIntersection, "@"),
    ];

    for (op, expected) in cases {
        assert_eq!(format!("{op}"), expected);
    }
}

#[test]
fn test_intersect_ast_construction() {
    let node = ASTNode::BinaryOp {
        op: BinOp::Intersect,
        left: Box::new(ASTNode::Range(RangeRef {
            start: pos(0, 0),
            end: pos(9, 1),
            abs_start: AbsFlags::default(),
            abs_end: AbsFlags::default(),
            range_type: RangeType::CellRange,
        })),
        right: Box::new(ASTNode::Range(RangeRef {
            start: pos(4, 1),
            end: pos(19, 2),
            abs_start: AbsFlags::default(),
            abs_end: AbsFlags::default(),
            range_type: RangeType::CellRange,
        })),
    };

    assert_eq!(format!("{node}"), "A1:B10 B5:C20");
}

#[test]
fn test_intersect_eq_ne() {
    assert_eq!(BinOp::Intersect, BinOp::Intersect);
    assert_ne!(BinOp::Intersect, BinOp::Add);
}
