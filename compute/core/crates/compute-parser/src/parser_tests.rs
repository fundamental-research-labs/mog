use super::*;
use crate::AbsFlags;
use crate::ast::{BinOp, CellRefNode, RangeRef};
use crate::test_helpers::TestResolver;
use cell_types::SheetId;
use formula_types::{CellRef, RangeType};
use value_types::CellError;

// ===== Simple Cell References =====

#[test]
fn test_simple_cell_ref_b31() {
    let ast = parse_formula("B31", None).unwrap().into_inner();
    match &ast {
        ASTNode::CellReference(CellRefNode { reference, .. }) => match reference {
            CellRef::Positional { row, col, .. } => {
                assert_eq!(*row, 30);
                assert_eq!(*col, 1);
            }
            CellRef::Resolved(_) => panic!("Expected Positional, got {reference:?}"),
        },
        _ => panic!("Expected CellReference, got {ast:?}"),
    }
}

#[test]
fn test_ref_error_in_formula_division() {
    // In XLSX, deleted row references produce formulas like #REF!/(B16+B22)
    // The parser must handle #REF! as an error literal in expressions
    let ast = parse_formula("#REF!/(B16+B22)", None).unwrap().into_inner();
    match &ast {
        ASTNode::BinaryOp { op, left, .. } => {
            assert_eq!(*op, BinOp::Div);
            assert_eq!(**left, ASTNode::Error(CellError::Ref));
        }
        _ => panic!("Expected BinaryOp(Div), got {ast:?}"),
    }
}

#[test]
fn test_ref_error_double_ref() {
    // #REF!/#REF! — both references deleted
    let ast = parse_formula("#REF!/#REF!", None).unwrap().into_inner();
    match &ast {
        ASTNode::BinaryOp { op, left, right } => {
            assert_eq!(*op, BinOp::Div);
            assert_eq!(**left, ASTNode::Error(CellError::Ref));
            assert_eq!(**right, ASTNode::Error(CellError::Ref));
        }
        _ => panic!("Expected BinaryOp(Div), got {ast:?}"),
    }
}

// ===== Basic Literals =====

#[test]
fn test_number_integer() {
    let ast = parse_formula("=42", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Number(42.0));
}

#[test]
#[allow(clippy::approx_constant)]
fn test_number_float() {
    let ast = parse_formula("=3.14", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Number(3.14));
}

#[test]
fn test_number_scientific() {
    let ast = parse_formula("=1e10", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Number(1e10));
}

#[test]
fn test_string_literal() {
    let ast = parse_formula("=\"hello\"", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Text("hello".to_string()));
}

#[test]
fn test_string_with_escaped_quotes() {
    let ast = parse_formula("=\"say \"\"hi\"\"\"", None)
        .unwrap()
        .into_inner();
    assert_eq!(ast, ASTNode::Text("say \"hi\"".to_string()));
}

#[test]
fn test_boolean_true() {
    let ast = parse_formula("=TRUE", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Boolean(true));
}

#[test]
fn test_boolean_false() {
    let ast = parse_formula("=FALSE", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Boolean(false));
}

#[test]
fn test_boolean_case_insensitive() {
    let ast = parse_formula("=true", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Boolean(true));
}

#[test]
fn test_error_div0() {
    let ast = parse_formula("=#DIV/0!", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Div0));
}

#[test]
fn test_error_na() {
    let ast = parse_formula("=#N/A", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Na));
}

#[test]
fn test_error_ref() {
    let ast = parse_formula("=#REF!", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn test_error_value() {
    let ast = parse_formula("=#VALUE!", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Value));
}

#[test]
fn test_error_name() {
    let ast = parse_formula("=#NAME?", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Name));
}

#[test]
fn test_error_null() {
    let ast = parse_formula("=#NULL!", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Null));
}

#[test]
fn test_error_num() {
    let ast = parse_formula("=#NUM!", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Num));
}

// ===== Cell References =====

#[test]
fn test_cell_ref_a1() {
    let ast = parse_formula("=A1", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::CellReference(CellRefNode {
            reference: CellRef::Positional {
                sheet: SheetId::from_raw(0),
                row: 0,
                col: 0,
            },
            abs_row: false,
            abs_col: false,
        })
    );
}

#[test]
fn test_cell_ref_absolute() {
    let ast = parse_formula("=$A$1", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::CellReference(CellRefNode {
            reference: CellRef::Positional {
                sheet: SheetId::from_raw(0),
                row: 0,
                col: 0,
            },
            abs_row: true,
            abs_col: true,
        })
    );
}

#[test]
fn test_cell_ref_mixed_abs_row() {
    let ast = parse_formula("=A$1", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::CellReference(CellRefNode {
            reference: CellRef::Positional {
                sheet: SheetId::from_raw(0),
                row: 0,
                col: 0,
            },
            abs_row: true,
            abs_col: false,
        })
    );
}

#[test]
fn test_cell_ref_mixed_abs_col() {
    let ast = parse_formula("=$A1", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::CellReference(CellRefNode {
            reference: CellRef::Positional {
                sheet: SheetId::from_raw(0),
                row: 0,
                col: 0,
            },
            abs_row: false,
            abs_col: true,
        })
    );
}

#[test]
fn test_cell_ref_b2() {
    let ast = parse_formula("=B2", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::CellReference(CellRefNode {
            reference: CellRef::Positional {
                sheet: SheetId::from_raw(0),
                row: 1,
                col: 1,
            },
            abs_row: false,
            abs_col: false,
        })
    );
}

#[test]
fn test_cell_ref_aa100() {
    let ast = parse_formula("=AA100", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::CellReference(CellRefNode {
            reference: CellRef::Positional {
                sheet: SheetId::from_raw(0),
                row: 99,
                col: 26,
            },
            abs_row: false,
            abs_col: false,
        })
    );
}

// ===== Range References =====

#[test]
fn test_range_a1_b10() {
    let ast = parse_formula("=A1:B10", None).unwrap().into_inner();
    assert_eq!(
        ast,
        ASTNode::Range(RangeRef {
            start: CellRef::Positional {
                sheet: SheetId::from_raw(0),
                row: 0,
                col: 0,
            },
            end: CellRef::Positional {
                sheet: SheetId::from_raw(0),
                row: 9,
                col: 1,
            },
            abs_start: AbsFlags::default(),
            abs_end: AbsFlags::default(),
            range_type: RangeType::CellRange,
        })
    );
}

#[test]
fn test_column_range() {
    let ast = parse_formula("=A:C", None).unwrap().into_inner();
    match &ast {
        ASTNode::Range(RangeRef { range_type, .. }) => {
            assert_eq!(*range_type, RangeType::ColumnRange);
        }
        _ => panic!("Expected Range, got {ast:?}"),
    }
}

#[test]
fn test_row_range() {
    let ast = parse_formula("=1:5", None).unwrap().into_inner();
    match &ast {
        ASTNode::Range(RangeRef {
            range_type,
            start,
            end,
            ..
        }) => {
            assert_eq!(*range_type, RangeType::RowRange);
            match start {
                CellRef::Positional { row, .. } => assert_eq!(*row, 0),
                CellRef::Resolved(_) => panic!("Expected Positional"),
            }
            match end {
                CellRef::Positional { row, .. } => assert_eq!(*row, 4),
                CellRef::Resolved(_) => panic!("Expected Positional"),
            }
        }
        _ => panic!("Expected Range, got {ast:?}"),
    }
}

#[test]
fn test_absolute_row_range_both() {
    let ast = parse_formula("=$1:$5", None).unwrap().into_inner();
    match &ast {
        ASTNode::Range(RangeRef {
            abs_start,
            abs_end,
            range_type,
            start,
            end,
            ..
        }) => {
            assert!(abs_start.row);
            assert!(abs_end.row);
            assert_eq!(*range_type, RangeType::RowRange);
            match start {
                CellRef::Positional { row, .. } => assert_eq!(*row, 0),
                CellRef::Resolved(_) => panic!("Expected Positional"),
            }
            match end {
                CellRef::Positional { row, .. } => assert_eq!(*row, 4),
                CellRef::Resolved(_) => panic!("Expected Positional"),
            }
        }
        other => panic!("expected row range, got {other:?}"),
    }
}

#[test]
fn test_absolute_row_range_start_only() {
    let ast = parse_formula("=$1:5", None).unwrap().into_inner();
    match &ast {
        ASTNode::Range(RangeRef {
            abs_start,
            abs_end,
            range_type,
            ..
        }) => {
            assert!(abs_start.row);
            assert!(!abs_end.row);
            assert_eq!(*range_type, RangeType::RowRange);
        }
        other => panic!("expected row range, got {other:?}"),
    }
}

#[test]
fn test_absolute_row_range_end_only() {
    let ast = parse_formula("=1:$5", None).unwrap().into_inner();
    match &ast {
        ASTNode::Range(RangeRef {
            abs_start,
            abs_end,
            range_type,
            ..
        }) => {
            assert!(!abs_start.row);
            assert!(abs_end.row);
            assert_eq!(*range_type, RangeType::RowRange);
        }
        other => panic!("expected row range, got {other:?}"),
    }
}

#[test]
fn test_absolute_row_range_display_round_trip() {
    // $1:$5 should display correctly and re-parse
    let ast1 = parse_formula("=$1:$5", None).unwrap().into_inner();
    let displayed = format!("{ast1}");
    assert_eq!(displayed, "$1:$5");
    let ast2 = parse_formula(&format!("={displayed}"), None)
        .unwrap()
        .into_inner();
    assert_eq!(ast1, ast2);
}

#[test]
fn test_mixed_absolute_row_range_display() {
    let ast = parse_formula("=$1:5", None).unwrap().into_inner();
    let displayed = format!("{ast}");
    assert_eq!(displayed, "$1:5");

    let ast = parse_formula("=1:$5", None).unwrap().into_inner();
    let displayed = format!("{ast}");
    assert_eq!(displayed, "1:$5");
}

// ===== Sheet References =====

#[test]
fn test_sheet_ref_unquoted() {
    let resolver = TestResolver::new();
    let ast = parse_formula("=Sheet1!A1", Some(&resolver))
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::SheetRef { sheet, inner } => {
            assert_eq!(*sheet, SheetId::from_raw(1));
            match inner.as_ref() {
                ASTNode::CellReference(CellRefNode { reference, .. }) => match reference {
                    CellRef::Positional { sheet, row, col } => {
                        assert_eq!(*sheet, SheetId::from_raw(1));
                        assert_eq!(*row, 0);
                        assert_eq!(*col, 0);
                    }
                    CellRef::Resolved(_) => panic!("Expected Positional"),
                },
                _ => panic!("Expected CellReference"),
            }
        }
        _ => panic!("Expected SheetRef, got {ast:?}"),
    }
}

#[test]
fn test_sheet_ref_quoted() {
    let resolver = TestResolver::new();
    let ast = parse_formula("='Sheet Name'!A1", Some(&resolver))
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::UnresolvedSheetRef { sheet_name, inner } => {
            assert_eq!(sheet_name, "Sheet Name");
            match inner.as_ref() {
                ASTNode::CellReference(..) => {}
                _ => panic!("Expected CellReference"),
            }
        }
        _ => panic!("Expected UnresolvedSheetRef, got {ast:?}"),
    }
}

#[test]
fn test_sheet_ref_resolved() {
    let resolver = TestResolver::new();
    let ast = parse_formula("=Sheet2!B5", Some(&resolver))
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::SheetRef { sheet, inner } => {
            assert_eq!(*sheet, SheetId::from_raw(2));
            match inner.as_ref() {
                ASTNode::CellReference(CellRefNode { reference, .. }) => match reference {
                    CellRef::Positional { sheet, row, col } => {
                        assert_eq!(*sheet, SheetId::from_raw(2));
                        assert_eq!(*row, 4);
                        assert_eq!(*col, 1);
                    }
                    CellRef::Resolved(_) => panic!("Expected Positional"),
                },
                _ => panic!("Expected CellReference"),
            }
        }
        _ => panic!("Expected SheetRef, got {ast:?}"),
    }
}
