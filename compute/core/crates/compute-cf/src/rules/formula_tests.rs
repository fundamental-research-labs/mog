use super::*;
use value_types::{CellError, FiniteF64};

/// Convenience: wrap a known-finite f64 literal in CellValue::Number for tests.
fn n(v: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(v))
}

// -----------------------------------------------------------------------
// is_truthy
// -----------------------------------------------------------------------

#[test]
fn test_truthy_boolean_true() {
    assert!(is_truthy(&CellValue::Boolean(true)));
}

#[test]
fn test_truthy_boolean_false() {
    assert!(!is_truthy(&CellValue::Boolean(false)));
}

#[test]
fn test_truthy_number_one() {
    assert!(is_truthy(&n(1.0)));
}

#[test]
fn test_truthy_number_negative() {
    assert!(is_truthy(&n(-1.0)));
}

#[test]
fn test_truthy_number_zero() {
    assert!(!is_truthy(&n(0.0)));
}

#[test]
fn test_truthy_number_nan() {
    assert!(!is_truthy(&CellValue::number(f64::NAN)));
}

#[test]
fn test_truthy_text_nonempty() {
    // In Excel CF formula rules, text is always falsy regardless of content.
    assert!(!is_truthy(&CellValue::Text("hello".into())));
}

#[test]
fn test_truthy_text_zero_string() {
    // Text "0" is also falsy — text is always falsy in CF formula rules.
    assert!(!is_truthy(&CellValue::Text("0".into())));
}

#[test]
fn test_truthy_text_empty() {
    assert!(!is_truthy(&CellValue::Text("".into())));
}

#[test]
fn test_truthy_null() {
    assert!(!is_truthy(&CellValue::Null));
}

#[test]
fn test_truthy_error() {
    assert!(!is_truthy(&CellValue::Error(CellError::Value, None)));
}

// -----------------------------------------------------------------------
// evaluate_formula
// -----------------------------------------------------------------------

#[test]
fn test_formula_none_result() {
    assert!(!evaluate_formula(None));
}

#[test]
fn test_formula_truthy_result() {
    let value = CellValue::Boolean(true);
    assert!(evaluate_formula(Some(&value)));
}

#[test]
fn test_formula_falsy_result() {
    let value = CellValue::Boolean(false);
    assert!(!evaluate_formula(Some(&value)));
}

#[test]
fn test_formula_number_truthy() {
    let value = n(42.0);
    assert!(evaluate_formula(Some(&value)));
}

#[test]
fn test_formula_number_zero() {
    let value = n(0.0);
    assert!(!evaluate_formula(Some(&value)));
}

#[test]
fn test_formula_text_falsy() {
    // Text is always falsy in Excel CF formula rules.
    let value = CellValue::Text("yes".into());
    assert!(!evaluate_formula(Some(&value)));
}

#[test]
fn test_formula_text_empty() {
    let value = CellValue::Text("".into());
    assert!(!evaluate_formula(Some(&value)));
}

#[test]
fn test_formula_null_value() {
    let value = CellValue::Null;
    assert!(!evaluate_formula(Some(&value)));
}

#[test]
fn test_formula_error_value() {
    let value = CellValue::Error(CellError::Div0, None);
    assert!(!evaluate_formula(Some(&value)));
}

// -----------------------------------------------------------------------
// is_truthy: Array and Lambda variants
// -----------------------------------------------------------------------

#[test]
fn test_array_value_is_truthy() {
    // Non-empty array: is_truthy catch-all `_ => false` means arrays are always falsy
    let arr = CellValue::from_rows(vec![vec![n(1.0)]]);
    assert!(!is_truthy(&arr));
}

#[test]
fn test_empty_array_value_is_truthy() {
    // Empty array is also falsy (same catch-all)
    let arr = CellValue::from_rows(vec![]);
    assert!(!is_truthy(&arr));
}

// -----------------------------------------------------------------------
// evaluate_formula with Array
// -----------------------------------------------------------------------

#[test]
fn test_formula_array_result() {
    // Array is falsy, so evaluate_formula returns false
    let arr = CellValue::from_rows(vec![vec![n(1.0)]]);
    assert!(!evaluate_formula(Some(&arr)));
}

#[test]
fn test_formula_empty_array_result() {
    let arr = CellValue::from_rows(vec![]);
    assert!(!evaluate_formula(Some(&arr)));
}

// -----------------------------------------------------------------------
// is_truthy: special float values
// -----------------------------------------------------------------------

#[test]
fn test_is_truthy_negative_zero() {
    // -0.0 should be falsy (same as 0.0 in IEEE 754)
    assert!(!is_truthy(&n(-0.0)));
}

#[test]
fn test_is_truthy_infinity() {
    // With FiniteF64, Infinity becomes Error(Num) — errors are falsy
    assert!(!is_truthy(&CellValue::number(f64::INFINITY)));
}

#[test]
fn test_is_truthy_neg_infinity() {
    // With FiniteF64, NEG_INFINITY becomes Error(Num) — errors are falsy
    assert!(!is_truthy(&CellValue::number(f64::NEG_INFINITY)));
}
