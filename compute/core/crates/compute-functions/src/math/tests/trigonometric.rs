use super::super::trigonometric::*;
use super::helpers::*;
use crate::PureFunction;
use std::f64::consts::{FRAC_PI_2, FRAC_PI_4, PI};
use value_types::{CellError, CellValue};

#[test]
fn test_acos() {
    if let CellValue::Number(n) = FnAcos.call(&[num(1.0)]) {
        assert!((n.get() - 0.0).abs() < 1e-10);
    } else {
        panic!("Expected number");
    }
    assert_eq!(FnAcos.call(&[num(2.0)]), err(CellError::Num));
}

#[test]
fn test_acos_basic() {
    let r = reg();
    assert_close(r.call("ACOS", &[num(0.0)]), FRAC_PI_2);
    assert_close(r.call("ACOS", &[num(1.0)]), 0.0);
    assert_close(r.call("ACOS", &[num(-1.0)]), PI);
}

#[test]
fn test_acos_cos_roundtrip() {
    let r = reg();
    for x in [0.0, 0.5, 1.0, 2.0, PI] {
        let cos_val = r.call("COS", &[num(x)]);
        let back = r.call("ACOS", &[cos_val]);
        assert_close(back, x);
    }
}

// -- degrees(radians(x)) = x -----------------------------------------

#[test]
fn test_acos_domain_error() {
    let r = reg();
    assert_is_err(r.call("ACOS", &[num(2.0)]), CellError::Num);
    assert_is_err(r.call("ACOS", &[num(-2.0)]), CellError::Num);
}

// -- ATAN -------------------------------------------------------------

#[test]
fn test_acot() {
    // ACOT(0) = PI/2
    if let CellValue::Number(n) = FnAcot.call(&[num(0.0)]) {
        assert!((n.get() - std::f64::consts::FRAC_PI_2).abs() < 1e-10);
    } else {
        panic!("Expected number");
    }
    // ACOT(1) = PI/4
    if let CellValue::Number(n) = FnAcot.call(&[num(1.0)]) {
        assert!((n.get() - std::f64::consts::FRAC_PI_4).abs() < 1e-10);
    } else {
        panic!("Expected number");
    }
}

#[test]
fn test_acot_basic() {
    let r = reg();
    // ACOT(1) = pi/4
    assert_close(r.call("ACOT", &[num(1.0)]), FRAC_PI_4);
    // ACOT(0) = pi/2
    assert_close(r.call("ACOT", &[num(0.0)]), FRAC_PI_2);
}

// -- SEC --------------------------------------------------------------

#[test]
fn test_asin() {
    assert_eq!(FnAsin.call(&[num(0.0)]), num(0.0));
    // asin(1) = PI/2
    if let CellValue::Number(n) = FnAsin.call(&[num(1.0)]) {
        assert!((n.get() - std::f64::consts::FRAC_PI_2).abs() < 1e-10);
    } else {
        panic!("Expected number");
    }
    // Out of range
    assert_eq!(FnAsin.call(&[num(2.0)]), err(CellError::Num));
    assert_eq!(FnAsin.call(&[num(-2.0)]), err(CellError::Num));
}

#[test]
fn test_asin_basic() {
    let r = reg();
    assert_close(r.call("ASIN", &[num(0.0)]), 0.0);
    assert_close(r.call("ASIN", &[num(1.0)]), FRAC_PI_2);
    assert_close(r.call("ASIN", &[num(-1.0)]), -FRAC_PI_2);
}

#[test]
fn test_asin_domain_error() {
    let r = reg();
    assert_is_err(r.call("ASIN", &[num(2.0)]), CellError::Num);
    assert_is_err(r.call("ASIN", &[num(-1.5)]), CellError::Num);
}

// -- ACOS -------------------------------------------------------------

#[test]
fn test_asin_sin_roundtrip() {
    let r = reg();
    for x in [0.0, 0.3, -0.3, 1.0, -1.0, FRAC_PI_4] {
        let sin_val = r.call("SIN", &[num(x)]);
        let back = r.call("ASIN", &[sin_val]);
        assert_close(back, x);
    }
}

// -- Inverse round-trip: acos(cos(x)) = x for x in [0, pi] -----------

#[test]
fn test_atan() {
    assert_eq!(FnAtan.call(&[num(0.0)]), num(0.0));
}

#[test]
fn test_atan2() {
    // ATAN2(1, 0) = atan2(0, 1) = 0
    assert_eq!(FnAtan2.call(&[num(1.0), num(0.0)]), num(0.0));
    // ATAN2(0, 0) = #DIV/0!
    assert_eq!(FnAtan2.call(&[num(0.0), num(0.0)]), err(CellError::Div0));
    // ATAN2(0, 1) = atan2(1, 0) = PI/2
    if let CellValue::Number(n) = FnAtan2.call(&[num(0.0), num(1.0)]) {
        assert!((n.get() - std::f64::consts::FRAC_PI_2).abs() < 1e-10);
    } else {
        panic!("Expected number");
    }
}

#[test]
fn test_atan2_basic() {
    let r = reg();
    // Excel ATAN2(x_num, y_num) — note arg order: x first, y second
    // ATAN2(1, 1) = pi/4
    assert_close(r.call("ATAN2", &[num(1.0), num(1.0)]), FRAC_PI_4);
    // ATAN2(0, 1) = pi/2 (x=0, y=1 => atan2(1,0) = pi/2)
    assert_close(r.call("ATAN2", &[num(0.0), num(1.0)]), FRAC_PI_2);
    // ATAN2(1, 0) = 0
    assert_close(r.call("ATAN2", &[num(1.0), num(0.0)]), 0.0);
}

#[test]
fn test_atan2_both_zero_div0() {
    let r = reg();
    assert_is_err(r.call("ATAN2", &[num(0.0), num(0.0)]), CellError::Div0);
}

// -- DEGREES / RADIANS ------------------------------------------------

#[test]
fn test_atan_basic() {
    let r = reg();
    assert_close(r.call("ATAN", &[num(0.0)]), 0.0);
    assert_close(r.call("ATAN", &[num(1.0)]), FRAC_PI_4);
    assert_close(r.call("ATAN", &[num(-1.0)]), -FRAC_PI_4);
}

// -- ATAN2 ------------------------------------------------------------

#[test]
fn test_cos_cardinal_points() {
    let r = reg();
    assert_close(r.call("COS", &[num(0.0)]), 1.0);
    assert_close(r.call("COS", &[num(FRAC_PI_2)]), 0.0);
    assert_close(r.call("COS", &[num(PI)]), -1.0);
}

// -- TAN --------------------------------------------------------------

#[test]
fn test_cot() {
    // COT(PI/4) = 1
    if let CellValue::Number(n) = FnCot.call(&[num(std::f64::consts::FRAC_PI_4)]) {
        assert!((n.get() - 1.0).abs() < 1e-10);
    } else {
        panic!("Expected number");
    }
}

#[test]
fn test_cot_basic() {
    let r = reg();
    // COT(pi/4) = 1/tan(pi/4) = 1
    assert_close(r.call("COT", &[num(FRAC_PI_4)]), 1.0);
}

#[test]
fn test_cot_zero_div0() {
    let r = reg();
    // COT(0) -> sin(0)=0 -> #DIV/0!
    assert_is_err(r.call("COT", &[num(0.0)]), CellError::Div0);
}

// -- ACOT -------------------------------------------------------------

#[test]
fn test_csc_basic() {
    let r = reg();
    // CSC(pi/2) = 1/sin(pi/2) = 1
    assert_close(r.call("CSC", &[num(FRAC_PI_2)]), 1.0);
}

// -- Hyperbolic functions ---------------------------------------------

#[test]
fn test_degrees() {
    let r = reg();
    assert_close(r.call("DEGREES", &[num(PI)]), 180.0);
    assert_close(r.call("DEGREES", &[num(0.0)]), 0.0);
    assert_close(r.call("DEGREES", &[num(FRAC_PI_2)]), 90.0);
}

#[test]
fn test_degrees_radians() {
    if let CellValue::Number(n) = FnDegrees.call(&[num(std::f64::consts::PI)]) {
        assert!((n.get() - 180.0).abs() < 1e-10);
    } else {
        panic!("Expected number");
    }
    if let CellValue::Number(n) = FnRadians.call(&[num(180.0)]) {
        assert!((n.get() - std::f64::consts::PI).abs() < 1e-10);
    } else {
        panic!("Expected number");
    }
}

#[test]
fn test_degrees_radians_roundtrip() {
    let r = reg();
    for x in [0.0, 45.0, 90.0, 180.0, 360.0, -30.0] {
        let rad = r.call("RADIANS", &[num(x)]);
        let back = r.call("DEGREES", &[rad]);
        assert_close(back, x);
    }
}

#[test]
fn test_pythagorean_identity() {
    let r = reg();
    for x in [0.0, 0.5, 1.0, 1.5, 2.0, PI, 2.7, -1.3] {
        let sin_val = match r.call("SIN", &[num(x)]) {
            CellValue::Number(n) => f64::from(n),
            other => panic!("SIN({x}) failed: {other:?}"),
        };
        let cos_val = match r.call("COS", &[num(x)]) {
            CellValue::Number(n) => f64::from(n),
            other => panic!("COS({x}) failed: {other:?}"),
        };
        let sum = sin_val * sin_val + cos_val * cos_val;
        assert!(
            (sum - 1.0).abs() < TOL,
            "sin^2({x}) + cos^2({x}) = {sum}, expected 1.0"
        );
    }
}

// -- Hyperbolic identity: cosh^2(x) - sinh^2(x) = 1 ------------------

#[test]
fn test_radians() {
    let r = reg();
    assert_close(r.call("RADIANS", &[num(180.0)]), PI);
    assert_close(r.call("RADIANS", &[num(0.0)]), 0.0);
    assert_close(r.call("RADIANS", &[num(90.0)]), FRAC_PI_2);
}

// -- COT --------------------------------------------------------------

#[test]
fn test_sec_basic() {
    let r = reg();
    // SEC(0) = 1/cos(0) = 1
    assert_close(r.call("SEC", &[num(0.0)]), 1.0);
}

// -- CSC --------------------------------------------------------------

#[test]
fn test_sec_csc() {
    // SEC(0) = 1/cos(0) = 1
    assert_eq!(FnSec.call(&[num(0.0)]), num(1.0));
    // CSC(PI/2) = 1/sin(PI/2) = 1
    if let CellValue::Number(n) = FnCsc.call(&[num(std::f64::consts::FRAC_PI_2)]) {
        assert!((n.get() - 1.0).abs() < 1e-10);
    } else {
        panic!("Expected number");
    }
}

// --- Tests for hyperbolic functions ---

#[test]
fn test_sin_cardinal_points() {
    let r = reg();
    assert_close(r.call("SIN", &[num(0.0)]), 0.0);
    assert_close(r.call("SIN", &[num(FRAC_PI_2)]), 1.0);
    assert_close(r.call("SIN", &[num(PI)]), 0.0);
    assert_close(r.call("SIN", &[num(3.0 * FRAC_PI_2)]), -1.0);
}

// -- COS --------------------------------------------------------------

#[test]
fn test_sin_cos_tan() {
    assert_eq!(FnSin.call(&[num(0.0)]), num(0.0));
    assert_eq!(FnCos.call(&[num(0.0)]), num(1.0));
    assert_eq!(FnTan.call(&[num(0.0)]), num(0.0));
}

#[test]
fn test_tan_basic() {
    let r = reg();
    assert_close(r.call("TAN", &[num(0.0)]), 0.0);
    assert_close(r.call("TAN", &[num(FRAC_PI_4)]), 1.0);
}

// -- ASIN -------------------------------------------------------------
