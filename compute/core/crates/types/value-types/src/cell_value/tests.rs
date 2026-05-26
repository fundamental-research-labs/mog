//! Unit tests for core `CellValue` functionality: accessors, From impls,
//! predicates, equality, and NaN invariant.

use super::cv_number as n;
use super::*;

#[test]
fn test_text_comparison_case_insensitive() {
    assert_eq!(
        CellValue::Text("hello".into()),
        CellValue::Text("HELLO".into())
    );
}

// === constructor tests ===

#[test]
fn number_constructor_nan_becomes_error() {
    assert_eq!(
        CellValue::number(f64::NAN),
        CellValue::Error(CellError::Num, None)
    );
}

#[test]
fn number_constructor_inf_becomes_error() {
    assert_eq!(
        CellValue::number(f64::INFINITY),
        CellValue::Error(CellError::Num, None)
    );
}

#[test]
fn number_constructor_neg_inf_becomes_error() {
    assert_eq!(
        CellValue::number(f64::NEG_INFINITY),
        CellValue::Error(CellError::Num, None)
    );
}

#[test]
fn number_constructor_f64_min() {
    assert_eq!(CellValue::number(f64::MIN), n(f64::MIN));
}

#[test]
fn number_constructor_f64_max() {
    assert_eq!(CellValue::number(f64::MAX), n(f64::MAX));
}

#[test]
fn number_constructor_subnormal() {
    let v = CellValue::number(f64::MIN_POSITIVE);
    assert!(matches!(v, CellValue::Number(_)));
}

#[test]
fn number_constructor_negative_zero() {
    let v = CellValue::number(-0.0);
    assert!(matches!(v, CellValue::Number(_)));
}

// === PartialEq tests ===

#[test]
fn eq_different_types_not_equal() {
    assert_ne!(n(0.0), CellValue::Null);
    assert_ne!(n(1.0), CellValue::Boolean(true));
    assert_ne!(CellValue::Text("".into()), CellValue::Null);
}

#[test]
fn eq_empty_arrays() {
    assert_eq!(CellValue::from_rows(vec![]), CellValue::from_rows(vec![]));
}

#[test]
fn eq_numbers() {
    assert_eq!(n(1.0), n(1.0));
    assert_ne!(n(1.0), n(2.0));
}

#[test]
fn eq_errors() {
    assert_eq!(
        CellValue::Error(CellError::Na, None),
        CellValue::Error(CellError::Na, None)
    );
    assert_ne!(
        CellValue::Error(CellError::Na, None),
        CellValue::Error(CellError::Div0, None)
    );
}

// === NaN invariant ===

#[test]
fn nan_invariant_constructor() {
    let v = CellValue::number(f64::NAN);
    assert!(matches!(v, CellValue::Error(CellError::Num, _)));
    assert!(!matches!(v, CellValue::Number(_)));
}

// === Default ===

#[test]
fn default_is_null() {
    assert_eq!(CellValue::default(), CellValue::Null);
}

// === accessor / predicate tests ===

#[test]
fn is_null_predicate() {
    assert!(CellValue::Null.is_null());
    assert!(!n(0.0).is_null());
}

#[test]
fn is_error_predicate() {
    assert!(CellValue::Error(CellError::Na, None).is_error());
    assert!(!CellValue::Null.is_error());
}

#[test]
fn is_number_predicate() {
    assert!(n(1.0).is_number());
    assert!(!CellValue::Text("1".into()).is_number());
}

#[test]
fn is_text_predicate() {
    assert!(CellValue::Text("x".into()).is_text());
    assert!(!n(1.0).is_text());
}

#[test]
fn is_boolean_predicate() {
    assert!(CellValue::Boolean(true).is_boolean());
    assert!(!CellValue::Null.is_boolean());
}

#[test]
fn is_array_predicate() {
    assert!(CellValue::from_rows(vec![]).is_array());
    assert!(!CellValue::Null.is_array());
}

#[test]
fn as_error_accessor() {
    assert_eq!(
        CellValue::Error(CellError::Ref, None).as_error(),
        Some(CellError::Ref)
    );
    assert_eq!(CellValue::Null.as_error(), None);
}

#[test]
fn as_number_accessor() {
    assert_eq!(n(5.0).as_number(), Some(5.0));
    assert_eq!(CellValue::Text("5".into()).as_number(), None);
}

#[test]
fn as_text_accessor() {
    assert_eq!(CellValue::Text("hi".into()).as_text(), Some("hi"));
    assert_eq!(n(1.0).as_text(), None);
}

#[test]
fn as_bool_accessor() {
    assert_eq!(CellValue::Boolean(true).as_bool(), Some(true));
    assert_eq!(CellValue::Null.as_bool(), None);
}

#[test]
fn as_array_accessor() {
    let v = CellValue::from_rows(vec![vec![n(1.0)]]);
    assert!(v.as_array().is_some());
    let arr = v.as_array().unwrap();
    assert_eq!(arr.rows(), 1);
    assert_eq!(arr.cols(), 1);
    assert_eq!(arr.get(0, 0), Some(&n(1.0)));
    assert!(CellValue::Null.as_array().is_none());
}

// === From impl tests ===

#[test]
fn from_f64_finite() {
    let v = CellValue::from(42.0_f64);
    assert!(matches!(v, CellValue::Number(_)));
    assert_eq!(v.as_number(), Some(42.0));
}

#[test]
fn from_f64_nan_becomes_error() {
    let v = CellValue::from(f64::NAN);
    assert_eq!(v, CellValue::Error(CellError::Num, None));
}

#[test]
fn from_f64_infinity_becomes_error() {
    let v = CellValue::from(f64::INFINITY);
    assert_eq!(v, CellValue::Error(CellError::Num, None));
}

#[test]
fn from_i64() {
    let v = CellValue::from(42_i64);
    assert_eq!(v.as_number(), Some(42.0));
}

#[test]
fn from_i32() {
    let v = CellValue::from(7_i32);
    assert_eq!(v.as_number(), Some(7.0));
}

#[test]
fn from_bool_true() {
    assert_eq!(CellValue::from(true), CellValue::Boolean(true));
}

#[test]
fn from_bool_false() {
    assert_eq!(CellValue::from(false), CellValue::Boolean(false));
}

#[test]
fn from_str_ref() {
    let v = CellValue::from("hello");
    assert_eq!(v, CellValue::Text("hello".into()));
    assert_eq!(v.as_text(), Some("hello"));
}

#[test]
fn from_string_owned() {
    let v = CellValue::from(String::from("world"));
    assert_eq!(v, CellValue::Text("world".into()));
    assert_eq!(v.as_text(), Some("world"));
}

#[test]
fn from_cell_error() {
    let v = CellValue::from(CellError::Na);
    assert_eq!(v, CellValue::Error(CellError::Na, None));
    assert_eq!(v.as_error(), Some(CellError::Na));
}

#[test]
fn from_into_syntax() {
    // Verify `.into()` works in contexts that expect CellValue
    let _: CellValue = 42.0_f64.into();
    let _: CellValue = 42_i64.into();
    let _: CellValue = 42_i32.into();
    let _: CellValue = true.into();
    let _: CellValue = "hello".into();
    let _: CellValue = String::from("hello").into();
    let _: CellValue = CellError::Div0.into();
}

// === Error message equality semantics ===

#[test]
fn eq_error_message_ignored() {
    // mod.rs documents "Message does NOT participate in PartialEq"
    assert_eq!(
        CellValue::Error(CellError::Na, Some("message A".into())),
        CellValue::Error(CellError::Na, Some("message B".into())),
    );
    assert_eq!(
        CellValue::Error(CellError::Na, Some("has message".into())),
        CellValue::Error(CellError::Na, None),
    );
}

// === is_visually_blank tests ===

#[test]
fn is_visually_blank_null() {
    assert!(CellValue::Null.is_visually_blank());
}

#[test]
fn is_visually_blank_empty_text() {
    assert!(CellValue::Text("".into()).is_visually_blank());
}

#[test]
fn is_visually_blank_whitespace_only() {
    assert!(CellValue::Text("   ".into()).is_visually_blank());
    assert!(CellValue::Text("\t\n".into()).is_visually_blank());
}

#[test]
fn is_visually_blank_non_empty_text() {
    assert!(!CellValue::Text("hello".into()).is_visually_blank());
    assert!(!CellValue::Text(" x ".into()).is_visually_blank());
}

#[test]
fn is_visually_blank_number() {
    assert!(!n(0.0).is_visually_blank());
}

#[test]
fn is_visually_blank_boolean() {
    assert!(!CellValue::Boolean(false).is_visually_blank());
}

#[test]
fn is_visually_blank_error() {
    assert!(!CellValue::Error(CellError::Na, None).is_visually_blank());
}

// === error_with_message constructor ===

#[test]
fn error_with_message_constructor() {
    let v = CellValue::error_with_message(CellError::Value, "custom msg");
    assert!(v.is_error());
    assert_eq!(v.as_error(), Some(CellError::Value));
    assert_eq!(v.error_message(), Some("custom msg"));
}

// === number_dd constructor ===

#[test]
fn number_dd_constructor() {
    let v = CellValue::number_dd(42.5, 1e-16);
    assert!(matches!(v, CellValue::Number(_)));
    assert_eq!(v.as_number(), Some(42.5));
}

#[test]
fn number_dd_nan_becomes_error() {
    let v = CellValue::number_dd(f64::NAN, 0.0);
    assert!(v.is_error());
}

// === Array equality for non-empty arrays ===

#[test]
fn eq_non_empty_arrays_identical() {
    let a = CellValue::from_rows(vec![vec![n(1.0), n(2.0)], vec![n(3.0), n(4.0)]]);
    let b = CellValue::from_rows(vec![vec![n(1.0), n(2.0)], vec![n(3.0), n(4.0)]]);
    assert_eq!(a, b);
}

#[test]
fn eq_non_empty_arrays_different_values() {
    let a = CellValue::from_rows(vec![vec![n(1.0), n(2.0)]]);
    let b = CellValue::from_rows(vec![vec![n(1.0), n(9.0)]]);
    assert_ne!(a, b);
}

#[test]
fn eq_non_empty_arrays_different_shapes() {
    let a = CellValue::from_rows(vec![vec![n(1.0), n(2.0)]]);
    let b = CellValue::from_rows(vec![vec![n(1.0)], vec![n(2.0)]]);
    assert_ne!(a, b);
}

// === as_finite_f64 / try_as_finite_f64 tests ===

#[test]
fn as_finite_f64_number() {
    let v = CellValue::number(5.0);
    let f = v.as_finite_f64().unwrap();
    assert_eq!(f.get(), 5.0);
}

#[test]
fn as_finite_f64_non_number() {
    assert!(CellValue::Null.as_finite_f64().is_none());
    assert!(CellValue::Boolean(true).as_finite_f64().is_none());
    assert!(CellValue::Text("5".into()).as_finite_f64().is_none());
}

#[test]
fn try_as_finite_f64_number() {
    let v = CellValue::number(5.0);
    assert_eq!(v.try_as_finite_f64().unwrap().get(), 5.0);
}

#[test]
fn try_as_finite_f64_error_propagation() {
    let v = CellValue::Error(CellError::Div0, None);
    assert_eq!(v.try_as_finite_f64(), Err(CellError::Div0));
}

#[test]
fn try_as_finite_f64_non_numeric() {
    assert_eq!(CellValue::Null.try_as_finite_f64(), Err(CellError::Value));
    assert_eq!(
        CellValue::Boolean(true).try_as_finite_f64(),
        Err(CellError::Value)
    );
    assert_eq!(
        CellValue::Text("5".into()).try_as_finite_f64(),
        Err(CellError::Value)
    );
}

// === TryFrom impls ===

#[test]
fn try_from_cell_value_to_f64() {
    let v = CellValue::number(42.0);
    let n: f64 = v.try_into().unwrap();
    assert_eq!(n, 42.0);
}

#[test]
fn try_from_cell_value_to_f64_error() {
    let v = CellValue::Error(CellError::Na, None);
    assert_eq!(f64::try_from(v), Err(CellError::Na));
}

#[test]
fn try_from_cell_value_to_f64_non_numeric() {
    let v = CellValue::from("hello");
    assert_eq!(f64::try_from(v), Err(CellError::Value));
}

#[test]
fn try_from_cell_value_to_finite_f64() {
    let v = CellValue::number(42.0);
    let f: FiniteF64 = v.try_into().unwrap();
    assert_eq!(f.get(), 42.0);
}

#[test]
fn try_from_cell_value_to_finite_f64_error() {
    let v = CellValue::from(CellError::Ref);
    assert_eq!(FiniteF64::try_from(v), Err(CellError::Ref));
}

#[test]
fn try_from_cell_value_to_bool() {
    let v = CellValue::Boolean(true);
    let b: bool = v.try_into().unwrap();
    assert!(b);
}

#[test]
fn try_from_cell_value_to_bool_non_boolean() {
    let v = CellValue::number(1.0);
    assert_eq!(bool::try_from(v), Err(CellError::Value));
}

// === Control variant tests ===

#[test]
fn control_checkbox_constructor() {
    let c = CellControl::checkbox(true);
    assert_eq!(c.control_type, CellControlType::Checkbox);
    assert!(c.checked);
    assert!(c.value);

    let c = CellControl::checkbox(false);
    assert!(!c.checked);
    assert!(!c.value);
}

#[test]
fn control_as_bool() {
    assert_eq!(
        CellValue::Control(CellControl::checkbox(true)).as_bool(),
        Some(true)
    );
    assert_eq!(
        CellValue::Control(CellControl::checkbox(false)).as_bool(),
        Some(false)
    );
}

#[test]
fn control_is_not_visually_blank() {
    assert!(!CellValue::Control(CellControl::checkbox(false)).is_visually_blank());
    assert!(!CellValue::Control(CellControl::checkbox(true)).is_visually_blank());
}

#[test]
fn control_coerce_to_number() {
    assert_eq!(
        CellValue::Control(CellControl::checkbox(true))
            .coerce_to_number()
            .unwrap(),
        1.0
    );
    assert_eq!(
        CellValue::Control(CellControl::checkbox(false))
            .coerce_to_number()
            .unwrap(),
        0.0
    );
}

#[test]
fn control_coerce_to_bool() {
    assert!(
        CellValue::Control(CellControl::checkbox(true))
            .coerce_to_bool()
            .unwrap()
    );
    assert!(
        !CellValue::Control(CellControl::checkbox(false))
            .coerce_to_bool()
            .unwrap()
    );
}

#[test]
fn control_coerce_to_string() {
    assert_eq!(
        CellValue::Control(CellControl::checkbox(true))
            .coerce_to_string()
            .unwrap()
            .as_ref(),
        "TRUE"
    );
    assert_eq!(
        CellValue::Control(CellControl::checkbox(false))
            .coerce_to_string()
            .unwrap()
            .as_ref(),
        "FALSE"
    );
}

#[test]
fn control_equality() {
    assert_eq!(
        CellValue::Control(CellControl::checkbox(true)),
        CellValue::Control(CellControl::checkbox(true))
    );
    assert_ne!(
        CellValue::Control(CellControl::checkbox(true)),
        CellValue::Control(CellControl::checkbox(false))
    );
    // Control != Boolean even with same logical value
    assert_ne!(
        CellValue::Control(CellControl::checkbox(true)),
        CellValue::Boolean(true)
    );
}

#[test]
fn control_display() {
    let checked = CellValue::Control(CellControl::checkbox(true));
    assert_eq!(format!("{checked}"), "\u{2611} TRUE");
    let unchecked = CellValue::Control(CellControl::checkbox(false));
    assert_eq!(format!("{unchecked}"), "\u{2610} FALSE");
}

#[test]
fn control_serde_roundtrip() {
    let v = CellValue::Control(CellControl::checkbox(true));
    let json = serde_json::to_string(&v).unwrap();
    assert!(json.contains("\"type\":\"control\""));
    assert!(json.contains("\"checked\":true"));
    let v2: CellValue = serde_json::from_str(&json).unwrap();
    assert_eq!(v, v2);

    let v = CellValue::Control(CellControl::checkbox(false));
    let json = serde_json::to_string(&v).unwrap();
    let v2: CellValue = serde_json::from_str(&json).unwrap();
    assert_eq!(v, v2);
}
