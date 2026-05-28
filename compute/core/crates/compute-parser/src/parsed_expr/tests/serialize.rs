use formula_types::{CellRef, RangeType};
use value_types::CellValue;

use crate::a1_entry::{parse_a1_cell, parse_a1_range};

use super::*;

#[test]
fn cell_ref_node_to_a1_string_positional() {
    let node = parse_a1_cell("$B$5").unwrap();
    assert_eq!(node.to_a1_string(), "$B$5");
}

#[test]
fn cell_ref_node_to_a1_string_canonical_upper() {
    let node = parse_a1_cell("ab100").unwrap();
    assert_eq!(node.to_a1_string(), "AB100");
}

#[test]
fn range_ref_to_a1_string_cell_range() {
    let r = parse_a1_range("$A$1:$C$5").unwrap();
    assert_eq!(r.to_a1_string(), "$A$1:$C$5");
}

#[test]
fn range_ref_to_a1_string_column_range() {
    let r = parse_a1_range("A:C").unwrap();
    assert_eq!(r.to_a1_string(), "A:C");
}

#[test]
fn range_ref_to_a1_string_row_range() {
    let r = parse_a1_range("2:7").unwrap();
    assert_eq!(r.to_a1_string(), "2:7");
}

#[test]
fn range_ref_to_a1_string_mixed_absolute_endpoint_flags() {
    let r = parse_a1_range("$A1:B$2").unwrap();
    assert_eq!(r.to_a1_string(), "$A1:B$2");
}

#[test]
fn range_ref_to_a1_string_resolved_fallback_is_ref_error() {
    use crate::ast::AbsFlags;
    use cell_types::CellId;
    let r = crate::ast::RangeRef {
        start: CellRef::Resolved(CellId::from_raw(1)),
        end: CellRef::Resolved(CellId::from_raw(2)),
        abs_start: AbsFlags::default(),
        abs_end: AbsFlags::default(),
        range_type: RangeType::CellRange,
    };
    assert_eq!(r.to_a1_string(), "#REF!:#REF!");
}

#[test]
fn parsed_expr_to_a1_string_empty() {
    assert_eq!(ParsedExpr::Empty.to_a1_string(), "");
}

#[test]
fn parsed_expr_to_a1_string_broken_ref() {
    assert_eq!(
        ParsedExpr::BrokenRef { sheet: None }.to_a1_string(),
        "#REF!"
    );
    assert_eq!(
        ParsedExpr::BrokenRef {
            sheet: Some(SheetName::from("Sheet1"))
        }
        .to_a1_string(),
        "Sheet1!#REF!"
    );
    assert_eq!(
        ParsedExpr::BrokenRef {
            sheet: Some(SheetName::from("My Sheet"))
        }
        .to_a1_string(),
        "'My Sheet'!#REF!"
    );
    assert_eq!(
        ParsedExpr::BrokenRef {
            sheet: Some(SheetName::from("Bob's Sheet"))
        }
        .to_a1_string(),
        "'Bob''s Sheet'!#REF!"
    );
}

#[test]
fn parsed_expr_to_a1_string_formula_returns_original() {
    let expr = ParsedExpr::classify("=SUM(A1:B2)");
    match &expr {
        ParsedExpr::Formula(_) => {}
        _ => panic!("expected formula variant"),
    }
    assert_eq!(&*expr.to_a1_string(), "=SUM(A1:B2)");
}

#[test]
fn classify_round_trip_cell_semantic() {
    let a = ParsedExpr::classify("$A$1");
    let s = a.to_a1_string();
    let b = ParsedExpr::classify(&s);
    assert_eq!(a, b);
}

#[test]
fn classify_round_trip_range_semantic() {
    let a = ParsedExpr::classify("A1:B10");
    let s = a.to_a1_string();
    let b = ParsedExpr::classify(&s);
    assert_eq!(a, b);
}

#[test]
fn classify_round_trip_sqref_semantic() {
    let a = ParsedExpr::classify("A1 B2:C3 D4");
    let s = a.to_a1_string();
    let b = ParsedExpr::classify(&s);
    assert_eq!(a, b);
}

#[test]
fn classify_round_trip_broken_ref_semantic() {
    let a = ParsedExpr::classify("'My Sheet'!#REF!");
    let s = a.to_a1_string();
    let b = ParsedExpr::classify(&s);
    assert_eq!(a, b);
}

#[test]
fn sheet_name_basic() {
    let n = SheetName::from("Sheet1");
    assert_eq!(n.as_str(), "Sheet1");
    let n2 = SheetName::from(String::from("Sheet2"));
    assert_eq!(n2.as_str(), "Sheet2");
}

#[test]
fn parsed_expr_to_a1_string_constant() {
    assert_eq!(
        ParsedExpr::Constant(CellValue::from(42.0)).to_a1_string(),
        "42"
    );
}
