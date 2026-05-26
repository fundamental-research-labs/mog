//! Coverage-focused tests for `references.rs` — targeting unique branches not
//! covered by `parser_tests.rs`, `edge_case_tests.rs`, or other test files.
//!
//! Focuses on: word boundary rejection, overflow backtracks, `consume_ref_suffix`,
//! resolver interactions, and sheet ref edge cases.

use super::*;

#[test]
fn external_workbook_refs_preserve_ast_shape() {
    let ast = parse_formula("=[Book.xlsx]Data!A1", None)
        .unwrap()
        .into_inner();
    match ast {
        ASTNode::ExternalSheetRef {
            workbook,
            sheet_name,
            inner,
        } => {
            assert_eq!(workbook.as_str(), "[Book.xlsx]");
            assert_eq!(sheet_name, "Data");
            assert!(matches!(*inner, ASTNode::CellReference(_)));
        }
        other => panic!("expected external sheet ref, got {other:?}"),
    }
}

#[test]
fn quoted_external_path_refs_preserve_workbook_token() {
    let ast = parse_formula("='C:\\Reports\\[Budget.xlsx]Annual'!$A$1:$B$2", None)
        .unwrap()
        .into_inner();
    match ast {
        ASTNode::ExternalSheetRef {
            workbook,
            sheet_name,
            inner,
        } => {
            assert_eq!(workbook.as_str(), "C:\\Reports\\[Budget.xlsx]");
            assert_eq!(sheet_name, "Annual");
            assert!(matches!(*inner, ASTNode::Range(_)));
        }
        other => panic!("expected external sheet ref, got {other:?}"),
    }
}
use crate::ast::{ASTNode, BinOp, CellRefNode, RangeRef};
use crate::parser::ParseErrorKind;
use crate::test_helpers::TestResolver;
use cell_types::SheetId;
use formula_types::{CellRef, RangeType};
use value_types::CellError;

use TestResolver as TR;

// ===== 1. Column range overflow =====

#[test]
fn col_range_overflow_is_not_col_range() {
    let result = parse_formula("XFE:XFF", None);
    if let Ok(spanned) = result {
        let ast = spanned.into_inner();
        assert!(
            !matches!(
                ast,
                ASTNode::Range(RangeRef {
                    range_type: RangeType::ColumnRange,
                    ..
                })
            ),
            "Overflow cols should not produce a ColumnRange, got {ast:?}"
        );
    }
}

// ===== 2. Row range with resolver and sheet override =====

#[test]
fn row_range_with_resolver() {
    let resolver = TR::new();
    let ast = parse_formula("1:5", Some(&resolver)).unwrap().into_inner();
    match &ast {
        ASTNode::Range(RangeRef {
            range_type, start, ..
        }) => {
            assert_eq!(*range_type, RangeType::RowRange);
            match start {
                CellRef::Positional { sheet, .. } => {
                    assert_eq!(*sheet, SheetId::from_raw(1));
                }
                CellRef::Resolved(_) => panic!("Expected Positional start"),
            }
        }
        _ => panic!("Expected Range(RowRange), got {ast:?}"),
    }
}

#[test]
fn row_range_with_sheet_override() {
    let resolver = TR::new();
    let ast = parse_formula("Sheet1!1:5", Some(&resolver))
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::SheetRef { sheet, inner } => {
            assert_eq!(*sheet, SheetId::from_raw(1));
            match inner.as_ref() {
                ASTNode::Range(RangeRef {
                    range_type, start, ..
                }) => {
                    assert_eq!(*range_type, RangeType::RowRange);
                    match start {
                        CellRef::Positional { sheet: s, .. } => {
                            assert_eq!(*s, SheetId::from_raw(1));
                        }
                        CellRef::Resolved(_) => panic!("Expected Positional"),
                    }
                }
                _ => panic!("Expected Range inside SheetRef, got {inner:?}"),
            }
        }
        _ => panic!("Expected SheetRef, got {ast:?}"),
    }
}

// ===== 3. Row range overflow/invalid backtracks =====

#[test]
fn row_range_row_zero_backtracks() {
    let result = parse_formula("0:5", None);
    if let Ok(spanned) = result {
        let ast = spanned.into_inner();
        assert!(
            !matches!(
                ast,
                ASTNode::Range(RangeRef {
                    range_type: RangeType::RowRange,
                    ..
                })
            ),
            "0:5 should not produce a RowRange, got {ast:?}"
        );
    }
}

#[test]
fn row_range_overflow_backtracks() {
    let result = parse_formula("1048577:1048578", None);
    if let Ok(spanned) = result {
        let ast = spanned.into_inner();
        assert!(
            !matches!(
                ast,
                ASTNode::Range(RangeRef {
                    range_type: RangeType::RowRange,
                    ..
                })
            ),
            "Overflow rows should not produce RowRange, got {ast:?}"
        );
    }
}

// ===== 4. Column range with sheet override =====

#[test]
fn col_range_with_sheet_override() {
    let resolver = TR::new();
    let ast = parse_formula("Sheet1!A:C", Some(&resolver))
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::SheetRef { sheet, inner } => {
            assert_eq!(*sheet, SheetId::from_raw(1));
            match inner.as_ref() {
                ASTNode::Range(RangeRef { range_type, .. }) => {
                    assert_eq!(*range_type, RangeType::ColumnRange);
                }
                _ => panic!("Expected ColumnRange inside SheetRef"),
            }
        }
        _ => panic!("Expected SheetRef, got {ast:?}"),
    }
}

#[test]
fn col_range_mixed_absolute_1() {
    let ast = parse_formula("$A:C", None).unwrap().into_inner();
    match &ast {
        ASTNode::Range(RangeRef {
            range_type,
            abs_start,
            abs_end,
            ..
        }) => {
            assert_eq!(*range_type, RangeType::ColumnRange);
            assert!(abs_start.col);
            assert!(!abs_end.col);
        }
        _ => panic!("Expected Range(ColumnRange), got {ast:?}"),
    }
}

#[test]
fn col_range_mixed_absolute_2() {
    let ast = parse_formula("A:$C", None).unwrap().into_inner();
    match &ast {
        ASTNode::Range(RangeRef {
            range_type,
            abs_start,
            abs_end,
            ..
        }) => {
            assert_eq!(*range_type, RangeType::ColumnRange);
            assert!(!abs_start.col);
            assert!(abs_end.col);
        }
        _ => panic!("Expected Range(ColumnRange), got {ast:?}"),
    }
}

// ===== 5. Cell range — word boundary and backtrack =====

#[test]
fn cell_range_word_boundary_rejection() {
    let result = parse_formula("A1:B10x", None);
    if let Ok(spanned) = result {
        let ast = spanned.into_inner();
        assert!(
            !matches!(
                ast,
                ASTNode::Range(RangeRef {
                    range_type: RangeType::CellRange,
                    ..
                })
            ),
            "A1:B10x should not be a CellRange due to word boundary, got {ast:?}"
        );
    }
}

#[test]
fn cell_range_colon_backtrack() {
    let result = parse_formula("A1:+2", None);
    if let Ok(spanned) = result {
        let ast = spanned.into_inner();
        assert!(
            !matches!(ast, ASTNode::Range(_)),
            "A1:+2 should not produce a Range, got {ast:?}"
        );
    }
}

// ===== 6. Dollar-prefixed word boundary backtrack =====

#[test]
fn dollar_cell_ref_word_boundary_backtrack() {
    let result = parse_formula("$A$1x", None);
    if let Ok(spanned) = result {
        let ast = spanned.into_inner();
        assert!(
            !matches!(ast, ASTNode::CellReference(_)),
            "$A$1x should not be a CellReference, got {ast:?}"
        );
    }
}

// ===== 7. Sheet ref — exclamation backtrack =====

#[test]
fn sheet_ref_no_exclamation_backtracks() {
    let result = parse_formula("Sheet1 + A1", None);
    if let Ok(spanned) = result {
        let ast = spanned.into_inner();
        assert!(
            !matches!(
                ast,
                ASTNode::SheetRef { .. } | ASTNode::UnresolvedSheetRef { .. }
            ),
            "Should not be a sheet ref without !, got {ast:?}"
        );
    }
}

// ===== 8. Quoted sheet ref edge cases =====

#[test]
fn quoted_sheet_ref_escaped_quote() {
    let resolver = TR::new();
    let ast = parse_formula("'Sheet''s Name'!A1", Some(&resolver))
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::SheetRef { sheet, inner } => {
            assert_eq!(*sheet, SheetId::from_raw(5));
            assert!(matches!(inner.as_ref(), ASTNode::CellReference(_)));
        }
        _ => panic!("Expected SheetRef, got {ast:?}"),
    }
}

#[test]
fn quoted_sheet_ref_unresolved() {
    let resolver = TR::new();
    let ast = parse_formula("'Unknown Sheet'!A1", Some(&resolver))
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::UnresolvedSheetRef { sheet_name, inner } => {
            assert_eq!(sheet_name, "Unknown Sheet");
            assert!(matches!(inner.as_ref(), ASTNode::CellReference(_)));
        }
        _ => panic!("Expected UnresolvedSheetRef, got {ast:?}"),
    }
}

#[test]
fn quoted_sheet_ref_without_resolver() {
    let ast = parse_formula("'My Sheet'!A1", None).unwrap().into_inner();
    match &ast {
        ASTNode::UnresolvedSheetRef { sheet_name, inner } => {
            assert_eq!(sheet_name, "My Sheet");
            assert!(matches!(inner.as_ref(), ASTNode::CellReference(_)));
        }
        _ => panic!("Expected UnresolvedSheetRef, got {ast:?}"),
    }
}

// ===== 9. Ref after sheet — error and edge cases =====

#[test]
fn ref_after_sheet_nothing_valid_errors() {
    let resolver = TR::new();
    let result = parse_formula("Sheet1!+", Some(&resolver));
    assert!(result.is_err(), "Sheet1!+ should fail to parse");
}

#[test]
fn ref_after_sheet_absolute_cell() {
    let resolver = TR::new();
    let ast = parse_formula("Sheet1!$A$1", Some(&resolver))
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::SheetRef { sheet, inner } => {
            assert_eq!(*sheet, SheetId::from_raw(1));
            match inner.as_ref() {
                ASTNode::CellReference(CellRefNode {
                    abs_row, abs_col, ..
                }) => {
                    assert!(*abs_row);
                    assert!(*abs_col);
                }
                _ => panic!("Expected CellReference, got {inner:?}"),
            }
        }
        _ => panic!("Expected SheetRef, got {ast:?}"),
    }
}

#[test]
fn ref_after_sheet_absolute_range() {
    let resolver = TR::new();
    let ast = parse_formula("Sheet1!$A$1:$B$10", Some(&resolver))
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::SheetRef { sheet, inner } => {
            assert_eq!(*sheet, SheetId::from_raw(1));
            match inner.as_ref() {
                ASTNode::Range(RangeRef {
                    range_type,
                    abs_start,
                    abs_end,
                    ..
                }) => {
                    assert_eq!(*range_type, RangeType::CellRange);
                    assert!(abs_start.row);
                    assert!(abs_start.col);
                    assert!(abs_end.row);
                    assert!(abs_end.col);
                }
                _ => panic!("Expected CellRange, got {inner:?}"),
            }
        }
        _ => panic!("Expected SheetRef, got {ast:?}"),
    }
}

#[test]
fn ref_after_sheet_absolute_col_range() {
    let resolver = TR::new();
    let ast = parse_formula("Sheet1!$A:$C", Some(&resolver))
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::SheetRef { sheet, inner } => {
            assert_eq!(*sheet, SheetId::from_raw(1));
            match inner.as_ref() {
                ASTNode::Range(RangeRef { range_type, .. }) => {
                    assert_eq!(*range_type, RangeType::ColumnRange);
                }
                _ => panic!("Expected ColumnRange, got {inner:?}"),
            }
        }
        _ => panic!("Expected SheetRef, got {ast:?}"),
    }
}

#[test]
fn ref_after_sheet_absolute_row_range() {
    let resolver = TR::new();
    let ast = parse_formula("Sheet1!$1:$5", Some(&resolver))
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::SheetRef { sheet, inner } => {
            assert_eq!(*sheet, SheetId::from_raw(1));
            match inner.as_ref() {
                ASTNode::Range(RangeRef {
                    range_type,
                    abs_start,
                    abs_end,
                    ..
                }) => {
                    assert_eq!(*range_type, RangeType::RowRange);
                    assert!(abs_start.row);
                    assert!(abs_end.row);
                }
                _ => panic!("Expected RowRange, got {inner:?}"),
            }
        }
        _ => panic!("Expected SheetRef, got {ast:?}"),
    }
}

// ===== 10. Structured ref backtracks =====

#[test]
fn structured_ref_no_bracket_backtracks() {
    let result = parse_formula("Table1 + 1", None);
    if let Ok(spanned) = result {
        let ast = spanned.into_inner();
        assert!(
            !matches!(ast, ASTNode::StructuredRef(_)),
            "Should not be StructuredRef without bracket, got {ast:?}"
        );
    }
}

#[test]
fn structured_ref_no_matching_bracket() {
    let result = parse_formula("Table1[Col", None);
    if let Ok(spanned) = result {
        let ast = spanned.into_inner();
        assert!(
            !matches!(ast, ASTNode::StructuredRef(_)),
            "Unclosed bracket should not produce StructuredRef, got {ast:?}"
        );
    }
}

// ===== 11. consume_ref_suffix — systematic #REF! suffix tests =====

#[test]
fn ref_error_with_cell_ref_suffix() {
    let ast = parse_formula("#REF!A1", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn ref_error_with_absolute_cell_ref_suffix() {
    let ast = parse_formula("#REF!$A$1", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn ref_error_with_range_suffix() {
    let ast = parse_formula("#REF!A1:B10", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn ref_error_with_absolute_range_suffix() {
    let ast = parse_formula("#REF!$A$1:$B$10", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn ref_error_with_col_range_suffix() {
    let ast = parse_formula("#REF!A:C", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn ref_error_with_row_range_suffix() {
    let ast = parse_formula("#REF!1:5", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn ref_error_chained() {
    let ast = parse_formula("#REF!#REF!", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn ref_error_double_with_suffix() {
    let ast = parse_formula("#REF!#REF!A1", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn ref_error_colon_cell_ref() {
    let ast = parse_formula("#REF!:B10", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn ref_error_colon_absolute() {
    let ast = parse_formula("#REF!:$B$10", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn ref_error_colon_ref_error() {
    let ast = parse_formula("#REF!:#REF!", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn ref_error_colon_row() {
    let ast = parse_formula("#REF!:5", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn ref_error_colon_invalid_backtracks() {
    let result = parse_formula("#REF!:+1", None);
    match result {
        Ok(spanned) => {
            let _ast = spanned.into_inner();
        }
        Err(e) => {
            assert!(
                e.kind == ParseErrorKind::TrailingInput || e.message().contains("trailing"),
                "unexpected error: {e:?}"
            );
        }
    }
}

#[test]
fn ref_error_row_range_with_dollar() {
    let ast = parse_formula("#REF!$1:$5", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn ref_error_suffix_row_no_range() {
    let ast = parse_formula("#REF!5", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn ref_error_row_colon_invalid_after_digits() {
    let result = parse_formula("#REF!5:X", None);
    if let Ok(spanned) = result {
        let _ast = spanned.into_inner();
    }
}

#[test]
fn ref_error_col_dollar_row() {
    let ast = parse_formula("#REF!A$1", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn ref_error_col_range_dollar() {
    let ast = parse_formula("#REF!$A:$C", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn ref_error_col_only_no_range() {
    let result = parse_formula("#REF!A", None);
    if let Ok(spanned) = result {
        let ast = spanned.into_inner();
        assert_eq!(ast, ASTNode::Error(CellError::Ref));
    }
}

#[test]
fn ref_error_triple_chained() {
    let ast = parse_formula("#REF!#REF!#REF!", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn ref_error_colon_ref_error_with_suffix() {
    let ast = parse_formula("#REF!:#REF!A1", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

// ===== 12. Column range with resolver =====

#[test]
fn col_range_with_resolver_uses_current_sheet() {
    let resolver = TR::new();
    let ast = parse_formula("A:C", Some(&resolver)).unwrap().into_inner();
    match &ast {
        ASTNode::Range(RangeRef {
            range_type, start, ..
        }) => {
            assert_eq!(*range_type, RangeType::ColumnRange);
            match start {
                CellRef::Positional { sheet, .. } => {
                    assert_eq!(*sheet, SheetId::from_raw(1));
                }
                CellRef::Resolved(_) => panic!("Expected Positional"),
            }
        }
        _ => panic!("Expected ColumnRange, got {ast:?}"),
    }
}

// ===== 13. #REF! suffix with mixed absolute rows =====

#[test]
fn ref_error_suffix_range_colon_dollar_digits() {
    let ast = parse_formula("#REF!1:$5", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn ref_error_range_alpha_colon_dollar_alpha_digits() {
    let ast = parse_formula("#REF!A:$C1", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

#[test]
fn ref_error_alpha_colon_alpha() {
    let ast = parse_formula("#REF!A:C", None).unwrap().into_inner();
    assert_eq!(ast, ASTNode::Error(CellError::Ref));
}

// ===== 14. #REF! suffix stops at operators =====

#[test]
fn ref_error_suffix_stops_at_operator() {
    let ast = parse_formula("#REF!A1+1", None).unwrap().into_inner();
    assert!(matches!(ast, ASTNode::BinaryOp { op: BinOp::Add, .. }));
}

#[test]
fn ref_error_range_suffix_stops_at_operator() {
    let ast = parse_formula("#REF!A1:B10*2", None).unwrap().into_inner();
    assert!(matches!(ast, ASTNode::BinaryOp { op: BinOp::Mul, .. }));
}

#[test]
fn ref_error_row_range_suffix_stops_at_operator() {
    let ast = parse_formula("#REF!1:5+3", None).unwrap().into_inner();
    assert!(matches!(ast, ASTNode::BinaryOp { op: BinOp::Add, .. }));
}

// ===== 15. Quoted sheet — column/row ranges and #REF! =====

#[test]
fn quoted_sheet_col_range() {
    let resolver = TR::new();
    let ast = parse_formula("'My Sheet'!A:C", Some(&resolver))
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::SheetRef { sheet, inner } => {
            assert_eq!(*sheet, SheetId::from_raw(4));
            match inner.as_ref() {
                ASTNode::Range(RangeRef { range_type, .. }) => {
                    assert_eq!(*range_type, RangeType::ColumnRange);
                }
                _ => panic!("Expected ColumnRange, got {inner:?}"),
            }
        }
        _ => panic!("Expected SheetRef, got {ast:?}"),
    }
}

#[test]
fn quoted_sheet_row_range() {
    let resolver = TR::new();
    let ast = parse_formula("'My Sheet'!1:5", Some(&resolver))
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::SheetRef { sheet, inner } => {
            assert_eq!(*sheet, SheetId::from_raw(4));
            match inner.as_ref() {
                ASTNode::Range(RangeRef { range_type, .. }) => {
                    assert_eq!(*range_type, RangeType::RowRange);
                }
                _ => panic!("Expected RowRange, got {inner:?}"),
            }
        }
        _ => panic!("Expected SheetRef, got {ast:?}"),
    }
}

#[test]
fn quoted_sheet_ref_error() {
    let resolver = TR::new();
    let ast = parse_formula("'My Sheet'!#REF!", Some(&resolver))
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::SheetRef { sheet, inner } => {
            assert_eq!(*sheet, SheetId::from_raw(4));
            assert_eq!(inner.as_ref(), &ASTNode::Error(CellError::Ref));
        }
        _ => panic!("Expected SheetRef with Error(Ref), got {ast:?}"),
    }
}

// ===== 16. #REF! no suffix in expression =====

#[test]
fn ref_error_no_suffix_in_expression() {
    let ast = parse_formula("#REF!+1", None).unwrap().into_inner();
    match &ast {
        ASTNode::BinaryOp { op, left, right: _ } => {
            assert_eq!(*op, BinOp::Add);
            assert_eq!(left.as_ref(), &ASTNode::Error(CellError::Ref));
        }
        _ => panic!("Expected BinaryOp, got {ast:?}"),
    }
}

#[test]
fn ref_error_col_range_suffix_then_operator() {
    let ast = parse_formula("#REF!A:C+1", None).unwrap().into_inner();
    match &ast {
        ASTNode::BinaryOp { op, left, .. } => {
            assert_eq!(*op, BinOp::Add);
            assert_eq!(left.as_ref(), &ASTNode::Error(CellError::Ref));
        }
        _ => panic!("Expected BinaryOp, got {ast:?}"),
    }
}

#[test]
fn ref_error_row_range_suffix_then_operator() {
    let ast = parse_formula("#REF!1:5+1", None).unwrap().into_inner();
    match &ast {
        ASTNode::BinaryOp { op, left, .. } => {
            assert_eq!(*op, BinOp::Add);
            assert_eq!(left.as_ref(), &ASTNode::Error(CellError::Ref));
        }
        _ => panic!("Expected BinaryOp, got {ast:?}"),
    }
}
