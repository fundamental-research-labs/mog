use super::super::basic::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_abs() {
    let f = FnAbs;
    assert_eq!(f.call(&[num(-5.0)]), num(5.0));
    assert_eq!(f.call(&[num(5.0)]), num(5.0));
    assert_eq!(f.call(&[num(0.0)]), num(0.0));
}

#[test]
fn test_countblank() {
    let arr = CellValue::from_rows(vec![vec![num(1.0), null(), text(""), num(3.0), null()]]);
    assert_eq!(FnCountBlank.call(&[arr]), num(3.0));
}

#[test]
fn test_mod() {
    let f = FnMod;
    assert_eq!(f.call(&[num(7.0), num(3.0)]), num(1.0));
    assert_eq!(f.call(&[num(7.0), num(0.0)]), err(CellError::Div0));
    // Excel MOD: sign of divisor
    assert_eq!(f.call(&[num(-7.0), num(3.0)]), num(2.0));
}

#[test]
fn test_mod_normal_cases_unaffected() {
    // Normal MOD cases should still work correctly
    assert_eq!(FnMod.call(&[num(7.0), num(3.0)]), num(1.0));
    assert_eq!(FnMod.call(&[num(10.0), num(3.0)]), num(1.0));
    // MOD with zero divisor
    assert_eq!(FnMod.call(&[num(1.0), num(0.0)]), err(CellError::Div0));
}

#[test]
fn test_mod_precision_limit_num_error() {
    // MOD(1, 1E-307): quotient = 1E+307 > 2^53 => #NUM!

    assert_eq!(FnMod.call(&[num(1.0), num(1e-307)]), err(CellError::Num));
    // MOD(42.5, 1E-307): quotient = 4.25E+308 > 2^53 => #NUM!
    assert_eq!(FnMod.call(&[num(42.5), num(1e-307)]), err(CellError::Num));
    // MOD(-1, 1E-307): quotient = -1E+307 > 2^53 => #NUM!
    assert_eq!(FnMod.call(&[num(-1.0), num(1e-307)]), err(CellError::Num));
}

#[test]
fn test_pi() {
    let f = FnPi;
    assert_eq!(f.call(&[]), num(std::f64::consts::PI));
}

#[test]
fn test_product() {
    let f = FnProduct;
    assert_eq!(f.call(&[num(2.0), num(3.0), num(4.0)]), num(24.0));
}

#[test]
fn test_quotient() {
    assert_eq!(FnQuotient.call(&[num(7.0), num(3.0)]), num(2.0));
    assert_eq!(FnQuotient.call(&[num(-7.0), num(3.0)]), num(-2.0));
    assert_eq!(FnQuotient.call(&[num(7.0), num(0.0)]), err(CellError::Div0));
}

#[test]
fn test_sign() {
    let f = FnSign;
    assert_eq!(f.call(&[num(5.0)]), num(1.0));
    assert_eq!(f.call(&[num(-5.0)]), num(-1.0));
    assert_eq!(f.call(&[num(0.0)]), num(0.0));
}
