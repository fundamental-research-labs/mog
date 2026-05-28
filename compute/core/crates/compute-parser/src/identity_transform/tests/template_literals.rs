use super::super::{ast_to_identity, to_identity_formula};
use super::fixtures::MockResolver;
use crate::ast::{ASTNode, AbsFlags, CellRefNode, RangeRef};
use crate::parser::{ParseError, ParseErrorKind, parse_formula};
use cell_types::{CellId, SheetId};
use formula_types::{CellRef, IdentityFormulaRef, RangeType};

#[test]
fn boolean_literal() {
    let r = MockResolver::new();
    let f = to_identity_formula("=TRUE", &r).unwrap();
    assert_eq!(f.template, "TRUE");
    assert_eq!(f.refs.len(), 0);
}

#[test]
fn numeric_literal() {
    let r = MockResolver::new();
    let f = to_identity_formula("=1+2", &r).unwrap();
    assert_eq!(f.template, "1+2");
    assert_eq!(f.refs.len(), 0);
}

#[test]
fn string_literal() {
    let r = MockResolver::new();
    let f = to_identity_formula("=\"hello\"", &r).unwrap();
    assert_eq!(f.template, "\"hello\"");
    assert_eq!(f.refs.len(), 0);
}

#[test]
fn error_literal_template() {
    let r = MockResolver::new();
    let f = to_identity_formula("=#N/A", &r).unwrap();
    assert_eq!(f.template, "#N/A");
    assert_eq!(f.refs.len(), 0);
}

#[test]
fn parenthesized_expression() {
    let r = MockResolver::new();
    let f = to_identity_formula("=(A1+B1)*2", &r).unwrap();
    assert_eq!(f.template, "({0}+{1})*2");
    assert_eq!(f.refs.len(), 2);
}

#[test]
fn array_literal_template() {
    let r = MockResolver::new();
    let f = to_identity_formula("={1,2;3,4}", &r).unwrap();
    assert_eq!(f.template, "{1,2;3,4}");
    assert_eq!(f.refs.len(), 0);
}

#[test]
fn omitted_args() {
    let r = MockResolver::new();
    let f = to_identity_formula("=IF(A1,,0)", &r).unwrap();
    assert_eq!(f.template, "IF({0},,0)");
    assert_eq!(f.refs.len(), 1);
}

#[test]
fn unary_minus() {
    let r = MockResolver::new();
    let f = to_identity_formula("=-A1", &r).unwrap();
    assert_eq!(f.template, "-{0}");
    assert_eq!(f.refs.len(), 1);
}

#[test]
fn unary_percent() {
    let r = MockResolver::new();
    let f = to_identity_formula("=50%", &r).unwrap();
    assert_eq!(f.template, "50%");
    assert_eq!(f.refs.len(), 0);
}
