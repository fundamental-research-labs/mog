use super::super::*;

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

#[test]
fn eq_same_values() {
    assert_eq!(FiniteF64::new(1.0).unwrap(), FiniteF64::new(1.0).unwrap());
    assert_eq!(FiniteF64::new(42.5).unwrap(), FiniteF64::new(42.5).unwrap());
}

#[test]
fn ne_different_values() {
    assert_ne!(FiniteF64::new(1.0).unwrap(), FiniteF64::new(2.0).unwrap());
}

#[test]
fn ord_ordering() {
    let a = FiniteF64::new(0.0).unwrap();
    let b = FiniteF64::new(1.0).unwrap();
    let c = FiniteF64::new(-1.0).unwrap();
    assert!(b > a);
    assert!(c < a);
    assert!(a < b);
}

#[test]
fn hash_consistency() {
    let a = FiniteF64::new(3.25).unwrap();
    let b = FiniteF64::new(3.25).unwrap();
    let mut h1 = DefaultHasher::new();
    let mut h2 = DefaultHasher::new();
    a.hash(&mut h1);
    b.hash(&mut h2);
    assert_eq!(h1.finish(), h2.finish());
}

#[test]
fn hash_different_values() {
    let a = FiniteF64::new(1.0).unwrap();
    let b = FiniteF64::new(2.0).unwrap();
    let mut h1 = DefaultHasher::new();
    let mut h2 = DefaultHasher::new();
    a.hash(&mut h1);
    b.hash(&mut h2);
    // Very unlikely to collide but technically possible; this is a sanity check
    assert_ne!(h1.finish(), h2.finish());
}

#[test]
fn partial_ord_consistent_with_ord() {
    let a = FiniteF64::new(1.0).unwrap();
    let b = FiniteF64::new(2.0).unwrap();
    assert_eq!(a.partial_cmp(&b), Some(std::cmp::Ordering::Less));
    assert_eq!(a.cmp(&b), std::cmp::Ordering::Less);
}

#[test]
fn hashset_works() {
    use std::collections::HashSet;
    let mut set = HashSet::new();
    set.insert(FiniteF64::new(1.0).unwrap());
    set.insert(FiniteF64::new(1.0).unwrap());
    assert_eq!(set.len(), 1);
    set.insert(FiniteF64::new(2.0).unwrap());
    assert_eq!(set.len(), 2);
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
fn eq_ignores_lo() {
    let a = FiniteF64::with_dd(42.0, 1e-16).unwrap();
    let b = FiniteF64::with_dd(42.0, 2e-16).unwrap();
    // Eq only compares val, not lo
    assert_eq!(a, b);
}
