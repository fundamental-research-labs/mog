use value_types::{CellImage, CellImageSizing, CellValue};

use super::super::literal::constant_to_a1;
use super::*;

#[test]
fn non_finite_numeric_strings_fall_through_to_formula() {
    for s in ["NaN", "inf", "-inf"] {
        match ParsedExpr::classify(s) {
            ParsedExpr::Formula(fs) => assert_eq!(fs.original, s),
            other => panic!("expected Formula for {s}, got {other:?}"),
        }
    }
}

#[test]
fn malformed_quoted_text_falls_through_to_formula() {
    match ParsedExpr::classify("\"a\"b\"") {
        ParsedExpr::Formula(fs) => assert_eq!(fs.original, "\"a\"b\""),
        other => panic!("expected Formula, got {other:?}"),
    }
}

#[test]
fn parsed_expr_to_a1_string_constant() {
    assert_eq!(
        ParsedExpr::Constant(CellValue::from(42.0)).to_a1_string(),
        "42"
    );
    assert_eq!(
        ParsedExpr::Constant(CellValue::Boolean(true)).to_a1_string(),
        "TRUE"
    );
    assert_eq!(
        ParsedExpr::Constant(CellValue::from("hi")).to_a1_string(),
        "\"hi\""
    );
}

#[test]
fn constant_to_a1_image_fallback_is_empty() {
    let image = CellImage::new(
        "https://example.test/i.png",
        None,
        CellImageSizing::Fit,
        None,
        None,
    );
    assert_eq!(constant_to_a1(&CellValue::Image(image)), "");
}
