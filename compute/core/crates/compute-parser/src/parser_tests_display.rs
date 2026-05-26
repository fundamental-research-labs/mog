use super::*;
use crate::ast::BinOp;
use crate::test_helpers::TestResolver;
use cell_types::SheetId;
use value_types::CellError;

fn assert_external_sheet_ref<'a>(ast: &'a ASTNode, expected_sheet: &str) -> &'a ASTNode {
    match ast {
        ASTNode::ExternalSheetRef {
            workbook: _,
            sheet_name,
            inner,
        } => {
            assert_eq!(sheet_name, expected_sheet);
            inner.as_ref()
        }
        other => panic!("Expected ExternalSheetRef, got: {other:?}"),
    }
}

// ── Intersection operator ────────────────────────────────────────

#[test]
fn test_intersection_two_ranges() {
    let ast = parse_formula("=A1:B10 B5:C20", None).unwrap().into_inner();
    match &ast {
        ASTNode::BinaryOp {
            op: BinOp::Intersect,
            left,
            right,
        } => {
            assert!(matches!(left.as_ref(), ASTNode::Range(..)));
            assert!(matches!(right.as_ref(), ASTNode::Range(..)));
        }
        other => panic!("expected intersection, got {other:?}"),
    }
}

#[test]
fn test_intersection_cell_and_range() {
    // A1 space B1:C10 — A1 is a cell ref, should intersect with range
    let ast = parse_formula("=A1 B1:C10", None).unwrap().into_inner();
    assert!(matches!(
        ast,
        ASTNode::BinaryOp {
            op: BinOp::Intersect,
            ..
        }
    ));
}

#[test]
fn test_intersection_left_associative() {
    // Three ranges: should nest as ((A1:B10 B5:C20) C1:D5)
    let ast = parse_formula("=A1:B10 B5:C20 C1:D5", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::BinaryOp {
            op: BinOp::Intersect,
            left,
            right,
        } => {
            // right should be C1:D5 range
            assert!(matches!(right.as_ref(), ASTNode::Range(..)));
            // left should be another intersection
            assert!(matches!(
                left.as_ref(),
                ASTNode::BinaryOp {
                    op: BinOp::Intersect,
                    ..
                }
            ));
        }
        other => panic!("expected nested intersection, got {other:?}"),
    }
}

#[test]
fn test_intersection_in_function_arg() {
    let ast = parse_formula("=SUM(A1:B10 B5:C20)", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name.as_ref(), "SUM");
            assert_eq!(args.len(), 1);
            assert!(matches!(
                args[0],
                ASTNode::BinaryOp {
                    op: BinOp::Intersect,
                    ..
                }
            ));
        }
        other => panic!("expected function, got {other:?}"),
    }
}

#[test]
fn test_no_intersection_with_operator() {
    // "A1:B10+5" — the + starts an expression, NOT a range intersection
    let ast = parse_formula("=A1:B10+5", None).unwrap().into_inner();
    assert!(matches!(ast, ASTNode::BinaryOp { op: BinOp::Add, .. }));
}

#[test]
fn test_intersection_round_trip() {
    // parse -> display -> re-parse should produce equal ASTs
    let ast1 = parse_formula("=A1:B10 B5:C20", None).unwrap().into_inner();
    let displayed = format!("{ast1}");
    let ast2 = parse_formula(&format!("={displayed}"), None)
        .unwrap()
        .into_inner();
    assert_eq!(ast1, ast2);
}

// =========================================================================
// Parser gap regression tests
// =========================================================================

// ── Fix 1: Expression-level range operator (expr:expr) ──────────────

#[test]
fn test_expr_range_index_colon_index() {
    // INDEX(A1:B5,1,1):INDEX(A1:B5,1,2) — range between two function results
    // This is valid Excel: the `:` operator works between any two
    // cell-returning expressions, not just literal cell refs.
    let result = parse_formula("=INDEX(A1:B5,1,1):INDEX(A1:B5,1,2)", None);
    assert!(
        result.is_ok(),
        "INDEX():INDEX() range should parse, got: {:?}",
        result.err()
    );
}

#[test]
fn test_expr_range_average_of_index_range() {
    // AVERAGE(INDEX(A1:A10,1):INDEX(A1:A10,5))
    let result = parse_formula("=AVERAGE(INDEX(A1:A10,1):INDEX(A1:A10,5))", None);
    assert!(
        result.is_ok(),
        "AVERAGE(INDEX():INDEX()) should parse, got: {:?}",
        result.err()
    );
}

#[test]
fn test_expr_range_sum_offset_colon_offset() {
    // SUM(OFFSET(A1,0,0):OFFSET(A1,5,0))
    let result = parse_formula("=SUM(OFFSET(A1,0,0):OFFSET(A1,5,0))", None);
    assert!(
        result.is_ok(),
        "SUM(OFFSET():OFFSET()) should parse, got: {:?}",
        result.err()
    );
}

#[test]
fn test_expr_range_let_with_index_range() {
    // LET(x,AVERAGE(INDEX(A:A,1):INDEX(A:A,5)),x+1)
    let result = parse_formula("=LET(x,AVERAGE(INDEX(A:A,1):INDEX(A:A,5)),x+1)", None);
    assert!(
        result.is_ok(),
        "LET with INDEX():INDEX() range should parse, got: {:?}",
        result.err()
    );
}

#[test]
fn test_expr_range_textjoin_with_index_range() {
    // TEXTJOIN(",",TRUE,INDEX(A:A,1):INDEX(A:A,10))
    let result = parse_formula("=TEXTJOIN(\",\",TRUE,INDEX(A:A,1):INDEX(A:A,10))", None);
    assert!(
        result.is_ok(),
        "TEXTJOIN with INDEX():INDEX() range should parse, got: {:?}",
        result.err()
    );
}

#[test]
fn test_expr_range_literal_still_works() {
    // A1:B5 should still produce Range (not RangeOp) — literal path unchanged
    let ast = parse_formula("=A1:B5", None).unwrap().into_inner();
    assert!(
        matches!(ast, ASTNode::Range(..)),
        "Literal range A1:B5 should still produce ASTNode::Range, got: {ast:?}"
    );
}

#[test]
fn test_expr_range_cell_ref_colon_index() {
    // A1:INDEX(A1:A10,5) — literal left, expression right
    // cell_ref_to_range_or_single fails on right side, backtracks,
    // then Pratt infix `:` should handle it
    let result = parse_formula("=A1:INDEX(A1:A10,5)", None);
    assert!(
        result.is_ok(),
        "A1:INDEX() should parse, got: {:?}",
        result.err()
    );
}

// ── Fix 2: Sheet-qualified #REF! ────────────────────────────────────

#[test]
fn test_sheet_qualified_ref_error_unquoted() {
    // Deals!#REF! — sheet-qualified broken reference
    let _resolver = TestResolver::new();
    // Without resolver, sheet name becomes UnresolvedSheetRef
    let result = parse_formula("=Deals!#REF!", None);
    assert!(
        result.is_ok(),
        "Deals!#REF! should parse, got: {:?}",
        result.err()
    );
    let ast = result.unwrap().into_inner();
    // Should be an UnresolvedSheetRef containing an Error(Ref)
    match &ast {
        ASTNode::UnresolvedSheetRef { sheet_name, inner } => {
            assert_eq!(sheet_name, "Deals");
            assert_eq!(**inner, ASTNode::Error(CellError::Ref));
        }
        _ => panic!("Expected UnresolvedSheetRef {{ Deals, Error(Ref) }}, got: {ast:?}"),
    }
}

#[test]
fn test_sheet_qualified_ref_error_quoted() {
    // 'Sheet Name'!#REF!
    let result = parse_formula("='Sheet Name'!#REF!", None);
    assert!(
        result.is_ok(),
        "'Sheet Name'!#REF! should parse, got: {:?}",
        result.err()
    );
    let ast = result.unwrap().into_inner();
    match &ast {
        ASTNode::UnresolvedSheetRef { sheet_name, inner } => {
            assert_eq!(sheet_name, "Sheet Name");
            assert_eq!(**inner, ASTNode::Error(CellError::Ref));
        }
        _ => panic!("Expected UnresolvedSheetRef with Error(Ref), got: {ast:?}"),
    }
}

#[test]
fn test_sheet_qualified_ref_error_with_resolver() {
    // Sheet1!#REF! with a resolver that knows Sheet1
    let resolver = TestResolver::new();
    let result = parse_formula("=Sheet1!#REF!", Some(&resolver));
    assert!(
        result.is_ok(),
        "Sheet1!#REF! should parse, got: {:?}",
        result.err()
    );
    let ast = result.unwrap().into_inner();
    match &ast {
        ASTNode::SheetRef { sheet, inner } => {
            assert_eq!(*sheet, SheetId::from_raw(1));
            assert_eq!(**inner, ASTNode::Error(CellError::Ref));
        }
        _ => panic!("Expected SheetRef with Error(Ref), got: {ast:?}"),
    }
}

#[test]
fn test_sheet_qualified_ref_error_in_iferror() {
    // IFERROR(INDEX(Deals!#REF!,MATCH(1,A:A,0)),0)
    let result = parse_formula("=IFERROR(INDEX(Deals!#REF!,MATCH(1,A:A,0)),0)", None);
    assert!(
        result.is_ok(),
        "IFERROR with Deals!#REF! should parse, got: {:?}",
        result.err()
    );
}

// ── Fix 3: External workbook references [N]Sheet!A1 ─────────────────

#[test]
fn test_external_ref_numeric_index() {
    // [1]Sheet1!A1 — external workbook reference preserves workbook token.
    let result = parse_formula("=[1]Sheet1!A1", None);
    assert!(
        result.is_ok(),
        "[1]Sheet1!A1 should parse, got: {:?}",
        result.err()
    );
    let ast = result.unwrap().into_inner();
    match assert_external_sheet_ref(&ast, "Sheet1") {
        ASTNode::CellReference(_) => {}
        other => panic!("Expected CellReference inside ExternalSheetRef, got: {other:?}"),
    }
}

#[test]
fn test_external_ref_with_quoted_sheet() {
    // [1]'Sheet Name'!$A$1:$B$10 preserves external workbook token.
    let result = parse_formula("=[1]'Sheet Name'!$A$1:$B$10", None);
    assert!(
        result.is_ok(),
        "[1]'Sheet Name'!$A$1:$B$10 should parse, got: {:?}",
        result.err()
    );
    let ast = result.unwrap().into_inner();
    match assert_external_sheet_ref(&ast, "Sheet Name") {
        ASTNode::Range(_) => {}
        other => panic!("Expected Range inside ExternalSheetRef, got: {other:?}"),
    }
}

#[test]
fn test_external_ref_in_iferror() {
    // IFERROR([1]DASHBOARD!$R:$R, "")
    let result = parse_formula("=IFERROR([1]DASHBOARD!$R:$R,\"\")", None);
    assert!(
        result.is_ok(),
        "IFERROR([1]DASHBOARD!$R:$R) should parse, got: {:?}",
        result.err()
    );
}

#[test]
fn test_external_ref_in_sum() {
    // SUM([2]BudgetAnn!P468)
    let result = parse_formula("=SUM([2]BudgetAnn!P468)", None);
    assert!(
        result.is_ok(),
        "SUM([2]BudgetAnn!P468) should parse, got: {:?}",
        result.err()
    );
}

#[test]
fn test_external_ref_with_filename() {
    // [Book1.xlsx]Sheet1!A1 preserves external workbook token.
    let result = parse_formula("=[Book1.xlsx]Sheet1!A1", None);
    assert!(
        result.is_ok(),
        "[Book1.xlsx]Sheet1!A1 should parse, got: {:?}",
        result.err()
    );
    let ast = result.unwrap().into_inner();
    match assert_external_sheet_ref(&ast, "Sheet1") {
        ASTNode::CellReference(_) => {}
        other => panic!("Expected CellReference inside ExternalSheetRef, got: {other:?}"),
    }
}

#[test]
fn test_external_ref_with_resolver_preserves_external_ref() {
    // [1]Sheet1!A1 with resolver still preserves external workbook identity.
    let resolver = TestResolver::new();
    let result = parse_formula("=[1]Sheet1!A1", Some(&resolver));
    assert!(result.is_ok());
    let ast = result.unwrap().into_inner();
    match assert_external_sheet_ref(&ast, "Sheet1") {
        ASTNode::CellReference(_) => {}
        other => panic!("Expected CellReference inside ExternalSheetRef, got: {other:?}"),
    }
}

#[test]
fn test_external_ref_unknown_sheet_produces_unresolved() {
    // [1]Missing!A1 remains external even with a local resolver.
    let resolver = TestResolver::new();
    let result = parse_formula("=[1]Missing!A1", Some(&resolver));
    assert!(result.is_ok());
    let ast = result.unwrap().into_inner();
    match assert_external_sheet_ref(&ast, "Missing") {
        ASTNode::CellReference(_) => {}
        other => panic!("Expected CellReference, got: {other:?}"),
    }
}

#[test]
fn test_external_ref_quoted_sheet_with_resolver() {
    // [1]'Unknown Sheet'!B1 preserves external workbook identity.
    let resolver = TestResolver::new();
    let result = parse_formula("=[1]'Unknown Sheet'!B1", Some(&resolver));
    assert!(result.is_ok());
    let ast = result.unwrap().into_inner();
    assert_external_sheet_ref(&ast, "Unknown Sheet");
}

#[test]
fn test_external_ref_data_sheet_with_resolver() {
    // [1]Data!A1 with resolver must not collapse to local SheetRef.
    let resolver = TestResolver::new();
    let result = parse_formula("=[1]Data!A1", Some(&resolver));
    assert!(result.is_ok());
    let ast = result.unwrap().into_inner();
    assert_external_sheet_ref(&ast, "Data");
}

#[test]
fn test_external_ref_filename_with_resolver() {
    // [Book1.xlsx]Data!$A$1 with resolver remains external.
    let resolver = TestResolver::new();
    let result = parse_formula("=[Book1.xlsx]Data!$A$1", Some(&resolver));
    assert!(result.is_ok());
    let ast = result.unwrap().into_inner();
    assert_external_sheet_ref(&ast, "Data");
}

#[test]
fn test_external_ref_sum_both_refs_resolve() {
    // =SUM([1]Data!A1,[1]Data!B1) — both refs preserve external identity
    let resolver = TestResolver::new();
    let result = parse_formula("=SUM([1]Data!A1,[1]Data!B1)", Some(&resolver));
    assert!(result.is_ok());
    let ast = result.unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, args, .. } => {
            assert_eq!(name, "SUM");
            assert_eq!(args.len(), 2);
            for arg in args {
                match arg {
                    ASTNode::ExternalSheetRef { sheet_name, .. } => {
                        assert_eq!(sheet_name, "Data");
                    }
                    other => panic!("Expected ExternalSheetRef, got: {other:?}"),
                }
            }
        }
        other => panic!("Expected Function, got: {other:?}"),
    }
}

#[test]
fn test_external_ref_nested_in_if() {
    // =IF([1]Data!A1>0,[1]Data!B1,"no")
    let resolver = TestResolver::new();
    let result = parse_formula("=IF([1]Data!A1>0,[1]Data!B1,\"no\")", Some(&resolver));
    assert!(
        result.is_ok(),
        "IF with external refs should parse, got: {:?}",
        result.err()
    );
}

// ── Review follow-up: additional external ref coverage ─────────────

#[test]
fn test_external_ref_no_ref_after_bang() {
    // [1]Sheet1! with no cell ref after bang — should fail to parse as external ref
    // and fall through to a parse error
    let result = parse_formula("=[1]Sheet1!", None);
    assert!(
        result.is_err(),
        "=[1]Sheet1! (no ref) should be a parse error"
    );
}

#[test]
fn test_external_ref_no_sheet_name() {
    // [1]!A1 — no sheet name between ] and ! — should fail
    let result = parse_formula("=[1]!A1", None);
    assert!(
        result.is_err(),
        "=[1]!A1 (no sheet name) should be a parse error"
    );
}

#[test]
fn test_external_ref_row_range() {
    // [1]Sheet1!1:5 — row range through external ref path
    let result = parse_formula("=[1]Sheet1!1:5", None);
    assert!(
        result.is_ok(),
        "[1]Sheet1!1:5 should parse, got: {:?}",
        result.err()
    );
    let ast = result.unwrap().into_inner();
    assert_external_sheet_ref(&ast, "Sheet1");
}

#[test]
fn test_external_ref_row_range_with_resolver() {
    // [1]Sheet1!1:5 with resolver remains external.
    let resolver = TestResolver::new();
    let result = parse_formula("=[1]Sheet1!1:5", Some(&resolver));
    assert!(result.is_ok());
    let ast = result.unwrap().into_inner();
    assert_external_sheet_ref(&ast, "Sheet1");
}

#[test]
fn test_external_ref_mixed_absolute() {
    // [1]Sheet1!$A1 — mixed absolute column, relative row
    let result = parse_formula("=[1]Sheet1!$A1", None);
    assert!(
        result.is_ok(),
        "[1]Sheet1!$A1 should parse, got: {:?}",
        result.err()
    );
    let ast = result.unwrap().into_inner();
    match assert_external_sheet_ref(&ast, "Sheet1") {
        ASTNode::CellReference(cr) => {
            assert!(cr.abs_col, "Column should be absolute");
            assert!(!cr.abs_row, "Row should be relative");
        }
        other => panic!("Expected CellReference, got: {other:?}"),
    }
}

#[test]
fn test_external_ref_column_range_with_resolver() {
    // [1]Data!$R:$R with resolver remains external.
    let resolver = TestResolver::new();
    let result = parse_formula("=[1]Data!$R:$R", Some(&resolver));
    assert!(
        result.is_ok(),
        "[1]Data!$R:$R should parse, got: {:?}",
        result.err()
    );
    let ast = result.unwrap().into_inner();
    assert_external_sheet_ref(&ast, "Data");
}

#[test]
fn test_external_ref_iferror_with_resolver() {
    // IFERROR([1]Data!$R:$R, "") keeps ExternalSheetRef inside IFERROR.
    let resolver = TestResolver::new();
    let result = parse_formula("=IFERROR([1]Data!$R:$R,\"\")", Some(&resolver));
    assert!(
        result.is_ok(),
        "IFERROR with external ref should parse, got: {:?}",
        result.err()
    );
    let ast = result.unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, args, .. } => {
            assert_eq!(name, "IFERROR");
            assert_eq!(args.len(), 2);
            match &args[0] {
                ASTNode::ExternalSheetRef { sheet_name, .. } => {
                    assert_eq!(sheet_name, "Data");
                }
                other => panic!("Expected ExternalSheetRef in first arg, got: {other:?}"),
            }
        }
        other => panic!("Expected Function, got: {other:?}"),
    }
}

// =========================================================================
// Real-world formulas (from comprehensive_tests.rs)
// =========================================================================

#[test]
fn test_real_world_index_match() {
    assert!(parse_formula("INDEX(B2:B100,MATCH(D1,A2:A100,0))", None).is_ok());
}

#[test]
fn test_real_world_iferror() {
    let ast = parse_formula("IFERROR(A1/B1,0)", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name.as_ref(), "IFERROR");
            assert_eq!(args.len(), 2);
        }
        _ => panic!("expected fn"),
    }
}

#[test]
fn test_real_world_filter() {
    let ast = parse_formula("FILTER(A1:C100,B1:B100>50)", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name.as_ref(), "FILTER");
            assert_eq!(args.len(), 2);
        }
        _ => panic!("expected fn"),
    }
}

#[test]
fn test_real_world_sort() {
    let ast = parse_formula("SORT(A1:B10,2,-1)", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name.as_ref(), "SORT");
            assert_eq!(args.len(), 3);
        }
        _ => panic!("expected fn"),
    }
}

#[test]
fn test_real_world_unique() {
    let ast = parse_formula("UNIQUE(A1:A100)", None).unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name.as_ref(), "UNIQUE");
            assert_eq!(args.len(), 1);
        }
        _ => panic!("expected fn"),
    }
}

#[test]
fn test_real_world_sequence() {
    let ast = parse_formula("SEQUENCE(10,3,1,2)", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name.as_ref(), "SEQUENCE");
            assert_eq!(args.len(), 4);
        }
        _ => panic!("expected fn"),
    }
}

#[test]
fn test_real_world_map() {
    let ast = parse_formula("MAP(A1:A10,LAMBDA(x,x*2))", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name.as_ref(), "MAP");
            assert_eq!(args.len(), 2);
        }
        _ => panic!("expected fn"),
    }
}

#[test]
fn test_real_world_reduce() {
    let ast = parse_formula("REDUCE(0,A1:A10,LAMBDA(acc,x,acc+x))", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name.as_ref(), "REDUCE");
            assert_eq!(args.len(), 3);
        }
        _ => panic!("expected fn"),
    }
}

#[test]
fn test_real_world_pmt() {
    let ast = parse_formula("PMT(B1/12,B2*12,-B3)", None)
        .unwrap()
        .into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name.as_ref(), "PMT");
            assert_eq!(args.len(), 3);
        }
        _ => panic!("expected fn"),
    }
}

#[test]
fn test_real_world_date() {
    assert!(parse_formula("DATE(YEAR(A1),MONTH(A1)+1,DAY(A1))", None).is_ok());
}

// =========================================================================
// Deleted endpoint edge cases (from comprehensive_tests.rs)
// =========================================================================

#[test]
fn test_deleted_endpoint_sum_ref_error() {
    let ast = parse_formula("SUM(A1:#REF!)", None).unwrap().into_inner();
    match &ast {
        ASTNode::Function { name, args } => {
            assert_eq!(name.as_ref(), "SUM");
            assert_eq!(args.len(), 1);
            assert!(matches!(&args[0], ASTNode::Error(CellError::Ref)));
        }
        _ => panic!("expected Function, got {ast:?}"),
    }
}

#[test]
fn test_deleted_endpoint_dollar_a1_colon_ref_error() {
    let ast = parse_formula("$A$1:#REF!", None).unwrap().into_inner();
    assert!(
        matches!(&ast, ASTNode::Error(CellError::Ref)),
        "got {ast:?}"
    );
}

#[test]
#[allow(clippy::float_cmp)]
fn test_deleted_endpoint_a1_ref_error_plus_1() {
    let ast = parse_formula("A1:#REF!+1", None).unwrap().into_inner();
    match &ast {
        ASTNode::BinaryOp {
            op: BinOp::Add,
            left,
            right,
        } => {
            assert!(matches!(left.as_ref(), ASTNode::Error(CellError::Ref)));
            assert!(matches!(right.as_ref(), ASTNode::Number(n) if *n == 1.0));
        }
        _ => panic!("expected BinaryOp(Add), got {ast:?}"),
    }
}

// =========================================================================
// Malformed input edge cases (from comprehensive_tests.rs)
// =========================================================================

#[test]
fn test_malformed_unterm_str_inner_quote() {
    assert!(parse_formula("\"hello\"\"", None).is_err());
}

#[test]
fn test_malformed_unterm_str_escape_at_end() {
    assert!(parse_formula("\"test\"\"world", None).is_err());
}

#[test]
fn test_malformed_at_sign() {
    assert!(parse_formula("1@2", None).is_err());
}

#[test]
fn test_malformed_hash_not_error() {
    assert!(parse_formula("#INVALID", None).is_err());
}

#[test]
fn test_malformed_tilde() {
    assert!(parse_formula("~1", None).is_err());
}

#[test]
fn test_malformed_backtick() {
    assert!(parse_formula("`A1`", None).is_err());
}

#[test]
fn test_malformed_double_mul() {
    assert!(parse_formula("1**2", None).is_err());
}

#[test]
fn test_malformed_double_div() {
    assert!(parse_formula("1//2", None).is_err());
}

#[test]
fn test_malformed_double_pow() {
    assert!(parse_formula("1^^2", None).is_err());
}

#[test]
fn test_malformed_empty_parens_not_func() {
    assert!(parse_formula("()", None).is_err());
}

#[test]
fn test_malformed_just_percent() {
    assert!(parse_formula("%", None).is_err());
}

#[test]
fn test_malformed_just_caret() {
    assert!(parse_formula("^", None).is_err());
}

#[test]
fn test_malformed_dollar_only() {
    assert!(parse_formula("$", None).is_err());
}

#[test]
fn test_malformed_dollar_dollar() {
    assert!(parse_formula("$$", None).is_err());
}

#[test]
fn test_malformed_colon_a1() {
    assert!(parse_formula(":A1", None).is_err());
}

#[test]
fn test_malformed_a1_colon_nothing() {
    assert!(parse_formula("A1:", None).is_err());
}

#[test]
fn test_malformed_unicode_emoji() {
    let _ = parse_formula("\u{1F389}", None);
}

#[test]
fn test_malformed_unicode_cjk() {
    let _ = parse_formula("\u{65E5}\u{672C}\u{8A9E}", None);
}

#[test]
fn test_malformed_unicode_arabic() {
    let _ = parse_formula("\u{0639}\u{0631}\u{0628}\u{064A}", None);
}

#[test]
fn test_malformed_unicode_mixed() {
    let _ = parse_formula("=A1+caf\u{00E9}", None);
}

#[test]
fn test_malformed_very_long_addition() {
    let formula = (0..100)
        .map(|i| format!("{i}"))
        .collect::<Vec<_>>()
        .join("+");
    let _ = parse_formula(&formula, None);
}

#[test]
fn test_trailing_dot_error() {
    assert!(parse_formula("5.", None).is_err());
}

#[test]
fn test_empty_array_error() {
    assert!(parse_formula("{}", None).is_err());
}

#[test]
fn test_precedence_pow_over_mul() {
    let a = parse_formula("2*3^4", None).unwrap().into_inner();
    match &a {
        ASTNode::BinaryOp {
            op: BinOp::Mul,
            right,
            ..
        } => assert!(matches!(
            right.as_ref(),
            ASTNode::BinaryOp { op: BinOp::Pow, .. }
        )),
        _ => panic!("wrong"),
    }
}

#[test]
fn test_depth_100_function_nesting_ok() {
    let f = format!("{}1{}", "SUM(".repeat(100), ")".repeat(100));
    assert!(parse_formula(&f, None).is_ok());
}

#[test]
fn test_row_range_overflow_is_error() {
    assert!(parse_formula("1:1048577", None).is_err());
}

#[test]
fn test_structured_ref_unicode_col() {
    assert!(parse_formula("Table1[Montant\u{00E9}]", None).is_ok());
}

#[test]
fn test_structured_ref_in_arith() {
    assert!(parse_formula("Table1[@Price]*Table1[@Qty]", None).is_ok());
}
