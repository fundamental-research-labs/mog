//! First-principles edge-case tests for the formula parser.
//!
//! Every test here is written from Excel formula semantics — testing what
//! SHOULD happen, not merely what the parser currently does.
//!
//! Tests here focus on edge cases NOT covered by `parser_tests.rs`.

use super::*;
use crate::ast::{ASTNode, BinOp};
use crate::test_helpers::TestResolver;
use cell_types::SheetId;
use value_types::CellError;

// ═══════════════════════════════════════════════════════════════════════════
// 1. Identifier vs Cell Reference — unique boundary cases
// ═══════════════════════════════════════════════════════════════════════════
mod identifier_vs_cellref {
    use super::*;

    #[test]
    fn abc_no_row_digits_is_identifier() {
        let ast = parse_formula("=ABC", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Identifier("ABC".to_string()));
    }

    #[test]
    fn hello_is_identifier() {
        let ast = parse_formula("=HELLO", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Identifier("HELLO".to_string()));
    }

    #[test]
    fn a1b_is_identifier_not_cellref_plus_trailing() {
        let ast = parse_formula("=A1B", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Identifier("A1B".to_string()));
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Boolean Literals — unique edge cases
// ═══════════════════════════════════════════════════════════════════════════
mod boolean_literals {
    use super::*;

    #[test]
    fn false_weird_case() {
        let ast = parse_formula("=fAlSe", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Boolean(false));
    }

    #[test]
    fn true_plus_number() {
        let ast = parse_formula("=TRUE+1", None).unwrap().into_inner();
        assert_eq!(
            ast,
            ASTNode::BinaryOp {
                op: BinOp::Add,
                left: Box::new(ASTNode::Boolean(true)),
                right: Box::new(ASTNode::Number(1.0)),
            }
        );
    }

    #[test]
    fn true_concat_string() {
        let ast = parse_formula("=TRUE&\"x\"", None).unwrap().into_inner();
        assert_eq!(
            ast,
            ASTNode::BinaryOp {
                op: BinOp::Concat,
                left: Box::new(ASTNode::Boolean(true)),
                right: Box::new(ASTNode::Text("x".to_string())),
            }
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Error Literals — unique types and expressions
// ═══════════════════════════════════════════════════════════════════════════
mod error_literals {
    use super::*;

    #[test]
    fn spill() {
        let ast = parse_formula("=#SPILL!", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Error(CellError::Spill));
    }

    #[test]
    fn calc() {
        let ast = parse_formula("=#CALC!", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Error(CellError::Calc));
    }

    #[test]
    fn div0_plus_number() {
        let ast = parse_formula("=#DIV/0!+1", None).unwrap().into_inner();
        assert_eq!(
            ast,
            ASTNode::BinaryOp {
                op: BinOp::Add,
                left: Box::new(ASTNode::Error(CellError::Div0)),
                right: Box::new(ASTNode::Number(1.0)),
            }
        );
    }

    #[test]
    fn na_concat_text() {
        let ast = parse_formula("=#N/A&\"text\"", None).unwrap().into_inner();
        assert_eq!(
            ast,
            ASTNode::BinaryOp {
                op: BinOp::Concat,
                left: Box::new(ASTNode::Error(CellError::Na)),
                right: Box::new(ASTNode::Text("text".to_string())),
            }
        );
    }

    #[test]
    fn error_as_function_arg() {
        let ast = parse_formula("=IF(#VALUE!,1,0)", None)
            .unwrap()
            .into_inner();
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name, "IF");
                assert_eq!(args.len(), 3);
                assert_eq!(args[0], ASTNode::Error(CellError::Value));
                assert_eq!(args[1], ASTNode::Number(1.0));
                assert_eq!(args[2], ASTNode::Number(0.0));
            }
            _ => panic!("Expected Function, got {ast:?}"),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. String Literals — unique edge cases
// ═══════════════════════════════════════════════════════════════════════════
mod string_literals {
    use super::*;

    #[test]
    fn four_quotes_is_one_escaped_quote() {
        let ast = parse_formula("=\"\"\"\"", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Text("\"".to_string()));
    }

    #[test]
    fn unicode_preserved() {
        let ast = parse_formula("=\"\u{65E5}\u{672C}\u{8A9E}\"", None)
            .unwrap()
            .into_inner();
        assert_eq!(ast, ASTNode::Text("\u{65E5}\u{672C}\u{8A9E}".to_string()));
    }

    #[test]
    fn backslash_not_interpreted_as_escape() {
        let ast = parse_formula("=\"line1\\nline2\"", None)
            .unwrap()
            .into_inner();
        assert_eq!(ast, ASTNode::Text("line1\\nline2".to_string()));
    }

    #[test]
    fn a1_in_string_is_text_not_cell_ref() {
        let ast = parse_formula("=\"A1\"", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Text("A1".to_string()));
    }

    #[test]
    fn error_in_string_is_text_not_error() {
        let ast = parse_formula("=\"#REF!\"", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Text("#REF!".to_string()));
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Numeric Literals — unique edge cases
// ═══════════════════════════════════════════════════════════════════════════
mod numeric_literals {
    use super::*;

    #[test]
    fn scientific_positive_exponent() {
        let ast = parse_formula("=1e+10", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Number(1e10));
    }

    #[test]
    fn scientific_zero_exponent() {
        let ast = parse_formula("=1e0", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Number(1.0));
    }

    #[test]
    fn scientific_negative_exponent() {
        let ast = parse_formula("=1.5e-3", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Number(0.0015));
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Array Literals — unique edge cases
// ═══════════════════════════════════════════════════════════════════════════
mod array_literals {
    use super::*;

    #[test]
    fn single_column_semicolon_separated() {
        let ast = parse_formula("={1;2;3}", None).unwrap().into_inner();
        match &ast {
            ASTNode::Array { rows } => {
                assert_eq!(rows.len(), 3);
                assert_eq!(rows[0].len(), 1);
                assert_eq!(rows[1].len(), 1);
                assert_eq!(rows[2].len(), 1);
            }
            _ => panic!("Expected Array, got {ast:?}"),
        }
    }

    #[test]
    fn array_with_error_value() {
        let ast = parse_formula("={#N/A,1}", None).unwrap().into_inner();
        match &ast {
            ASTNode::Array { rows } => {
                assert_eq!(rows.len(), 1);
                assert_eq!(rows[0][0], ASTNode::Error(CellError::Na));
                assert_eq!(rows[0][1], ASTNode::Number(1.0));
            }
            _ => panic!("Expected Array, got {ast:?}"),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Function Calls — unique edge cases
// ═══════════════════════════════════════════════════════════════════════════
mod function_calls {
    use super::*;

    #[test]
    #[allow(clippy::cast_precision_loss)]
    fn sum_with_five_number_args() {
        let ast = parse_formula("=SUM(1,2,3,4,5)", None).unwrap().into_inner();
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name, "SUM");
                assert_eq!(args.len(), 5);
                for (i, arg) in args.iter().enumerate() {
                    assert_eq!(*arg, ASTNode::Number((i + 1) as f64));
                }
            }
            _ => panic!("Expected Function, got {ast:?}"),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. Omitted Arguments — unique edge case
// ═══════════════════════════════════════════════════════════════════════════
mod omitted_arguments {
    use super::*;

    #[test]
    fn index_middle_omitted() {
        let ast = parse_formula("=INDEX(A1:B10,,2)", None)
            .unwrap()
            .into_inner();
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name, "INDEX");
                assert_eq!(args.len(), 3);
                assert!(matches!(&args[0], ASTNode::Range(_)));
                assert_eq!(args[1], ASTNode::Omitted);
                assert_eq!(args[2], ASTNode::Number(2.0));
            }
            _ => panic!("Expected Function, got {ast:?}"),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. LET and LAMBDA — unique edge cases
// ═══════════════════════════════════════════════════════════════════════════
mod let_and_lambda {
    use super::*;

    #[test]
    fn let_simple_binding_detailed() {
        // Detailed assertion on the body expression
        let ast = parse_formula("=LET(x,10,x+1)", None).unwrap().into_inner();
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name, "LET");
                assert_eq!(args.len(), 3);
                assert_eq!(args[0], ASTNode::Identifier("x".to_string()));
                assert_eq!(args[1], ASTNode::Number(10.0));
                match &args[2] {
                    ASTNode::BinaryOp { op, left, right } => {
                        assert_eq!(*op, BinOp::Add);
                        assert_eq!(**left, ASTNode::Identifier("x".to_string()));
                        assert_eq!(**right, ASTNode::Number(1.0));
                    }
                    _ => panic!("Expected BinaryOp, got {:?}", args[2]),
                }
            }
            _ => panic!("Expected Function, got {ast:?}"),
        }
    }

    #[test]
    fn lambda_simple_detailed() {
        let ast = parse_formula("=LAMBDA(x,x*2)", None).unwrap().into_inner();
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name, "LAMBDA");
                assert_eq!(args.len(), 2);
                assert_eq!(args[0], ASTNode::Identifier("x".to_string()));
                match &args[1] {
                    ASTNode::BinaryOp { op, left, right } => {
                        assert_eq!(*op, BinOp::Mul);
                        assert_eq!(**left, ASTNode::Identifier("x".to_string()));
                        assert_eq!(**right, ASTNode::Number(2.0));
                    }
                    _ => panic!("Expected BinaryOp, got {:?}", args[1]),
                }
            }
            _ => panic!("Expected Function, got {ast:?}"),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. Structured References — uses parse_structured_ref directly
// ═══════════════════════════════════════════════════════════════════════════
mod structured_references {
    use crate::parse_structured_ref;
    use formula_types::{SpecialItem, StructuredRefSpecifier};

    #[test]
    fn simple_column_ref() {
        let sr = parse_structured_ref("Table1[Column1]").unwrap();
        assert_eq!(sr.table_name, "Table1");
        assert_eq!(sr.specifiers.len(), 1);
        match &sr.specifiers[0] {
            StructuredRefSpecifier::Column { name } => assert_eq!(name, "Column1"),
            _ => panic!("Expected Column specifier, got {:?}", sr.specifiers[0]),
        }
    }

    #[test]
    fn headers_with_column() {
        let sr = parse_structured_ref("Table1[[#Headers],[Col1]]").unwrap();
        assert_eq!(sr.table_name, "Table1");
        assert!(sr.specifiers.len() >= 2);
        let has_headers = sr.specifiers.iter().any(|s| {
            matches!(
                s,
                StructuredRefSpecifier::Special {
                    item: SpecialItem::Headers
                }
            )
        });
        let has_col = sr
            .specifiers
            .iter()
            .any(|s| matches!(s, StructuredRefSpecifier::Column { name } if name == "Col1"));
        assert!(has_headers, "Expected Headers specifier");
        assert!(has_col, "Expected Column specifier for Col1");
    }

    #[test]
    fn this_row_at_shorthand() {
        let sr = parse_structured_ref("Table1[@Column1]").unwrap();
        assert_eq!(sr.table_name, "Table1");
        let has_this_row = sr
            .specifiers
            .iter()
            .any(|s| matches!(s, StructuredRefSpecifier::ThisRow));
        let has_col = sr
            .specifiers
            .iter()
            .any(|s| matches!(s, StructuredRefSpecifier::Column { name } if name == "Column1"));
        assert!(has_this_row, "Expected ThisRow specifier from @ shorthand");
        assert!(has_col, "Expected Column specifier for Column1");
    }

    #[test]
    fn all_specifier_with_column() {
        let sr = parse_structured_ref("Table1[[#All],[Column1]]").unwrap();
        assert_eq!(sr.table_name, "Table1");
        let has_all = sr.specifiers.iter().any(|s| {
            matches!(
                s,
                StructuredRefSpecifier::Special {
                    item: SpecialItem::All
                }
            )
        });
        assert!(has_all, "Expected All specifier");
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. Cross-Sheet — unique edge case: escaped single quote
// ═══════════════════════════════════════════════════════════════════════════
mod cross_sheet_references {
    use super::*;

    #[test]
    fn escaped_single_quote_in_sheet_name() {
        let resolver = TestResolver::new();
        let ast = parse_formula("='Sheet''s Name'!A1", Some(&resolver))
            .unwrap()
            .into_inner();
        match &ast {
            ASTNode::SheetRef { sheet, .. } => {
                assert_eq!(*sheet, SheetId::from_raw(5));
            }
            _ => panic!("Expected SheetRef, got {ast:?}"),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 12. #REF! as Deleted Reference — unique expressions
// ═══════════════════════════════════════════════════════════════════════════
mod ref_error_as_deleted_reference {
    use super::*;

    #[test]
    fn cellref_plus_ref_error() {
        let ast = parse_formula("=A1+#REF!", None).unwrap().into_inner();
        match &ast {
            ASTNode::BinaryOp { op, left, right } => {
                assert_eq!(*op, BinOp::Add);
                assert!(matches!(left.as_ref(), ASTNode::CellReference(_)));
                assert_eq!(**right, ASTNode::Error(CellError::Ref));
            }
            _ => panic!("Expected BinaryOp, got {ast:?}"),
        }
    }

    #[test]
    fn sum_of_ref_error() {
        let ast = parse_formula("=SUM(#REF!)", None).unwrap().into_inner();
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name, "SUM");
                assert_eq!(args.len(), 1);
                assert_eq!(args[0], ASTNode::Error(CellError::Ref));
            }
            _ => panic!("Expected Function, got {ast:?}"),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 13. Display Round-Trip Fidelity — unique formulas
// ═══════════════════════════════════════════════════════════════════════════
mod display_round_trip {
    use super::*;

    fn assert_round_trip(formula: &str) {
        let ast1 = parse_formula(formula, None).unwrap().into_inner();
        let display = format!("{ast1}");
        let ast2 = parse_formula(&display, None).unwrap().into_inner();
        assert_eq!(
            ast1, ast2,
            "Round-trip failed: '{formula}' -> display '{display}' -> re-parsed {ast2:?}"
        );
    }

    #[test]
    fn precedence_preserved() {
        assert_round_trip("=A1+B1*C1");
    }

    #[test]
    fn function_with_comparison_and_strings() {
        assert_round_trip("=IF(A1>0,\"pos\",\"neg\")");
    }

    #[test]
    fn parens() {
        assert_round_trip("=(A1+B1)^2");
    }

    #[test]
    fn escaped_quotes_in_string() {
        assert_round_trip("=\"he\"\"llo\"");
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 14. Normalization (XLSX semantics) — ALL UNIQUE
// ═══════════════════════════════════════════════════════════════════════════
mod normalization {
    use crate::{decode_xml_entities_str, normalize_xlsx_formula};

    #[test]
    fn strip_xlfn_prefix() {
        let normalized = normalize_xlsx_formula("_xlfn.SUM(A1)");
        assert_eq!(normalized, "=SUM(A1)");
    }

    #[test]
    fn strip_xlfn_xlws_prefix() {
        let normalized = normalize_xlsx_formula("_xlfn._xlws.SORT(A1)");
        assert_eq!(normalized, "=SORT(A1)");
    }

    #[test]
    fn decode_amp_entity() {
        let decoded = decode_xml_entities_str("A1&amp;B1");
        assert_eq!(decoded, "A1&B1");
    }

    #[test]
    fn decode_lt_gt_entities() {
        let decoded = decode_xml_entities_str("A1&lt;B1&gt;C1");
        assert_eq!(decoded, "A1<B1>C1");
    }

    #[test]
    fn decode_quot_entity() {
        let decoded = decode_xml_entities_str("&quot;hello&quot;");
        assert_eq!(decoded, "\"hello\"");
    }

    #[test]
    fn normalize_preserves_string_content() {
        let normalized = normalize_xlsx_formula("\"_xlfn.test\"");
        assert!(normalized.contains("_xlfn.test"));
    }

    #[test]
    fn normalize_adds_equals_prefix() {
        let normalized = normalize_xlsx_formula("SUM(A1)");
        assert_eq!(normalized, "=SUM(A1)");
    }

    #[test]
    fn normalize_preserves_existing_equals() {
        let normalized = normalize_xlsx_formula("=SUM(A1)");
        assert_eq!(normalized, "=SUM(A1)");
    }

    #[test]
    fn normalize_empty_string() {
        let normalized = normalize_xlsx_formula("");
        assert_eq!(normalized, "");
    }

    #[test]
    fn decode_xml_entities_combined() {
        let normalized = normalize_xlsx_formula("IF(A1&lt;0,\"neg\",\"pos\")");
        assert_eq!(normalized, "=IF(A1<0,\"neg\",\"pos\")");
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 15. Parse Error Cases — unique edge cases
// ═══════════════════════════════════════════════════════════════════════════
mod parse_errors {
    use super::*;

    #[test]
    fn double_plus_behavior() {
        let result = parse_formula("=A1++", None);
        assert!(
            result.is_err(),
            "Expected error for trailing double plus, got {result:?}"
        );
    }

    #[test]
    fn unmatched_parens_more_open() {
        let result = parse_formula("=(((A1))", None);
        assert!(
            result.is_err(),
            "Expected error for unmatched parens, got {result:?}"
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 16. Boundary Condition Matrix
// ═══════════════════════════════════════════════════════════════════════════
// Tests at exact limits: MAX_DEPTH, max row (1048576), max col (16383/XFD)

mod boundary_conditions {
    use super::*;
    use formula_types::CellRef;

    // ── Depth boundaries ────────────────────────────────────────────

    #[test]
    fn depth_at_max_minus_one_succeeds() {
        // 127 levels of paren nesting should succeed.
        // Each paren adds one depth level via parse_expr_bp, plus the initial
        // call = 128 total depth, which is exactly MAX_DEPTH (not exceeded).
        let formula = format!("={}1{}", "(".repeat(127), ")".repeat(127));
        assert!(parse_formula(&formula, None).is_ok());
    }

    #[test]
    fn depth_at_max_parens_fails() {
        // 128 levels of paren nesting: initial call + 128 parens = depth 129,
        // which exceeds MAX_DEPTH (128). Should fail with MaxDepthExceeded.
        let formula = format!("={}1{}", "(".repeat(128), ")".repeat(128));
        let result = parse_formula(&formula, None);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().kind, ParseErrorKind::MaxDepthExceeded);
    }

    #[test]
    fn depth_at_max_plus_one_fails() {
        // 129 levels of nesting should fail
        let formula = format!("={}1{}", "(".repeat(129), ")".repeat(129));
        let result = parse_formula(&formula, None);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().kind, ParseErrorKind::MaxDepthExceeded);
    }

    #[test]
    fn depth_function_nesting_at_limit() {
        // Nested function calls: SUM(SUM(SUM(...)))
        // Each function call adds depth. Test well within the limit.
        let mut formula = String::from("=");
        for _ in 0..64 {
            formula.push_str("SUM(");
        }
        formula.push('1');
        for _ in 0..64 {
            formula.push(')');
        }
        // 64 levels of function nesting should be well within limits
        assert!(parse_formula(&formula, None).is_ok());
    }

    #[test]
    fn depth_deep_nesting_no_panic() {
        // 200 levels — well past the limit. Must not panic (stack overflow).
        // Run in a thread with a large stack to avoid actual stack overflow
        // before the depth guard kicks in.
        let builder = std::thread::Builder::new().stack_size(8 * 1024 * 1024);
        let handle = builder
            .spawn(|| {
                let formula = format!("={}1{}", "(".repeat(200), ")".repeat(200));
                let result = parse_formula(&formula, None);
                assert!(result.is_err());
            })
            .expect("Failed to spawn thread");
        handle.join().expect("Thread panicked");
    }

    // ── Row boundaries ──────────────────────────────────────────────

    #[test]
    fn row_at_max_succeeds() {
        // Row 1048576 is the maximum valid row
        let ast = parse_formula("=A1048576", None).unwrap().into_inner();
        match &ast {
            ASTNode::CellReference(r) => match &r.reference {
                CellRef::Positional { row, .. } => assert_eq!(*row, 1_048_575), // 0-indexed
                CellRef::Resolved(_) => panic!("expected positional"),
            },
            _ => panic!("expected cell ref"),
        }
    }

    #[test]
    fn row_at_max_in_range_succeeds() {
        // Range ending at max row
        let result = parse_formula("=A1:A1048576", None);
        assert!(result.is_ok());
    }

    #[test]
    fn row_zero_is_not_valid_cell() {
        // Row 0 doesn't exist in spreadsheets (A0 is not valid)
        // Parser should treat this as identifier or error, not cell ref
        let result = parse_formula("=A0", None);
        // A0 is parsed as an identifier, not a cell reference
        if let Ok(spanned) = result {
            assert!(
                !matches!(spanned.node, ASTNode::CellReference(..)),
                "A0 should not parse as a cell reference"
            );
        }
    }

    // ── Column boundaries ───────────────────────────────────────────

    #[test]
    fn col_at_max_xfd_succeeds() {
        // XFD is column 16384 (0-indexed: 16383) — the maximum valid column
        let ast = parse_formula("=XFD1", None).unwrap().into_inner();
        match &ast {
            ASTNode::CellReference(r) => match &r.reference {
                CellRef::Positional { col, .. } => assert_eq!(*col, 16_383), // 0-indexed
                CellRef::Resolved(_) => panic!("expected positional"),
            },
            _ => panic!("expected cell ref"),
        }
    }

    #[test]
    fn col_past_max_xfe_is_identifier() {
        // XFE1 exceeds the column limit — should NOT parse as cell reference
        let result = parse_formula("=XFE1", None);
        // Should parse as identifier, not cell reference. An error is also acceptable.
        if let Ok(spanned) = result {
            assert!(
                !matches!(spanned.node, ASTNode::CellReference(..)),
                "XFE1 should not parse as a cell reference"
            );
        }
    }

    #[test]
    fn col_xfd_max_row_corner() {
        // The absolute maximum cell: XFD1048576
        let ast = parse_formula("=XFD1048576", None).unwrap().into_inner();
        match &ast {
            ASTNode::CellReference(r) => match &r.reference {
                CellRef::Positional { row, col, .. } => {
                    assert_eq!(*row, 1_048_575);
                    assert_eq!(*col, 16_383);
                }
                CellRef::Resolved(_) => panic!("expected positional"),
            },
            _ => panic!("expected cell ref"),
        }
    }

    #[test]
    fn col_a_is_zero() {
        // Column A should be 0-indexed as 0
        let ast = parse_formula("=A1", None).unwrap().into_inner();
        match &ast {
            ASTNode::CellReference(r) => match &r.reference {
                CellRef::Positional { col, .. } => assert_eq!(*col, 0),
                CellRef::Resolved(_) => panic!("expected positional"),
            },
            _ => panic!("expected cell ref"),
        }
    }

    // ── Range boundaries ────────────────────────────────────────────

    #[test]
    fn range_max_row_range() {
        // Row range covering all rows: 1:1048576
        let result = parse_formula("=1:1048576", None);
        assert!(result.is_ok());
    }

    #[test]
    fn range_max_col_range() {
        // Column range covering all columns: A:XFD
        let result = parse_formula("=A:XFD", None);
        assert!(result.is_ok());
    }

    #[test]
    fn absolute_ref_at_boundaries() {
        // $XFD$1048576 — absolute reference at max corner
        let ast = parse_formula("=$XFD$1048576", None).unwrap().into_inner();
        match &ast {
            ASTNode::CellReference(r) => {
                assert!(r.abs_row);
                assert!(r.abs_col);
                match &r.reference {
                    CellRef::Positional { row, col, .. } => {
                        assert_eq!(*row, 1_048_575);
                        assert_eq!(*col, 16_383);
                    }
                    CellRef::Resolved(_) => panic!("expected positional"),
                }
            }
            _ => panic!("expected cell ref"),
        }
    }

    // ── String boundary ─────────────────────────────────────────────

    #[test]
    fn empty_string_literal() {
        let ast = parse_formula("=\"\"", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Text(String::new()));
    }

    // ── Array boundary ──────────────────────────────────────────────

    #[test]
    fn single_element_array() {
        let ast = parse_formula("={1}", None).unwrap().into_inner();
        match &ast {
            ASTNode::Array { rows } => {
                assert_eq!(rows.len(), 1);
                assert_eq!(rows[0].len(), 1);
            }
            _ => panic!("expected array"),
        }
    }

    // ── Function arg boundaries ─────────────────────────────────────

    #[test]
    fn function_zero_args() {
        let ast = parse_formula("=NOW()", None).unwrap().into_inner();
        match &ast {
            ASTNode::Function { args, .. } => assert_eq!(args.len(), 0),
            _ => panic!("expected function"),
        }
    }

    #[test]
    fn function_single_arg() {
        let ast = parse_formula("=ABS(1)", None).unwrap().into_inner();
        match &ast {
            ASTNode::Function { args, .. } => assert_eq!(args.len(), 1),
            _ => panic!("expected function"),
        }
    }

    #[test]
    fn function_many_omitted_args() {
        // 10 omitted args: FUNC(,,,,,,,,,,)
        let formula = format!("=FUNC({})", ",".repeat(10));
        let ast = parse_formula(&formula, None).unwrap().into_inner();
        match &ast {
            ASTNode::Function { args, .. } => {
                assert_eq!(args.len(), 11); // 10 commas = 11 positions
                for arg in args {
                    assert_eq!(*arg, ASTNode::Omitted);
                }
            }
            _ => panic!("expected function"),
        }
    }
}
