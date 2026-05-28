use super::super::*;

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use proptest::prelude::*;

proptest! {
    // Any finite f64 should round-trip through FiniteF64
    #[test]
    fn prop_new_accepts_all_finite(x in prop::num::f64::NORMAL | prop::num::f64::SUBNORMAL | prop::num::f64::ZERO) {
        prop_assert!(FiniteF64::new(x).is_some());
    }

    // NaN/Inf are always rejected
    #[test]
    fn prop_new_rejects_non_finite(x in prop::num::f64::ANY.prop_filter("non-finite", |x| !x.is_finite())) {
        prop_assert!(FiniteF64::new(x).is_none());
    }

    // Eq is reflexive
    #[test]
    fn prop_eq_reflexive(x in prop::num::f64::NORMAL) {
        if let Some(v) = FiniteF64::new(x) {
            prop_assert_eq!(v, v);
        }
    }

    // Hash consistency: equal values have equal hashes
    #[test]
    fn prop_hash_consistent_with_eq(x in prop::num::f64::NORMAL) {
        if let Some(a) = FiniteF64::new(x) {
            if let Some(b) = FiniteF64::new(x) {
                let mut h1 = DefaultHasher::new();
                let mut h2 = DefaultHasher::new();
                a.hash(&mut h1);
                b.hash(&mut h2);
                prop_assert_eq!(h1.finish(), h2.finish());
            }
        }
    }

    // Serde JSON roundtrip: serialize to JSON and parse back.
    // JSON text encoding can introduce up to a few ULPs of error at any
    // magnitude, so we check: (a) the result is a valid FiniteF64, and
    // (b) the relative error is negligible (< 1e-15).
    #[test]
    fn prop_serde_roundtrip(x in prop::num::f64::NORMAL) {
        if let Some(v) = FiniteF64::new(x) {
            let json = serde_json::to_string(&v).unwrap();
            let v2: FiniteF64 = serde_json::from_str(&json).unwrap();
            let a = v.get();
            let b = v2.get();
            let rel_err = if a == 0.0 { b.abs() } else { ((a - b) / a).abs() };
            prop_assert!(rel_err < 1e-15, "rel error {} for x={}", rel_err, x);
        }
    }

    // Ord is total and consistent with PartialOrd
    #[test]
    fn prop_ord_consistent(a_raw in prop::num::f64::NORMAL, b_raw in prop::num::f64::NORMAL) {
        if let (Some(a), Some(b)) = (FiniteF64::new(a_raw), FiniteF64::new(b_raw)) {
            prop_assert_eq!(a.partial_cmp(&b), Some(a.cmp(&b)));
        }
    }

    // -0 normalizes to +0
    #[test]
    fn prop_neg_zero_normalized(x in prop::num::f64::ZERO) {
        if let Some(v) = FiniteF64::new(x) {
            prop_assert_eq!(v.get().to_bits(), 0.0_f64.to_bits());
        }
    }

    // Negation always produces a finite result
    #[test]
    fn prop_neg_always_finite(x in prop::num::f64::NORMAL) {
        if let Some(v) = FiniteF64::new(x) {
            let neg = -v;
            prop_assert!(neg.get().is_finite());
            if x != 0.0 {
                prop_assert_eq!(neg.get(), -x);
            }
        }
    }

    // Double negation is identity
    #[test]
    fn prop_neg_neg_identity(x in prop::num::f64::NORMAL) {
        if let Some(v) = FiniteF64::new(x) {
            prop_assert_eq!(-(-v), v);
        }
    }

    // finite_abs always produces a finite non-negative result
    #[test]
    fn prop_finite_abs_non_negative(x in prop::num::f64::NORMAL) {
        if let Some(v) = FiniteF64::new(x) {
            let abs_v = v.finite_abs();
            prop_assert!(abs_v.get() >= 0.0);
            prop_assert!(abs_v.get().is_finite());
        }
    }

    // finite_min is commutative
    #[test]
    fn prop_finite_min_commutative(a_raw in prop::num::f64::NORMAL, b_raw in prop::num::f64::NORMAL) {
        if let (Some(a), Some(b)) = (FiniteF64::new(a_raw), FiniteF64::new(b_raw)) {
            prop_assert_eq!(a.finite_min(b), b.finite_min(a));
        }
    }

    // finite_max is commutative
    #[test]
    fn prop_finite_max_commutative(a_raw in prop::num::f64::NORMAL, b_raw in prop::num::f64::NORMAL) {
        if let (Some(a), Some(b)) = (FiniteF64::new(a_raw), FiniteF64::new(b_raw)) {
            prop_assert_eq!(a.finite_max(b), b.finite_max(a));
        }
    }

    // checked_add result (when Some) equals raw f64 addition
    #[test]
    fn prop_checked_add_matches_f64(a_raw in -1e100..1e100_f64, b_raw in -1e100..1e100_f64) {
        if let (Some(a), Some(b)) = (FiniteF64::new(a_raw), FiniteF64::new(b_raw)) {
            if let Some(result) = a.checked_add(b) {
                prop_assert_eq!(result.get(), a_raw + b_raw);
            }
        }
    }
}
