use value_types::{CellError, CellValue};

use super::super::arithmetic::{FnImDiv, FnImPower, FnImProduct, FnImSqrt, FnImSub, FnImSum};
use super::super::types::parse_complex;
use super::helpers::*;
use crate::PureFunction;

#[test]
fn test_imsum_basic() {
    assert_eq!(FnImSum.call(&[text("1+2i"), text("3+4i")]), text("4+6i"));
}

#[test]
fn test_imsum_three_args() {
    assert_eq!(
        FnImSum.call(&[text("1+i"), text("2+2i"), text("3+3i")]),
        text("6+6i")
    );
}

#[test]
fn test_imsum_with_real() {
    assert_eq!(FnImSum.call(&[text("3+4i"), text("2")]), text("5+4i"));
}

// =====================================================================
// IMSUB — subtraction
// =====================================================================

#[test]
fn test_imsub_basic() {
    assert_eq!(FnImSub.call(&[text("3+4i"), text("1+2i")]), text("2+2i"));
}

#[test]
fn test_imsub_result_zero() {
    assert_eq!(FnImSub.call(&[text("3+4i"), text("3+4i")]), text("0"));
}

// =====================================================================
// IMPRODUCT — multiplication
// =====================================================================

#[test]
fn test_improduct_i_squared() {
    // (1+i)^2 = 1 + 2i + i^2 = 1 + 2i - 1 = 2i
    assert_eq!(FnImProduct.call(&[text("1+i"), text("1+i")]), text("2i"));
}

#[test]
fn test_improduct_conjugate_pair() {
    // (3+4i)(3-4i) = 9 + 16 = 25
    assert_eq!(FnImProduct.call(&[text("3+4i"), text("3-4i")]), text("25"));
}

#[test]
fn test_improduct_pure_imaginary() {
    // i * i = -1
    assert_eq!(FnImProduct.call(&[text("i"), text("i")]), text("-1"));
}

#[test]
fn test_improduct_three_args() {
    // (1+i)(1+i)(1+i) = (2i)(1+i) = 2i + 2i^2 = -2+2i
    assert_eq!(
        FnImProduct.call(&[text("1+i"), text("1+i"), text("1+i")]),
        text("-2+2i")
    );
}

// =====================================================================
// IMDIV — division
// =====================================================================

#[test]
fn test_imdiv_one_over_i() {
    // 1/i = -i
    assert_eq!(FnImDiv.call(&[text("1"), text("i")]), text("-i"));
}

#[test]
fn test_imdiv_basic() {
    // (4+2i)/(1+i) = (4+2i)(1-i)/2 = (4-4i+2i-2i^2)/2 = (6-2i)/2 = 3-i
    assert_eq!(FnImDiv.call(&[text("4+2i"), text("1+i")]), text("3-i"));
}

#[test]
fn test_imdiv_by_zero() {
    assert!(matches!(
        FnImDiv.call(&[text("1+i"), text("0")]),
        CellValue::Error(CellError::Num, _)
    ));
}

#[test]
fn test_imdiv_identity() {
    // z/z = 1
    assert_eq!(FnImDiv.call(&[text("3+4i"), text("3+4i")]), text("1"));
}

// =====================================================================
// IMPOWER — z^n
// =====================================================================

#[test]
fn test_impower_squared() {
    // (1+i)^2 = 2i
    let result = FnImPower.call(&[text("1+i"), num(2.0)]);
    assert_complex_approx(&result, 0.0, 2.0, 1e-9);
}

#[test]
fn test_impower_zero() {
    // z^0 = 1
    assert_eq!(FnImPower.call(&[text("3+4i"), num(0.0)]), text("1"));
}

#[test]
fn test_impower_one() {
    // z^1 = z
    let result = FnImPower.call(&[text("3+4i"), num(1.0)]);
    assert_complex_approx(&result, 3.0, 4.0, 1e-9);
}

#[test]
fn test_impower_negative_exponent() {
    // i^(-1) = 1/i = -i
    let result = FnImPower.call(&[text("i"), num(-1.0)]);
    assert_complex_approx(&result, 0.0, -1.0, 1e-9);
}

#[test]
fn test_impower_zero_base_negative_exp() {
    assert!(matches!(
        FnImPower.call(&[text("0"), num(-1.0)]),
        CellValue::Error(CellError::Num, _)
    ));
}

// =====================================================================
// IMSQRT — principal square root
// =====================================================================

#[test]
fn test_imsqrt_negative_one() {
    // sqrt(-1) = i
    assert_eq!(FnImSqrt.call(&[text("-1")]), text("i"));
}

#[test]
fn test_imsqrt_of_i() {
    // sqrt(i) = (1+i)/sqrt(2)
    let result = FnImSqrt.call(&[text("i")]);
    let expected = 1.0 / std::f64::consts::SQRT_2;
    assert_complex_approx(&result, expected, expected, 1e-9);
}

#[test]
fn test_imsqrt_positive_real() {
    // sqrt(4) = 2
    assert_eq!(FnImSqrt.call(&[text("4")]), text("2"));
}

#[test]
fn test_imsqrt_negative_four() {
    // sqrt(-4) = 2i
    assert_eq!(FnImSqrt.call(&[text("-4")]), text("2i"));
}

// =====================================================================
// Suffix consistency errors
// =====================================================================

#[test]
fn test_imsum_mixed_suffix_error() {
    // IMSUM("3+4i", "1+2j") should return #VALUE! because of mixed i/j suffixes
    let f = FnImSum;
    assert!(matches!(
        f.call(&[text("3+4i"), text("1+2j")]),
        CellValue::Error(CellError::Value, _)
    ));
}

#[test]
fn test_imsum_same_suffix_j() {
    // IMSUM("3+4j", "1+2j") should work fine with j suffix
    let f = FnImSum;
    assert_eq!(f.call(&[text("3+4j"), text("1+2j")]), text("4+6j"));
}

#[test]
fn test_improduct_mixed_suffix_error() {
    // IMPRODUCT("3+4i", "1+2j") should return #VALUE!
    let f = FnImProduct;
    assert!(matches!(
        f.call(&[text("3+4i"), text("1+2j")]),
        CellValue::Error(CellError::Value, _)
    ));
}

#[test]
fn test_imsub_mixed_suffix_error() {
    // IMSUB("3+4i", "1+2j") should return #VALUE!
    let f = FnImSub;
    assert!(matches!(
        f.call(&[text("3+4i"), text("1+2j")]),
        CellValue::Error(CellError::Value, _)
    ));
}

#[test]
fn test_imdiv_mixed_suffix_error() {
    // IMDIV("3+4i", "1+2j") should return #VALUE!
    let f = FnImDiv;
    assert!(matches!(
        f.call(&[text("3+4i"), text("1+2j")]),
        CellValue::Error(CellError::Value, _)
    ));
}

#[test]
fn test_parse_complex_scientific_notation_imaginary() {
    // Pure imaginary with scientific notation: "1.5e2i" = 150i
    assert_eq!(parse_complex("1.5e2i"), Some((0.0, 150.0, 'i')));
    // Negative exponent: "2.5e-3i" = 0.0025i
    assert_eq!(parse_complex("2.5e-3i"), Some((0.0, 0.0025, 'i')));
    // Complex with scientific notation in imaginary part: "1+2.5e2i"
    assert_eq!(parse_complex("1+2.5e2i"), Some((1.0, 250.0, 'i')));
    // Complex with scientific notation in both parts: "1.5e2+2.5e-1i"
    assert_eq!(parse_complex("1.5e2+2.5e-1i"), Some((150.0, 0.25, 'i')));
}
