use value_types::{CellError, CellValue};

use crate::PureFunction;
use crate::information::predicates::{
    FnIsErr, FnIsEven, FnIsLogical, FnIsNonText, FnIsOdd, FnIsRef,
};

use super::helpers::{array, bool_val, err, null, num, text};

#[test]
fn test_iserr_div0() {
    assert_eq!(FnIsErr.call(&[err(CellError::Div0)]), bool_val(true));
}

#[test]
fn test_iserr_na_excluded() {
    assert_eq!(FnIsErr.call(&[err(CellError::Na)]), bool_val(false));
}

#[test]
fn test_iserr_not_error() {
    assert_eq!(FnIsErr.call(&[num(5.0)]), bool_val(false));
    assert_eq!(FnIsErr.call(&[text("hello")]), bool_val(false));
}

#[test]
fn test_iseven() {
    assert_eq!(FnIsEven.call(&[num(4.0)]), bool_val(true));
    assert_eq!(FnIsEven.call(&[num(3.0)]), bool_val(false));
    assert_eq!(FnIsEven.call(&[num(0.0)]), bool_val(true));
    assert_eq!(FnIsEven.call(&[num(-4.0)]), bool_val(true));
}

#[test]
fn test_iseven_truncates() {
    assert_eq!(FnIsEven.call(&[num(4.7)]), bool_val(true));
    assert_eq!(FnIsEven.call(&[num(3.9)]), bool_val(false));
}

#[test]
fn test_iseven_boolean_error() {
    assert_eq!(FnIsEven.call(&[bool_val(true)]), err(CellError::Value));
}

#[test]
fn test_iseven_error_propagation() {
    assert_eq!(FnIsEven.call(&[err(CellError::Ref)]), err(CellError::Ref));
}

#[test]
fn test_isodd() {
    assert_eq!(FnIsOdd.call(&[num(3.0)]), bool_val(true));
    assert_eq!(FnIsOdd.call(&[num(4.0)]), bool_val(false));
    assert_eq!(FnIsOdd.call(&[num(0.0)]), bool_val(false));
    assert_eq!(FnIsOdd.call(&[num(-3.0)]), bool_val(true));
}

#[test]
fn test_isodd_truncates() {
    assert_eq!(FnIsOdd.call(&[num(3.2)]), bool_val(true));
    assert_eq!(FnIsOdd.call(&[num(4.8)]), bool_val(false));
}

#[test]
fn test_isodd_boolean_error() {
    assert_eq!(FnIsOdd.call(&[bool_val(false)]), err(CellError::Value));
}

#[test]
fn test_islogical() {
    assert_eq!(FnIsLogical.call(&[bool_val(true)]), bool_val(true));
    assert_eq!(FnIsLogical.call(&[bool_val(false)]), bool_val(true));
    assert_eq!(FnIsLogical.call(&[num(1.0)]), bool_val(false));
    assert_eq!(FnIsLogical.call(&[text("TRUE")]), bool_val(false));
    assert_eq!(FnIsLogical.call(&[err(CellError::Na)]), bool_val(false));
}

#[test]
fn test_isnontext() {
    assert_eq!(FnIsNonText.call(&[num(1.0)]), bool_val(true));
    assert_eq!(FnIsNonText.call(&[bool_val(true)]), bool_val(true));
    assert_eq!(FnIsNonText.call(&[null()]), bool_val(true));
    assert_eq!(FnIsNonText.call(&[err(CellError::Na)]), bool_val(true));
    assert_eq!(FnIsNonText.call(&[text("hello")]), bool_val(false));
    assert_eq!(FnIsNonText.call(&[text("")]), bool_val(false));
}

#[test]
fn test_isref() {
    assert_eq!(FnIsRef.call(&[num(1.0)]), bool_val(true));
    assert_eq!(FnIsRef.call(&[text("A1")]), bool_val(true));
    assert_eq!(FnIsRef.call(&[null()]), bool_val(true));
    assert_eq!(FnIsRef.call(&[err(CellError::Ref)]), bool_val(false));
}

#[test]
fn test_islogical_array() {
    let arr = CellValue::from_rows(vec![vec![bool_val(true), num(1.0), bool_val(false)]]);
    let result = FnIsLogical.call(&[arr]);
    match result {
        CellValue::Array(rows) => {
            assert_eq!(*rows.get(0, 0).unwrap(), bool_val(true));
            assert_eq!(*rows.get(0, 1).unwrap(), bool_val(false));
            assert_eq!(*rows.get(0, 2).unwrap(), bool_val(true));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_isnontext_array() {
    let arr = CellValue::from_rows(vec![vec![num(1.0), text("hi"), bool_val(true)]]);
    let result = FnIsNonText.call(&[arr]);
    match result {
        CellValue::Array(rows) => {
            assert_eq!(*rows.get(0, 0).unwrap(), bool_val(true));
            assert_eq!(*rows.get(0, 1).unwrap(), bool_val(false));
            assert_eq!(*rows.get(0, 2).unwrap(), bool_val(true));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_iserr_array() {
    let arr = CellValue::from_rows(vec![vec![
        err(CellError::Div0),
        err(CellError::Na),
        num(1.0),
    ]]);
    let result = FnIsErr.call(&[arr]);
    match result {
        CellValue::Array(rows) => {
            assert_eq!(*rows.get(0, 0).unwrap(), bool_val(true));
            assert_eq!(*rows.get(0, 1).unwrap(), bool_val(false));
            assert_eq!(*rows.get(0, 2).unwrap(), bool_val(false));
        }
        other => panic!("Expected Array, got {:?}", other),
    }
}

#[test]
fn test_iserr_array_direct_shape() {
    assert_eq!(
        FnIsErr.call(&[array(vec![vec![err(CellError::Value), err(CellError::Na)]])]),
        array(vec![vec![bool_val(true), bool_val(false)]])
    );
}
