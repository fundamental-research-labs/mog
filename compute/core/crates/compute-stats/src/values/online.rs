/// Welford's online algorithm for numerically stable mean and variance.
///
/// Single-pass over any `f64` iterator.  Returns `(mean, m2, count)` where:
/// - `population_variance = m2 / count`
/// - `sample_variance = m2 / (count - 1)`
///
/// Returns `(0.0, 0.0, 0)` for empty iterators.
///
/// # Example
///
/// ```
/// use compute_stats::welford_online;
///
/// let (mean, m2, count) = welford_online([1.0, 2.0, 3.0, 4.0, 5.0].iter().copied());
/// assert_eq!(count, 5);
/// assert!((mean - 3.0).abs() < 1e-10);
/// // population variance = m2 / count = 2.0
/// assert!((m2 / count as f64 - 2.0).abs() < 1e-10);
/// ```
#[allow(clippy::cast_precision_loss)]
pub fn welford_online(iter: impl Iterator<Item = f64>) -> (f64, f64, u64) {
    let mut count: u64 = 0;
    let mut mean = 0.0_f64;
    let mut m2 = 0.0_f64;
    for x in iter {
        count += 1;
        let delta = x - mean;
        mean += delta / count as f64;
        let delta2 = x - mean;
        m2 += delta * delta2;
    }
    (mean, m2, count)
}

// Re-export from value-types — the single canonical implementation.
pub use value_types::kahan_sum;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_welford_empty() {
        let (mean, m2, count) = welford_online(std::iter::empty());
        assert_eq!(count, 0);
        assert_eq!(mean, 0.0);
        assert_eq!(m2, 0.0);
    }

    #[test]
    fn test_welford_single() {
        let (mean, m2, count) = welford_online(std::iter::once(42.0));
        assert_eq!(count, 1);
        assert_eq!(mean, 42.0);
        assert_eq!(m2, 0.0);
    }

    #[test]
    fn test_welford_basic() {
        let (mean, m2, count) = welford_online([1.0, 2.0, 3.0, 4.0, 5.0].iter().copied());
        assert_eq!(count, 5);
        assert!((mean - 3.0).abs() < 1e-10);
        assert!((m2 / count as f64 - 2.0).abs() < 1e-10);
    }

    #[test]
    fn test_welford_large_offset() {
        let (mean, m2, count) =
            welford_online([1e15 + 1.0, 1e15 + 2.0, 1e15 + 3.0].iter().copied());
        assert_eq!(count, 3);
        assert!((mean - (1e15 + 2.0)).abs() < 1e-6);
        assert!((m2 / (count - 1) as f64 - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_welford_known_variance() {
        let data = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0];
        let (mean, m2, count) = welford_online(data.iter().copied());
        assert_eq!(count, 8);
        assert!((mean - 5.0).abs() < 1e-10);
        assert!((m2 / count as f64 - 4.0).abs() < 1e-10);
    }

    #[test]
    fn test_welford_1_to_5_exact() {
        let (mean, m2, count) = welford_online([1.0, 2.0, 3.0, 4.0, 5.0].iter().copied());
        assert_eq!(count, 5);
        assert!((mean - 3.0).abs() < 1e-10);
        assert!((m2 - 10.0).abs() < 1e-10);
    }

    #[test]
    fn test_welford_single_value_7() {
        let (mean, m2, count) = welford_online(std::iter::once(7.0));
        assert_eq!(count, 1);
        assert_eq!(mean, 7.0);
        assert_eq!(m2, 0.0);
    }

    #[test]
    fn test_welford_two_values_3_7() {
        let (mean, m2, count) = welford_online([3.0, 7.0].iter().copied());
        assert_eq!(count, 2);
        assert!((mean - 5.0).abs() < 1e-10);
        assert!((m2 - 8.0).abs() < 1e-10);
    }

    #[test]
    fn test_kahan_sum_catastrophic_cancellation() {
        let result = kahan_sum([1e15, 1.0, -1e15].iter().copied());
        assert_eq!(result, 1.0);
    }

    #[test]
    fn test_kahan_sum_many_small_values() {
        let result = kahan_sum(std::iter::repeat(1e-7).take(1_000_000));
        assert!((result - 0.1).abs() < 1e-10, "Expected ~0.1, got {result}");
    }
}
