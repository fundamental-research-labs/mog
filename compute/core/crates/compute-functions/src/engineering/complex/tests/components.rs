use value_types::{CellError, CellValue};

use super::super::components::{
    FnComplex, FnImAbs, FnImArgument, FnImConjugate, FnImReal, FnImaginary,
};
use super::helpers::*;
use crate::PureFunction;

#[test]
fn test_complex_negative_imaginary() {
    assert_eq!(FnComplex.call(&[num(3.0), num(-4.0)]), text("3-4i"));
}

#[test]
fn test_complex_zero_zero() {
    assert_eq!(FnComplex.call(&[num(0.0), num(0.0)]), text("0"));
}

#[test]
fn test_complex_pure_real() {
    assert_eq!(FnComplex.call(&[num(5.0), num(0.0)]), text("5"));
}

#[test]
fn test_complex_pure_imaginary() {
    assert_eq!(FnComplex.call(&[num(0.0), num(3.0)]), text("3i"));
}

#[test]
fn test_complex_neg_one_imaginary() {
    assert_eq!(FnComplex.call(&[num(0.0), num(-1.0)]), text("-i"));
}

#[test]
fn test_complex_j_suffix() {
    assert_eq!(
        FnComplex.call(&[num(3.0), num(4.0), text("j")]),
        text("3+4j")
    );
}

#[test]
fn test_complex_invalid_suffix() {
    assert!(matches!(
        FnComplex.call(&[num(1.0), num(1.0), text("k")]),
        CellValue::Error(CellError::Value, _)
    ));
}

#[test]
fn test_complex_fractional() {
    assert_eq!(FnComplex.call(&[num(1.5), num(2.5)]), text("1.5+2.5i"));
}

#[test]
fn test_complex_negative_real_and_imag() {
    assert_eq!(FnComplex.call(&[num(-3.0), num(-4.0)]), text("-3-4i"));
}

#[test]
fn test_complex_one_imag() {
    // COMPLEX(2, 1) = "2+i"
    assert_eq!(FnComplex.call(&[num(2.0), num(1.0)]), text("2+i"));
}

#[test]
fn test_complex_neg_one_imag_with_real() {
    // COMPLEX(2, -1) = "2-i"
    assert_eq!(FnComplex.call(&[num(2.0), num(-1.0)]), text("2-i"));
}

// =====================================================================
// IMREAL / IMAGINARY — extraction
// =====================================================================

#[test]
fn test_imreal_pure_real() {
    assert_eq!(FnImReal.call(&[text("5")]), num(5.0));
}

#[test]
fn test_imaginary_pure_real() {
    assert_eq!(FnImaginary.call(&[text("5")]), num(0.0));
}

#[test]
fn test_imreal_pure_imaginary() {
    assert_eq!(FnImReal.call(&[text("3i")]), num(0.0));
}

#[test]
fn test_imaginary_pure_imaginary() {
    assert_eq!(FnImaginary.call(&[text("3i")]), num(3.0));
}

#[test]
fn test_imreal_unit_imaginary() {
    assert_eq!(FnImReal.call(&[text("i")]), num(0.0));
}

#[test]
fn test_imaginary_unit_imaginary() {
    assert_eq!(FnImaginary.call(&[text("i")]), num(1.0));
}

#[test]
fn test_imaginary_negative_unit() {
    assert_eq!(FnImaginary.call(&[text("-i")]), num(-1.0));
}

#[test]
fn test_imreal_invalid_string() {
    assert!(matches!(
        FnImReal.call(&[text("abc")]),
        CellValue::Error(CellError::Num, _)
    ));
}

// =====================================================================
// IMABS — modulus |z| = sqrt(re^2 + im^2)
// =====================================================================

#[test]
fn test_imabs_3_4i() {
    // |3+4i| = 5
    assert_eq!(FnImAbs.call(&[text("3+4i")]), num(5.0));
}

#[test]
fn test_imabs_1_plus_i() {
    // |1+i| = sqrt(2)
    let result = FnImAbs.call(&[text("1+i")]);
    assert_num_approx(&result, std::f64::consts::SQRT_2, 1e-9);
}

#[test]
fn test_imabs_pure_real() {
    assert_eq!(FnImAbs.call(&[text("5")]), num(5.0));
}

#[test]
fn test_imabs_pure_imaginary() {
    // |4i| = 4
    assert_eq!(FnImAbs.call(&[text("4i")]), num(4.0));
}

#[test]
fn test_imabs_zero() {
    assert_eq!(FnImAbs.call(&[text("0")]), num(0.0));
}

// =====================================================================
// IMARGUMENT — angle theta = atan2(im, re)
// =====================================================================

#[test]
fn test_imargument_first_quadrant() {
    // arg(1+i) = pi/4
    let result = FnImArgument.call(&[text("1+i")]);
    assert_num_approx(&result, std::f64::consts::FRAC_PI_4, 1e-9);
}

#[test]
fn test_imargument_pure_imaginary() {
    // arg(i) = pi/2
    let result = FnImArgument.call(&[text("i")]);
    assert_num_approx(&result, std::f64::consts::FRAC_PI_2, 1e-9);
}

#[test]
fn test_imargument_negative_real() {
    // arg(-1) = pi
    let result = FnImArgument.call(&[text("-1")]);
    assert_num_approx(&result, std::f64::consts::PI, 1e-9);
}

#[test]
fn test_imargument_positive_real() {
    // arg(1) = 0
    let result = FnImArgument.call(&[text("1")]);
    assert_num_approx(&result, 0.0, 1e-9);
}

#[test]
fn test_imargument_negative_imaginary() {
    // arg(-i) = -pi/2
    let result = FnImArgument.call(&[text("-i")]);
    assert_num_approx(&result, -std::f64::consts::FRAC_PI_2, 1e-9);
}

#[test]
fn test_imargument_zero_is_div0() {
    // arg(0) is undefined -> #DIV/0!
    assert!(matches!(
        FnImArgument.call(&[text("0")]),
        CellValue::Error(CellError::Div0, _)
    ));
}

// =====================================================================
// IMCONJUGATE — z̄ = re - im*i
// =====================================================================

#[test]
fn test_imconjugate_positive_imag() {
    assert_eq!(FnImConjugate.call(&[text("3+4i")]), text("3-4i"));
}

#[test]
fn test_imconjugate_negative_imag() {
    assert_eq!(FnImConjugate.call(&[text("3-4i")]), text("3+4i"));
}

#[test]
fn test_imconjugate_pure_real() {
    assert_eq!(FnImConjugate.call(&[text("5")]), text("5"));
}

#[test]
fn test_imconjugate_pure_imaginary() {
    assert_eq!(FnImConjugate.call(&[text("3i")]), text("-3i"));
}
