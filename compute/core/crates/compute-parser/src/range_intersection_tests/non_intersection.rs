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
