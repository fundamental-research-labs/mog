use super::super::*;

#[test]
fn neg_positive() {
    let v = FiniteF64::must(5.0);
    assert_eq!((-v).get(), -5.0);
}

#[test]
fn neg_negative() {
    let v = FiniteF64::must(-5.0);
    assert_eq!((-v).get(), 5.0);
}

#[test]
fn neg_zero_is_positive_zero() {
    let v = FiniteF64::ZERO;
    let neg = -v;
    // Must normalize to +0.0
    assert_eq!(neg.get().to_bits(), 0.0_f64.to_bits());
}

#[test]
fn add_operator() {
    let a = FiniteF64::must(2.0);
    let b = FiniteF64::must(3.0);
    assert_eq!((a + b).unwrap().get(), 5.0);
}

#[test]
fn sub_operator() {
    let a = FiniteF64::must(10.0);
    let b = FiniteF64::must(3.0);
    assert_eq!((a - b).unwrap().get(), 7.0);
}

#[test]
fn mul_operator() {
    let a = FiniteF64::must(2.0);
    let b = FiniteF64::must(3.0);
    assert_eq!((a * b).unwrap().get(), 6.0);
}

#[test]
fn div_operator() {
    let a = FiniteF64::must(6.0);
    let b = FiniteF64::must(2.0);
    assert_eq!((a / b).unwrap().get(), 3.0);
}

#[test]
fn rem_operator() {
    let a = FiniteF64::must(7.0);
    let b = FiniteF64::must(3.0);
    assert_eq!((a % b).unwrap().get(), 1.0);
}

#[test]
fn add_operator_overflow() {
    let big = FiniteF64::must(f64::MAX);
    assert!((big + big).is_none());
}

#[test]
fn div_operator_nan_result() {
    assert!((FiniteF64::ZERO / FiniteF64::ZERO).is_none());
}
