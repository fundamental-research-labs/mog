use cell_types::SheetId;
use formula_types::RangeType;
use value_types::{CellError, CellValue};

use super::*;

#[test]
fn classify_empty() {
    assert_eq!(ParsedExpr::classify(""), ParsedExpr::Empty);
    assert_eq!(ParsedExpr::classify("   "), ParsedExpr::Empty);
    assert_eq!(ParsedExpr::classify("\t\n"), ParsedExpr::Empty);
}

#[test]
fn classify_cell() {
    match ParsedExpr::classify("A1") {
        ParsedExpr::Cell(node) => {
            assert!(!node.abs_row);
            assert!(!node.abs_col);
        }
        other => panic!("expected Cell, got {other:?}"),
    }
    match ParsedExpr::classify("$B$5") {
        ParsedExpr::Cell(node) => {
            assert!(node.abs_row);
            assert!(node.abs_col);
        }
        other => panic!("expected Cell, got {other:?}"),
    }
}

#[test]
fn classify_range() {
    match ParsedExpr::classify("A1:C5") {
        ParsedExpr::Range(r) => assert_eq!(r.range_type, RangeType::CellRange),
        other => panic!("expected Range, got {other:?}"),
    }
    match ParsedExpr::classify("A:C") {
        ParsedExpr::Range(r) => assert_eq!(r.range_type, RangeType::ColumnRange),
        other => panic!("expected Range column, got {other:?}"),
    }
}

#[test]
fn classify_sqref_list() {
    match ParsedExpr::classify("A1 B2:C3 D4") {
        ParsedExpr::SqrefList(list) => assert_eq!(list.len(), 3),
        other => panic!("expected SqrefList, got {other:?}"),
    }
}

#[test]
fn classify_constant_number() {
    match ParsedExpr::classify("42") {
        ParsedExpr::Constant(CellValue::Number(n)) => assert!((*n - 42.0).abs() < f64::EPSILON),
        other => panic!("expected Constant(Number), got {other:?}"),
    }
}

#[test]
fn classify_constant_boolean() {
    assert_eq!(
        ParsedExpr::classify("TRUE"),
        ParsedExpr::Constant(CellValue::Boolean(true))
    );
    assert_eq!(
        ParsedExpr::classify("false"),
        ParsedExpr::Constant(CellValue::Boolean(false))
    );
}

#[test]
fn classify_constant_text() {
    match ParsedExpr::classify("\"hello\"") {
        ParsedExpr::Constant(v) => assert_eq!(v.as_text(), Some("hello")),
        other => panic!("expected Constant(Text), got {other:?}"),
    }
}

#[test]
fn classify_data_validation_list_formula() {
    match ParsedExpr::classify("\"Yes,No,Maybe\"") {
        ParsedExpr::Constant(v) => assert_eq!(v.as_text(), Some("Yes,No,Maybe")),
        other => panic!("expected Constant(Text) for list formula, got {other:?}"),
    }
    match ParsedExpr::classify("\"Option1,Option2,Option3\"") {
        ParsedExpr::Constant(v) => assert_eq!(v.as_text(), Some("Option1,Option2,Option3")),
        other => panic!("expected Constant(Text) for list formula, got {other:?}"),
    }
    match ParsedExpr::classify("\"Yes\"") {
        ParsedExpr::Constant(v) => assert_eq!(v.as_text(), Some("Yes")),
        other => panic!("expected Constant(Text) for single-item list, got {other:?}"),
    }
    match ParsedExpr::classify("$J$1:$J$5") {
        ParsedExpr::Range(_) => {}
        other => panic!("expected Range for range-shaped list source, got {other:?}"),
    }
}

#[test]
fn classify_constant_error() {
    match ParsedExpr::classify("#DIV/0!") {
        ParsedExpr::Constant(v) => assert_eq!(v.as_error(), Some(CellError::Div0)),
        other => panic!("expected Constant(Error), got {other:?}"),
    }
}

#[test]
fn classify_formula() {
    match ParsedExpr::classify("=A1+B1") {
        ParsedExpr::Formula(fs) => assert_eq!(fs.original, "=A1+B1"),
        other => panic!("expected Formula, got {other:?}"),
    }
}

#[test]
fn classify_unparseable_goes_to_formula_with_error_ast() {
    let fs = match ParsedExpr::classify("=((()") {
        ParsedExpr::Formula(fs) => fs,
        other => panic!("expected Formula, got {other:?}"),
    };
    assert_eq!(fs.original, "=((()");
}

#[test]
fn classify_is_total_on_sample_inputs() {
    for s in [
        "",
        " ",
        "A1",
        "A1:B10",
        "#REF!",
        "Sheet1!#REF!",
        "=1+1",
        "hello world",
        "\"quoted\"",
        "TRUE",
        "3.14",
        "",
        "Πλήρης_Εκτύπωση",
        "μμμμμμ",
        "=OFFSET(Πλήρης,0,0)",
    ] {
        let _ = ParsedExpr::classify(s);
    }
    let _ = SheetId::from_raw(0);
}
