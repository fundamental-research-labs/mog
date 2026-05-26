use super::super::super::distributions::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_chisq_dist_nan_df() {
    let f = FnChisqDist;
    // NaN df should return #NUM!, not panic
    let result = f.call(&[num(1.0), num(f64::NAN), CellValue::Boolean(true)]);
    assert_eq!(result, err(CellError::Num));
}

#[test]
fn test_chisq_dist_cdf_at_zero() {
    assert_dist_near(
        FnChisqDist.call(&[num(0.0), num(5.0), bv(true)]),
        0.0,
        "CHISQ.DIST(0,5,TRUE)",
    );
}

#[test]
fn test_chisq_dist_cdf_df5() {
    assert_dist_near(
        FnChisqDist.call(&[num(11.07), num(5.0), bv(true)]),
        0.95,
        "CHISQ.DIST(11.07,5,TRUE)",
    );
}

#[test]
fn test_chisq_dist_err_neg_x() {
    assert_num_err(
        FnChisqDist.call(&[num(-1.0), num(5.0), bv(true)]),
        "CHISQ.DIST x<0",
    );
}

#[test]
fn test_chisq_dist_err_df_lt1() {
    assert_num_err(
        FnChisqDist.call(&[num(1.0), num(0.5), bv(true)]),
        "CHISQ.DIST df<1",
    );
}

#[test]
fn test_chisq_dist_rt_complement() {
    let cdf = FnChisqDist.call(&[num(5.0), num(3.0), bv(true)]);
    let rt = FnChisqDistRT.call(&[num(5.0), num(3.0)]);
    if let (CellValue::Number(c), CellValue::Number(r)) = (&cdf, &rt) {
        assert!(
            (c.get() + r.get() - 1.0).abs() < DIST_TOL,
            "CDF + RT should = 1"
        );
    } else {
        panic!("Expected numbers");
    }
}

#[test]
fn test_chisq_inv_95_df1() {
    assert_dist_near(
        FnChisqInv.call(&[num(0.95), num(1.0)]),
        3.8415,
        "CHISQ.INV(0.95,1)",
    );
}

#[test]
fn test_chisq_inv_95_df10() {
    assert_dist_near(
        FnChisqInv.call(&[num(0.95), num(10.0)]),
        18.307,
        "CHISQ.INV(0.95,10)",
    );
}

#[test]
fn test_chisq_inv_rt_05_df1() {
    assert_dist_near(
        FnChisqInvRT.call(&[num(0.05), num(1.0)]),
        3.8415,
        "CHISQ.INV.RT(0.05,1)",
    );
}

#[test]
fn test_chiinv_legacy_delegates() {
    assert_eq!(
        FnChisqInvRT.call(&[num(0.05), num(1.0)]),
        FnChiInvLegacy.call(&[num(0.05), num(1.0)]),
        "CHIINV should delegate to CHISQ.INV.RT"
    );
}

#[test]
fn test_chisq_dist_pdf() {
    let result = FnChisqDist.call(&[num(2.0), num(3.0), CellValue::Boolean(false)]);
    assert_num(result, 0.2076, 0.01, "CHISQ.DIST PDF");
}

#[test]
fn test_chisq_dist_cdf_at_zero_v2() {
    let result = FnChisqDist.call(&[num(0.0), num(3.0), CellValue::Boolean(true)]);
    assert_num(result, 0.0, 0.001, "CHISQ.DIST CDF at 0");
}

#[test]
fn test_chisq_dist_negative_x() {
    assert_eq!(
        FnChisqDist.call(&[num(-1.0), num(3.0), CellValue::Boolean(true)]),
        err(CellError::Num)
    );
}

#[test]
fn test_chisq_dist_rt_basic() {
    assert_num(
        FnChisqDistRT.call(&[num(0.0), num(3.0)]),
        1.0,
        0.001,
        "CHISQ.DIST.RT(0,3)",
    );
}

#[test]
fn test_chisq_dist_rt_negative_x() {
    assert_eq!(
        FnChisqDistRT.call(&[num(-1.0), num(3.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_chidist_legacy_delegates() {
    let args = [num(3.0), num(5.0)];
    assert_eq!(FnChisqDistRT.call(&args), FnChiDistLegacy.call(&args));
}

#[test]
fn test_chisq_inv_basic() {
    assert_num(
        FnChisqInv.call(&[num(0.0), num(3.0)]),
        0.0,
        0.001,
        "CHISQ.INV(0,3)",
    );
}

#[test]
fn test_chisq_inv_error() {
    assert_eq!(FnChisqInv.call(&[num(-0.1), num(3.0)]), err(CellError::Num));
    assert_eq!(FnChisqInv.call(&[num(1.1), num(3.0)]), err(CellError::Num));
}

#[test]
fn test_chisq_inv_rt_basic() {
    assert_num(
        FnChisqInvRT.call(&[num(1.0), num(3.0)]),
        0.0,
        0.001,
        "CHISQ.INV.RT(1,3)",
    );
}

#[test]
fn test_chiinv_legacy_delegates_v2() {
    let args = [num(0.5), num(5.0)];
    assert_eq!(FnChisqInvRT.call(&args), FnChiInvLegacy.call(&args));
}
