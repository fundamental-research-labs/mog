use value_types::{CellError, CellValue};

use super::super::transcendental::{FnImExp, FnImLn, FnImLog2, FnImLog10};
use super::helpers::*;
use crate::PureFunction;

#[test]
fn test_imexp_zero() {
    // e^0 = 1
    assert_eq!(FnImExp.call(&[text("0")]), text("1"));
}

#[test]
fn test_imexp_euler_identity() {
    // e^(pi*i) = -1 (Euler's identity)
    let arg = format!("{}i", std::f64::consts::PI);
    let result = FnImExp.call(&[text(&arg)]);
    assert_complex_approx(&result, -1.0, 0.0, 1e-9);
}

#[test]
fn test_imexp_pure_real() {
    // e^1 = e
    let result = FnImExp.call(&[text("1")]);
    assert_complex_approx(&result, std::f64::consts::E, 0.0, 1e-9);
}

#[test]
fn test_imexp_half_pi_i() {
    // e^(pi/2 * i) = i
    let arg = format!("{}i", std::f64::consts::FRAC_PI_2);
    let result = FnImExp.call(&[text(&arg)]);
    assert_complex_approx(&result, 0.0, 1.0, 1e-9);
}

// =====================================================================
// IMLN — natural log
// =====================================================================

#[test]
fn test_imln_one() {
    // ln(1) = 0
    assert_eq!(FnImLn.call(&[text("1")]), text("0"));
}

#[test]
fn test_imln_of_i() {
    // ln(i) = i*pi/2
    let result = FnImLn.call(&[text("i")]);
    assert_complex_approx(&result, 0.0, std::f64::consts::FRAC_PI_2, 1e-9);
}

#[test]
fn test_imln_of_e() {
    // ln(e) = 1
    let arg = format!("{}", std::f64::consts::E);
    let result = FnImLn.call(&[text(&arg)]);
    assert_complex_approx(&result, 1.0, 0.0, 1e-9);
}

#[test]
fn test_imln_of_zero() {
    // ln(0) is undefined -> #NUM!
    assert!(matches!(
        FnImLn.call(&[text("0")]),
        CellValue::Error(CellError::Num, _)
    ));
}

#[test]
fn test_imln_negative_one() {
    // ln(-1) = i*pi
    let result = FnImLn.call(&[text("-1")]);
    assert_complex_approx(&result, 0.0, std::f64::consts::PI, 1e-9);
}

// =====================================================================
// IMLOG2 / IMLOG10
// =====================================================================

#[test]
fn test_imlog2_one() {
    assert_eq!(FnImLog2.call(&[text("1")]), text("0"));
}

#[test]
fn test_imlog2_two() {
    let result = FnImLog2.call(&[text("2")]);
    assert_complex_approx(&result, 1.0, 0.0, 1e-9);
}

#[test]
fn test_imlog10_one() {
    assert_eq!(FnImLog10.call(&[text("1")]), text("0"));
}

#[test]
fn test_imlog10_ten() {
    let result = FnImLog10.call(&[text("10")]);
    assert_complex_approx(&result, 1.0, 0.0, 1e-9);
}

#[test]
fn test_imlog2_of_zero() {
    assert!(matches!(
        FnImLog2.call(&[text("0")]),
        CellValue::Error(CellError::Num, _)
    ));
}

#[test]
fn test_imlog10_of_zero() {
    assert!(matches!(
        FnImLog10.call(&[text("0")]),
        CellValue::Error(CellError::Num, _)
    ));
}
