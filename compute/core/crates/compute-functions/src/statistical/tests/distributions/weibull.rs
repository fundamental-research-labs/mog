use super::super::super::distributions::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_weibull_dist_nan_params() {
    let f = FnWeibullDist;
    // NaN alpha should return #NUM!, not panic
    let result = f.call(&[num(1.0), num(f64::NAN), num(1.0), CellValue::Boolean(true)]);
    assert_eq!(result, err(CellError::Num));
    // NaN beta should return #NUM!, not panic
    let result = f.call(&[num(1.0), num(1.0), num(f64::NAN), CellValue::Boolean(true)]);
    assert_eq!(result, err(CellError::Num));
}

#[test]
fn test_weibull_cdf() {
    assert_dist_near(
        FnWeibullDist.call(&[num(1.0), num(1.0), num(1.0), bv(true)]),
        0.6321,
        "WEIBULL CDF",
    );
}

#[test]
fn test_weibull_pdf() {
    assert_dist_near(
        FnWeibullDist.call(&[num(1.0), num(1.0), num(1.0), bv(false)]),
        0.3679,
        "WEIBULL PDF",
    );
}

#[test]
fn test_weibull_err_params() {
    assert_num_err(
        FnWeibullDist.call(&[num(1.0), num(0.0), num(1.0), bv(true)]),
        "alpha<=0",
    );
    assert_num_err(
        FnWeibullDist.call(&[num(1.0), num(1.0), num(0.0), bv(true)]),
        "beta<=0",
    );
}

#[test]
fn test_weibull_legacy_delegates() {
    assert_dist_near(
        FnWeibullLegacy.call(&[num(1.0), num(1.0), num(1.0), bv(true)]),
        0.6321,
        "WEIBULL legacy",
    );
}

#[test]
fn test_weibull_dist_cdf() {
    assert_num(
        FnWeibullDist.call(&[num(1.0), num(1.0), num(1.0), CellValue::Boolean(true)]),
        0.6321,
        0.001,
        "WEIBULL CDF",
    );
}

#[test]
fn test_weibull_dist_pdf() {
    assert_num(
        FnWeibullDist.call(&[num(1.0), num(2.0), num(1.0), CellValue::Boolean(false)]),
        0.7358,
        0.01,
        "WEIBULL PDF",
    );
}

#[test]
fn test_weibull_dist_x_zero_pdf() {
    assert_num(
        FnWeibullDist.call(&[num(0.0), num(2.0), num(1.0), CellValue::Boolean(false)]),
        0.0,
        0.001,
        "WEIBULL PDF at 0",
    );
}

#[test]
fn test_weibull_dist_negative_alpha() {
    assert_eq!(
        FnWeibullDist.call(&[num(1.0), num(-1.0), num(1.0), CellValue::Boolean(true)]),
        err(CellError::Num)
    );
}

#[test]
fn test_weibull_dist_zero_beta() {
    assert_eq!(
        FnWeibullDist.call(&[num(1.0), num(1.0), num(0.0), CellValue::Boolean(true)]),
        err(CellError::Num)
    );
}

#[test]
fn test_weibull_legacy_delegates_v2() {
    let args = [num(1.0), num(2.0), num(3.0), CellValue::Boolean(true)];
    assert_eq!(FnWeibullDist.call(&args), FnWeibullLegacy.call(&args));
}
