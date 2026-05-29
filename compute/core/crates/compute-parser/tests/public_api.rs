//! Integration tests exercising only the public API of `compute-parser`.
//!
//! Every import comes from `compute_parser::*` — if something fails to compile
//! it means the type/function is not part of the public API.

// These imports serve as compile-time checks that the public API surface exists.
#[allow(unused_imports)]
use compute_parser::{
    ASTNode, BinOp, CellRefNode, ParseError, ParseErrorKind, RangeRef, Span, Spanned, UnaryOp,
    decode_xml_entities_str, needs_quoting, normalize_formula_input, normalize_xlsx_formula,
    parse_formula, parse_structured_ref, to_a1_string,
};

// ═══════════════════════════════════════════════════════════════════════════
// 1. Core parsing
// ═══════════════════════════════════════════════════════════════════════════

mod core_parsing {
    use super::*;

    // --- Literals ---

    #[test]
    fn parse_integer() {
        let ast = parse_formula("=42", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Number(42.0));
    }

    #[test]
    fn parse_float() {
        let ast = parse_formula("=3.15", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Number(3.15));
    }

    #[test]
    fn parse_scientific_notation() {
        let ast = parse_formula("=1e10", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Number(1e10));
    }

    #[test]
    fn parse_string_literal() {
        let ast = parse_formula("=\"hello\"", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Text("hello".to_string()));
    }

    #[test]
    fn parse_string_with_escaped_quotes() {
        let ast = parse_formula("=\"say \"\"hi\"\"\"", None)
            .unwrap()
            .into_inner();
        assert_eq!(ast, ASTNode::Text("say \"hi\"".to_string()));
    }

    #[test]
    fn parse_boolean_true() {
        let ast = parse_formula("=TRUE", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Boolean(true));
    }

    #[test]
    fn parse_boolean_false() {
        let ast = parse_formula("=FALSE", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Boolean(false));
    }

    #[test]
    fn parse_error_div0() {
        let ast = parse_formula("=#DIV/0!", None).unwrap().into_inner();
        matches!(ast, ASTNode::Error(_));
    }

    #[test]
    fn parse_error_na() {
        let ast = parse_formula("=#N/A", None).unwrap().into_inner();
        matches!(ast, ASTNode::Error(_));
    }

    // --- Cell references ---

    #[test]
    fn parse_simple_cell_ref() {
        let ast = parse_formula("=A1", None).unwrap().into_inner();
        match &ast {
            ASTNode::CellReference(CellRefNode {
                abs_row, abs_col, ..
            }) => {
                assert!(!abs_row);
                assert!(!abs_col);
            }
            other => panic!("Expected CellReference, got {other:?}"),
        }
    }

    #[test]
    fn parse_absolute_cell_ref() {
        let ast = parse_formula("=$A$1", None).unwrap().into_inner();
        match &ast {
            ASTNode::CellReference(CellRefNode {
                abs_row, abs_col, ..
            }) => {
                assert!(abs_row, "Expected abs_row=true");
                assert!(abs_col, "Expected abs_col=true");
            }
            other => panic!("Expected CellReference, got {other:?}"),
        }
    }

    #[test]
    fn parse_mixed_absolute_ref() {
        let ast = parse_formula("=$A1", None).unwrap().into_inner();
        match &ast {
            ASTNode::CellReference(CellRefNode {
                abs_row, abs_col, ..
            }) => {
                assert!(!abs_row, "Expected abs_row=false");
                assert!(abs_col, "Expected abs_col=true");
            }
            other => panic!("Expected CellReference, got {other:?}"),
        }
    }

    #[test]
    fn parse_sheet_qualified_ref() {
        // Without a resolver, sheet references become UnresolvedSheetRef
        let ast = parse_formula("=Sheet1!A1", None).unwrap().into_inner();
        match &ast {
            ASTNode::UnresolvedSheetRef { sheet_name, inner } => {
                assert_eq!(sheet_name, "Sheet1");
                assert!(matches!(inner.as_ref(), ASTNode::CellReference(_)));
            }
            other => panic!("Expected UnresolvedSheetRef, got {other:?}"),
        }
    }

    // --- Ranges ---

    #[test]
    fn parse_cell_range() {
        let ast = parse_formula("=A1:B10", None).unwrap().into_inner();
        assert!(
            matches!(ast, ASTNode::Range(_)),
            "Expected Range, got {ast:?}"
        );
    }

    #[test]
    fn parse_column_range() {
        let ast = parse_formula("=A:C", None).unwrap().into_inner();
        assert!(
            matches!(ast, ASTNode::Range(_)),
            "Expected Range, got {ast:?}"
        );
    }

    #[test]
    fn parse_row_range() {
        let ast = parse_formula("=1:5", None).unwrap().into_inner();
        assert!(
            matches!(ast, ASTNode::Range(_)),
            "Expected Range, got {ast:?}"
        );
    }

    // --- Function calls ---

    #[test]
    fn parse_sum_function() {
        let ast = parse_formula("=SUM(A1:B10)", None).unwrap().into_inner();
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name.as_ref(), "SUM");
                assert_eq!(args.len(), 1);
                assert!(matches!(args[0], ASTNode::Range(_)));
            }
            other => panic!("Expected Function, got {other:?}"),
        }
    }

    #[test]
    fn parse_if_function() {
        let ast = parse_formula("=IF(A1>0,A1,-A1)", None)
            .unwrap()
            .into_inner();
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name.as_ref(), "IF");
                assert_eq!(args.len(), 3);
            }
            other => panic!("Expected Function, got {other:?}"),
        }
    }

    // --- Operators and precedence ---

    #[test]
    fn parse_addition() {
        let ast = parse_formula("=1+2", None).unwrap().into_inner();
        match &ast {
            ASTNode::BinaryOp { op, left, right } => {
                assert_eq!(*op, BinOp::Add);
                assert_eq!(**left, ASTNode::Number(1.0));
                assert_eq!(**right, ASTNode::Number(2.0));
            }
            other => panic!("Expected BinaryOp, got {other:?}"),
        }
    }

    #[test]
    fn mul_binds_tighter_than_add() {
        // 1+2*3 should parse as 1+(2*3)
        let ast = parse_formula("=1+2*3", None).unwrap().into_inner();
        match &ast {
            ASTNode::BinaryOp { op, left, right } => {
                assert_eq!(*op, BinOp::Add);
                assert_eq!(**left, ASTNode::Number(1.0));
                match right.as_ref() {
                    ASTNode::BinaryOp { op, left, right } => {
                        assert_eq!(*op, BinOp::Mul);
                        assert_eq!(**left, ASTNode::Number(2.0));
                        assert_eq!(**right, ASTNode::Number(3.0));
                    }
                    other => panic!("Expected inner BinaryOp(Mul), got {other:?}"),
                }
            }
            other => panic!("Expected BinaryOp(Add), got {other:?}"),
        }
    }

    #[test]
    fn parse_comparison_operators() {
        let ast = parse_formula("=A1>=B1", None).unwrap().into_inner();
        match &ast {
            ASTNode::BinaryOp { op, .. } => assert_eq!(*op, BinOp::Gte),
            other => panic!("Expected BinaryOp(Gte), got {other:?}"),
        }
    }

    #[test]
    fn parse_unary_negation() {
        let ast = parse_formula("=-5", None).unwrap().into_inner();
        match &ast {
            ASTNode::UnaryOp { op, operand } => {
                assert_eq!(*op, UnaryOp::Minus);
                assert_eq!(**operand, ASTNode::Number(5.0));
            }
            other => panic!("Expected UnaryOp(Minus), got {other:?}"),
        }
    }

    #[test]
    fn parse_percent() {
        let ast = parse_formula("=50%", None).unwrap().into_inner();
        match &ast {
            ASTNode::UnaryOp { op, operand } => {
                assert_eq!(*op, UnaryOp::Percent);
                assert_eq!(**operand, ASTNode::Number(50.0));
            }
            other => panic!("Expected UnaryOp(Percent), got {other:?}"),
        }
    }

    // --- Nested / complex ---

    #[test]
    fn parse_nested_parens() {
        let ast = parse_formula("=(1+2)*3", None).unwrap().into_inner();
        match &ast {
            ASTNode::BinaryOp { op, left, .. } => {
                assert_eq!(*op, BinOp::Mul);
                assert!(matches!(left.as_ref(), ASTNode::Paren(_)));
            }
            other => panic!("Expected BinaryOp(Mul), got {other:?}"),
        }
    }

    #[test]
    fn parse_nested_functions() {
        let ast = parse_formula("=SUM(IF(A1>0,A1,0))", None)
            .unwrap()
            .into_inner();
        match &ast {
            ASTNode::Function { name, args } => {
                assert_eq!(name.as_ref(), "SUM");
                assert_eq!(args.len(), 1);
                assert!(matches!(args[0], ASTNode::Function { .. }));
            }
            other => panic!("Expected Function, got {other:?}"),
        }
    }

    #[test]
    fn parse_array_literal() {
        let ast = parse_formula("={1,2;3,4}", None).unwrap().into_inner();
        match &ast {
            ASTNode::Array { rows } => {
                assert_eq!(rows.len(), 2);
                assert_eq!(rows[0].len(), 2);
                assert_eq!(rows[1].len(), 2);
                assert_eq!(rows[0][0], ASTNode::Number(1.0));
                assert_eq!(rows[0][1], ASTNode::Number(2.0));
                assert_eq!(rows[1][0], ASTNode::Number(3.0));
                assert_eq!(rows[1][1], ASTNode::Number(4.0));
            }
            other => panic!("Expected Array, got {other:?}"),
        }
    }

    #[test]
    fn parse_string_concat() {
        let ast = parse_formula("=\"a\"&\"b\"", None).unwrap().into_inner();
        match &ast {
            ASTNode::BinaryOp { op, .. } => assert_eq!(*op, BinOp::Concat),
            other => panic!("Expected BinaryOp(Concat), got {other:?}"),
        }
    }

    #[test]
    fn parse_without_equals_prefix() {
        // Parser should accept formulas without leading =
        let ast = parse_formula("42", None).unwrap().into_inner();
        assert_eq!(ast, ASTNode::Number(42.0));
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Error handling
// ═══════════════════════════════════════════════════════════════════════════

mod error_handling {
    use super::*;

    #[test]
    fn empty_formula_returns_empty_kind() {
        let err = parse_formula("", None).unwrap_err();
        assert_eq!(err.kind, ParseErrorKind::Empty);
    }

    #[test]
    fn equals_only_returns_empty_kind() {
        let err = parse_formula("=", None).unwrap_err();
        assert_eq!(err.kind, ParseErrorKind::Empty);
    }

    #[test]
    fn unmatched_paren_returns_error() {
        let err = parse_formula("=SUM(A1:B10", None).unwrap_err();
        assert!(
            matches!(err.kind, ParseErrorKind::UnmatchedParen { .. }),
            "Expected UnmatchedParen, got {:?}",
            err.kind
        );
    }

    #[test]
    fn parse_error_has_position() {
        let err = parse_formula("", None).unwrap_err();
        // Position should be a valid byte offset
        assert_eq!(err.position(), 0);
    }

    #[test]
    fn parse_error_has_span() {
        let err = parse_formula("", None).unwrap_err();
        // Span should be a range
        assert!(err.span.start <= err.span.end);
    }

    #[test]
    fn parse_error_display_is_meaningful() {
        let err = parse_formula("", None).unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("Parse error"), "Display was: {msg}");
        assert!(msg.contains("empty"), "Display was: {msg}");
    }

    #[test]
    fn parse_error_message_method() {
        let err = parse_formula("", None).unwrap_err();
        let msg = err.message();
        assert!(msg.contains("empty"), "message() was: {msg}");
    }

    #[test]
    fn parse_error_implements_std_error() {
        let err = parse_formula("", None).unwrap_err();
        // std::error::Error must be implemented — the trait bound is checked at compile time
        let _: &dyn std::error::Error = &err;
    }

    #[test]
    fn parse_error_kind_display() {
        let kind = ParseErrorKind::Empty;
        let s = format!("{kind}");
        assert!(!s.is_empty());
    }

    #[test]
    fn trailing_garbage_returns_trailing_input() {
        let err = parse_formula("=1+2 xyz", None).unwrap_err();
        assert_eq!(err.kind, ParseErrorKind::TrailingInput);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Round-trip (parse -> to_a1_string requires a lookup, so we test
//    parse -> Debug -> parse consistency via structural comparison)
// ═══════════════════════════════════════════════════════════════════════════

mod round_trip {
    use super::*;

    /// Helper: parse a formula twice and assert ASTs are equal.
    fn assert_parse_idempotent(formula: &str) {
        let ast1 = parse_formula(formula, None).unwrap();
        let ast2 = parse_formula(formula, None).unwrap();
        assert_eq!(
            ast1.node, ast2.node,
            "Parse is not deterministic for: {formula}"
        );
    }

    #[test]
    fn idempotent_simple_arithmetic() {
        assert_parse_idempotent("=1+2*3");
    }

    #[test]
    fn idempotent_function_call() {
        assert_parse_idempotent("=SUM(A1:B10)");
    }

    #[test]
    fn idempotent_nested_if() {
        assert_parse_idempotent("=IF(A1>0,IF(B1>0,1,2),3)");
    }

    #[test]
    fn idempotent_array_literal() {
        assert_parse_idempotent("={1,2,3;4,5,6}");
    }

    #[test]
    fn idempotent_complex_formula() {
        assert_parse_idempotent("=VLOOKUP(A1,Sheet1!B:D,3,FALSE)");
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Normalization
// ═══════════════════════════════════════════════════════════════════════════

mod normalization {
    use super::*;

    #[test]
    fn normalize_xlsx_strips_xlfn_prefix() {
        let result = normalize_xlsx_formula("_xlfn.SUM(A1:B10)");
        assert_eq!(result, "=SUM(A1:B10)");
    }

    #[test]
    fn normalize_xlsx_strips_xlfn_xlws_prefix() {
        let result = normalize_xlsx_formula("_xlfn._xlws.FILTER(A1:A10,B1:B10)");
        assert_eq!(result, "=FILTER(A1:A10,B1:B10)");
    }

    #[test]
    fn normalize_xlsx_strips_round_74_dynamic_array_prefixes() {
        let cases = [
            (
                "_xlfn.GROUPBY(A1:A3,B1:B3,SUM)",
                "=GROUPBY(A1:A3,B1:B3,SUM)",
            ),
            (
                "_xlfn._xlws.PIVOTBY(A1:A3,B1:B3,C1:C3,SUM)",
                "=PIVOTBY(A1:A3,B1:B3,C1:C3,SUM)",
            ),
            ("_xlfn.PERCENTOF(A1:A3,B1:B3)", "=PERCENTOF(A1:A3,B1:B3)"),
            ("_xlfn.TRIMRANGE(A1:C3)", "=TRIMRANGE(A1:C3)"),
        ];
        for (raw, expected) in cases {
            assert_eq!(normalize_xlsx_formula(raw), expected);
            assert!(parse_formula(expected, None).is_ok());
        }
    }

    #[test]
    fn normalize_xlsx_keeps_xlfn_text_inside_strings() {
        let formula = r#"IF(A1="_xlfn.GROUPBY","_xlfn._xlws.PIVOTBY",TRIMRANGE(A1:C3))"#;
        assert_eq!(
            normalize_xlsx_formula(formula),
            r#"=IF(A1="_xlfn.GROUPBY","_xlfn._xlws.PIVOTBY",TRIMRANGE(A1:C3))"#
        );
    }

    #[test]
    fn normalize_xlsx_adds_equals_prefix() {
        let result = normalize_xlsx_formula("SUM(A1:B10)");
        assert_eq!(result, "=SUM(A1:B10)");
    }

    #[test]
    fn normalize_xlsx_preserves_existing_equals() {
        let result = normalize_xlsx_formula("=SUM(A1:B10)");
        assert_eq!(result, "=SUM(A1:B10)");
    }

    #[test]
    fn normalize_xlsx_empty_input() {
        let result = normalize_xlsx_formula("");
        assert_eq!(result, "");
    }

    #[test]
    fn normalize_input_uppercases_cell_refs() {
        let result = normalize_formula_input("=sum(a1:b10)", &[]);
        // Cell references a1, b10 should be uppercased
        assert!(
            result.contains("A1") && result.contains("B10"),
            "Expected uppercase refs, got: {result}"
        );
    }

    #[test]
    fn normalize_input_closes_unclosed_parens() {
        let result = normalize_formula_input("=SUM(A1:B10", &[]);
        assert!(
            result.ends_with(')'),
            "Expected auto-closed paren, got: {result}"
        );
    }

    #[test]
    fn normalize_input_noop_for_clean() {
        let result = normalize_formula_input("=SUM(A1:B10)", &[]);
        assert_eq!(result, "=SUM(A1:B10)");
    }

    #[test]
    fn decode_xml_entities() {
        let result = decode_xml_entities_str("a&amp;b&lt;c");
        assert_eq!(result, "a&b<c");
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Structured references
// ═══════════════════════════════════════════════════════════════════════════

mod structured_refs {
    use super::*;

    #[test]
    fn parse_simple_structured_ref() {
        let sr = parse_structured_ref("Table1[Column1]").unwrap();
        assert_eq!(sr.table_name, "Table1");
    }

    #[test]
    fn parse_structured_ref_with_specifier() {
        let sr = parse_structured_ref("Table1[[#Headers],[Col1]]").unwrap();
        assert_eq!(sr.table_name, "Table1");
    }

    #[test]
    fn parse_structured_ref_empty_input_fails() {
        let err = parse_structured_ref("").unwrap_err();
        assert!(matches!(
            err.kind,
            ParseErrorKind::MalformedStructuredRef { .. }
        ));
    }

    #[test]
    fn parse_structured_ref_no_bracket_fails() {
        let err = parse_structured_ref("Table1").unwrap_err();
        assert!(matches!(
            err.kind,
            ParseErrorKind::MalformedStructuredRef { .. }
        ));
    }

    #[test]
    fn parse_structured_ref_no_table_name_fails() {
        let err = parse_structured_ref("[Column1]").unwrap_err();
        assert!(matches!(
            err.kind,
            ParseErrorKind::MalformedStructuredRef { .. }
        ));
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. API contract tests (trait implementations)
// ═══════════════════════════════════════════════════════════════════════════

mod api_contract {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn astnode_implements_debug() {
        let node = ASTNode::Number(1.0);
        let _ = format!("{node:?}");
    }

    #[test]
    fn astnode_implements_clone() {
        let node = ASTNode::Number(1.0);
        let cloned = node.clone();
        assert_eq!(node, cloned);
    }

    #[test]
    fn astnode_implements_partial_eq() {
        assert_eq!(ASTNode::Number(1.0), ASTNode::Number(1.0));
        assert_ne!(ASTNode::Number(1.0), ASTNode::Number(2.0));
    }

    #[test]
    fn parse_error_implements_debug_clone_partial_eq() {
        let err = parse_formula("", None).unwrap_err();
        let debug = format!("{err:?}");
        assert!(!debug.is_empty());
        let cloned = err.clone();
        assert_eq!(err, cloned);
    }

    #[test]
    fn parse_error_implements_display_and_error() {
        let err = parse_formula("", None).unwrap_err();
        let display = format!("{err}");
        assert!(!display.is_empty());
        let _: &dyn std::error::Error = &err;
    }

    #[test]
    fn binop_implements_hash() {
        let mut set = HashSet::new();
        set.insert(BinOp::Add);
        set.insert(BinOp::Mul);
        assert_eq!(set.len(), 2);
        set.insert(BinOp::Add);
        assert_eq!(set.len(), 2);
    }

    #[test]
    fn unaryop_implements_hash() {
        let mut set = HashSet::new();
        set.insert(UnaryOp::Minus);
        set.insert(UnaryOp::Plus);
        assert_eq!(set.len(), 2);
    }

    #[test]
    fn span_implements_hash() {
        let mut set = HashSet::new();
        set.insert(Span::new(0, 5));
        set.insert(Span::new(0, 10));
        assert_eq!(set.len(), 2);
        set.insert(Span::new(0, 5));
        assert_eq!(set.len(), 2);
    }

    #[test]
    fn spanned_into_inner() {
        let spanned = parse_formula("=42", None).unwrap();
        let node = spanned.into_inner();
        assert_eq!(node, ASTNode::Number(42.0));
    }

    #[test]
    fn spanned_map() {
        let spanned = parse_formula("=42", None).unwrap();
        let mapped = spanned.map(|n| format!("{n:?}"));
        assert!(mapped.node.contains("Number"));
    }

    #[test]
    fn span_merge() {
        let s1 = Span::new(0, 5);
        let s2 = Span::new(3, 10);
        let merged = s1.merge(s2);
        assert_eq!(merged.start, 0);
        assert_eq!(merged.end, 10);
    }

    #[test]
    fn span_len_and_is_empty() {
        let s = Span::new(2, 7);
        assert_eq!(s.len(), 5);
        assert!(!s.is_empty());

        let empty = Span::empty();
        assert_eq!(empty.len(), 0);
        assert!(empty.is_empty());
    }

    #[test]
    fn needs_quoting_special_chars() {
        assert!(needs_quoting("D&A Build"));
        assert!(needs_quoting("RC"));
        assert!(needs_quoting("A1"));
        assert!(!needs_quoting("Sheet1"));
    }

    #[test]
    fn binop_display() {
        assert_eq!(format!("{}", BinOp::Add), "+");
        assert_eq!(format!("{}", BinOp::Neq), "<>");
    }

    #[test]
    fn unaryop_display() {
        assert_eq!(format!("{}", UnaryOp::Minus), "-");
        assert_eq!(format!("{}", UnaryOp::Percent), "%");
    }

    #[test]
    fn parse_error_kind_implements_hash() {
        let mut set = HashSet::new();
        set.insert(ParseErrorKind::Empty);
        set.insert(ParseErrorKind::TrailingInput);
        assert_eq!(set.len(), 2);
    }
}
