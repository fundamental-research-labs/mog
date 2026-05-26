use super::super::super::distributions::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_beta_dist_nan_params() {
    let f = FnBetaDist;
    // NaN alpha should return #NUM!, not panic
    let result = f.call(&[num(0.5), num(f64::NAN), num(1.0), CellValue::Boolean(true)]);
    assert_eq!(result, err(CellError::Num));
}

#[test]
fn test_beta_dist_uniform_cdf() {
    assert_dist_near(
        FnBetaDist.call(&[num(0.5), num(1.0), num(1.0), bv(true)]),
        0.5,
        "BETA(0.5,1,1)",
    );
}

#[test]
fn test_beta_dist_cdf_at_1() {
    assert_dist_near(
        FnBetaDist.call(&[num(1.0), num(2.0), num(3.0), bv(true)]),
        1.0,
        "BETA CDF(1)",
    );
}

#[test]
fn test_betadist_legacy() {
    assert_dist_near(
        FnBetaDistLegacy.call(&[num(0.5), num(1.0), num(1.0)]),
        0.5,
        "BETADIST",
    );
}

#[test]
fn test_beta_inv_uniform() {
    assert_dist_near(
        FnBetaInv.call(&[num(0.5), num(1.0), num(1.0)]),
        0.5,
        "BETA.INV uniform",
    );
}

#[test]
fn test_beta_inv_with_bounds() {
    // Uniform Beta on [0,10]: inverse at 0.5 should be ~5.0 (allow slightly wider tolerance due to numerical inversion)
    let r = FnBetaInv.call(&[num(0.5), num(1.0), num(1.0), num(0.0), num(10.0)]);
    match r {
        CellValue::Number(n) => assert!(
            (n.get() - 5.0).abs() < 0.01,
            "BETA.INV bounds: got {}",
            n.get()
        ),
        other => panic!("BETA.INV bounds: expected Number, got {:?}", other),
    }
}

#[test]
fn test_beta_dist_uniform_cdf_v2() {
    assert_num(
        FnBetaDist.call(&[num(0.5), num(1.0), num(1.0), CellValue::Boolean(true)]),
        0.5,
        0.001,
        "BETA.DIST uniform CDF",
    );
}

#[test]
fn test_beta_dist_pdf() {
    assert_num(
        FnBetaDist.call(&[num(0.5), num(2.0), num(2.0), CellValue::Boolean(false)]),
        1.5,
        0.001,
        "BETA.DIST PDF",
    );
}

#[test]
fn test_beta_dist_with_bounds() {
    assert_num(
        FnBetaDist.call(&[
            num(5.0),
            num(1.0),
            num(1.0),
            CellValue::Boolean(true),
            num(0.0),
            num(10.0),
        ]),
        0.5,
        0.001,
        "BETA.DIST with bounds",
    );
}

#[test]
fn test_beta_dist_x_out_of_bounds() {
    assert_eq!(
        FnBetaDist.call(&[num(-0.1), num(2.0), num(2.0), CellValue::Boolean(true)]),
        err(CellError::Num)
    );
    assert_eq!(
        FnBetaDist.call(&[num(1.1), num(2.0), num(2.0), CellValue::Boolean(true)]),
        err(CellError::Num)
    );
}

#[test]
fn test_beta_dist_negative_alpha() {
    assert_eq!(
        FnBetaDist.call(&[num(0.5), num(-1.0), num(2.0), CellValue::Boolean(true)]),
        err(CellError::Num)
    );
}

#[test]
fn test_beta_dist_a_equals_b() {
    assert_eq!(
        FnBetaDist.call(&[
            num(5.0),
            num(1.0),
            num(1.0),
            CellValue::Boolean(true),
            num(10.0),
            num(10.0)
        ]),
        err(CellError::Num)
    );
}

#[test]
fn test_betadist_legacy_v2() {
    assert_num(
        FnBetaDistLegacy.call(&[num(0.5), num(2.0), num(2.0)]),
        0.5,
        0.001,
        "BETADIST",
    );
}

#[test]
fn test_betadist_legacy_with_bounds() {
    assert_num(
        FnBetaDistLegacy.call(&[num(5.0), num(1.0), num(1.0), num(0.0), num(10.0)]),
        0.5,
        0.001,
        "BETADIST bounds",
    );
}

#[test]
fn test_betadist_legacy_error() {
    assert_eq!(
        FnBetaDistLegacy.call(&[num(0.5), num(-1.0), num(2.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_beta_inv_basic() {
    assert_num(
        FnBetaInv.call(&[num(0.5), num(1.0), num(1.0)]),
        0.5,
        0.001,
        "BETA.INV",
    );
}

#[test]
fn test_beta_inv_with_bounds_v2() {
    assert_num(
        FnBetaInv.call(&[num(0.5), num(1.0), num(1.0), num(0.0), num(10.0)]),
        5.0,
        0.001,
        "BETA.INV bounds",
    );
}

#[test]
fn test_beta_inv_error() {
    assert_eq!(
        FnBetaInv.call(&[num(-0.1), num(1.0), num(1.0)]),
        err(CellError::Num)
    );
    assert_eq!(
        FnBetaInv.call(&[num(1.1), num(1.0), num(1.0)]),
        err(CellError::Num)
    );
    assert_eq!(
        FnBetaInv.call(&[num(0.5), num(-1.0), num(1.0)]),
        err(CellError::Num)
    );
    assert_eq!(
        FnBetaInv.call(&[num(0.5), num(1.0), num(-1.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_beta_inv_a_ge_b() {
    assert_eq!(
        FnBetaInv.call(&[num(0.5), num(1.0), num(1.0), num(10.0), num(5.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_betainv_legacy_delegates() {
    let args = [num(0.5), num(2.0), num(3.0)];
    assert_eq!(FnBetaInv.call(&args), FnBetaInvLegacy.call(&args));
}
