use super::*;
use value_types::{CellError, FiniteF64};

/// Convenience: wrap a known-finite f64 literal in CellValue::Number for tests.
fn n(v: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(v))
}

// -----------------------------------------------------------------------
// is_visually_blank (via CellValue method)
// -----------------------------------------------------------------------

#[test]
fn test_is_visually_blank_null() {
    assert!(CellValue::Null.is_visually_blank());
}

#[test]
fn test_is_visually_blank_empty_string() {
    assert!(CellValue::Text("".into()).is_visually_blank());
}

#[test]
fn test_is_visually_blank_whitespace() {
    assert!(CellValue::Text("   ".into()).is_visually_blank());
}

#[test]
fn test_is_visually_blank_nonempty_string() {
    assert!(!CellValue::Text("hello".into()).is_visually_blank());
}

#[test]
fn test_is_visually_blank_number() {
    assert!(!n(0.0).is_visually_blank());
}

#[test]
fn test_is_visually_blank_boolean() {
    assert!(!CellValue::Boolean(false).is_visually_blank());
}

#[test]
fn test_is_visually_blank_error() {
    assert!(!CellValue::Error(CellError::Value, None).is_visually_blank());
}

// -----------------------------------------------------------------------
// is_error
// -----------------------------------------------------------------------

#[test]
fn test_is_error_error_value() {
    assert!(is_error(&CellValue::Error(CellError::Div0, None)));
}

#[test]
fn test_is_error_error_na() {
    assert!(is_error(&CellValue::Error(CellError::Na, None)));
}

#[test]
fn test_is_error_null() {
    assert!(!is_error(&CellValue::Null));
}

#[test]
fn test_is_error_number() {
    assert!(!is_error(&n(42.0)));
}

#[test]
fn test_is_error_text() {
    assert!(!is_error(&CellValue::Text("hello".into())));
}

#[test]
fn test_is_error_boolean() {
    assert!(!is_error(&CellValue::Boolean(true)));
}

// -----------------------------------------------------------------------
// evaluate_blanks — blanks=true (match blank cells)
// -----------------------------------------------------------------------

#[test]
fn test_blanks_true_null() {
    assert!(evaluate_blanks(&CellValue::Null, true));
}

#[test]
fn test_blanks_true_empty_string() {
    assert!(evaluate_blanks(&CellValue::Text("".into()), true));
}

#[test]
fn test_blanks_true_nonempty_string() {
    assert!(!evaluate_blanks(&CellValue::Text("hi".into()), true));
}

#[test]
fn test_blanks_true_number() {
    assert!(!evaluate_blanks(&n(0.0), true));
}

// -----------------------------------------------------------------------
// evaluate_blanks — blanks=false (match non-blank cells)
// -----------------------------------------------------------------------

#[test]
fn test_blanks_false_null() {
    assert!(!evaluate_blanks(&CellValue::Null, false));
}

#[test]
fn test_blanks_false_empty_string() {
    assert!(!evaluate_blanks(&CellValue::Text("".into()), false));
}

#[test]
fn test_blanks_false_nonempty_string() {
    assert!(evaluate_blanks(&CellValue::Text("hi".into()), false));
}

#[test]
fn test_blanks_false_number() {
    assert!(evaluate_blanks(&n(5.0), false));
}

// -----------------------------------------------------------------------
// evaluate_errors — errors=true (match error cells)
// -----------------------------------------------------------------------

#[test]
fn test_errors_true_error() {
    assert!(evaluate_errors(
        &CellValue::Error(CellError::Ref, None),
        true
    ));
}

#[test]
fn test_errors_true_non_error() {
    assert!(!evaluate_errors(&n(1.0), true));
}

#[test]
fn test_errors_true_null() {
    assert!(!evaluate_errors(&CellValue::Null, true));
}

// -----------------------------------------------------------------------
// evaluate_errors — errors=false (match non-error cells)
// -----------------------------------------------------------------------

#[test]
fn test_errors_false_error() {
    assert!(!evaluate_errors(
        &CellValue::Error(CellError::Name, None),
        false
    ));
}

#[test]
fn test_errors_false_non_error() {
    assert!(evaluate_errors(&n(1.0), false));
}

#[test]
fn test_errors_false_null() {
    assert!(evaluate_errors(&CellValue::Null, false));
}

#[test]
fn test_errors_false_text() {
    assert!(evaluate_errors(&CellValue::Text("hello".into()), false));
}

// -----------------------------------------------------------------------
// All CellError variants — ContainsErrors matches, ContainsBlanks does not
// -----------------------------------------------------------------------

#[test]
fn test_error_variant_null_error() {
    // CellError::Null (the #NULL! error, not CellValue::Null)
    assert!(evaluate_errors(
        &CellValue::Error(CellError::Null, None),
        true
    ));
    assert!(!evaluate_blanks(
        &CellValue::Error(CellError::Null, None),
        true
    ));
}

#[test]
fn test_error_variant_spill() {
    assert!(evaluate_errors(
        &CellValue::Error(CellError::Spill, None),
        true
    ));
    assert!(!evaluate_blanks(
        &CellValue::Error(CellError::Spill, None),
        true
    ));
}

#[test]
fn test_error_variant_calc() {
    assert!(evaluate_errors(
        &CellValue::Error(CellError::Calc, None),
        true
    ));
    assert!(!evaluate_blanks(
        &CellValue::Error(CellError::Calc, None),
        true
    ));
}

#[test]
fn test_error_variant_getting_data() {
    assert!(evaluate_errors(
        &CellValue::Error(CellError::GettingData, None),
        true
    ));
    assert!(!evaluate_blanks(
        &CellValue::Error(CellError::GettingData, None),
        true
    ));
}

#[test]
fn test_error_variant_div0() {
    assert!(evaluate_errors(
        &CellValue::Error(CellError::Div0, None),
        true
    ));
    assert!(!evaluate_blanks(
        &CellValue::Error(CellError::Div0, None),
        true
    ));
}

#[test]
fn test_error_variant_na() {
    assert!(evaluate_errors(
        &CellValue::Error(CellError::Na, None),
        true
    ));
    assert!(!evaluate_blanks(
        &CellValue::Error(CellError::Na, None),
        true
    ));
}

#[test]
fn test_error_variant_name() {
    assert!(evaluate_errors(
        &CellValue::Error(CellError::Name, None),
        true
    ));
    assert!(!evaluate_blanks(
        &CellValue::Error(CellError::Name, None),
        true
    ));
}

#[test]
fn test_error_variant_num() {
    assert!(evaluate_errors(
        &CellValue::Error(CellError::Num, None),
        true
    ));
    assert!(!evaluate_blanks(
        &CellValue::Error(CellError::Num, None),
        true
    ));
}

#[test]
fn test_error_variant_ref() {
    assert!(evaluate_errors(
        &CellValue::Error(CellError::Ref, None),
        true
    ));
    assert!(!evaluate_blanks(
        &CellValue::Error(CellError::Ref, None),
        true
    ));
}

#[test]
fn test_error_variant_value() {
    assert!(evaluate_errors(
        &CellValue::Error(CellError::Value, None),
        true
    ));
    assert!(!evaluate_blanks(
        &CellValue::Error(CellError::Value, None),
        true
    ));
}
