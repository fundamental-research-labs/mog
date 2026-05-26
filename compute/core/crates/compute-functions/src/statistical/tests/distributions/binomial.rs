use super::super::super::distributions::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_binom_dist() {
    let f = FnBinomDist;
    // BINOM.DIST(3, 5, 0.5, FALSE) = C(5,3) * 0.5^3 * 0.5^2 = 10 * 0.03125 = 0.3125
    let result = f.call(&[num(3.0), num(5.0), num(0.5), CellValue::Boolean(false)]);
    if let CellValue::Number(n) = result {
        assert!(
            (n.get() - 0.3125).abs() < 0.001,
            "binom.dist was {}",
            n.get()
        );
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_binom_dist_negative_trials() {
    let f = FnBinomDist;
    // BINOM.DIST(3, -1, 0.5, FALSE) should return #NUM! (negative trials)
    assert_eq!(
        f.call(&[num(3.0), num(-1.0), num(0.5), CellValue::Boolean(false)]),
        err(CellError::Num)
    );
}

#[test]
fn test_binom_dist_negative_successes() {
    let f = FnBinomDist;
    // BINOM.DIST(-1, 5, 0.5, FALSE) should return #NUM! (negative successes)
    assert_eq!(
        f.call(&[num(-1.0), num(5.0), num(0.5), CellValue::Boolean(false)]),
        err(CellError::Num)
    );
}

#[test]
fn test_binom_dist_range_negative() {
    let f = FnBinomDistRange;
    // BINOM.DIST.RANGE(-1, 0.5, 0) should return #NUM! (negative trials)
    assert_eq!(
        f.call(&[num(-1.0), num(0.5), num(0.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_binom_inv_negative_trials() {
    let f = FnBinomInv;
    // BINOM.INV(-1, 0.5, 0.5) should return #NUM! (negative trials)
    assert_eq!(
        f.call(&[num(-1.0), num(0.5), num(0.5)]),
        err(CellError::Num)
    );
}

#[test]
fn test_binom_dist_pmf_0_of_10() {
    assert_dist_near(
        FnBinomDist.call(&[num(0.0), num(10.0), num(0.5), bv(false)]),
        0.000977,
        "BINOM.DIST(0,10,0.5,FALSE)",
    );
}

#[test]
fn test_binom_dist_pmf_5_of_10() {
    assert_dist_near(
        FnBinomDist.call(&[num(5.0), num(10.0), num(0.5), bv(false)]),
        0.24609,
        "BINOM.DIST(5,10,0.5,FALSE)",
    );
}

#[test]
fn test_binom_dist_cdf_at_max() {
    assert_dist_near(
        FnBinomDist.call(&[num(10.0), num(10.0), num(0.5), bv(true)]),
        1.0,
        "BINOM.DIST(10,10,0.5,TRUE)",
    );
}

#[test]
fn test_binom_dist_cdf_5_of_10() {
    assert_dist_near(
        FnBinomDist.call(&[num(5.0), num(10.0), num(0.5), bv(true)]),
        0.6230,
        "BINOM.DIST(5,10,0.5,TRUE)",
    );
}

#[test]
fn test_binom_inv_median() {
    assert_dist_near(
        FnBinomInv.call(&[num(10.0), num(0.5), num(0.5)]),
        5.0,
        "BINOM.INV(10,0.5,0.5)",
    );
}

#[test]
fn test_critbinom_legacy_delegates() {
    assert_dist_near(
        FnCritBinom.call(&[num(10.0), num(0.5), num(0.5)]),
        5.0,
        "CRITBINOM",
    );
}

#[test]
fn test_binom_dist_range_single() {
    assert_dist_near(
        FnBinomDistRange.call(&[num(10.0), num(0.5), num(5.0)]),
        0.24609,
        "BINOM.DIST.RANGE single",
    );
}

#[test]
fn test_binom_dist_range_interval() {
    assert_dist_near(
        FnBinomDistRange.call(&[num(10.0), num(0.5), num(4.0), num(6.0)]),
        0.65625,
        "BINOM.DIST.RANGE(10,0.5,4,6)",
    );
}

#[test]
fn test_binom_dist_cdf() {
    let result = FnBinomDist.call(&[num(3.0), num(5.0), num(0.5), CellValue::Boolean(true)]);
    assert_num(result, 0.8125, 0.001, "BINOM.DIST CDF");
}

#[test]
fn test_binom_dist_s_greater_than_n() {
    assert_eq!(
        FnBinomDist.call(&[num(6.0), num(5.0), num(0.5), CellValue::Boolean(false)]),
        err(CellError::Num)
    );
}

#[test]
fn test_binom_dist_p_out_of_range() {
    assert_eq!(
        FnBinomDist.call(&[num(3.0), num(5.0), num(1.5), CellValue::Boolean(false)]),
        err(CellError::Num)
    );
}

#[test]
fn test_binomdist_legacy_delegates() {
    let args = [num(3.0), num(5.0), num(0.5), CellValue::Boolean(false)];
    assert_eq!(FnBinomDist.call(&args), FnBinomDistLegacy.call(&args));
}

#[test]
fn test_binom_dist_range_single_v2() {
    assert_num(
        FnBinomDistRange.call(&[num(5.0), num(0.5), num(3.0)]),
        0.3125,
        0.001,
        "BINOM.DIST.RANGE single",
    );
}

#[test]
fn test_binom_dist_range_interval_v2() {
    assert_num(
        FnBinomDistRange.call(&[num(5.0), num(0.5), num(2.0), num(3.0)]),
        0.625,
        0.001,
        "BINOM.DIST.RANGE interval",
    );
}

#[test]
fn test_binom_dist_range_s_greater_than_s2() {
    assert_eq!(
        FnBinomDistRange.call(&[num(5.0), num(0.5), num(4.0), num(2.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_binom_inv_basic() {
    assert_num(
        FnBinomInv.call(&[num(10.0), num(0.5), num(0.5)]),
        5.0,
        0.001,
        "BINOM.INV",
    );
}

#[test]
fn test_binom_inv_alpha_out_of_range() {
    assert_eq!(
        FnBinomInv.call(&[num(10.0), num(0.5), num(1.5)]),
        err(CellError::Num)
    );
}

#[test]
fn test_critbinom_legacy_delegates_v2() {
    let args = [num(10.0), num(0.5), num(0.5)];
    assert_eq!(FnBinomInv.call(&args), FnCritBinom.call(&args));
}
