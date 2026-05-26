use super::super::super::distributions::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_poisson_dist_nan_mean() {
    let f = FnPoissonDist;
    // NaN mean should return #NUM!, not panic
    let result = f.call(&[num(1.0), num(f64::NAN), CellValue::Boolean(true)]);
    assert_eq!(result, err(CellError::Num));
}

#[test]
fn test_poisson_dist_negative_x() {
    let f = FnPoissonDist;
    // POISSON.DIST(-1, 5, FALSE) should return #NUM! (negative x)
    assert_eq!(
        f.call(&[num(-1.0), num(5.0), CellValue::Boolean(false)]),
        err(CellError::Num)
    );
}

#[test]
fn test_poisson_pmf_0_lambda1() {
    assert_dist_near(
        FnPoissonDist.call(&[num(0.0), num(1.0), bv(false)]),
        0.36788,
        "P(0;1)=e^-1",
    );
}

#[test]
fn test_poisson_pmf_1_lambda1() {
    assert_dist_near(
        FnPoissonDist.call(&[num(1.0), num(1.0), bv(false)]),
        0.36788,
        "P(1;1)=e^-1",
    );
}

#[test]
fn test_poisson_pmf_2_lambda1() {
    assert_dist_near(
        FnPoissonDist.call(&[num(2.0), num(1.0), bv(false)]),
        0.18394,
        "P(2;1)=e^-1/2",
    );
}

#[test]
fn test_poisson_cdf_0_lambda1() {
    assert_dist_near(
        FnPoissonDist.call(&[num(0.0), num(1.0), bv(true)]),
        0.36788,
        "CDF(0;1)",
    );
}

#[test]
fn test_poisson_cdf_2_lambda1() {
    assert_dist_near(
        FnPoissonDist.call(&[num(2.0), num(1.0), bv(true)]),
        0.9197,
        "CDF(2;1)",
    );
}

#[test]
fn test_poisson_legacy_delegates() {
    assert_dist_near(
        FnPoissonLegacy.call(&[num(0.0), num(1.0), bv(false)]),
        0.36788,
        "POISSON legacy",
    );
}

#[test]
fn test_poisson_dist_pmf() {
    assert_num(
        FnPoissonDist.call(&[num(2.0), num(3.0), CellValue::Boolean(false)]),
        0.2240,
        0.001,
        "POISSON PMF",
    );
}

#[test]
fn test_poisson_dist_cdf() {
    assert_num(
        FnPoissonDist.call(&[num(2.0), num(3.0), CellValue::Boolean(true)]),
        0.4232,
        0.01,
        "POISSON CDF",
    );
}

#[test]
fn test_poisson_dist_negative_mean() {
    assert_eq!(
        FnPoissonDist.call(&[num(1.0), num(-1.0), CellValue::Boolean(false)]),
        err(CellError::Num)
    );
}

#[test]
fn test_poisson_legacy_delegates_v2() {
    let args = [num(2.0), num(3.0), CellValue::Boolean(true)];
    assert_eq!(FnPoissonDist.call(&args), FnPoissonLegacy.call(&args));
}
