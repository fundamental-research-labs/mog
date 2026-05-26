use super::super::super::distributions::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_negbinom_dist_negative_failures() {
    let f = FnNegBinomDist;
    // NEGBINOM.DIST(-1, 5, 0.5, FALSE) should return #NUM! (negative failures)
    assert_eq!(
        f.call(&[num(-1.0), num(5.0), num(0.5), CellValue::Boolean(false)]),
        err(CellError::Num)
    );
}

#[test]
fn test_negbinom_dist_negative_successes() {
    let f = FnNegBinomDist;
    // NEGBINOM.DIST(3, -1, 0.5, FALSE) should return #NUM! (negative successes)
    assert_eq!(
        f.call(&[num(3.0), num(-1.0), num(0.5), CellValue::Boolean(false)]),
        err(CellError::Num)
    );
}

#[test]
fn test_negbinom_pmf() {
    assert_dist_near(
        FnNegBinomDist.call(&[num(3.0), num(2.0), num(0.5), bv(false)]),
        0.125,
        "NEGBINOM PMF",
    );
}

#[test]
fn test_negbinom_cdf_ge_pmf() {
    let pmf = FnNegBinomDist.call(&[num(3.0), num(2.0), num(0.5), bv(false)]);
    let cdf = FnNegBinomDist.call(&[num(3.0), num(2.0), num(0.5), bv(true)]);
    if let (CellValue::Number(p), CellValue::Number(c)) = (&pmf, &cdf) {
        assert!(c.get() >= p.get(), "CDF >= PMF");
    } else {
        panic!("Expected numbers");
    }
}

#[test]
fn test_negbinomdist_legacy() {
    assert_dist_near(
        FnNegBinomDistLegacy.call(&[num(3.0), num(2.0), num(0.5)]),
        0.125,
        "NEGBINOMDIST",
    );
}

#[test]
fn test_negbinom_dist_pmf() {
    assert_num(
        FnNegBinomDist.call(&[num(3.0), num(5.0), num(0.5), CellValue::Boolean(false)]),
        0.1367,
        0.01,
        "NEGBINOM.DIST PMF",
    );
}

#[test]
fn test_negbinom_dist_cdf() {
    assert_num(
        FnNegBinomDist.call(&[num(3.0), num(5.0), num(0.5), CellValue::Boolean(true)]),
        0.3633,
        0.01,
        "NEGBINOM.DIST CDF",
    );
}

#[test]
fn test_negbinom_dist_s_zero() {
    assert_eq!(
        FnNegBinomDist.call(&[num(3.0), num(0.0), num(0.5), CellValue::Boolean(false)]),
        err(CellError::Num)
    );
}

#[test]
fn test_negbinom_dist_p_out_of_range() {
    assert_eq!(
        FnNegBinomDist.call(&[num(3.0), num(5.0), num(1.5), CellValue::Boolean(false)]),
        err(CellError::Num)
    );
}

#[test]
fn test_negbinomdist_legacy_v2() {
    assert_num(
        FnNegBinomDistLegacy.call(&[num(3.0), num(5.0), num(0.5)]),
        0.1367,
        0.01,
        "NEGBINOMDIST legacy",
    );
}

#[test]
fn test_negbinomdist_legacy_error() {
    assert_eq!(
        FnNegBinomDistLegacy.call(&[num(-1.0), num(5.0), num(0.5)]),
        err(CellError::Num)
    );
    assert_eq!(
        FnNegBinomDistLegacy.call(&[num(3.0), num(0.0), num(0.5)]),
        err(CellError::Num)
    );
}
