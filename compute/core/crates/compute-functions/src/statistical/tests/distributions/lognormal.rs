use super::super::super::distributions::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_lognorm_dist_nan_std_dev() {
    let f = FnLogNormDist;
    // NaN std_dev should return #NUM!, not panic
    let result = f.call(&[num(1.0), num(0.0), num(f64::NAN), CellValue::Boolean(true)]);
    assert_eq!(result, err(CellError::Num));
}

#[test]
fn test_lognorm_cdf_at_1() {
    assert_dist_near(
        FnLogNormDist.call(&[num(1.0), num(0.0), num(1.0), bv(true)]),
        0.5,
        "LOGNORM CDF(1)",
    );
}

#[test]
fn test_lognorm_err_x_le0() {
    assert_num_err(
        FnLogNormDist.call(&[num(0.0), num(0.0), num(1.0), bv(true)]),
        "LOGNORM x<=0",
    );
}

#[test]
fn test_lognormdist_legacy() {
    assert_dist_near(
        FnLogNormDistLegacy.call(&[num(1.0), num(0.0), num(1.0)]),
        0.5,
        "LOGNORMDIST",
    );
}

#[test]
fn test_lognorm_inv_at_half() {
    assert_dist_near(
        FnLogNormInv.call(&[num(0.5), num(0.0), num(1.0)]),
        1.0,
        "LOGNORM.INV(0.5)=e^0",
    );
}

#[test]
fn test_loginv_legacy_delegates() {
    assert_dist_near(
        FnLogInv.call(&[num(0.5), num(0.0), num(1.0)]),
        1.0,
        "LOGINV",
    );
}

#[test]
fn test_lognorm_dist_cdf() {
    assert_num(
        FnLogNormDist.call(&[num(1.0), num(0.0), num(1.0), CellValue::Boolean(true)]),
        0.5,
        0.001,
        "LOGNORM.DIST CDF",
    );
}

#[test]
fn test_lognorm_dist_pdf() {
    assert_num(
        FnLogNormDist.call(&[num(1.0), num(0.0), num(1.0), CellValue::Boolean(false)]),
        0.3989,
        0.001,
        "LOGNORM.DIST PDF",
    );
}

#[test]
fn test_lognorm_dist_x_zero() {
    assert_eq!(
        FnLogNormDist.call(&[num(0.0), num(0.0), num(1.0), CellValue::Boolean(true)]),
        err(CellError::Num)
    );
}

#[test]
fn test_lognorm_dist_negative_std() {
    assert_eq!(
        FnLogNormDist.call(&[num(1.0), num(0.0), num(-1.0), CellValue::Boolean(true)]),
        err(CellError::Num)
    );
}

#[test]
fn test_lognormdist_legacy_v2() {
    assert_num(
        FnLogNormDistLegacy.call(&[num(1.0), num(0.0), num(1.0)]),
        0.5,
        0.001,
        "LOGNORMDIST",
    );
}

#[test]
fn test_lognormdist_legacy_error() {
    assert_eq!(
        FnLogNormDistLegacy.call(&[num(0.0), num(0.0), num(1.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_lognorm_inv_basic() {
    assert_num(
        FnLogNormInv.call(&[num(0.5), num(0.0), num(1.0)]),
        1.0,
        0.001,
        "LOGNORM.INV",
    );
}

#[test]
fn test_lognorm_inv_error() {
    assert_eq!(
        FnLogNormInv.call(&[num(0.0), num(0.0), num(1.0)]),
        err(CellError::Num)
    );
    assert_eq!(
        FnLogNormInv.call(&[num(1.0), num(0.0), num(1.0)]),
        err(CellError::Num)
    );
    assert_eq!(
        FnLogNormInv.call(&[num(0.5), num(0.0), num(-1.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_loginv_legacy_delegates_v2() {
    let args = [num(0.5), num(0.0), num(1.0)];
    assert_eq!(FnLogNormInv.call(&args), FnLogInv.call(&args));
}
