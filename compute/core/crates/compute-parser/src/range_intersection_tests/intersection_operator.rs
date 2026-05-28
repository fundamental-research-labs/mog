use super::*;

// ===========================================================================
// Basics
// ===========================================================================

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

// ===========================================================================
// Left-Associativity
// ===========================================================================

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

// ===========================================================================
// Sheet-Qualified Operands
// ===========================================================================

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

// ===========================================================================
// Column/Row Ranges and Known Limitations
// ===========================================================================

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

// ===========================================================================
// Precedence with Infix Operators
// ===========================================================================

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

// ===========================================================================
// Function Arguments
// ===========================================================================

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
