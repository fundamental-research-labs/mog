use super::super::super::distributions::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_expon_dist_nan_lambda() {
    let f = FnExponDist;
    // NaN lambda should return #NUM!, not panic
    let result = f.call(&[num(1.0), num(f64::NAN), CellValue::Boolean(true)]);
    assert_eq!(result, err(CellError::Num));
}

#[test]
fn test_expon_cdf_at_zero() {
    assert_dist_near(
        FnExponDist.call(&[num(0.0), num(1.0), bv(true)]),
        0.0,
        "EXPON CDF(0)",
    );
}

#[test]
fn test_expon_cdf_at_1() {
    assert_dist_near(
        FnExponDist.call(&[num(1.0), num(1.0), bv(true)]),
        0.6321,
        "EXPON CDF(1)=1-e^-1",
    );
}

#[test]
fn test_expon_pdf_at_1() {
    assert_dist_near(
        FnExponDist.call(&[num(1.0), num(1.0), bv(false)]),
        0.3679,
        "EXPON PDF(1)=e^-1",
    );
}

#[test]
fn test_expon_pdf_at_zero() {
    assert_dist_near(
        FnExponDist.call(&[num(0.0), num(1.0), bv(false)]),
        1.0,
        "EXPON PDF(0)=lambda",
    );
}

#[test]
fn test_expon_err_neg_lambda() {
    assert_num_err(
        FnExponDist.call(&[num(1.0), num(-1.0), bv(true)]),
        "EXPON lambda<0",
    );
}

#[test]
fn test_expondist_legacy_delegates() {
    assert_dist_near(
        FnExponDistLegacy.call(&[num(1.0), num(1.0), bv(true)]),
        0.6321,
        "EXPONDIST",
    );
}

#[test]
fn test_expon_dist_cdf() {
    assert_num(
        FnExponDist.call(&[num(1.0), num(1.0), CellValue::Boolean(true)]),
        0.6321,
        0.001,
        "EXPON.DIST CDF",
    );
}

#[test]
fn test_expon_dist_pdf() {
    assert_num(
        FnExponDist.call(&[num(1.0), num(1.0), CellValue::Boolean(false)]),
        0.3679,
        0.001,
        "EXPON.DIST PDF",
    );
}

#[test]
fn test_expon_dist_negative_x() {
    assert_eq!(
        FnExponDist.call(&[num(-1.0), num(1.0), CellValue::Boolean(true)]),
        err(CellError::Num)
    );
}

#[test]
fn test_expon_dist_zero_lambda() {
    assert_eq!(
        FnExponDist.call(&[num(1.0), num(0.0), CellValue::Boolean(true)]),
        err(CellError::Num)
    );
}

#[test]
fn test_expondist_legacy_delegates_v2() {
    let args = [num(1.0), num(2.0), CellValue::Boolean(true)];
    assert_eq!(FnExponDist.call(&args), FnExponDistLegacy.call(&args));
}
