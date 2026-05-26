use super::super::super::distributions::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_gammaln() {
    let f = FnGammaLn;
    // GAMMALN(4) = ln(3!) = ln(6) ~ 1.7918
    let result = f.call(&[num(4.0)]);
    if let CellValue::Number(n) = result {
        assert!((n.get() - 1.7918).abs() < 0.01, "gammaln was {}", n.get());
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_gamma_dist_nan_params() {
    let f = FnGammaDist;
    // NaN alpha should return #NUM!, not panic
    let result = f.call(&[num(1.0), num(f64::NAN), num(1.0), CellValue::Boolean(true)]);
    assert_eq!(result, err(CellError::Num));
}

#[test]
fn test_gamma_dist_scale_parameterization() {
    let f = FnGammaDist;
    // GAMMA.DIST(2, 3, 2, TRUE) should be ~0.0803 per Excel
    // (shape=3, scale=2, cumulative)
    let result = f.call(&[num(2.0), num(3.0), num(2.0), CellValue::Boolean(true)]);
    if let CellValue::Number(n) = result {
        assert!(
            (n.get() - 0.0803).abs() < 0.01,
            "GAMMA.DIST(2,3,2,TRUE) was {}, expected ~0.0803",
            n.get()
        );
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_gamma_inv_scale_parameterization() {
    let f = FnGammaInv;
    // GAMMA.INV(0.5, 3, 2) should be ~5.348 per Excel
    // (p=0.5, shape=3, scale=2)
    let result = f.call(&[num(0.5), num(3.0), num(2.0)]);
    if let CellValue::Number(n) = result {
        assert!(
            (n.get() - 5.348).abs() < 0.1,
            "GAMMA.INV(0.5,3,2) was {}, expected ~5.348",
            n.get()
        );
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_gamma_dist_legacy_delegates() {
    // GAMMADIST should produce the same result as GAMMA.DIST
    let modern = FnGammaDist;
    let legacy = FnGammaDistLegacy;
    let args = [num(2.0), num(3.0), num(2.0), CellValue::Boolean(true)];
    assert_eq!(modern.call(&args), legacy.call(&args));
}

#[test]
fn test_gamma_fn_factorial() {
    assert_dist_near(FnGammaFn.call(&[num(5.0)]), 24.0, "GAMMA(5)=4!");
}

#[test]
fn test_gamma_fn_half() {
    assert_dist_near(FnGammaFn.call(&[num(0.5)]), 1.7725, "GAMMA(0.5)=sqrt(pi)");
}

#[test]
fn test_gamma_fn_err_nonpositive() {
    assert_num_err(FnGammaFn.call(&[num(0.0)]), "GAMMA(0)");
    assert_num_err(FnGammaFn.call(&[num(-1.0)]), "GAMMA(-1)");
}

#[test]
fn test_gamma_dist_cdf_dist() {
    assert_dist_near(
        FnGammaDist.call(&[num(2.0), num(3.0), num(2.0), bv(true)]),
        0.0803,
        "GAMMA.DIST CDF",
    );
}

#[test]
fn test_gamma_inv_roundtrip() {
    let cdf = FnGammaDist.call(&[num(5.0), num(3.0), num(2.0), bv(true)]);
    if let CellValue::Number(p) = cdf {
        assert_dist_near(
            FnGammaInv.call(&[num(p.get()), num(3.0), num(2.0)]),
            5.0,
            "GAMMA.INV roundtrip",
        );
    } else {
        panic!("Expected number");
    }
}

#[test]
fn test_gammaln_one() {
    assert_dist_near(FnGammaLn.call(&[num(1.0)]), 0.0, "GAMMALN(1)=0");
}

#[test]
fn test_gammaln_five() {
    assert_dist_near(FnGammaLn.call(&[num(5.0)]), 3.1781, "GAMMALN(5)=ln(24)");
}

#[test]
fn test_gammaln_precise_delegates() {
    assert_eq!(
        FnGammaLn.call(&[num(5.0)]),
        FnGammaLnPrecise.call(&[num(5.0)]),
        "GAMMALN.PRECISE"
    );
}

#[test]
fn test_gamma_fn_integer() {
    assert_num(FnGammaFn.call(&[num(5.0)]), 24.0, 0.001, "GAMMA(5)");
}

#[test]
fn test_gamma_fn_half_v2() {
    assert_num(FnGammaFn.call(&[num(0.5)]), 1.7725, 0.001, "GAMMA(0.5)");
}

#[test]
fn test_gamma_fn_negative_integer() {
    assert_eq!(FnGammaFn.call(&[num(0.0)]), err(CellError::Num));
    assert_eq!(FnGammaFn.call(&[num(-1.0)]), err(CellError::Num));
    assert_eq!(FnGammaFn.call(&[num(-2.0)]), err(CellError::Num));
}

#[test]
fn test_gamma_fn_negative_non_integer() {
    assert_num(FnGammaFn.call(&[num(-0.5)]), -3.5449, 0.01, "GAMMA(-0.5)");
}

#[test]
fn test_gamma_dist_exponential_cdf() {
    assert_num(
        FnGammaDist.call(&[num(1.0), num(1.0), num(1.0), CellValue::Boolean(true)]),
        0.6321,
        0.001,
        "GAMMA.DIST exp CDF",
    );
}

#[test]
fn test_gamma_dist_pdf() {
    assert_num(
        FnGammaDist.call(&[num(1.0), num(2.0), num(1.0), CellValue::Boolean(false)]),
        0.3679,
        0.001,
        "GAMMA.DIST PDF",
    );
}

#[test]
fn test_gamma_dist_negative_x() {
    assert_eq!(
        FnGammaDist.call(&[num(-1.0), num(2.0), num(1.0), CellValue::Boolean(true)]),
        err(CellError::Num)
    );
}

#[test]
fn test_gamma_dist_zero_alpha() {
    assert_eq!(
        FnGammaDist.call(&[num(1.0), num(0.0), num(1.0), CellValue::Boolean(true)]),
        err(CellError::Num)
    );
}

#[test]
fn test_gamma_dist_zero_beta() {
    assert_eq!(
        FnGammaDist.call(&[num(1.0), num(2.0), num(0.0), CellValue::Boolean(true)]),
        err(CellError::Num)
    );
}

#[test]
fn test_gamma_inv_error_cases() {
    assert_eq!(
        FnGammaInv.call(&[num(-0.1), num(2.0), num(1.0)]),
        err(CellError::Num)
    );
    assert_eq!(
        FnGammaInv.call(&[num(1.1), num(2.0), num(1.0)]),
        err(CellError::Num)
    );
    assert_eq!(
        FnGammaInv.call(&[num(0.5), num(0.0), num(1.0)]),
        err(CellError::Num)
    );
    assert_eq!(
        FnGammaInv.call(&[num(0.5), num(2.0), num(0.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_gammainv_legacy_delegates() {
    let args = [num(0.5), num(3.0), num(2.0)];
    assert_eq!(FnGammaInv.call(&args), FnGammaInvLegacy.call(&args));
}

#[test]
fn test_gammaln_non_integer() {
    assert_num(FnGammaLn.call(&[num(0.5)]), 0.5724, 0.01, "GAMMALN(0.5)");
}

#[test]
fn test_gammaln_error() {
    assert_eq!(FnGammaLn.call(&[num(0.0)]), err(CellError::Num));
    assert_eq!(FnGammaLn.call(&[num(-1.0)]), err(CellError::Num));
}

#[test]
fn test_gammaln_precise_delegates_v2() {
    assert_eq!(
        FnGammaLn.call(&[num(4.0)]),
        FnGammaLnPrecise.call(&[num(4.0)])
    );
}
