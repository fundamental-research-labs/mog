use super::super::hyperbolic::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_acosh() {
    assert_eq!(FnAcosh.call(&[num(1.0)]), num(0.0));
    assert_eq!(FnAcosh.call(&[num(0.5)]), err(CellError::Num));
}

#[test]
fn test_acosh_domain_error() {
    let r = reg();
    // ACOSH(0) -> #NUM! (domain: [1, inf))
    assert_is_err(r.call("ACOSH", &[num(0.0)]), CellError::Num);
    assert_is_err(r.call("ACOSH", &[num(-1.0)]), CellError::Num);
}

#[test]
fn test_acosh_one() {
    let r = reg();
    assert_close(r.call("ACOSH", &[num(1.0)]), 0.0);
}

#[test]
fn test_acoth() {
    // ACOTH with |x| <= 1 = #NUM!
    assert_eq!(FnAcoth.call(&[num(0.5)]), err(CellError::Num));
    assert_eq!(FnAcoth.call(&[num(0.0)]), err(CellError::Num));
}

#[test]
fn test_asinh() {
    assert_eq!(FnAsinh.call(&[num(0.0)]), num(0.0));
}

#[test]
fn test_asinh_zero() {
    let r = reg();
    assert_close(r.call("ASINH", &[num(0.0)]), 0.0);
}

#[test]
fn test_atanh() {
    assert_eq!(FnAtanh.call(&[num(0.0)]), num(0.0));
    assert_eq!(FnAtanh.call(&[num(1.0)]), err(CellError::Num));
    assert_eq!(FnAtanh.call(&[num(-1.0)]), err(CellError::Num));
}

#[test]
fn test_atanh_domain_error() {
    let r = reg();
    // ATANH(1) -> #NUM! (domain: (-1, 1))
    assert_is_err(r.call("ATANH", &[num(1.0)]), CellError::Num);
    assert_is_err(r.call("ATANH", &[num(-1.0)]), CellError::Num);
    assert_is_err(r.call("ATANH", &[num(2.0)]), CellError::Num);
}

// -- Pythagorean identity: sin^2(x) + cos^2(x) = 1 -------------------

#[test]
fn test_atanh_zero() {
    let r = reg();
    assert_close(r.call("ATANH", &[num(0.0)]), 0.0);
}

#[test]
fn test_cosh_overflow_returns_num_error() {
    // COSH(800) overflows f64 -> should return #NUM! not Infinity
    assert_eq!(FnCosh.call(&[num(800.0)]), err(CellError::Num));
}

#[test]
fn test_cosh_zero() {
    let r = reg();
    assert_close(r.call("COSH", &[num(0.0)]), 1.0);
}

#[test]
fn test_coth() {
    // COTH(0) = #DIV/0! since sinh(0) = 0
    assert_eq!(FnCoth.call(&[num(0.0)]), err(CellError::Div0));
}

#[test]
fn test_hyperbolic_identity() {
    let r = reg();
    for x in [0.0, 0.5, 1.0, -1.0, 2.0, -0.3] {
        let sinh_val = match r.call("SINH", &[num(x)]) {
            CellValue::Number(n) => f64::from(n),
            other => panic!("SINH({x}) failed: {other:?}"),
        };
        let cosh_val = match r.call("COSH", &[num(x)]) {
            CellValue::Number(n) => f64::from(n),
            other => panic!("COSH({x}) failed: {other:?}"),
        };
        let diff = cosh_val * cosh_val - sinh_val * sinh_val;
        assert!(
            (diff - 1.0).abs() < TOL,
            "cosh^2({x}) - sinh^2({x}) = {diff}, expected 1.0"
        );
    }
}

// -- Inverse round-trip: asin(sin(x)) = x for x in [-pi/2, pi/2] -----

#[test]
fn test_sech_csch() {
    // SECH(0) = 1/cosh(0) = 1
    assert_eq!(FnSech.call(&[num(0.0)]), num(1.0));
    // CSCH(0) = #DIV/0!
    assert_eq!(FnCsch.call(&[num(0.0)]), err(CellError::Div0));
}

// --- Tests for rounding functions ---

#[test]
fn test_sinh_cosh_tanh() {
    assert_eq!(FnSinh.call(&[num(0.0)]), num(0.0));
    assert_eq!(FnCosh.call(&[num(0.0)]), num(1.0));
    assert_eq!(FnTanh.call(&[num(0.0)]), num(0.0));
}

#[test]
fn test_sinh_overflow_returns_num_error() {
    // SINH(800) overflows f64 -> should return #NUM! not Infinity
    assert_eq!(FnSinh.call(&[num(800.0)]), err(CellError::Num));
}

#[test]
fn test_sinh_zero() {
    let r = reg();
    assert_close(r.call("SINH", &[num(0.0)]), 0.0);
}

#[test]
fn test_tanh_zero() {
    let r = reg();
    assert_close(r.call("TANH", &[num(0.0)]), 0.0);
}
