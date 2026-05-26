use super::super::super::distributions::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_confidence_norm() {
    let f = FnConfidenceNorm;
    // CONFIDENCE.NORM(0.05, 2.5, 50) -- known result approximately 0.693
    let result = f.call(&[num(0.05), num(2.5), num(50.0)]);
    if let CellValue::Number(n) = result {
        assert!(
            (n.get() - 0.693).abs() < 0.01,
            "confidence.norm was {}",
            n.get()
        );
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_confidence_norm_nan_std_dev() {
    let f = FnConfidenceNorm;
    // NaN std_dev should return #NUM!, not panic
    let result = f.call(&[num(0.05), num(f64::NAN), num(50.0)]);
    assert_eq!(result, err(CellError::Num));
}

#[test]
fn test_confidence_t_nan_std_dev() {
    let f = FnConfidenceT;
    // NaN std_dev should return #NUM!, not panic
    let result = f.call(&[num(0.05), num(f64::NAN), num(50.0)]);
    assert_eq!(result, err(CellError::Num));
}

#[test]
fn test_confidence_norm_dist() {
    assert_dist_near(
        FnConfidenceNorm.call(&[num(0.05), num(1.0), num(100.0)]),
        0.196,
        "CONFIDENCE.NORM",
    );
}

#[test]
fn test_confidence_norm_err_alpha() {
    assert_num_err(
        FnConfidenceNorm.call(&[num(0.0), num(1.0), num(100.0)]),
        "alpha=0",
    );
    assert_num_err(
        FnConfidenceNorm.call(&[num(1.0), num(1.0), num(100.0)]),
        "alpha=1",
    );
}

#[test]
fn test_confidence_legacy_delegates() {
    assert_eq!(
        FnConfidenceNorm.call(&[num(0.05), num(1.0), num(100.0)]),
        FnConfidenceLegacy.call(&[num(0.05), num(1.0), num(100.0)]),
        "CONFIDENCE delegates"
    );
}

#[test]
fn test_confidence_t_dist() {
    assert_dist_near(
        FnConfidenceT.call(&[num(0.05), num(1.0), num(30.0)]),
        0.3734,
        "CONFIDENCE.T",
    );
}

#[test]
fn test_confidence_norm_errors() {
    assert_eq!(
        FnConfidenceNorm.call(&[num(0.0), num(2.5), num(50.0)]),
        err(CellError::Num)
    );
    assert_eq!(
        FnConfidenceNorm.call(&[num(1.0), num(2.5), num(50.0)]),
        err(CellError::Num)
    );
    assert_eq!(
        FnConfidenceNorm.call(&[num(0.05), num(0.0), num(50.0)]),
        err(CellError::Num)
    );
    assert_eq!(
        FnConfidenceNorm.call(&[num(0.05), num(2.5), num(0.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_confidence_legacy_delegates_v2() {
    let args = [num(0.05), num(2.5), num(50.0)];
    assert_eq!(FnConfidenceNorm.call(&args), FnConfidenceLegacy.call(&args));
}

#[test]
fn test_confidence_t_basic() {
    let result = FnConfidenceT.call(&[num(0.05), num(2.5), num(50.0)]);
    if let CellValue::Number(n) = result {
        assert!(n.get() > 0.0, "CONFIDENCE.T positive: {}", n.get());
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_confidence_t_errors() {
    assert_eq!(
        FnConfidenceT.call(&[num(0.05), num(2.5), num(1.0)]),
        err(CellError::Num)
    );
    assert_eq!(
        FnConfidenceT.call(&[num(0.0), num(2.5), num(50.0)]),
        err(CellError::Num)
    );
    assert_eq!(
        FnConfidenceT.call(&[num(1.0), num(2.5), num(50.0)]),
        err(CellError::Num)
    );
    assert_eq!(
        FnConfidenceT.call(&[num(0.05), num(0.0), num(50.0)]),
        err(CellError::Num)
    );
}
