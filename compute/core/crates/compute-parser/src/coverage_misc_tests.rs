//! Coverage tests for Display impls, error types, identity transforms, and AST utilities.
//!
//! Organized into three parts:
//!
//! - **Part A** — `ParseErrorKind` Display impls and parse-time error paths
//! - **Part B** — `identity_transform.rs` (AST → `IdentityFormula` conversion for all node types)
//! - **Part C** — `ast.rs` utilities: ASTNode/BinOp/UnaryOp Display, Span methods,
//!   Spanned helpers, `RangeRef::same_sheet`, `needs_quoting`, and structured ref Display

use super::*;
use crate::AbsFlags;
use crate::ast::{ASTNode, BinOp, CellRefNode, RangeRef, Span, Spanned, UnaryOp, needs_quoting};
use crate::identity_transform::{ast_to_identity, to_identity_formula};
use crate::parser::{ParseError, ParseErrorKind};
use cell_types::{CellId, ColId, RowId, SheetId};
use formula_types::{CellRef, IdentityFormulaRef, RangeType};
use value_types::CellError;

// ===========================================================================
// PART A: parser.rs coverage — ParseErrorKind Display + error paths
// ===========================================================================

#[test]
fn display_empty() {
    let kind = ParseErrorKind::Empty;
    assert_eq!(format!("{kind}"), "formula is empty");
}

#[test]
fn display_max_depth_exceeded() {
    let kind = ParseErrorKind::MaxDepthExceeded;
    assert_eq!(format!("{kind}"), "maximum nesting depth exceeded");
}

#[test]
fn display_trailing_input() {
    let kind = ParseErrorKind::TrailingInput;
    assert_eq!(format!("{kind}"), "unexpected trailing input");
}

#[test]
fn display_unmatched_paren() {
    let kind = ParseErrorKind::UnmatchedParen { open_pos: 5 };
    let s = format!("{kind}");
    assert!(s.contains("position 5"), "got: {s}");
    assert!(s.contains("'('"), "got: {s}");
}

#[test]
fn display_unmatched_brace() {
    let kind = ParseErrorKind::UnmatchedBrace { open_pos: 3 };
    let s = format!("{kind}");
    assert!(s.contains("position 3"), "got: {s}");
    assert!(s.contains("'{'"), "got: {s}");
}

#[test]
fn display_expected_expression() {
    let kind = ParseErrorKind::ExpectedExpression;
    assert_eq!(format!("{kind}"), "expected an expression");
}

#[test]
fn display_expected_argument() {
    let kind = ParseErrorKind::ExpectedArgument;
    assert_eq!(format!("{kind}"), "expected a function argument");
}

#[test]
fn display_invalid_cell_reference() {
    let kind = ParseErrorKind::InvalidCellReference;
    assert_eq!(format!("{kind}"), "invalid cell reference");
}

#[test]
fn display_invalid_row_number() {
    let kind = ParseErrorKind::InvalidRowNumber { row: 2_000_000 };
    let s = format!("{kind}");
    assert!(s.contains("2000000"), "got: {s}");
    assert!(s.contains("1048576"), "got: {s}");
}

#[test]
fn display_invalid_column_number() {
    let kind = ParseErrorKind::InvalidColumnNumber { col: 99999 };
    let s = format!("{kind}");
    assert!(s.contains("99999"), "got: {s}");
    assert!(s.contains("16384"), "got: {s}");
}

#[test]
fn display_unknown_sheet_name() {
    let kind = ParseErrorKind::UnknownSheetName {
        name: "FooSheet".to_string(),
    };
    let s = format!("{kind}");
    assert!(s.contains("FooSheet"), "got: {s}");
}

#[test]
fn display_malformed_structured_ref() {
    let kind = ParseErrorKind::MalformedStructuredRef {
        detail: "missing bracket".to_string(),
    };
    let s = format!("{kind}");
    assert!(s.contains("missing bracket"), "got: {s}");
}

#[test]
fn display_malformed_string() {
    let kind = ParseErrorKind::MalformedString;
    assert_eq!(format!("{kind}"), "malformed string literal");
}

#[test]
fn display_malformed_number() {
    let kind = ParseErrorKind::MalformedNumber;
    assert_eq!(format!("{kind}"), "malformed numeric literal");
}

#[test]
fn display_malformed_array_literal() {
    let kind = ParseErrorKind::MalformedArrayLiteral;
    assert_eq!(format!("{kind}"), "malformed array literal");
}

#[test]
fn display_unexpected_token() {
    let kind = ParseErrorKind::UnexpectedToken;
    assert_eq!(format!("{kind}"), "unexpected token");
}

#[test]
fn display_invalid_reference() {
    let kind = ParseErrorKind::InvalidReference;
    assert_eq!(format!("{kind}"), "invalid reference");
}

// ── ParseError Display + Error trait ──────────────────────────────────

#[test]
fn parse_error_display() {
    let err = ParseError::new(ParseErrorKind::UnexpectedToken, Span::new(7, 10));
    let s = format!("{err}");
    assert!(s.contains("position 7"), "got: {s}");
    assert!(s.contains("unexpected token"), "got: {s}");
}

#[test]
fn parse_error_message_method() {
    let err = ParseError::new(ParseErrorKind::UnexpectedToken, Span::new(7, 10));
    assert_eq!(err.message(), "unexpected token");
    let err2 = ParseError::new(ParseErrorKind::Empty, Span::empty());
    assert_eq!(err2.message(), "formula is empty");
}

#[test]
fn parse_error_is_std_error() {
    let err = ParseError::new(ParseErrorKind::Empty, Span::empty());
    // Verify it implements std::error::Error
    let dyn_err: &dyn std::error::Error = &err;
    let _ = dyn_err;
    // source() should return None (default impl)
    assert!(std::error::Error::source(&err).is_none());
}

// ===========================================================================
// PART B: identity_transform.rs coverage
// ===========================================================================

// ── Mock resolver ─────────────────────────────────────────────────────

use std::cell::{Cell, RefCell};
use std::collections::HashMap;

struct MockIdentityResolver {
    sheet: SheetId,
    next_cell_id: Cell<u128>,
    cell_ids: RefCell<HashMap<(SheetId, u32, u32), CellId>>,
    row_ids: HashMap<(SheetId, u32), RowId>,
    col_ids: HashMap<(SheetId, u32), ColId>,
    sheets: HashMap<String, SheetId>,
}

impl MockIdentityResolver {
    fn new() -> Self {
        let sheet = SheetId::from_raw(1);
        let mut row_ids = HashMap::new();
        let mut col_ids = HashMap::new();
        for r in 0..1000 {
            row_ids.insert((sheet, r), RowId::from_raw(1000 + u128::from(r)));
        }
        for c in 0..26 {
            col_ids.insert((sheet, c), ColId::from_raw(2000 + u128::from(c)));
        }
        Self {
            sheet,
            next_cell_id: Cell::new(100),
            cell_ids: RefCell::new(HashMap::new()),
            row_ids,
            col_ids,
            sheets: HashMap::new(),
        }
    }

    fn add_sheet(&mut self, name: &str, id: u128) {
        let sheet_id = SheetId::from_raw(id);
        self.sheets.insert(name.to_string(), sheet_id);
        for r in 0..1000 {
            self.row_ids.insert(
                (sheet_id, r),
                RowId::from_raw(id * 10000 + 1000 + u128::from(r)),
            );
        }
        for c in 0..26 {
            self.col_ids.insert(
                (sheet_id, c),
                ColId::from_raw(id * 10000 + 2000 + u128::from(c)),
            );
        }
    }
}

impl crate::IdentityResolver for MockIdentityResolver {
    fn get_or_create_cell_id(&self, sheet: &SheetId, row: u32, col: u32) -> CellId {
        let mut cell_ids = self.cell_ids.borrow_mut();
        *cell_ids.entry((*sheet, row, col)).or_insert_with(|| {
            let id = CellId::from_raw(self.next_cell_id.get());
            self.next_cell_id.set(self.next_cell_id.get() + 1);
            id
        })
    }

    fn get_row_id(&self, sheet: &SheetId, row: u32) -> Option<RowId> {
        self.row_ids.get(&(*sheet, row)).copied()
    }

    fn get_col_id(&self, sheet: &SheetId, col: u32) -> Option<ColId> {
        self.col_ids.get(&(*sheet, col)).copied()
    }

    fn resolve_sheet_name(&self, name: &str) -> Option<SheetId> {
        self.sheets.get(name).copied()
    }

    fn current_sheet(&self) -> SheetId {
        self.sheet
    }
}

// ── Identity transform tests ──────────────────────────────────────────

#[test]
fn identity_simple_cell_ref() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=A1", &r).unwrap();
    assert_eq!(f.template, "{0}");
    assert_eq!(f.refs.len(), 1);
    assert!(matches!(f.refs[0], IdentityFormulaRef::Cell(_)));
}

#[test]
fn identity_range() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=A1:B10", &r).unwrap();
    assert_eq!(f.template, "{0}");
    assert_eq!(f.refs.len(), 1);
    assert!(matches!(f.refs[0], IdentityFormulaRef::Range(_)));
}

#[test]
fn identity_row_range() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=1:5", &r).unwrap();
    assert_eq!(f.template, "{0}");
    assert_eq!(f.refs.len(), 1);
    assert!(matches!(f.refs[0], IdentityFormulaRef::RowRange(_)));
}

#[test]
fn identity_single_row_range() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=1:1", &r).unwrap();
    assert_eq!(f.template, "{0}");
    assert_eq!(f.refs.len(), 1);
    assert!(matches!(f.refs[0], IdentityFormulaRef::FullRow(_)));
}

#[test]
fn identity_column_range() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=A:C", &r).unwrap();
    assert_eq!(f.template, "{0}");
    assert_eq!(f.refs.len(), 1);
    assert!(matches!(f.refs[0], IdentityFormulaRef::ColRange(_)));
}

#[test]
fn identity_single_column_range() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=A:A", &r).unwrap();
    assert_eq!(f.template, "{0}");
    assert_eq!(f.refs.len(), 1);
    assert!(matches!(f.refs[0], IdentityFormulaRef::FullCol(_)));
}

#[test]
fn identity_sheet_qualified_ref() {
    let mut r = MockIdentityResolver::new();
    r.add_sheet("Sheet1", 10);
    let f = to_identity_formula("=Sheet1!A1", &r).unwrap();
    assert_eq!(f.template, "{0}");
    assert_eq!(f.refs.len(), 1);
}

#[test]
fn identity_unknown_sheet_emits_ref() {
    let r = MockIdentityResolver::new();
    let result = to_identity_formula("=UnknownSheet!A1", &r);
    // Unknown sheets now gracefully emit #REF! instead of returning an error
    assert!(result.is_ok());
    assert_eq!(result.unwrap().template, "#REF!");
}

#[test]
fn identity_number_integer_format() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=1", &r).unwrap();
    assert_eq!(f.template, "1");
}

#[test]
fn identity_number_float_format() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=1.5", &r).unwrap();
    assert_eq!(f.template, "1.5");
}

#[test]
fn identity_text_with_quotes() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=\"he\"\"llo\"", &r).unwrap();
    assert_eq!(f.template, "\"he\"\"llo\"");
}

#[test]
fn identity_boolean_true() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=TRUE", &r).unwrap();
    assert_eq!(f.template, "TRUE");
    assert_eq!(f.refs.len(), 0);
}

#[test]
fn identity_boolean_false() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=FALSE", &r).unwrap();
    assert_eq!(f.template, "FALSE");
}

#[test]
fn identity_error_literal() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=#REF!", &r).unwrap();
    assert_eq!(f.template, "#REF!");
}

#[test]
fn identity_binary_op() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=A1+B1", &r).unwrap();
    assert_eq!(f.template, "{0}+{1}");
}

#[test]
fn identity_unary_minus() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=-A1", &r).unwrap();
    assert_eq!(f.template, "-{0}");
}

#[test]
fn identity_unary_plus() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=+A1", &r).unwrap();
    assert_eq!(f.template, "+{0}");
}

#[test]
fn identity_unary_percent() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=A1%", &r).unwrap();
    assert_eq!(f.template, "{0}%");
}

#[test]
fn identity_function() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=SUM(A1:B10)", &r).unwrap();
    assert_eq!(f.template, "SUM({0})");
}

#[test]
fn identity_paren() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=(A1+B1)", &r).unwrap();
    assert_eq!(f.template, "({0}+{1})");
}

#[test]
fn identity_identifier_via_let() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=LET(x,1,x+1)", &r).unwrap();
    assert!(f.template.contains('x'), "template: {}", f.template);
}

#[test]
fn identity_array_literal() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("={1,2;3,4}", &r).unwrap();
    assert_eq!(f.template, "{1,2;3,4}");
}

#[test]
fn identity_structured_ref() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=Table1[Col]", &r).unwrap();
    // Structured refs pass through as literal text
    assert!(f.template.contains("Table1"), "template: {}", f.template);
}

#[test]
fn identity_call_expression() {
    let r = MockIdentityResolver::new();
    // LAMBDA call expression
    let f = to_identity_formula("=(LAMBDA(x,x+1))(5)", &r).unwrap();
    assert!(f.template.contains("(5)"), "template: {}", f.template);
}

#[test]
fn identity_omitted_arg() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=IF(A1,,C1)", &r).unwrap();
    assert_eq!(f.template, "IF({0},,{1})");
}

#[test]
fn identity_range_op() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=INDEX(A:A,1):INDEX(B:B,1)", &r).unwrap();
    assert!(f.template.contains(':'), "template: {}", f.template);
}

#[test]
fn identity_dynamic_array_flag() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=SORT(A1:B10)", &r).unwrap();
    assert!(f.is_dynamic_array);
    assert!(!f.is_volatile);
}

#[test]
fn identity_volatile_flag() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=NOW()", &r).unwrap();
    assert!(f.is_volatile);
    assert!(!f.is_dynamic_array);
}

#[test]
fn identity_non_dynamic_non_volatile() {
    let r = MockIdentityResolver::new();
    let f = to_identity_formula("=SUM(A1:B10)", &r).unwrap();
    assert!(!f.is_dynamic_array);
    assert!(!f.is_volatile);
}

#[test]
fn identity_ast_to_identity_simple() {
    let ast = parse_formula("=A1+1", None).unwrap().into_inner();
    let r = MockIdentityResolver::new();
    let f = ast_to_identity(&ast, &r).unwrap();
    assert_eq!(f.template, "{0}+1");
}

#[test]
fn identity_sheet_ref_resolved_node() {
    // Build a SheetRef node manually (resolved sheet)
    let sheet_id = SheetId::from_raw(1);
    let ast = ASTNode::SheetRef {
        sheet: sheet_id,
        inner: Box::new(ASTNode::CellReference(CellRefNode {
            reference: CellRef::Positional {
                sheet: SheetId::from_raw(0),
                row: 0,
                col: 0,
            },
            abs_row: false,
            abs_col: false,
        })),
    };
    let r = MockIdentityResolver::new();
    let f = ast_to_identity(&ast, &r).unwrap();
    assert_eq!(f.template, "{0}");
}

// ===========================================================================
// PART C: ast.rs coverage — Display impls, Span, Spanned, etc.
// ===========================================================================

// ── ASTNode Display ───────────────────────────────────────────────────

#[test]
fn ast_display_number_integer() {
    assert_eq!(format!("{}", ASTNode::Number(42.0)), "42");
}

#[test]
fn ast_display_number_float() {
    assert_eq!(format!("{}", ASTNode::Number(3.15)), "3.15");
}

#[test]
fn ast_display_text() {
    assert_eq!(format!("{}", ASTNode::Text("hello".into())), "\"hello\"");
}

#[test]
fn ast_display_text_with_embedded_quotes() {
    assert_eq!(
        format!("{}", ASTNode::Text("say \"hi\"".into())),
        "\"say \"\"hi\"\"\""
    );
}

#[test]
fn ast_display_boolean_true() {
    assert_eq!(format!("{}", ASTNode::Boolean(true)), "TRUE");
}

#[test]
fn ast_display_boolean_false() {
    assert_eq!(format!("{}", ASTNode::Boolean(false)), "FALSE");
}

#[test]
fn ast_display_error_div0() {
    assert_eq!(format!("{}", ASTNode::Error(CellError::Div0)), "#DIV/0!");
}

#[test]
fn ast_display_omitted() {
    assert_eq!(format!("{}", ASTNode::Omitted), "");
}

#[test]
fn ast_display_identifier() {
    assert_eq!(format!("{}", ASTNode::Identifier("x".into())), "x");
}

#[test]
fn ast_display_range_op() {
    let node = ASTNode::RangeOp {
        start: Box::new(ASTNode::Number(1.0)),
        end: Box::new(ASTNode::Number(2.0)),
    };
    assert_eq!(format!("{node}"), "1:2");
}

#[test]
fn ast_display_resolved_cell_ref() {
    let node = ASTNode::CellReference(CellRefNode {
        reference: CellRef::Resolved(CellId::from_raw(42)),
        abs_row: false,
        abs_col: false,
    });
    assert_eq!(format!("{node}"), "<resolved>");
}

// ── BinOp Display ─────────────────────────────────────────────────────

#[test]
fn binop_display_all() {
    assert_eq!(format!("{}", BinOp::Add), "+");
    assert_eq!(format!("{}", BinOp::Sub), "-");
    assert_eq!(format!("{}", BinOp::Mul), "*");
    assert_eq!(format!("{}", BinOp::Div), "/");
    assert_eq!(format!("{}", BinOp::Pow), "^");
    assert_eq!(format!("{}", BinOp::Concat), "&");
    assert_eq!(format!("{}", BinOp::Eq), "=");
    assert_eq!(format!("{}", BinOp::Neq), "<>");
    assert_eq!(format!("{}", BinOp::Lt), "<");
    assert_eq!(format!("{}", BinOp::Gt), ">");
    assert_eq!(format!("{}", BinOp::Lte), "<=");
    assert_eq!(format!("{}", BinOp::Gte), ">=");
    assert_eq!(format!("{}", BinOp::Intersect), " ");
}

// ── UnaryOp Display ───────────────────────────────────────────────────

#[test]
fn unaryop_display_all() {
    assert_eq!(format!("{}", UnaryOp::Plus), "+");
    assert_eq!(format!("{}", UnaryOp::Minus), "-");
    assert_eq!(format!("{}", UnaryOp::Percent), "%");
}

// ── Span methods ──────────────────────────────────────────────────────

#[test]
fn span_new() {
    let s = Span::new(5, 10);
    assert_eq!(s.start, 5);
    assert_eq!(s.end, 10);
}

#[test]
fn span_empty() {
    let s = Span::empty();
    assert_eq!(s.start, 0);
    assert_eq!(s.end, 0);
    assert!(s.is_empty());
    assert_eq!(s.len(), 0);
}

#[test]
fn span_merge() {
    let a = Span::new(2, 5);
    let b = Span::new(8, 12);
    let merged = a.merge(b);
    assert_eq!(merged.start, 2);
    assert_eq!(merged.end, 12);
}

#[test]
fn span_merge_overlapping() {
    let a = Span::new(3, 10);
    let b = Span::new(1, 7);
    let merged = a.merge(b);
    assert_eq!(merged.start, 1);
    assert_eq!(merged.end, 10);
}

#[test]
fn span_len() {
    let s = Span::new(3, 10);
    assert_eq!(s.len(), 7);
}

#[test]
fn span_is_empty_false() {
    let s = Span::new(0, 5);
    assert!(!s.is_empty());
}

#[test]
fn span_is_empty_true_same() {
    let s = Span::new(3, 3);
    assert!(s.is_empty());
}

#[test]
fn span_len_saturating() {
    // Edge case: start > end (shouldn't happen normally, but saturating_sub handles it)
    let s = Span::new(10, 5);
    assert_eq!(s.len(), 0);
    assert!(s.is_empty());
}

// ── Spanned methods ──────────────────────────────────────────────────

#[test]
fn spanned_map() {
    let spanned = Spanned {
        node: 42i32,
        span: Span::new(1, 5),
    };
    let mapped = spanned.map(|n| n.to_string());
    assert_eq!(mapped.node, "42");
    assert_eq!(mapped.span, Span::new(1, 5));
}

#[test]
fn spanned_into_inner() {
    let spanned = Spanned {
        node: "hello".to_string(),
        span: Span::new(0, 5),
    };
    let inner = spanned.into_inner();
    assert_eq!(inner, "hello");
}

#[test]
fn spanned_display() {
    let spanned = Spanned {
        node: ASTNode::Number(7.0),
        span: Span::new(0, 1),
    };
    assert_eq!(format!("{spanned}"), "7");
}

// ── RangeRef::same_sheet ──────────────────────────────────────────────

#[test]
fn range_ref_same_sheet_both_positional_same() {
    let sheet = SheetId::from_raw(1);
    let r = RangeRef {
        start: CellRef::Positional {
            sheet,
            row: 0,
            col: 0,
        },
        end: CellRef::Positional {
            sheet,
            row: 9,
            col: 1,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    };
    assert_eq!(r.same_sheet(), Some(sheet));
}

#[test]
fn range_ref_same_sheet_different_sheets() {
    let r = RangeRef {
        start: CellRef::Positional {
            sheet: SheetId::from_raw(1),
            row: 0,
            col: 0,
        },
        end: CellRef::Positional {
            sheet: SheetId::from_raw(2),
            row: 0,
            col: 0,
        },
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    };
    assert_eq!(r.same_sheet(), None);
}

#[test]
fn range_ref_same_sheet_resolved() {
    let r = RangeRef {
        start: CellRef::Resolved(CellId::from_raw(1)),
        end: CellRef::Resolved(CellId::from_raw(2)),
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    };
    assert_eq!(r.same_sheet(), None);
}

#[test]
fn range_ref_same_sheet_mixed() {
    let r = RangeRef {
        start: CellRef::Positional {
            sheet: SheetId::from_raw(1),
            row: 0,
            col: 0,
        },
        end: CellRef::Resolved(CellId::from_raw(2)),
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    };
    assert_eq!(r.same_sheet(), None);
}

// ── needs_quoting ─────────────────────────────────────────────────────

#[test]
fn needs_quoting_empty() {
    assert!(needs_quoting(""));
}

#[test]
fn needs_quoting_starts_with_digit() {
    assert!(needs_quoting("1Sheet"));
}

#[test]
fn needs_quoting_starts_with_special() {
    assert!(needs_quoting("@Sheet"));
}

#[test]
fn needs_quoting_contains_space() {
    assert!(needs_quoting("My Sheet"));
}

#[test]
fn needs_quoting_contains_special_char() {
    assert!(needs_quoting("Sheet-1"));
}

#[test]
fn needs_quoting_simple_name_no_quoting() {
    assert!(!needs_quoting("Sheet1"));
}

#[test]
fn needs_quoting_underscore_ok() {
    assert!(!needs_quoting("_Sheet_1"));
}

#[test]
fn needs_quoting_all_alpha() {
    assert!(!needs_quoting("MySheet"));
}

// ── ASTNode Display for FullRow/FullCol range types ───────────────────

#[test]
fn ast_display_full_row_range_type() {
    // FullRow via RangeType — the "catch-all" <range> path
    // Note: RowRange and ColumnRange already tested; test the unknown/future catch-all
    // by using a RangeRef with Resolved refs (hits the fallback path)
    let node = ASTNode::Range(RangeRef {
        start: CellRef::Resolved(CellId::from_raw(1)),
        end: CellRef::Resolved(CellId::from_raw(2)),
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::ColumnRange,
    });
    // Resolved refs in ColumnRange hit the <col-range> fallback
    assert_eq!(format!("{node}"), "<col-range>");
}

#[test]
fn ast_display_row_range_resolved_fallback() {
    let node = ASTNode::Range(RangeRef {
        start: CellRef::Resolved(CellId::from_raw(1)),
        end: CellRef::Resolved(CellId::from_raw(2)),
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::RowRange,
    });
    assert_eq!(format!("{node}"), "<row-range>");
}

// ── ASTNode Display for absolute column/row ranges ────────────────────

#[test]
fn ast_display_absolute_column_range() {
    let sheet = SheetId::from_raw(0);
    let node = ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet,
            row: 0,
            col: 0,
        },
        end: CellRef::Positional {
            sheet,
            row: 0,
            col: 2,
        },
        abs_start: AbsFlags {
            row: false,
            col: true,
        },

        abs_end: AbsFlags {
            row: false,
            col: true,
        },
        range_type: RangeType::ColumnRange,
    });
    assert_eq!(format!("{node}"), "$A:$C");
}

#[test]
fn ast_display_absolute_row_range() {
    let sheet = SheetId::from_raw(0);
    let node = ASTNode::Range(RangeRef {
        start: CellRef::Positional {
            sheet,
            row: 0,
            col: 0,
        },
        end: CellRef::Positional {
            sheet,
            row: 4,
            col: 0,
        },
        abs_start: AbsFlags {
            row: true,
            col: false,
        },

        abs_end: AbsFlags {
            row: true,
            col: false,
        },
        range_type: RangeType::RowRange,
    });
    assert_eq!(format!("{node}"), "$1:$5");
}

// ── ASTNode Display for SheetRef with quoted name ─────────────────────

#[test]
fn ast_display_unresolved_sheet_ref_with_apostrophe() {
    let node = ASTNode::UnresolvedSheetRef {
        sheet_name: "Bob's Sheet".to_string(),
        inner: Box::new(ASTNode::CellReference(CellRefNode {
            reference: CellRef::Positional {
                sheet: SheetId::from_raw(0),
                row: 0,
                col: 0,
            },
            abs_row: false,
            abs_col: false,
        })),
    };
    let s = format!("{node}");
    // Name should be quoted and apostrophe escaped
    assert!(s.starts_with("'Bob''s Sheet'!"), "got: {s}");
}

// ── ASTNode Display for structured ref special items ──────────────────

#[test]
fn ast_display_structured_ref_this_row() {
    use formula_types::{StructuredRef, StructuredRefSpecifier};
    let sr = StructuredRef {
        table_name: "T1".to_string(),
        specifiers: vec![StructuredRefSpecifier::ThisRow],
    };
    let s = format!("{}", ASTNode::StructuredRef(sr));
    assert_eq!(s, "T1[[#This Row]]");
}

#[test]
fn ast_display_structured_ref_special_all() {
    use formula_types::{SpecialItem, StructuredRef, StructuredRefSpecifier};
    let sr = StructuredRef {
        table_name: "T1".to_string(),
        specifiers: vec![StructuredRefSpecifier::Special {
            item: SpecialItem::All,
        }],
    };
    assert_eq!(format!("{}", ASTNode::StructuredRef(sr)), "T1[[#All]]");
}

#[test]
fn ast_display_structured_ref_special_data() {
    use formula_types::{SpecialItem, StructuredRef, StructuredRefSpecifier};
    let sr = StructuredRef {
        table_name: "T1".to_string(),
        specifiers: vec![StructuredRefSpecifier::Special {
            item: SpecialItem::Data,
        }],
    };
    assert_eq!(format!("{}", ASTNode::StructuredRef(sr)), "T1[[#Data]]");
}

#[test]
fn ast_display_structured_ref_special_totals() {
    use formula_types::{SpecialItem, StructuredRef, StructuredRefSpecifier};
    let sr = StructuredRef {
        table_name: "T1".to_string(),
        specifiers: vec![StructuredRefSpecifier::Special {
            item: SpecialItem::Totals,
        }],
    };
    assert_eq!(format!("{}", ASTNode::StructuredRef(sr)), "T1[[#Totals]]");
}

#[test]
fn ast_display_structured_ref_special_this_row_via_special() {
    use formula_types::{SpecialItem, StructuredRef, StructuredRefSpecifier};
    let sr = StructuredRef {
        table_name: "T1".to_string(),
        specifiers: vec![StructuredRefSpecifier::Special {
            item: SpecialItem::ThisRow,
        }],
    };
    assert_eq!(format!("{}", ASTNode::StructuredRef(sr)), "T1[[#This Row]]");
}
