use super::super::{ast_to_identity, to_identity_formula};
use super::fixtures::MockResolver;
use crate::ast::{ASTNode, AbsFlags, CellRefNode, RangeRef};
use crate::parser::{ParseError, ParseErrorKind, parse_formula};
use cell_types::{CellId, SheetId};
use formula_types::{CellRef, IdentityFormulaRef, RangeType};

#[test]
fn simple_addition_two_cells() {
    let r = MockResolver::new();
    let f = to_identity_formula("=A1+B1", &r).unwrap();
    assert_eq!(f.template, "{0}+{1}");
    assert_eq!(f.refs.len(), 2);
    assert!(matches!(f.refs[0], IdentityFormulaRef::Cell(_)));
    assert!(matches!(f.refs[1], IdentityFormulaRef::Cell(_)));
}

#[test]
fn sum_range() {
    let r = MockResolver::new();
    let f = to_identity_formula("=SUM(A1:B10)", &r).unwrap();
    assert_eq!(f.template, "SUM({0})");
    assert_eq!(f.refs.len(), 1);
    assert!(matches!(f.refs[0], IdentityFormulaRef::Range(_)));
}

#[test]
fn cells_with_constant() {
    let r = MockResolver::new();
    let f = to_identity_formula("=A1+B1*2", &r).unwrap();
    assert_eq!(f.template, "{0}+{1}*2");
    assert_eq!(f.refs.len(), 2);
}

#[test]
fn full_column_range() {
    let r = MockResolver::new();
    let f = to_identity_formula("=SUM(A:A)", &r).unwrap();
    assert_eq!(f.template, "SUM({0})");
    assert_eq!(f.refs.len(), 1);
    assert!(matches!(f.refs[0], IdentityFormulaRef::FullCol(_)));
}

#[test]
fn column_range_different_cols() {
    let r = MockResolver::new();
    let f = to_identity_formula("=SUM(A:C)", &r).unwrap();
    assert_eq!(f.template, "SUM({0})");
    assert_eq!(f.refs.len(), 1);
    assert!(matches!(f.refs[0], IdentityFormulaRef::ColRange(_)));
}

#[test]
fn row_range_different_rows() {
    let r = MockResolver::new();
    let f = to_identity_formula("=SUM(1:5)", &r).unwrap();
    assert_eq!(f.template, "SUM({0})");
    assert_eq!(f.refs.len(), 1);
    assert!(matches!(f.refs[0], IdentityFormulaRef::RowRange(_)));
}

#[test]
fn full_row_same_row() {
    let r = MockResolver::new();
    let f = to_identity_formula("=SUM(1:1)", &r).unwrap();
    assert_eq!(f.template, "SUM({0})");
    assert_eq!(f.refs.len(), 1);
    assert!(matches!(f.refs[0], IdentityFormulaRef::FullRow(_)));
}

#[test]
fn sum_range_plus_cell_times_constant() {
    let r = MockResolver::new();
    let f = to_identity_formula("=SUM(A1:B10)+C1*2", &r).unwrap();
    assert_eq!(f.template, "SUM({0})+{1}*2");
    assert_eq!(f.refs.len(), 2);
    assert!(matches!(f.refs[0], IdentityFormulaRef::Range(_)));
    assert!(matches!(f.refs[1], IdentityFormulaRef::Cell(_)));
}

#[test]
fn absolute_cell_ref() {
    let r = MockResolver::new();
    let f = to_identity_formula("=$A$1", &r).unwrap();
    assert_eq!(f.template, "{0}");
    assert_eq!(f.refs.len(), 1);
    match &f.refs[0] {
        IdentityFormulaRef::Cell(c) => {
            assert!(c.row_absolute);
            assert!(c.col_absolute);
        }
        _ => panic!("expected Cell ref"),
    }
}

#[test]
fn same_cell_reused() {
    let r = MockResolver::new();
    let f = to_identity_formula("=A1+A1", &r).unwrap();
    assert_eq!(f.template, "{0}+{1}");
    // Both refs should have the same CellId since they reference
    // the same cell position.
    match (&f.refs[0], &f.refs[1]) {
        (IdentityFormulaRef::Cell(a), IdentityFormulaRef::Cell(b)) => {
            assert_eq!(a.id, b.id);
        }
        _ => panic!("expected two Cell refs"),
    }
}

#[test]
fn absolute_range_ref() {
    let r = MockResolver::new();
    let f = to_identity_formula("=SUM($A$1:$B$10)", &r).unwrap();
    assert_eq!(f.template, "SUM({0})");
    match &f.refs[0] {
        IdentityFormulaRef::Range(rng) => {
            assert!(rng.start_row_absolute);
            assert!(rng.start_col_absolute);
            assert!(rng.end_row_absolute);
            assert!(rng.end_col_absolute);
        }
        _ => panic!("expected Range ref"),
    }
}
