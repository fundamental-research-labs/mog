use super::super::super::distributions::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_t_dist_nan_df() {
    let f = FnTDist;
    // NaN df should return #NUM!, not panic
    let result = f.call(&[num(1.0), num(f64::NAN), CellValue::Boolean(true)]);
    assert_eq!(result, err(CellError::Num));
}

#[test]
fn test_t_dist_cdf_at_zero() {
    assert_dist_near(
        FnTDist.call(&[num(0.0), num(10.0), bv(true)]),
        0.5,
        "T.DIST(0,10,TRUE)",
    );
}

#[test]
fn test_t_dist_pdf_at_zero_df10() {
    assert_dist_near(
        FnTDist.call(&[num(0.0), num(10.0), bv(false)]),
        0.3891,
        "T.DIST(0,10,FALSE)",
    );
}

#[test]
fn test_t_dist_error_df_lt1() {
    assert_num_err(FnTDist.call(&[num(0.0), num(0.5), bv(true)]), "T.DIST df<1");
}

#[test]
fn test_t_dist_2t_at_zero() {
    assert_dist_near(
        FnTDist2T.call(&[num(0.0), num(10.0)]),
        1.0,
        "T.DIST.2T(0,10)",
    );
}

#[test]
fn test_t_dist_2t_neg_x_error() {
    assert_num_err(FnTDist2T.call(&[num(-1.0), num(10.0)]), "T.DIST.2T x<0");
}

#[test]
fn test_t_dist_rt_at_zero() {
    assert_dist_near(
        FnTDistRT.call(&[num(0.0), num(10.0)]),
        0.5,
        "T.DIST.RT(0,10)",
    );
}

#[test]
fn test_tdist_legacy_1tail() {
    assert_dist_near(
        FnTDistLegacy.call(&[num(0.0), num(10.0), num(1.0)]),
        0.5,
        "TDIST 1-tail",
    );
}

#[test]
fn test_tdist_legacy_2tail() {
    assert_dist_near(
        FnTDistLegacy.call(&[num(0.0), num(10.0), num(2.0)]),
        1.0,
        "TDIST 2-tail",
    );
}

#[test]
fn test_tdist_legacy_bad_tails() {
    assert_num_err(
        FnTDistLegacy.call(&[num(0.0), num(10.0), num(3.0)]),
        "TDIST tails=3",
    );
}

#[test]
fn test_t_inv_at_half() {
    assert_dist_near(FnTInv.call(&[num(0.5), num(10.0)]), 0.0, "T.INV(0.5,10)");
}

#[test]
fn test_t_inv_2t_critical_005_df10() {
    assert_dist_near(
        FnTInv2T.call(&[num(0.05), num(10.0)]),
        2.2281,
        "T.INV.2T(0.05,10)",
    );
}

#[test]
fn test_t_inv_2t_at_one() {
    assert_dist_near(
        FnTInv2T.call(&[num(1.0), num(10.0)]),
        0.0,
        "T.INV.2T(1.0,10)",
    );
}

#[test]
fn test_tinv_legacy_delegates() {
    assert_dist_near(FnTInvLegacy.call(&[num(0.05), num(10.0)]), 2.2281, "TINV");
}

#[test]
fn test_t_dist_pdf_at_zero() {
    let result = FnTDist.call(&[num(0.0), num(10.0), CellValue::Boolean(false)]);
    assert_num(result, 0.38966, 0.001, "T.DIST PDF at 0");
}

#[test]
fn test_t_dist_cdf_negative_x() {
    let result = FnTDist.call(&[num(-1.0), num(10.0), CellValue::Boolean(true)]);
    if let CellValue::Number(n) = result {
        assert!(
            n.get() < 0.5 && n.get() > 0.0,
            "T.DIST CDF(-1) = {}",
            n.get()
        );
    } else {
        panic!("Expected number");
    }
}

#[test]
fn test_t_dist_cdf_at_zero_v2() {
    let result = FnTDist.call(&[num(0.0), num(10.0), CellValue::Boolean(true)]);
    assert_num(result, 0.5, 0.001, "T.DIST CDF at 0");
}

#[test]
fn test_t_dist_df_below_one() {
    assert_eq!(
        FnTDist.call(&[num(0.0), num(0.5), CellValue::Boolean(true)]),
        err(CellError::Num)
    );
}

#[test]
fn test_t_dist_2t_basic() {
    assert_num(
        FnTDist2T.call(&[num(0.0), num(10.0)]),
        1.0,
        0.001,
        "T.DIST.2T(0,10)",
    );
}

#[test]
fn test_t_dist_2t_negative_x() {
    assert_eq!(FnTDist2T.call(&[num(-1.0), num(10.0)]), err(CellError::Num));
}

#[test]
fn test_t_dist_rt_at_zero_v2() {
    assert_num(
        FnTDistRT.call(&[num(0.0), num(10.0)]),
        0.5,
        0.001,
        "T.DIST.RT(0,10)",
    );
}

#[test]
fn test_t_dist_rt_df_below_one() {
    assert_eq!(FnTDistRT.call(&[num(0.0), num(0.5)]), err(CellError::Num));
}

#[test]
fn test_tdist_legacy_one_tail() {
    assert_num(
        FnTDistLegacy.call(&[num(0.0), num(10.0), num(1.0)]),
        0.5,
        0.001,
        "TDIST 1t",
    );
}

#[test]
fn test_tdist_legacy_two_tail() {
    assert_num(
        FnTDistLegacy.call(&[num(0.0), num(10.0), num(2.0)]),
        1.0,
        0.001,
        "TDIST 2t",
    );
}

#[test]
fn test_tdist_legacy_invalid_tails() {
    assert_eq!(
        FnTDistLegacy.call(&[num(0.0), num(10.0), num(3.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_tdist_legacy_negative_x() {
    assert_eq!(
        FnTDistLegacy.call(&[num(-1.0), num(10.0), num(1.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_t_inv_half() {
    assert_num(
        FnTInv.call(&[num(0.5), num(10.0)]),
        0.0,
        0.001,
        "T.INV(0.5,10)",
    );
}

#[test]
fn test_t_inv_error_p_zero() {
    assert_eq!(FnTInv.call(&[num(0.0), num(10.0)]), err(CellError::Num));
}

#[test]
fn test_t_inv_2t_basic() {
    assert_num(
        FnTInv2T.call(&[num(1.0), num(10.0)]),
        0.0,
        0.001,
        "T.INV.2T(1,10)",
    );
}

#[test]
fn test_t_inv_2t_error_p_zero() {
    assert_eq!(FnTInv2T.call(&[num(0.0), num(10.0)]), err(CellError::Num));
}

#[test]
fn test_tinv_legacy_delegates_v2() {
    let args = [num(0.5), num(10.0)];
    assert_eq!(FnTInv2T.call(&args), FnTInvLegacy.call(&args));
}
