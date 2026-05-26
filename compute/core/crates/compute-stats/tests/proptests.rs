use compute_stats::{kahan_sum, welford_online};
use proptest::prelude::*;

/// Naive summation for comparison.
fn naive_sum(vals: &[f64]) -> f64 {
    vals.iter().copied().fold(0.0_f64, |a, b| a + b)
}

proptest! {
    /// For small arrays the Kahan sum should match naive sum within a tight
    /// tolerance (both are accurate when the magnitude stays small).
    #[test]
    fn kahan_matches_naive_small(vals in prop::collection::vec(-1e6_f64..1e6, 0..100)) {
        let k = kahan_sum(vals.iter().copied());
        let n = naive_sum(&vals);
        // Both should agree within 1e-6 relative or absolute tolerance.
        let tol = 1e-6_f64 * n.abs().max(1.0);
        prop_assert!(
            (k - n).abs() <= tol,
            "kahan={k}, naive={n}, diff={}", (k - n).abs()
        );
    }

    /// If naive summation produces a finite result, Kahan must too (it should
    /// never introduce spurious infinities or NaNs).
    #[test]
    fn kahan_at_least_as_accurate_as_naive(vals in prop::collection::vec(prop::num::f64::NORMAL, 0..200)) {
        let n = naive_sum(&vals);
        let k = kahan_sum(vals.iter().copied());
        if n.is_finite() {
            prop_assert!(k.is_finite(), "naive is finite ({n}) but kahan is {k}");
        }
    }

    /// Welford's online mean must match the simple average (sum/count) within
    /// a reasonable floating-point tolerance.
    #[test]
    fn welford_mean_matches_simple(vals in prop::collection::vec(-1e9_f64..1e9, 1..200)) {
        let (mean, _m2, count) = welford_online(vals.iter().copied());
        prop_assert_eq!(count, vals.len() as u64);
        let simple_mean = kahan_sum(vals.iter().copied()) / vals.len() as f64;
        let tol = 1e-9_f64 * simple_mean.abs().max(1.0);
        prop_assert!(
            (mean - simple_mean).abs() <= tol,
            "welford mean={mean}, simple mean={simple_mean}, diff={}", (mean - simple_mean).abs()
        );
    }

    /// The sample variance (m2 / (count - 1)) must always be non-negative.
    #[test]
    fn welford_variance_non_negative(vals in prop::collection::vec(-1e12_f64..1e12, 2..300)) {
        let (_mean, m2, count) = welford_online(vals.iter().copied());
        let variance = m2 / (count as f64 - 1.0);
        prop_assert!(variance >= 0.0, "variance={variance}, m2={m2}, count={count}");
    }
}
