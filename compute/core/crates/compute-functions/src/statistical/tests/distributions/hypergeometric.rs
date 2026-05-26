use super::super::super::distributions::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_hypgeom_dist_negative_params() {
    let f = FnHypGeomDist;
    // HYPGEOM.DIST(-1, 10, 20, 100, FALSE) should return #NUM! (negative successes)
    assert_eq!(
        f.call(&[
            num(-1.0),
            num(10.0),
            num(20.0),
            num(100.0),
            CellValue::Boolean(false)
        ]),
        err(CellError::Num)
    );
    // HYPGEOM.DIST(1, -1, 20, 100, FALSE) should return #NUM! (negative sample)
    assert_eq!(
        f.call(&[
            num(1.0),
            num(-1.0),
            num(20.0),
            num(100.0),
            CellValue::Boolean(false)
        ]),
        err(CellError::Num)
    );
    // HYPGEOM.DIST(1, 10, -1, 100, FALSE) should return #NUM! (negative pop successes)
    assert_eq!(
        f.call(&[
            num(1.0),
            num(10.0),
            num(-1.0),
            num(100.0),
            CellValue::Boolean(false)
        ]),
        err(CellError::Num)
    );
    // HYPGEOM.DIST(1, 10, 20, -1, FALSE) should return #NUM! (negative population)
    assert_eq!(
        f.call(&[
            num(1.0),
            num(10.0),
            num(20.0),
            num(-1.0),
            CellValue::Boolean(false)
        ]),
        err(CellError::Num)
    );
}

#[test]
fn test_hypgeom_dist_legacy_negative_params() {
    let f = FnHypGeomDistLegacy;
    // HYPGEOMDIST(-1, 10, 20, 100) should return #NUM!
    assert_eq!(
        f.call(&[num(-1.0), num(10.0), num(20.0), num(100.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_hypgeom_pmf() {
    assert_dist_near(
        FnHypGeomDist.call(&[num(1.0), num(4.0), num(8.0), num(20.0), bv(false)]),
        0.3633,
        "HYPGEOM PMF",
    );
}

#[test]
fn test_hypgeom_cdf() {
    assert_dist_near(
        FnHypGeomDist.call(&[num(1.0), num(4.0), num(8.0), num(20.0), bv(true)]),
        0.4654,
        "HYPGEOM CDF",
    );
}

#[test]
fn test_hypgeomdist_legacy() {
    assert_dist_near(
        FnHypGeomDistLegacy.call(&[num(1.0), num(4.0), num(8.0), num(20.0)]),
        0.3633,
        "HYPGEOMDIST",
    );
}

#[test]
fn test_hypgeom_dist_pmf() {
    assert_num(
        FnHypGeomDist.call(&[
            num(1.0),
            num(4.0),
            num(8.0),
            num(20.0),
            CellValue::Boolean(false),
        ]),
        0.3633,
        0.01,
        "HYPGEOM.DIST PMF",
    );
}

#[test]
fn test_hypgeom_dist_cdf() {
    assert_num(
        FnHypGeomDist.call(&[
            num(1.0),
            num(4.0),
            num(8.0),
            num(20.0),
            CellValue::Boolean(true),
        ]),
        0.4654,
        0.02,
        "HYPGEOM.DIST CDF",
    );
}

#[test]
fn test_hypgeom_dist_sample_gt_pop() {
    assert_eq!(
        FnHypGeomDist.call(&[
            num(1.0),
            num(100.0),
            num(8.0),
            num(20.0),
            CellValue::Boolean(false)
        ]),
        err(CellError::Num)
    );
}

#[test]
fn test_hypgeom_dist_s_gt_sample() {
    assert_eq!(
        FnHypGeomDist.call(&[
            num(5.0),
            num(4.0),
            num(8.0),
            num(20.0),
            CellValue::Boolean(false)
        ]),
        err(CellError::Num)
    );
}

#[test]
fn test_hypgeomdist_legacy_basic() {
    assert_num(
        FnHypGeomDistLegacy.call(&[num(1.0), num(4.0), num(8.0), num(20.0)]),
        0.3633,
        0.01,
        "HYPGEOMDIST",
    );
}

#[test]
fn test_hypgeomdist_legacy_sample_gt_pop() {
    assert_eq!(
        FnHypGeomDistLegacy.call(&[num(1.0), num(100.0), num(8.0), num(20.0)]),
        err(CellError::Num)
    );
}
