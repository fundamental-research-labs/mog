//! Compensated (Kahan) summation for accurate floating-point accumulation.

/// Accumulator that tracks and compensates for floating-point rounding errors.
///
/// Standard `sum += x` accumulates O(n·ε) error over *n* additions.
/// `KahanSum` keeps a running compensation term, reducing total error to O(ε)
/// regardless of the number of terms.
///
/// # Example
/// ```
/// use value_types::KahanSum;
///
/// let mut acc = KahanSum::new();
/// acc.add(1e15);
/// acc.add(1.0);
/// acc.add(-1e15);
/// assert_eq!(acc.total(), 1.0);
/// ```
#[derive(Clone, Debug)]
pub struct KahanSum {
    sum: f64,
    c: f64, // compensation for lost low-order bits
}

impl KahanSum {
    /// Create a new accumulator starting at zero.
    #[inline]
    #[must_use]
    pub const fn new() -> Self {
        Self { sum: 0.0, c: 0.0 }
    }

    /// Add a value with compensation.
    #[inline]
    pub fn add(&mut self, x: f64) {
        let y = x - self.c;
        let t = self.sum + y;
        self.c = (t - self.sum) - y;
        self.sum = t;
    }

    /// Return the accumulated total.
    #[inline]
    #[must_use]
    pub fn total(&self) -> f64 {
        self.sum
    }
}

impl Default for KahanSum {
    fn default() -> Self {
        Self::new()
    }
}

/// Compute a compensated sum over an iterator of `f64` values.
///
/// ```
/// use value_types::kahan_sum;
///
/// // Without Kahan: 1e15 + 1.0 - 1e15 might yield 0.0 due to catastrophic
/// // cancellation.  With Kahan the result is exactly 1.0.
/// let result = kahan_sum([1e15, 1.0, -1e15].iter().copied());
/// assert_eq!(result, 1.0);
/// ```
#[inline]
#[must_use]
pub fn kahan_sum(iter: impl Iterator<Item = f64>) -> f64 {
    let mut acc = KahanSum::new();
    for x in iter {
        acc.add(x);
    }
    acc.total()
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;

    #[test]
    fn catastrophic_cancellation() {
        let result = kahan_sum([1e15, 1.0, -1e15].iter().copied());
        assert_eq!(result, 1.0);
    }

    #[test]
    fn many_small_terms() {
        // 10_000 additions of 0.1 — naive sum drifts, Kahan stays accurate.
        let result = kahan_sum(std::iter::repeat_n(0.1, 10_000));
        assert!((result - 1000.0).abs() < 1e-10);
    }

    #[test]
    fn empty_iterator() {
        assert_eq!(kahan_sum(std::iter::empty()), 0.0);
    }

    #[test]
    fn accumulator_api() {
        let mut acc = KahanSum::new();
        acc.add(1e15);
        acc.add(1.0);
        acc.add(-1e15);
        assert_eq!(acc.total(), 1.0);
    }
}
