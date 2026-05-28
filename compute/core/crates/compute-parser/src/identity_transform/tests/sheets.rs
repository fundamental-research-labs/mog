use super::super::{ast_to_identity, to_identity_formula};
use super::fixtures::MockResolver;
use crate::ast::{ASTNode, AbsFlags, CellRefNode, RangeRef};
use crate::parser::{ParseError, ParseErrorKind, parse_formula};
use cell_types::{CellId, SheetId};
use formula_types::{CellRef, IdentityFormulaRef, RangeType};

#[test]
fn cross_sheet_ref() {
    let mut r = MockResolver::new();
    r.add_sheet("Sheet2", 2);
    let f = to_identity_formula("=Sheet2!A1", &r).unwrap();
    // Template should NOT include the sheet prefix.
    assert_eq!(f.template, "{0}");
    assert_eq!(f.refs.len(), 1);
}

#[test]
fn unresolved_sheet_emits_ref_error() {
    let r = MockResolver::new();
    let result = to_identity_formula("=NoSuchSheet!A1", &r);
    // Unknown sheets now gracefully emit #REF! instead of returning an error
    assert!(result.is_ok());
    assert_eq!(result.unwrap().template, "#REF!");
}

#[test]
fn unresolved_sheet_in_compound_expression() {
    let r = MockResolver::new();
    // =NoSuchSheet!A1+1 — the unresolvable ref becomes #REF! but +1 is preserved
    let result = to_identity_formula("=NoSuchSheet!A1+1", &r);
    assert!(result.is_ok());
    assert_eq!(result.unwrap().template, "#REF!+1");
}

#[test]
fn unresolved_sheet_in_function_arg() {
    let r = MockResolver::new();
    let result = to_identity_formula("=SUM(NoSuchSheet!A1,1)", &r);
    assert!(result.is_ok());
    assert_eq!(result.unwrap().template, "SUM(#REF!,1)");
}
