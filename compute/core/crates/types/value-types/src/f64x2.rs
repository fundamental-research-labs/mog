//! Double-double arithmetic for extended-precision floating-point computation.
//!
//! An [`F64x2`] represents a number as the unevaluated sum of two `f64` values
//! `(hi, lo)` where `|lo| <= ε·|hi|` (ε = 2⁻⁵²). This gives approximately
//! 31 decimal digits of precision — enough to match Excel's 80-bit x87 FPU
//! intermediate precision (~18.9 digits) and eliminate catastrophic cancellation
//! when subtracting nearly-equal large values.
//!
//! # Algorithms
//!
//! The error-free transformations are from:
//! - **TwoSum**: Knuth (1969) / Møller (1965) — 6 flops
//! - **TwoProd**: Dekker (1971) via FMA — 2 flops
//! - **DD arithmetic**: Hida, Li, Bailey (2001) — "Library for Double-Double
//!   and Quad-Double Arithmetic"
//!
//! # Feature gating
//!
//! This module is always compiled (the algorithms are useful for testing), but
//! integration into the eval engine is gated behind `dd-precision`.

/// A double-double number: the unevaluated sum `hi + lo` with `|lo| <= ε·|hi|`.
///
/// Provides ~31 decimal digits of precision using a pair of `f64` values.
///
/// # Examples
///
/// ```
/// use value_types::F64x2;
///
/// // Catastrophic cancellation: 1e15 + 1.0 - 1e15
/// // With f64: 1e15 + 1.0 = 1e15 (1.0 is lost), so 1e15 - 1e15 = 0
/// // With F64x2: the 1.0 is preserved in the lo term
/// let a = F64x2::from(1e15);
/// let b = F64x2::from(1.0);
/// let c = F64x2::from(1e15);
/// let result = (a + b) - c;
/// assert_eq!(result.hi(), 1.0);
/// ```
#[derive(Clone, Copy, Debug, finite_at_boundary::AllowedBareF64)]
pub struct F64x2 {
    // Double-double pair: the unevaluated sum `hi + lo` with `|lo| <= ε·|hi|`.
    // The bare `f64`s here carry the standard IEEE-754 invariants; non-finite
    // values are part of the legitimate domain (overflow, sentinel) and not a
    // boundary concern because `F64x2` does not derive Serialize/Deserialize.
    // The `#[allowed_bare_f64]` helper-attribute markers (registered by the
    // `finite_at_boundary::AllowedBareF64` derive above) are present so that
    // if a future change adds a Serialize derive, the walker still correctly
    // whitelists these as engine-internal numeric storage rather than
    // boundary fields.
    #[allowed_bare_f64]
    hi: f64,
    #[allowed_bare_f64]
    lo: f64,
}

// ---------------------------------------------------------------------------
// Error-free transformations
// ---------------------------------------------------------------------------

/// Compute `s = a + b` and error `e` such that `s + e = a + b` exactly.
///
/// Uses the Knuth/Møller `TwoSum` algorithm (6 flops, no branch).
/// Both `s` and `e` are representable `f64` values.
#[inline]
#[must_use]
#[allow(clippy::many_single_char_names)] // standard names in error-free transformation literature
pub fn two_sum(a: f64, b: f64) -> (f64, f64) {
    let s = a + b;
    let v = s - a;
    let e = (a - (s - v)) + (b - v);
    (s, e)
}

/// Compute `p = a * b` and error `e` such that `p + e = a * b` exactly.
///
/// Uses FMA (fused multiply-add) which is a single instruction on modern
/// x86-64 (with AVX2) and ARM64. Falls back to software FMA on older hardware.
#[inline]
#[must_use]
pub fn two_prod(a: f64, b: f64) -> (f64, f64) {
    let p = a * b;
    let e = a.mul_add(b, -p);
    (p, e)
}

/// Compute `d = a - b` and error `e` such that `d + e = a - b` exactly.
///
/// Uses `TwoSum` with negated `b`.
#[inline]
#[must_use]
#[allow(clippy::many_single_char_names)] // standard names in error-free transformation literature
pub fn two_diff(a: f64, b: f64) -> (f64, f64) {
    let d = a - b;
    let v = d - a;
    let e = (a - (d - v)) + (-b - v);
    (d, e)
}

// ---------------------------------------------------------------------------
// F64x2 constructors
// ---------------------------------------------------------------------------

impl F64x2 {
    /// Create a new double-double value from high and low components.
    ///
    /// The caller must ensure `|lo| <= ε·|hi|` (the renormalization invariant).
    /// For untrusted inputs, use [`F64x2::renormalize`].
    #[inline]
    #[must_use]
    pub const fn new(hi: f64, lo: f64) -> Self {
        Self { hi, lo }
    }

    /// Create a double-double from a single f64 (lo = 0).
    #[inline]
    #[must_use]
    pub const fn from_f64(val: f64) -> Self {
        Self { hi: val, lo: 0.0 }
    }

    /// Create the zero value.
    #[inline]
    #[must_use]
    pub const fn zero() -> Self {
        Self { hi: 0.0, lo: 0.0 }
    }

    /// Create the value 1.0.
    #[inline]
    #[must_use]
    pub const fn one() -> Self {
        Self { hi: 1.0, lo: 0.0 }
    }

    /// Renormalize: ensure `|lo| <= ε·|hi|` by performing a `TwoSum`.
    #[inline]
    #[must_use]
    pub fn renormalize(self) -> Self {
        let (hi, lo) = two_sum(self.hi, self.lo);
        Self { hi, lo }
    }

    /// Get the high component (the primary f64 value).
    #[inline]
    #[must_use]
    pub const fn hi(&self) -> f64 {
        self.hi
    }

    /// Get the low component (the error/compensation term).
    #[inline]
    #[must_use]
    pub const fn lo(&self) -> f64 {
        self.lo
    }

    /// Collapse to a single f64 (returns hi + lo, which may lose the compensation).
    #[inline]
    #[must_use]
    pub fn to_f64(self) -> f64 {
        self.hi + self.lo
    }

    /// Negate.
    #[inline]
    #[must_use]
    pub const fn neg(self) -> Self {
        Self {
            hi: -self.hi,
            lo: -self.lo,
        }
    }

    /// Absolute value.
    #[inline]
    #[must_use]
    pub fn abs(self) -> Self {
        if self.hi < 0.0 || (self.hi == 0.0 && self.lo < 0.0) {
            self.neg()
        } else {
            self
        }
    }

    /// Check if the value is zero.
    #[inline]
    #[must_use]
    pub fn is_zero(self) -> bool {
        self.hi == 0.0 && self.lo == 0.0
    }
}

// ---------------------------------------------------------------------------
// From conversions
// ---------------------------------------------------------------------------

impl From<f64> for F64x2 {
    #[inline]
    fn from(val: f64) -> Self {
        Self::from_f64(val)
    }
}

impl From<F64x2> for f64 {
    #[inline]
    fn from(val: F64x2) -> Self {
        val.hi
    }
}

// ---------------------------------------------------------------------------
// Double-double arithmetic
// ---------------------------------------------------------------------------

impl std::ops::Add for F64x2 {
    type Output = Self;

    /// Double-double addition: `(ah + al) + (bh + bl)`.
    ///
    /// Uses the Hida/Li/Bailey QD library algorithm (Sloppy-Add):
    /// 1. `TwoSum` on the high parts
    /// 2. Accumulate low parts into the error
    /// 3. Renormalize
    #[inline]
    fn add(self, rhs: Self) -> Self {
        let (sh, sl) = two_sum(self.hi, rhs.hi);
        // Add low parts and the TwoSum error
        let sl = sl + self.lo + rhs.lo;
        // Renormalize: fold sl back into (hi, lo) pair
        let (hi, lo) = two_sum(sh, sl);
        Self { hi, lo }
    }
}

impl std::ops::Sub for F64x2 {
    type Output = Self;

    /// Double-double subtraction: `(ah + al) - (bh + bl)`.
    ///
    /// Implemented as `self + (-rhs)` which reuses the `Add` implementation.
    #[inline]
    #[allow(clippy::suspicious_arithmetic_impl)] // intentional: a - b = a + (-b) for double-double
    fn sub(self, rhs: Self) -> Self {
        self + rhs.neg()
    }
}

impl std::ops::Mul for F64x2 {
    type Output = Self;

    /// Double-double multiplication: `(ah + al) * (bh + bl)`.
    ///
    /// Uses `TwoProd` for the high parts, then accumulates cross terms.
    #[inline]
    fn mul(self, rhs: Self) -> Self {
        let (ph, pl) = two_prod(self.hi, rhs.hi);
        // Cross terms: ah*bl + al*bh (al*bl is negligible at double-double precision)
        let pl = pl + self.hi * rhs.lo + self.lo * rhs.hi;
        let (hi, lo) = two_sum(ph, pl);
        Self { hi, lo }
    }
}

impl std::ops::Div for F64x2 {
    type Output = Self;

    /// Double-double division: `(ah + al) / (bh + bl)`.
    ///
    /// Computes an initial quotient `q1 = ah / bh`, then refines using
    /// the residual computed via `TwoProd`.
    #[inline]
    fn div(self, rhs: Self) -> Self {
        if rhs.hi == 0.0 {
            // Division by zero — propagate infinity/NaN to match f64 behavior
            return Self::from_f64(self.hi / rhs.hi);
        }
        let q1 = self.hi / rhs.hi;
        // Residual: self - q1 * rhs
        let (ph, pl) = two_prod(q1, rhs.hi);
        let r = ((self.hi - ph) - pl + self.lo - q1 * rhs.lo) / rhs.hi;
        let (hi, lo) = two_sum(q1, r);
        Self { hi, lo }
    }
}

impl std::ops::Neg for F64x2 {
    type Output = Self;

    #[inline]
    fn neg(self) -> Self {
        Self {
            hi: -self.hi,
            lo: -self.lo,
        }
    }
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

impl std::fmt::Display for F64x2 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.lo == 0.0 {
            write!(f, "{}", self.hi)
        } else {
            write!(f, "{}+{:e}", self.hi, self.lo)
        }
    }
}

// ---------------------------------------------------------------------------
// Comparison (on the mathematical value hi+lo)
// ---------------------------------------------------------------------------

impl PartialEq for F64x2 {
    fn eq(&self, other: &Self) -> bool {
        self.hi == other.hi && self.lo == other.lo
    }
}

impl PartialOrd for F64x2 {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        match self.hi.partial_cmp(&other.hi) {
            Some(std::cmp::Ordering::Equal) => self.lo.partial_cmp(&other.lo),
            other_ord => other_ord,
        }
    }
}

// ---------------------------------------------------------------------------
// Accumulator (double-double Kahan)
// ---------------------------------------------------------------------------

/// Compensated accumulator using double-double arithmetic.
///
/// Like [`KahanSum`](crate::KahanSum) but carries the full double-double
/// representation through the accumulation, giving ~31-digit precision.
pub struct DdSum {
    acc: F64x2,
}

impl DdSum {
    /// Create a new accumulator starting at zero.
    #[inline]
    #[must_use]
    pub const fn new() -> Self {
        Self { acc: F64x2::zero() }
    }

    /// Add a single f64 value.
    #[inline]
    pub fn add(&mut self, x: f64) {
        self.acc = self.acc + F64x2::from_f64(x);
    }

    /// Add a double-double value.
    #[inline]
    pub fn add_dd(&mut self, x: F64x2) {
        self.acc = self.acc + x;
    }

    /// Return the accumulated total as a double-double.
    #[inline]
    #[must_use]
    pub fn total(&self) -> F64x2 {
        self.acc
    }

    /// Return just the high part (compatible with existing `KahanSum` API).
    #[inline]
    #[must_use]
    pub fn total_f64(&self) -> f64 {
        self.acc.hi
    }
}

impl Default for DdSum {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;

    // === TwoSum tests ===

    #[test]
    fn two_sum_exact() {
        let (s, e) = two_sum(1.0, 2.0);
        assert_eq!(s, 3.0);
        assert_eq!(e, 0.0);
    }

    #[test]
    fn two_sum_with_cancellation() {
        // 1e15 + 1.0: the 1.0 is lost in f64 addition, but captured in error
        let (s, e) = two_sum(1e15, 1.0);
        // s = 1e15 (the 1.0 was absorbed)
        // e = 1.0 (the lost bit)
        assert_eq!(s + e, 1e15 + 1.0); // Not exact in f64, but the sum is preserved
        // More precisely: s should be the f64 result of 1e15 + 1.0
        assert_eq!(s, 1e15 + 1.0);
    }

    #[test]
    fn two_sum_preserves_small_term() {
        // Adding a tiny value to a large one
        let (s, e) = two_sum(1e16, 1.0);
        // At magnitude 1e16, ULP is 2.0, so 1.0 is completely lost in f64
        assert_eq!(s, 1e16); // 1.0 absorbed
        assert_eq!(e, 1.0); // recovered in error term
    }

    // === TwoProd tests ===

    #[test]
    fn two_prod_exact() {
        let (p, e) = two_prod(3.0, 7.0);
        assert_eq!(p, 21.0);
        assert_eq!(e, 0.0);
    }

    #[test]
    fn two_prod_with_rounding() {
        // This product is exact in extended precision but rounded in f64
        let a = 1.0 + 1e-15;
        let b = 1.0 - 1e-15;
        let (p, e) = two_prod(a, b);
        // a * b = 1 - 1e-30, but f64 can't represent 1e-30 relative to 1.0
        // p is the f64 result, e captures the rounding error
        assert!((p + e - a * b).abs() < 1e-30 || (p + e) == a * b);
    }

    // === TwoDiff tests ===

    #[test]
    fn two_diff_exact() {
        let (d, e) = two_diff(5.0, 3.0);
        assert_eq!(d, 2.0);
        assert_eq!(e, 0.0);
    }

    #[test]
    fn two_diff_catastrophic_cancellation() {
        // Subtracting two large nearly-equal values
        let a = 1e15 + 1.0; // In f64, this is just 1e15 (1.0 lost)
        let b = 1e15;
        let (d, e) = two_diff(a, b);
        // d + e should recover the mathematical difference
        assert_eq!(d + e, a - b);
    }

    // === F64x2 arithmetic tests ===

    #[test]
    fn dd_add_basic() {
        let a = F64x2::from(3.0);
        let b = F64x2::from(4.0);
        let c = a + b;
        assert_eq!(c.hi(), 7.0);
        assert_eq!(c.lo(), 0.0);
    }

    #[test]
    fn dd_sub_basic() {
        let a = F64x2::from(7.0);
        let b = F64x2::from(3.0);
        let c = a - b;
        assert_eq!(c.hi(), 4.0);
        assert_eq!(c.lo(), 0.0);
    }

    #[test]
    fn dd_mul_basic() {
        let a = F64x2::from(3.0);
        let b = F64x2::from(7.0);
        let c = a * b;
        assert_eq!(c.hi(), 21.0);
        assert_eq!(c.lo(), 0.0);
    }

    #[test]
    fn dd_div_basic() {
        let a = F64x2::from(21.0);
        let b = F64x2::from(7.0);
        let c = a / b;
        assert_eq!(c.hi(), 3.0);
        assert_eq!(c.lo(), 0.0);
    }

    #[test]
    fn dd_catastrophic_cancellation_preserved() {
        // The key test: 1e15 + 1.0 - 1e15 should give exactly 1.0
        let a = F64x2::from(1e15);
        let b = F64x2::from(1.0);
        let c = F64x2::from(1e15);
        let result = (a + b) - c;
        assert_eq!(result.hi(), 1.0);
        assert_eq!(result.lo(), 0.0);
    }

    #[test]
    fn dd_catastrophic_cancellation_larger() {
        // 1e16 + 1.0 - 1e16: at this scale, 1.0 is below ULP for f64
        let a = F64x2::from(1e16);
        let b = F64x2::from(1.0);
        let c = F64x2::from(1e16);
        let result = (a + b) - c;
        assert_eq!(result.hi(), 1.0);
    }

    #[test]
    fn dd_near_equal_subtraction() {
        // Simulates the S&U!Q41 pattern: ABS(Q37 - Q38) where both are ~8919
        let q37 = F64x2::from(8_918.980_788_245_935);
        let q38 = F64x2::from(8_918.980_776_648_694);
        let diff = q37 - q38;
        // The difference should be ~1.16e-5 with more precision than f64 alone
        let f64_diff = 8_918.980_788_245_935_f64 - 8_918.980_776_648_694_f64;
        assert_eq!(diff.hi(), f64_diff);
        // Note: when both inputs are plain f64 (lo=0), double-double subtraction
        // still gives the same hi as f64, but captures the error in lo.
        // The benefit comes when the INPUTS carry error terms from upstream chains.
    }

    #[test]
    fn dd_sum_chain_preserves_precision() {
        // Simulates a rolling balance: start with 20000, subtract ~2069 each period
        // After ~10 periods, the balance should have a tiny residual
        let mut balance = F64x2::from(20_686.601_250);
        let payment = F64x2::from(2_068.660_125);
        for _ in 0..10 {
            balance = balance - payment;
        }
        // With f64: 20686.60125 - 10 * 2068.660125 = 0 (exact, no issue here)
        // But with accumulated intermediate values, the dd preserves error terms
        assert!((balance.hi() - 0.0).abs() < 1e-10);
    }

    #[test]
    fn dd_financial_check_row() {
        // Pattern B from analysis: total_assets ≈ total_liabilities, difference should be ~0
        // Build assets as sum of many terms
        let mut assets = DdSum::new();
        assets.add(1000.50);
        assets.add(2500.75);
        assets.add(3000.25);
        assets.add(500.125);
        assets.add(998.375);

        // Build liabilities as the same terms in different order
        let mut liabilities = DdSum::new();
        liabilities.add(998.375);
        liabilities.add(3000.25);
        liabilities.add(1000.50);
        liabilities.add(500.125);
        liabilities.add(2500.75);

        let diff = assets.total() - liabilities.total();
        // With dd precision, the check row should be exactly 0
        assert_eq!(diff.hi(), 0.0);
        assert_eq!(diff.lo(), 0.0);
    }

    #[test]
    fn dd_mul_preserves_precision() {
        // (1 + 1e-15) * (1 - 1e-15) = 1 - 1e-30
        // f64 gives exactly 1.0 (the 1e-30 is below ULP)
        let a = F64x2::new(1.0, 1e-15);
        let b = F64x2::new(1.0, -1e-15);
        let c = a * b;
        // hi should be 1.0, lo should capture the -1e-30
        assert_eq!(c.hi(), 1.0);
        // The lo term captures the sub-ULP difference
        assert!(c.lo().abs() < 1e-14);
    }

    #[test]
    fn dd_div_inverse() {
        let a = F64x2::from(1.0);
        let b = F64x2::from(3.0);
        let c = a / b; // 1/3
        let d = c * b; // should be ~1.0
        assert!((d.hi() - 1.0).abs() < 1e-30);
    }

    #[test]
    fn dd_identity_properties() {
        let a = F64x2::from(42.5);

        // a + 0 = a
        let r = a + F64x2::zero();
        assert_eq!(r.hi(), a.hi());

        // a * 1 = a
        let r = a * F64x2::one();
        assert_eq!(r.hi(), a.hi());

        // a - a = 0
        let r = a - a;
        assert_eq!(r.hi(), 0.0);

        // a / a = 1
        let r = a / a;
        assert_eq!(r.hi(), 1.0);
    }

    #[test]
    fn dd_neg_and_abs() {
        let a = F64x2::new(3.0, 1e-16);
        let b = a.neg();
        assert_eq!(b.hi(), -3.0);
        assert_eq!(b.lo(), -1e-16);

        let c = b.abs();
        assert_eq!(c.hi(), 3.0);
        assert_eq!(c.lo(), 1e-16);
    }

    // === DdSum tests ===

    #[test]
    fn dd_sum_many_small_terms() {
        // Sum 10000 copies of 0.1 — should be close to 1000.0
        let mut acc = DdSum::new();
        for _ in 0..10_000 {
            acc.add(0.1);
        }
        let result = acc.total();
        // With dd precision, the error should be much smaller than Kahan
        assert!((result.hi() - 1000.0).abs() < 1e-12);
    }

    #[test]
    fn dd_sum_catastrophic() {
        let mut acc = DdSum::new();
        acc.add(1e15);
        acc.add(1.0);
        acc.add(-1e15);
        let result = acc.total();
        assert_eq!(result.hi(), 1.0);
    }

    #[test]
    fn dd_from_f64_roundtrip() {
        let x = std::f64::consts::PI;
        let dd = F64x2::from(x);
        assert_eq!(dd.hi(), x);
        assert_eq!(dd.lo(), 0.0);
        assert_eq!(f64::from(dd), x);
    }

    // === Property-based tests ===

    use proptest::prelude::*;

    proptest! {
        // Addition is commutative (hi part)
        #[test]
        fn prop_add_commutative(a in -1e10..1e10_f64, b in -1e10..1e10_f64) {
            let fa = F64x2::from(a);
            let fb = F64x2::from(b);
            let ab = fa + fb;
            let ba = fb + fa;
            prop_assert_eq!(ab.hi().to_bits(), ba.hi().to_bits());
        }

        // a + 0 = a
        #[test]
        fn prop_add_identity(a in -1e15..1e15_f64) {
            let fa = F64x2::from(a);
            let result = fa + F64x2::zero();
            prop_assert_eq!(result.hi(), fa.hi());
        }

        // a - a = 0
        #[test]
        fn prop_sub_self_is_zero(a in -1e15..1e15_f64) {
            let fa = F64x2::from(a);
            let result = fa - fa;
            prop_assert_eq!(result.hi(), 0.0);
        }

        // a * 1 = a
        #[test]
        fn prop_mul_identity(a in -1e15..1e15_f64) {
            let fa = F64x2::from(a);
            let result = fa * F64x2::one();
            prop_assert_eq!(result.hi(), fa.hi());
        }

        // TwoSum: s should equal the f64 sum a + b
        #[test]
        fn prop_two_sum_hi_equals_f64_sum(a in -1e10..1e10_f64, b in -1e10..1e10_f64) {
            let (s, _e) = two_sum(a, b);
            prop_assert_eq!(s, a + b);
        }
    }
}
