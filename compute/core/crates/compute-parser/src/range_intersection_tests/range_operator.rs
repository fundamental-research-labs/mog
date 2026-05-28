use super::*;

// ===========================================================================
// Literal Range Binding Power
// ===========================================================================

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

// ===========================================================================
// Expression-Level Range Operator (RangeOp)
// ===========================================================================

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
