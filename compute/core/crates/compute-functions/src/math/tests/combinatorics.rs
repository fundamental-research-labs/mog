use super::super::combinatorics::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::CellError;

#[test]
fn test_combin() {
    assert_eq!(FnCombin.call(&[num(5.0), num(2.0)]), num(10.0));
    assert_eq!(FnCombin.call(&[num(10.0), num(3.0)]), num(120.0));
    assert_eq!(FnCombin.call(&[num(5.0), num(0.0)]), num(1.0));
    assert_eq!(FnCombin.call(&[num(5.0), num(5.0)]), num(1.0));
    assert_eq!(FnCombin.call(&[num(3.0), num(5.0)]), err(CellError::Num));
}

#[test]
fn test_combina() {
    // COMBINA(4, 3) = COMBIN(6, 3) = 20
    assert_eq!(FnCombinA.call(&[num(4.0), num(3.0)]), num(20.0));
}

#[test]
fn test_fact() {
    assert_eq!(FnFact.call(&[num(0.0)]), num(1.0));
    assert_eq!(FnFact.call(&[num(1.0)]), num(1.0));
    assert_eq!(FnFact.call(&[num(5.0)]), num(120.0));
    assert_eq!(FnFact.call(&[num(10.0)]), num(3628800.0));
    assert_eq!(FnFact.call(&[num(-1.0)]), err(CellError::Num));
}

#[test]
fn test_factdouble() {
    assert_eq!(FnFactDouble.call(&[num(0.0)]), num(1.0));
    assert_eq!(FnFactDouble.call(&[num(1.0)]), num(1.0));
    assert_eq!(FnFactDouble.call(&[num(5.0)]), num(15.0)); // 5*3*1
    assert_eq!(FnFactDouble.call(&[num(6.0)]), num(48.0)); // 6*4*2
}

#[test]
fn test_factdouble_negative_one() {
    // (-1)!! = 1 by convention (base case of double factorial)
    assert_eq!(FnFactDouble.call(&[num(-1.0)]), num(1.0));
}

#[test]
fn test_factdouble_negative_two_is_error() {
    // FACTDOUBLE(-2) should be #NUM!
    assert_eq!(FnFactDouble.call(&[num(-2.0)]), err(CellError::Num));
}

// ---- FIX 4: ROMAN form parameter ----

#[test]
fn test_gcd() {
    assert_eq!(FnGcd.call(&[num(12.0), num(8.0)]), num(4.0));
    assert_eq!(FnGcd.call(&[num(7.0), num(5.0)]), num(1.0));
    assert_eq!(FnGcd.call(&[num(24.0), num(36.0), num(48.0)]), num(12.0));
}

#[test]
fn test_lcm() {
    assert_eq!(FnLcm.call(&[num(4.0), num(6.0)]), num(12.0));
    assert_eq!(FnLcm.call(&[num(3.0), num(5.0)]), num(15.0));
    assert_eq!(FnLcm.call(&[num(0.0), num(5.0)]), num(0.0));
}

#[test]
fn test_multinomial() {
    // MULTINOMIAL(2, 3, 4) = 9!/(2!*3!*4!) = 362880/(2*6*24) = 1260
    assert_eq!(
        FnMultinomial.call(&[num(2.0), num(3.0), num(4.0)]),
        num(1260.0)
    );
}

// --- Tests for additional math ---

#[test]
fn test_permut() {
    // PERMUT(5, 2) = 5*4 = 20
    assert_eq!(FnPermut.call(&[num(5.0), num(2.0)]), num(20.0));
    assert_eq!(FnPermut.call(&[num(5.0), num(0.0)]), num(1.0));
}

#[test]
fn test_permutationa() {
    // PERMUTATIONA(3, 2) = 3^2 = 9
    assert_eq!(FnPermutationA.call(&[num(3.0), num(2.0)]), num(9.0));
}
