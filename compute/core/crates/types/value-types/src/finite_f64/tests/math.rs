use super::super::*;

#[test]
fn checked_add_basic() {
    let a = FiniteF64::must(2.0);
    let b = FiniteF64::must(3.0);
    assert_eq!(a.checked_add(b).unwrap().get(), 5.0);
}

#[test]
fn checked_sub_basic() {
    let a = FiniteF64::must(10.0);
    let b = FiniteF64::must(3.0);
    assert_eq!(a.checked_sub(b).unwrap().get(), 7.0);
}

#[test]
fn checked_mul_basic() {
    let a = FiniteF64::must(2.0);
    let b = FiniteF64::must(3.0);
    assert_eq!(a.checked_mul(b).unwrap().get(), 6.0);
}

#[test]
fn checked_div_basic() {
    let a = FiniteF64::must(6.0);
    let b = FiniteF64::must(2.0);
    assert_eq!(a.checked_div(b).unwrap().get(), 3.0);
}

#[test]
fn checked_rem_basic() {
    let a = FiniteF64::must(7.0);
    let b = FiniteF64::must(3.0);
    assert_eq!(a.checked_rem(b).unwrap().get(), 1.0);
}

#[test]
fn checked_add_overflow_returns_none() {
    let big = FiniteF64::must(f64::MAX);
    assert!(big.checked_add(big).is_none());
}

#[test]
fn checked_sub_overflow_returns_none() {
    let big = FiniteF64::must(f64::MAX);
    let neg_big = FiniteF64::must(-f64::MAX);
    assert!(big.checked_sub(neg_big).is_none());
}

#[test]
fn checked_mul_overflow_returns_none() {
    let big = FiniteF64::must(f64::MAX);
    let two = FiniteF64::must(2.0);
    assert!(big.checked_mul(two).is_none());
}

#[test]
fn checked_div_by_zero_returns_none() {
    let a = FiniteF64::must(6.0);
    assert!(a.checked_div(FiniteF64::ZERO).is_none());
}

#[test]
fn checked_div_zero_by_zero_returns_none() {
    assert!(FiniteF64::ZERO.checked_div(FiniteF64::ZERO).is_none());
}

#[test]
fn checked_rem_by_zero_returns_none() {
    let a = FiniteF64::must(7.0);
    assert!(a.checked_rem(FiniteF64::ZERO).is_none());
}

#[test]
fn checked_add_subnormal() {
    // Very small (subnormal) numbers should still produce finite results
    let tiny = FiniteF64::must(5e-324);
    let result = tiny.checked_add(tiny);
    assert!(result.is_some());
}

#[test]
fn checked_mul_subnormal_underflow() {
    // Subnormal * subnormal → 0.0 (underflow), which is finite
    let tiny = FiniteF64::must(5e-324);
    let result = tiny.checked_mul(tiny);
    assert!(result.is_some());
    assert_eq!(result.unwrap().get(), 0.0);
}

#[test]
fn finite_abs_positive() {
    assert_eq!(FiniteF64::must(5.0).finite_abs().get(), 5.0);
}

#[test]
fn finite_abs_negative() {
    assert_eq!(FiniteF64::must(-5.0).finite_abs().get(), 5.0);
}

#[test]
fn finite_abs_dd_preserves_sign_of_lo() {
    // For double-double: abs(val=-3.0, lo=+1e-16) represents abs(-3.0 + 1e-16)
    // = abs(-2.999...) = 2.999... = (val=3.0, lo=-1e-16), NOT (3.0, +1e-16)
    let v = FiniteF64::with_dd(-3.0, 1e-16).unwrap();
    let abs_v = v.finite_abs();
    assert_eq!(abs_v.get(), 3.0);
    #[cfg(feature = "dd-precision")]
    assert_eq!(abs_v.lo(), -1e-16, "lo must negate, not abs");
}

#[test]
fn finite_abs_positive_dd_unchanged() {
    // Positive values should pass through unchanged, including lo
    let v = FiniteF64::with_dd(3.0, -1e-16).unwrap();
    let abs_v = v.finite_abs();
    assert_eq!(abs_v.get(), 3.0);
    #[cfg(feature = "dd-precision")]
    assert_eq!(abs_v.lo(), -1e-16, "positive val: lo must not change");
}

#[test]
fn finite_abs_zero() {
    assert_eq!(FiniteF64::must(0.0).finite_abs().get(), 0.0);
}

#[test]
fn finite_min_basic() {
    let a = FiniteF64::must(3.0);
    let b = FiniteF64::must(5.0);
    assert_eq!(a.finite_min(b).get(), 3.0);
    assert_eq!(b.finite_min(a).get(), 3.0);
}

#[test]
fn finite_min_equal() {
    let a = FiniteF64::must(3.0);
    assert_eq!(a.finite_min(a).get(), 3.0);
}

#[test]
fn finite_min_negative() {
    let a = FiniteF64::must(-10.0);
    let b = FiniteF64::must(5.0);
    assert_eq!(a.finite_min(b).get(), -10.0);
}

#[test]
fn finite_max_basic() {
    let a = FiniteF64::must(3.0);
    let b = FiniteF64::must(5.0);
    assert_eq!(a.finite_max(b).get(), 5.0);
    assert_eq!(b.finite_max(a).get(), 5.0);
}

#[test]
fn finite_max_equal() {
    let a = FiniteF64::must(3.0);
    assert_eq!(a.finite_max(a).get(), 3.0);
}

#[test]
fn finite_max_negative() {
    let a = FiniteF64::must(-10.0);
    let b = FiniteF64::must(5.0);
    assert_eq!(a.finite_max(b).get(), 5.0);
}

#[test]
fn checked_sqrt_positive() {
    assert_eq!(FiniteF64::must(9.0).checked_sqrt().unwrap().get(), 3.0);
}

#[test]
fn checked_sqrt_zero() {
    assert_eq!(FiniteF64::must(0.0).checked_sqrt().unwrap().get(), 0.0);
}

#[test]
fn checked_sqrt_negative_returns_none() {
    assert!(FiniteF64::must(-1.0).checked_sqrt().is_none());
}

#[test]
fn checked_sqrt_fractional() {
    let v = FiniteF64::must(2.0).checked_sqrt().unwrap();
    let expected = std::f64::consts::SQRT_2;
    assert!((v.get() - expected).abs() < 1e-15);
}

#[test]
fn checked_pow_basic() {
    let base = FiniteF64::must(2.0);
    let exp = FiniteF64::must(10.0);
    assert_eq!(base.checked_pow(exp).unwrap().get(), 1024.0);
}

#[test]
fn checked_pow_zero_exponent() {
    let base = FiniteF64::must(5.0);
    assert_eq!(base.checked_pow(FiniteF64::ZERO).unwrap().get(), 1.0);
}

#[test]
fn checked_pow_overflow_returns_none() {
    let big = FiniteF64::must(f64::MAX);
    assert!(big.checked_pow(FiniteF64::must(2.0)).is_none());
}

#[test]
fn checked_pow_negative_base_fractional_exp_returns_none() {
    assert!(
        FiniteF64::must(-1.0)
            .checked_pow(FiniteF64::must(0.5))
            .is_none()
    );
}
