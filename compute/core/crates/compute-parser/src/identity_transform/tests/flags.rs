use super::super::{ast_to_identity, to_identity_formula};
use super::fixtures::MockResolver;
use crate::ast::{ASTNode, AbsFlags, CellRefNode, RangeRef};
use crate::parser::{ParseError, ParseErrorKind, parse_formula};
use cell_types::{CellId, SheetId};
use formula_types::{CellRef, IdentityFormulaRef, RangeType};

#[test]
fn dynamic_array_sequence() {
    let r = MockResolver::new();
    let f = to_identity_formula("=SEQUENCE(5)", &r).unwrap();
    assert!(f.is_dynamic_array);
    assert!(!f.is_volatile);
}

#[test]
fn dynamic_array_split() {
    let r = MockResolver::new();
    let f = to_identity_formula(r#"=SPLIT("a,b",",")"#, &r).unwrap();
    assert!(f.is_dynamic_array);
    assert!(!f.is_volatile);
}

#[test]
fn volatile_now() {
    let r = MockResolver::new();
    let f = to_identity_formula("=NOW()", &r).unwrap();
    assert!(f.is_volatile);
    assert!(!f.is_dynamic_array);
}

#[test]
fn randarray_is_dynamic_and_volatile() {
    let r = MockResolver::new();
    let f = to_identity_formula("=RANDARRAY(2,3)", &r).unwrap();
    assert!(f.is_dynamic_array);
    assert!(f.is_volatile);
}

#[test]
fn regular_function_no_flags() {
    let r = MockResolver::new();
    let f = to_identity_formula("=SUM(A1:B10)", &r).unwrap();
    assert!(!f.is_dynamic_array);
    assert!(!f.is_volatile);
}

#[test]
fn nested_dynamic_array_in_sum() {
    let r = MockResolver::new();
    let f = to_identity_formula("=SUM(SEQUENCE(5))", &r).unwrap();
    assert!(f.is_dynamic_array);
}

#[test]
fn volatile_in_expression() {
    let r = MockResolver::new();
    let f = to_identity_formula("=A1+RAND()", &r).unwrap();
    assert!(f.is_volatile);
    assert!(!f.is_dynamic_array);
}

#[test]
fn aggregate_flag_subtotal_top_level() {
    let r = MockResolver::new();
    let f = to_identity_formula("=SUBTOTAL(1, A1:A10)", &r).unwrap();
    assert!(f.is_aggregate);
}

#[test]
fn aggregate_flag_xlfn_subtotal_top_level() {
    // `_xlfn.` is stripped by normalize before parsing, so the AST sees
    // the bare function name — still aggregate.
    let r = MockResolver::new();
    let f = to_identity_formula("=_xlfn.SUBTOTAL(1, A1:A10)", &r).unwrap();
    assert!(f.is_aggregate);
}

#[test]
fn aggregate_flag_aggregate_top_level() {
    let r = MockResolver::new();
    let f = to_identity_formula("=AGGREGATE(9, 0, A1:A10)", &r).unwrap();
    assert!(f.is_aggregate);
}

#[test]
fn aggregate_flag_subtotal_case_insensitive() {
    let r = MockResolver::new();
    let f = to_identity_formula("=subtotal(1, A1:A10)", &r).unwrap();
    assert!(f.is_aggregate);
}

#[test]
fn aggregate_flag_plain_sum_false() {
    let r = MockResolver::new();
    let f = to_identity_formula("=SUM(A1:A10)", &r).unwrap();
    assert!(!f.is_aggregate);
}

#[test]
fn aggregate_flag_nested_subtotal_false() {
    // The top-level call is IF; SUBTOTAL is nested — match the old
    // shadow parser's `starts_with("SUBTOTAL(")` semantics.
    let r = MockResolver::new();
    let f = to_identity_formula("=IF(TRUE, SUBTOTAL(1, A1:A10), 0)", &r).unwrap();
    assert!(!f.is_aggregate);
}

#[test]
fn aggregate_flag_constant_false() {
    let r = MockResolver::new();
    let f = to_identity_formula("=42", &r).unwrap();
    assert!(!f.is_aggregate);
}
