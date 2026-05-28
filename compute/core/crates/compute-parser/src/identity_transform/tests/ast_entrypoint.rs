use super::super::{ast_to_identity, to_identity_formula};
use super::fixtures::MockResolver;
use crate::ast::{ASTNode, AbsFlags, CellRefNode, RangeRef};
use crate::parser::{ParseError, ParseErrorKind, parse_formula};
use cell_types::{CellId, SheetId};
use formula_types::{CellRef, IdentityFormulaRef, RangeType};

#[test]
fn ast_to_identity_matches_to_identity_formula() {
    // Parse without resolver (Positional refs)
    let ast = parse_formula("=A1+B1*2", None).unwrap().into_inner();
    let r = MockResolver::new();
    let from_ast = ast_to_identity(&ast, &r).unwrap();

    let r2 = MockResolver::new();
    let from_string = to_identity_formula("=A1+B1*2", &r2).unwrap();

    assert_eq!(from_ast.template, from_string.template);
    assert_eq!(from_ast.refs.len(), from_string.refs.len());
    assert_eq!(from_ast.is_dynamic_array, from_string.is_dynamic_array);
    assert_eq!(from_ast.is_volatile, from_string.is_volatile);
}

#[test]
fn ast_to_identity_with_resolved_cell_ref() {
    let cell_id = CellId::from_raw(42);
    let ast = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Resolved(cell_id),
        abs_row: false,
        abs_col: false,
    });
    let r = MockResolver::new();
    let f = ast_to_identity(&ast, &r).unwrap();
    assert_eq!(f.template, "{0}");
    match &f.refs[0] {
        IdentityFormulaRef::Cell(c) => assert_eq!(c.id, cell_id),
        _ => panic!("expected Cell ref"),
    }
}

#[test]
fn ast_to_identity_with_resolved_range() {
    let start_id = CellId::from_raw(10);
    let end_id = CellId::from_raw(20);
    let ast = ASTNode::Function {
        name: "SUM".into(),
        args: vec![ASTNode::Range(RangeRef {
            start: CellRef::Resolved(start_id),
            end: CellRef::Resolved(end_id),
            abs_start: AbsFlags::default(),
            abs_end: AbsFlags::default(),
            range_type: RangeType::CellRange,
        })],
    };
    let r = MockResolver::new();
    let f = ast_to_identity(&ast, &r).unwrap();
    assert_eq!(f.template, "SUM({0})");
    match &f.refs[0] {
        IdentityFormulaRef::Range(rng) => {
            assert_eq!(rng.start_id, start_id);
            assert_eq!(rng.end_id, end_id);
        }
        _ => panic!("expected Range ref"),
    }
}

#[test]
fn ast_to_identity_sum_range_plus_cell() {
    let ast = parse_formula("=SUM(A1:B10)+C1*2", None)
        .unwrap()
        .into_inner();
    let r = MockResolver::new();
    let from_ast = ast_to_identity(&ast, &r).unwrap();
    assert_eq!(from_ast.template, "SUM({0})+{1}*2");
    assert_eq!(from_ast.refs.len(), 2);
}

#[test]
fn ast_to_identity_flags_preserved() {
    let ast = parse_formula("=SEQUENCE(5)+NOW()", None)
        .unwrap()
        .into_inner();
    let r = MockResolver::new();
    let f = ast_to_identity(&ast, &r).unwrap();
    assert!(f.is_dynamic_array);
    assert!(f.is_volatile);
}

#[test]
fn ast_to_identity_cross_sheet() {
    let mut r = MockResolver::new();
    r.add_sheet("Sheet2", 2);
    // Parse without resolver — creates UnresolvedSheetRef
    let ast = parse_formula("=Sheet2!A1+B1", None).unwrap().into_inner();
    let f = ast_to_identity(&ast, &r).unwrap();
    assert_eq!(f.template, "{0}+{1}");
    assert_eq!(f.refs.len(), 2);
}

#[test]
fn ast_to_identity_with_mixed_resolved_positional_range() {
    // CellRange where start is Resolved and end is Positional
    let start_id = CellId::from_raw(50);
    let sheet = SheetId::from_raw(0); // current sheet sentinel
    let ast = ASTNode::Function {
        name: "SUM".into(),
        args: vec![ASTNode::Range(RangeRef {
            start: CellRef::Resolved(start_id),
            end: CellRef::Positional {
                sheet,
                row: 9,
                col: 1,
            },
            abs_start: AbsFlags::default(),
            abs_end: AbsFlags::default(),
            range_type: RangeType::CellRange,
        })],
    };
    let r = MockResolver::new();
    let f = ast_to_identity(&ast, &r).unwrap();
    assert_eq!(f.template, "SUM({0})");
    match &f.refs[0] {
        IdentityFormulaRef::Range(rng) => {
            assert_eq!(rng.start_id, start_id);
            // end_id was created by the resolver
            assert_ne!(rng.end_id, start_id);
        }
        _ => panic!("expected Range ref"),
    }
}
