use super::super::*;

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

#[test]
fn new_finite_succeeds() {
    assert!(FiniteF64::new(1.0).is_some());
    assert!(FiniteF64::new(-1.0).is_some());
    assert!(FiniteF64::new(0.0).is_some());
    assert!(FiniteF64::new(f64::MIN).is_some());
    assert!(FiniteF64::new(f64::MAX).is_some());
    assert!(FiniteF64::new(f64::MIN_POSITIVE).is_some());
}

#[test]
fn new_nan_fails() {
    assert!(FiniteF64::new(f64::NAN).is_none());
}

#[test]
fn new_infinity_fails() {
    assert!(FiniteF64::new(f64::INFINITY).is_none());
}

#[test]
fn new_neg_infinity_fails() {
    assert!(FiniteF64::new(f64::NEG_INFINITY).is_none());
}

#[test]
fn new_zero_succeeds() {
    assert!(FiniteF64::new(0.0).is_some());
    assert_eq!(FiniteF64::new(0.0).unwrap().get(), 0.0);
}

#[test]
fn new_neg_zero_succeeds() {
    assert!(FiniteF64::new(-0.0).is_some());
}

#[test]
#[should_panic(expected = "non-finite value")]
fn must_nan_panics() {
    let _ = FiniteF64::must(f64::NAN);
}

#[test]
#[should_panic(expected = "non-finite value")]
fn must_infinity_panics() {
    let _ = FiniteF64::must(f64::INFINITY);
}

#[test]
#[should_panic(expected = "non-finite value")]
fn must_neg_infinity_panics() {
    let _ = FiniteF64::must(f64::NEG_INFINITY);
}

#[test]
fn get_returns_inner() {
    let v = FiniteF64::new(99.9).unwrap();
    assert_eq!(v.get(), 99.9);
}

#[test]
fn must_neg_zero_normalizes() {
    // must() must normalize -0.0, same as new()
    let v = FiniteF64::must(-0.0);
    assert_eq!(
        v.get().to_bits(),
        0.0_f64.to_bits(),
        "must(-0.0) should normalize to +0.0"
    );
}

#[test]
fn must_neg_zero_eq_ord_hash_consistent() {
    // The contract: if a == b, then hash(a) == hash(b) and a.cmp(b) == Equal
    use std::collections::{BTreeSet, HashSet};
    let pos = FiniteF64::must(0.0);
    let neg = FiniteF64::must(-0.0);

    // Eq
    assert_eq!(pos, neg);

    // Hash
    let mut h1 = DefaultHasher::new();
    let mut h2 = DefaultHasher::new();
    pos.hash(&mut h1);
    neg.hash(&mut h2);
    assert_eq!(
        h1.finish(),
        h2.finish(),
        "equal values must have equal hashes"
    );

    // Ord
    assert_eq!(
        pos.cmp(&neg),
        std::cmp::Ordering::Equal,
        "equal values must compare Equal"
    );

    // Collections must not keep duplicates
    let mut hset = HashSet::new();
    hset.insert(pos);
    hset.insert(neg);
    assert_eq!(hset.len(), 1, "HashSet must deduplicate ±0");

    let mut bset = BTreeSet::new();
    bset.insert(pos);
    bset.insert(neg);
    assert_eq!(bset.len(), 1, "BTreeSet must deduplicate ±0");
}

#[test]
fn with_dd_neg_zero_normalizes() {
    let v = FiniteF64::with_dd(-0.0, 0.0).unwrap();
    assert_eq!(
        v.get().to_bits(),
        0.0_f64.to_bits(),
        "with_dd(-0.0, _) should normalize to +0.0"
    );
}

#[test]
fn with_dd_rejects_non_finite_lo() {
    assert!(
        FiniteF64::with_dd(1.0, f64::NAN).is_none(),
        "NaN lo must be rejected"
    );
    assert!(
        FiniteF64::with_dd(1.0, f64::INFINITY).is_none(),
        "Infinity lo must be rejected"
    );
    assert!(
        FiniteF64::with_dd(1.0, f64::NEG_INFINITY).is_none(),
        "-Infinity lo must be rejected"
    );
}

#[test]
fn lo_returns_zero_without_feature() {
    let v = FiniteF64::new(42.0).unwrap();
    // Without dd-precision feature, lo is always 0
    // With dd-precision, lo is 0 for newly-constructed values
    assert_eq!(v.lo(), 0.0);
}

#[test]
fn with_dd_stores_error_term() {
    let v = FiniteF64::with_dd(42.0, 1e-16).unwrap();
    assert_eq!(v.get(), 42.0);
    #[cfg(feature = "dd-precision")]
    assert_eq!(v.lo(), 1e-16);
    #[cfg(not(feature = "dd-precision"))]
    assert_eq!(v.lo(), 0.0);
}

#[test]
fn to_f64x2_roundtrip() {
    let v = FiniteF64::with_dd(42.0, 1e-16).unwrap();
    let dd = v.to_f64x2();
    assert_eq!(dd.hi(), 42.0);
    #[cfg(feature = "dd-precision")]
    assert_eq!(dd.lo(), 1e-16);

    let v2 = FiniteF64::from_f64x2(dd).unwrap();
    assert_eq!(v2.get(), 42.0);
}

#[test]
fn constants() {
    assert_eq!(FiniteF64::ZERO.get(), 0.0);
    assert_eq!(FiniteF64::ONE.get(), 1.0);
}
