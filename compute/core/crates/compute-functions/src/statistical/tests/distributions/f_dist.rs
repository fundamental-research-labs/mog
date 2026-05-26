use super::super::super::distributions::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_f_dist_nan_df() {
    let f = FnFDist;
    // NaN df1 should return #NUM!, not panic
    let result = f.call(&[num(1.0), num(f64::NAN), num(5.0), CellValue::Boolean(true)]);
    assert_eq!(result, err(CellError::Num));
    // NaN df2 should return #NUM!, not panic
    let result = f.call(&[num(1.0), num(5.0), num(f64::NAN), CellValue::Boolean(true)]);
    assert_eq!(result, err(CellError::Num));
}

#[test]
fn test_f_dist_cdf_at_zero() {
    assert_dist_near(
        FnFDist.call(&[num(0.0), num(5.0), num(10.0), bv(true)]),
        0.0,
        "F.DIST(0,5,10,TRUE)",
    );
}

#[test]
fn test_f_dist_cdf_equal_df() {
    assert_dist_near(
        FnFDist.call(&[num(1.0), num(5.0), num(5.0), bv(true)]),
        0.5,
        "F.DIST(1,5,5,TRUE)",
    );
}

#[test]
fn test_f_dist_rt_complement() {
    let cdf = FnFDist.call(&[num(2.0), num(5.0), num(10.0), bv(true)]);
    let rt = FnFDistRT.call(&[num(2.0), num(5.0), num(10.0)]);
    if let (CellValue::Number(c), CellValue::Number(r)) = (&cdf, &rt) {
        assert!((c.get() + r.get() - 1.0).abs() < DIST_TOL, "F CDF+RT=1");
    } else {
        panic!("Expected numbers");
    }
}

#[test]
fn test_f_dist_err_df_lt1() {
    assert_num_err(
        FnFDist.call(&[num(1.0), num(0.0), num(10.0), bv(true)]),
        "F.DIST df1<1",
    );
    assert_num_err(
        FnFDist.call(&[num(1.0), num(5.0), num(0.0), bv(true)]),
        "F.DIST df2<1",
    );
}

#[test]
fn test_f_inv_95_5_10() {
    assert_dist_near(
        FnFInv.call(&[num(0.95), num(5.0), num(10.0)]),
        3.3258,
        "F.INV(0.95,5,10)",
    );
}

#[test]
fn test_f_inv_rt_05_5_10() {
    assert_dist_near(
        FnFInvRT.call(&[num(0.05), num(5.0), num(10.0)]),
        3.3258,
        "F.INV.RT(0.05,5,10)",
    );
}

#[test]
fn test_fdist_legacy_delegates() {
    assert_eq!(
        FnFDistRT.call(&[num(2.0), num(5.0), num(10.0)]),
        FnFDistLegacy.call(&[num(2.0), num(5.0), num(10.0)]),
        "FDIST delegates"
    );
}

#[test]
fn test_finv_legacy_delegates() {
    assert_eq!(
        FnFInvRT.call(&[num(0.05), num(5.0), num(10.0)]),
        FnFInvLegacy.call(&[num(0.05), num(5.0), num(10.0)]),
        "FINV delegates"
    );
}

#[test]
fn test_f_dist_pdf() {
    let result = FnFDist.call(&[num(1.0), num(5.0), num(10.0), CellValue::Boolean(false)]);
    assert_num(result, 0.4955, 0.01, "F.DIST PDF");
}

#[test]
fn test_f_dist_cdf_at_zero_v2() {
    let result = FnFDist.call(&[num(0.0), num(5.0), num(10.0), CellValue::Boolean(true)]);
    assert_num(result, 0.0, 0.001, "F.DIST CDF at 0");
}

#[test]
fn test_f_dist_negative_x() {
    assert_eq!(
        FnFDist.call(&[num(-1.0), num(5.0), num(10.0), CellValue::Boolean(true)]),
        err(CellError::Num)
    );
}

#[test]
fn test_f_dist_rt_basic() {
    assert_num(
        FnFDistRT.call(&[num(0.0), num(5.0), num(10.0)]),
        1.0,
        0.001,
        "F.DIST.RT(0)",
    );
}

#[test]
fn test_f_dist_rt_df_error() {
    assert_eq!(
        FnFDistRT.call(&[num(1.0), num(0.5), num(10.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_fdist_legacy_delegates_v2() {
    let args = [num(2.0), num(5.0), num(10.0)];
    assert_eq!(FnFDistRT.call(&args), FnFDistLegacy.call(&args));
}

#[test]
fn test_f_inv_basic() {
    assert_num(
        FnFInv.call(&[num(0.0), num(5.0), num(10.0)]),
        0.0,
        0.001,
        "F.INV(0)",
    );
}

#[test]
fn test_f_inv_error() {
    assert_eq!(
        FnFInv.call(&[num(-0.1), num(5.0), num(10.0)]),
        err(CellError::Num)
    );
    assert_eq!(
        FnFInv.call(&[num(1.1), num(5.0), num(10.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_f_inv_rt_basic() {
    assert_num(
        FnFInvRT.call(&[num(1.0), num(5.0), num(10.0)]),
        0.0,
        0.001,
        "F.INV.RT(1)",
    );
}

#[test]
fn test_f_inv_rt_error() {
    assert_eq!(
        FnFInvRT.call(&[num(-0.1), num(5.0), num(10.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_finv_legacy_delegates_v2() {
    let args = [num(0.5), num(5.0), num(10.0)];
    assert_eq!(FnFInvRT.call(&args), FnFInvLegacy.call(&args));
}
