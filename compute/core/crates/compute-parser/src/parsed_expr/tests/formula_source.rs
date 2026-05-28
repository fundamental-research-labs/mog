use crate::ast::ASTNode;

use super::*;

#[test]
fn formula_source_parse_preserves_bytes() {
    let fs = FormulaSource::parse("=SUM(A1:B2)");
    assert_eq!(fs.original, "=SUM(A1:B2)");

    let fs = FormulaSource::parse("arbitrary  whitespace  ");
    assert_eq!(fs.original, "arbitrary  whitespace  ");
}

#[test]
fn formula_source_parse_on_malformed_is_error_ast() {
    let fs = FormulaSource::parse("=((");
    assert_eq!(fs.original, "=((");
    assert!(matches!(fs.ast, ASTNode::Error(_)));
}
