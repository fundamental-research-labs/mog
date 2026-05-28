use value_types::{CellError, CellValue};

use super::super::trig::{
    FnImCos, FnImCosh, FnImCot, FnImCsc, FnImCsch, FnImSec, FnImSech, FnImSin, FnImSinh, FnImTan,
};
use super::helpers::*;
use crate::PureFunction;

#[test]
fn test_imsin_zero() {
    // sin(0) = 0
    assert_eq!(FnImSin.call(&[text("0")]), text("0"));
}

#[test]
fn test_imcos_zero() {
    // cos(0) = 1
    assert_eq!(FnImCos.call(&[text("0")]), text("1"));
}

#[test]
fn test_imtan_zero() {
    // tan(0) = 0
    assert_eq!(FnImTan.call(&[text("0")]), text("0"));
}

#[test]
fn test_imsin_pi_half() {
    // sin(pi/2) = 1
    let arg = format!("{}", std::f64::consts::FRAC_PI_2);
    let result = FnImSin.call(&[text(&arg)]);
    assert_complex_approx(&result, 1.0, 0.0, 1e-9);
}

#[test]
fn test_imcos_pi() {
    // cos(pi) = -1
    let arg = format!("{}", std::f64::consts::PI);
    let result = FnImCos.call(&[text(&arg)]);
    assert_complex_approx(&result, -1.0, 0.0, 1e-9);
}

// =====================================================================
// IMSINH / IMCOSH at zero
// =====================================================================

#[test]
fn test_imsinh_zero() {
    // sinh(0) = 0
    assert_eq!(FnImSinh.call(&[text("0")]), text("0"));
}

#[test]
fn test_imcosh_zero() {
    // cosh(0) = 1
    assert_eq!(FnImCosh.call(&[text("0")]), text("1"));
}

#[test]
fn test_imsinh_pure_imaginary() {
    // sinh(i*pi/2) = i*sin(pi/2) = i
    let arg = format!("{}i", std::f64::consts::FRAC_PI_2);
    let result = FnImSinh.call(&[text(&arg)]);
    assert_complex_approx(&result, 0.0, 1.0, 1e-9);
}

// =====================================================================
// IMCOT / IMCSC / IMCSCH / IMSEC / IMSECH
// =====================================================================

#[test]
fn test_imcot_at_pi_over_4() {
    // cot(pi/4) = 1
    let arg = format!("{}", std::f64::consts::FRAC_PI_4);
    let result = FnImCot.call(&[text(&arg)]);
    assert_complex_approx(&result, 1.0, 0.0, 1e-9);
}

#[test]
fn test_imcot_at_zero_is_error() {
    // cot(0) = cos(0)/sin(0) -> division by zero -> #NUM!
    assert!(matches!(
        FnImCot.call(&[text("0")]),
        CellValue::Error(CellError::Num, _)
    ));
}

#[test]
fn test_imcsc_at_pi_over_2() {
    // csc(pi/2) = 1/sin(pi/2) = 1
    let arg = format!("{}", std::f64::consts::FRAC_PI_2);
    let result = FnImCsc.call(&[text(&arg)]);
    assert_complex_approx(&result, 1.0, 0.0, 1e-9);
}

#[test]
fn test_imcsc_at_zero_is_error() {
    assert!(matches!(
        FnImCsc.call(&[text("0")]),
        CellValue::Error(CellError::Num, _)
    ));
}

#[test]
fn test_imcsch_at_zero_is_error() {
    // csch(0) = 1/sinh(0) -> division by zero
    assert!(matches!(
        FnImCsch.call(&[text("0")]),
        CellValue::Error(CellError::Num, _)
    ));
}

#[test]
fn test_imsec_at_zero() {
    // sec(0) = 1/cos(0) = 1
    let result = FnImSec.call(&[text("0")]);
    assert_complex_approx(&result, 1.0, 0.0, 1e-9);
}

#[test]
fn test_imsech_at_zero() {
    // sech(0) = 1/cosh(0) = 1
    let result = FnImSech.call(&[text("0")]);
    assert_complex_approx(&result, 1.0, 0.0, 1e-9);
}
