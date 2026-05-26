//! A finite f64 wrapper that guarantees no NaN or Infinity values.
//!
//! [`FiniteF64`] is a newtype over `f64` that excludes NaN and
//! Infinity at construction time. This makes `Eq`, `Ord`, and `Hash` sound — unlike raw
//! `f64` where NaN breaks reflexivity. Used in contexts that require total ordering (sorting,
//! dedup) or hash-map keys. The inner `f64` is private to enforce the invariant; use
//! [`FiniteF64::get()`] or the `Deref<Target = f64>` impl to read the value.
//!
//! ## Double-double precision (`dd-precision` feature)
//!
//! When the `dd-precision` feature is enabled, `FiniteF64` carries an additional `lo: f64`
//! error term, forming a double-double pair `(val, lo)` where the mathematical value is
//! `val + lo`. This gives ~31 decimal digits of intermediate precision, matching Excel's
//! x87 80-bit FPU behavior and eliminating catastrophic cancellation mismatches.
//!
//! The `lo` term is:
//! - Ignored in `Eq`, `Ord`, `Hash` (only `val` matters for identity/ordering)
//! - Ignored in `Serialize`/`Deserialize` (only `val` crosses IPC boundaries)
//! - Accessible via [`FiniteF64::lo()`] and [`FiniteF64::with_dd()`]

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;
use std::ops::{Add, Deref, Div, Mul, Neg, Rem, Sub};

/// A finite f64 value — guaranteed to never be NaN or Infinity.
///
/// This is the inner type of `CellValue::Number`. The invariant is enforced
/// at construction time: `FiniteF64::new()` returns `None` for non-finite values.
/// All arithmetic that might produce non-finite results should go through
/// `CellValue::number()` which maps non-finite to `CellValue::Error(CellError::Num, None)`.
///
/// The inner field is private to enforce the invariant; use [`FiniteF64::get()`]
/// or the [`Deref<Target = f64>`](#impl-Deref-for-FiniteF64) impl to read the value.
/// The `Deref` impl means you can call `f64` methods directly on a `FiniteF64`
/// (e.g., `val.abs()`, `val.sqrt()`).
///
/// # Examples
///
/// ```
/// use value_types::FiniteF64;
///
/// // Construct from a known-finite value:
/// let val = FiniteF64::new(3.25).unwrap();
/// assert_eq!(val.get(), 3.25);
///
/// // NaN and Infinity are rejected:
/// assert!(FiniteF64::new(f64::NAN).is_none());
/// assert!(FiniteF64::new(f64::INFINITY).is_none());
///
/// // Deref lets you call f64 methods directly:
/// assert_eq!(val.abs(), 3.25);
///
/// // TryFrom<f64> works too:
/// let val2: FiniteF64 = 2.718.try_into().unwrap();
/// assert_eq!(val2.get(), 2.718);
/// ```
#[derive(Clone, Copy, finite_at_boundary::AllowedBareF64)]
pub struct FiniteF64 {
    // The wrapped finite-f64 storage. This is the *only* legitimate bare `f64`
    // field at the boundary surface — every `FiniteF64` is constructed through
    // `FiniteF64::new` / `FiniteF64::must` which reject NaN and ±∞. The
    // `#[allowed_bare_f64]` helper attribute (registered by the
    // `finite_at_boundary::AllowedBareF64` derive above) is read by the
    // `no_bare_f64_at_boundary` walker tests in each type crate to whitelist
    // this field. (Note: `FiniteF64` uses a hand-rolled `Serialize`/`Deserialize`
    // impl, not `#[derive]`, so this field is already invisible to the walker
    // — but the marker documents the intent and provides a structural escape
    // hatch should the impl ever switch to derive.)
    #[allowed_bare_f64]
    val: f64,
    // Engine-internal error term for the optional `dd-precision` double-double
    // representation. Never crosses an IPC boundary (skipped by the manual
    // serde impl); marked allowed-bare-f64 for symmetry with `val`.
    #[cfg(feature = "dd-precision")]
    #[allowed_bare_f64]
    lo: f64,
}

impl FiniteF64 {
    // -----------------------------------------------------------------------
    // The single normalization chokepoint.
    // Every construction path MUST funnel through this to maintain invariants:
    //   1. val is finite (no NaN, no ±∞)
    //   2. -0.0 is normalized to +0.0 (Eq/Ord/Hash consistency)
    // -----------------------------------------------------------------------

    /// Normalize `-0.0` to `+0.0`. All other values pass through unchanged.
    #[inline]
    fn normalize(val: f64) -> f64 {
        if val == 0.0 { 0.0 } else { val }
    }

    /// Create a new `FiniteF64`, returning `None` if the value is NaN or Infinity.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::FiniteF64;
    ///
    /// assert_eq!(FiniteF64::new(42.0).map(|v| v.get()), Some(42.0));
    /// assert_eq!(FiniteF64::new(f64::NAN), None);
    /// assert_eq!(FiniteF64::new(f64::INFINITY), None);
    /// assert_eq!(FiniteF64::new(f64::NEG_INFINITY), None);
    /// ```
    #[must_use]
    #[inline]
    pub fn new(n: f64) -> Option<Self> {
        if n.is_finite() {
            Some(Self {
                val: Self::normalize(n),
                #[cfg(feature = "dd-precision")]
                lo: 0.0,
            })
        } else {
            None
        }
    }

    /// Returns a `FiniteF64` or panics.
    ///
    /// Named `must` to clearly indicate this is a panicking constructor — not
    /// an unchecked bypass. For fallible construction, use [`FiniteF64::new()`].
    ///
    /// # Panics
    ///
    /// Panics if `n` is NaN or Infinity.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::FiniteF64;
    ///
    /// let val = FiniteF64::must(1.0);
    /// assert_eq!(val.get(), 1.0);
    /// ```
    ///
    /// ```should_panic
    /// use value_types::FiniteF64;
    ///
    /// // This panics because NaN is not finite:
    /// let _ = FiniteF64::must(f64::NAN);
    /// ```
    #[must_use]
    #[inline]
    pub fn must(n: f64) -> Self {
        Self::new(n).unwrap_or_else(|| panic!("FiniteF64::must called with non-finite value: {n}"))
    }

    /// Create a `FiniteF64` with a double-double error term.
    ///
    /// Both `val` and `lo` must be finite; returns `None` otherwise.
    /// When `dd-precision` is off, the `lo` parameter is ignored.
    #[must_use]
    #[inline]
    #[allow(clippy::used_underscore_binding)] // `_lo` is conditionally used with dd-precision feature
    pub fn with_dd(val: f64, _lo: f64) -> Option<Self> {
        if val.is_finite() && _lo.is_finite() {
            Some(Self {
                val: Self::normalize(val),
                #[cfg(feature = "dd-precision")]
                lo: _lo,
            })
        } else {
            None
        }
    }

    /// Get the inner f64 value (the high part).
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::FiniteF64;
    ///
    /// let val = FiniteF64::new(99.9).unwrap();
    /// assert_eq!(val.get(), 99.9);
    ///
    /// // Equivalent to dereferencing:
    /// assert_eq!(*val, 99.9);
    /// ```
    #[must_use]
    #[inline]
    pub fn get(self) -> f64 {
        self.val
    }

    /// Get the double-double error term (lo component).
    ///
    /// Returns 0.0 when `dd-precision` is not enabled.
    #[must_use]
    #[inline]
    pub fn lo(self) -> f64 {
        #[cfg(feature = "dd-precision")]
        {
            self.lo
        }
        #[cfg(not(feature = "dd-precision"))]
        {
            0.0
        }
    }

    /// Convert to an [`F64x2`](crate::F64x2) double-double value.
    #[must_use]
    #[inline]
    pub fn to_f64x2(self) -> crate::F64x2 {
        crate::F64x2::new(self.val, self.lo())
    }

    /// Create from an [`F64x2`](crate::F64x2) double-double value.
    ///
    /// Returns `None` if the high part is not finite.
    #[must_use]
    #[inline]
    pub fn from_f64x2(dd: crate::F64x2) -> Option<Self> {
        Self::with_dd(dd.hi(), dd.lo())
    }

    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    /// The additive identity `0.0`.
    pub const ZERO: Self = Self {
        val: 0.0,
        #[cfg(feature = "dd-precision")]
        lo: 0.0,
    };

    /// The multiplicative identity `1.0`.
    pub const ONE: Self = Self {
        val: 1.0,
        #[cfg(feature = "dd-precision")]
        lo: 0.0,
    };

    // -----------------------------------------------------------------------
    // Checked arithmetic
    // -----------------------------------------------------------------------

    /// Checked addition. Returns `None` if the result is not finite.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::FiniteF64;
    ///
    /// let a = FiniteF64::must(2.0);
    /// let b = FiniteF64::must(3.0);
    /// assert_eq!(a.checked_add(b).unwrap().get(), 5.0);
    ///
    /// let big = FiniteF64::must(f64::MAX);
    /// assert!(big.checked_add(big).is_none()); // overflow → infinity
    /// ```
    #[must_use]
    #[inline]
    pub fn checked_add(self, rhs: Self) -> Option<Self> {
        Self::new(self.val + rhs.val)
    }

    /// Checked subtraction. Returns `None` if the result is not finite.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::FiniteF64;
    ///
    /// let a = FiniteF64::must(10.0);
    /// let b = FiniteF64::must(3.0);
    /// assert_eq!(a.checked_sub(b).unwrap().get(), 7.0);
    /// ```
    #[must_use]
    #[inline]
    pub fn checked_sub(self, rhs: Self) -> Option<Self> {
        Self::new(self.val - rhs.val)
    }

    /// Checked multiplication. Returns `None` if the result is not finite.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::FiniteF64;
    ///
    /// let a = FiniteF64::must(2.0);
    /// let b = FiniteF64::must(3.0);
    /// assert_eq!(a.checked_mul(b).unwrap().get(), 6.0);
    ///
    /// let big = FiniteF64::must(f64::MAX);
    /// let two = FiniteF64::must(2.0);
    /// assert!(big.checked_mul(two).is_none()); // overflow → infinity
    /// ```
    #[must_use]
    #[inline]
    pub fn checked_mul(self, rhs: Self) -> Option<Self> {
        Self::new(self.val * rhs.val)
    }

    /// Checked division. Returns `None` if the result is not finite (e.g., `0.0 / 0.0` → NaN,
    /// `1.0 / 0.0` → infinity).
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::FiniteF64;
    ///
    /// let a = FiniteF64::must(6.0);
    /// let b = FiniteF64::must(2.0);
    /// assert_eq!(a.checked_div(b).unwrap().get(), 3.0);
    ///
    /// let zero = FiniteF64::ZERO;
    /// assert!(zero.checked_div(zero).is_none()); // 0/0 → NaN
    /// assert!(a.checked_div(zero).is_none());    // 6/0 → infinity
    /// ```
    #[must_use]
    #[inline]
    pub fn checked_div(self, rhs: Self) -> Option<Self> {
        Self::new(self.val / rhs.val)
    }

    /// Checked remainder. Returns `None` if the result is not finite (e.g., `1.0 % 0.0` → NaN).
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::FiniteF64;
    ///
    /// let a = FiniteF64::must(7.0);
    /// let b = FiniteF64::must(3.0);
    /// assert_eq!(a.checked_rem(b).unwrap().get(), 1.0);
    ///
    /// let zero = FiniteF64::ZERO;
    /// assert!(a.checked_rem(zero).is_none()); // x % 0 → NaN
    /// ```
    #[must_use]
    #[inline]
    pub fn checked_rem(self, rhs: Self) -> Option<Self> {
        Self::new(self.val % rhs.val)
    }

    // -----------------------------------------------------------------------
    // Mathematical convenience methods
    // -----------------------------------------------------------------------

    /// Absolute value. This is total — the absolute value of any finite number is finite.
    ///
    /// Unlike calling `.abs()` through `Deref<Target = f64>` (which returns raw `f64`),
    /// this preserves the `FiniteF64` type guarantee.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::FiniteF64;
    ///
    /// assert_eq!(FiniteF64::must(-5.0).finite_abs().get(), 5.0);
    /// assert_eq!(FiniteF64::must(5.0).finite_abs().get(), 5.0);
    /// assert_eq!(FiniteF64::ZERO.finite_abs().get(), 0.0);
    /// ```
    #[must_use]
    #[inline]
    pub fn finite_abs(self) -> Self {
        // abs of a finite value is always finite (no overflow possible).
        // For double-double: the represented value is (val + lo). To negate
        // the pair we negate both components — abs(lo) would be wrong because
        // lo is a signed correction term, not an independent magnitude.
        if self.val < 0.0 || (self.val == 0.0 && self.val.is_sign_negative()) {
            Self {
                val: Self::normalize(-self.val),
                #[cfg(feature = "dd-precision")]
                lo: -self.lo,
            }
        } else {
            self
        }
    }

    /// Minimum of two finite values. Total — always returns a valid `FiniteF64`.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::FiniteF64;
    ///
    /// let a = FiniteF64::must(3.0);
    /// let b = FiniteF64::must(5.0);
    /// assert_eq!(a.finite_min(b).get(), 3.0);
    /// ```
    #[must_use]
    #[inline]
    pub fn finite_min(self, other: Self) -> Self {
        if self.val <= other.val { self } else { other }
    }

    /// Maximum of two finite values. Total — always returns a valid `FiniteF64`.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::FiniteF64;
    ///
    /// let a = FiniteF64::must(3.0);
    /// let b = FiniteF64::must(5.0);
    /// assert_eq!(a.finite_max(b).get(), 5.0);
    /// ```
    #[must_use]
    #[inline]
    pub fn finite_max(self, other: Self) -> Self {
        if self.val >= other.val { self } else { other }
    }

    /// Checked square root. Returns `None` for negative values (which produce NaN).
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::FiniteF64;
    ///
    /// assert_eq!(FiniteF64::must(9.0).checked_sqrt().unwrap().get(), 3.0);
    /// assert_eq!(FiniteF64::must(0.0).checked_sqrt().unwrap().get(), 0.0);
    /// assert!(FiniteF64::must(-1.0).checked_sqrt().is_none());
    /// ```
    #[must_use]
    #[inline]
    pub fn checked_sqrt(self) -> Option<Self> {
        Self::new(self.val.sqrt())
    }

    /// Checked power. Returns `None` if the result is not finite.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::FiniteF64;
    ///
    /// let base = FiniteF64::must(2.0);
    /// let exp = FiniteF64::must(10.0);
    /// assert_eq!(base.checked_pow(exp).unwrap().get(), 1024.0);
    ///
    /// // Overflow returns None
    /// let big = FiniteF64::must(f64::MAX);
    /// assert!(big.checked_pow(FiniteF64::must(2.0)).is_none());
    ///
    /// // Negative base with fractional exponent → NaN → None
    /// assert!(FiniteF64::must(-1.0).checked_pow(FiniteF64::must(0.5)).is_none());
    /// ```
    #[must_use]
    #[inline]
    pub fn checked_pow(self, exp: Self) -> Option<Self> {
        Self::new(self.val.powf(exp.val))
    }
}

// ---------------------------------------------------------------------------
// Error type for TryFrom<f64>
// ---------------------------------------------------------------------------

/// Error returned when attempting to convert a non-finite `f64` (NaN or Infinity)
/// into a [`FiniteF64`].
///
/// # Examples
///
/// ```
/// use value_types::NonFiniteError;
/// use value_types::FiniteF64;
///
/// let err = FiniteF64::try_from(f64::NAN).unwrap_err();
/// assert_eq!(err.to_string(), "expected finite f64, got NaN or Infinity");
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NonFiniteError;

impl fmt::Display for NonFiniteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("expected finite f64, got NaN or Infinity")
    }
}

impl std::error::Error for NonFiniteError {}

// ---------------------------------------------------------------------------
// TryFrom<f64>
// ---------------------------------------------------------------------------

/// Fallible conversion from `f64` to `FiniteF64`.
///
/// Returns [`NonFiniteError`] if the value is NaN or Infinity.
///
/// # Examples
///
/// ```
/// use value_types::FiniteF64;
///
/// let val: FiniteF64 = 42.0_f64.try_into().unwrap();
/// assert_eq!(val.get(), 42.0);
///
/// assert!(FiniteF64::try_from(f64::NAN).is_err());
/// assert!(FiniteF64::try_from(f64::INFINITY).is_err());
/// ```
impl TryFrom<f64> for FiniteF64 {
    type Error = NonFiniteError;

    #[inline]
    fn try_from(n: f64) -> Result<Self, Self::Error> {
        Self::new(n).ok_or(NonFiniteError)
    }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

impl fmt::Debug for FiniteF64 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.val)
    }
}

impl fmt::Display for FiniteF64 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.val)
    }
}

// ---------------------------------------------------------------------------
// Comparison & Hashing
// ---------------------------------------------------------------------------
// NOTE: Eq/Ord/Hash intentionally compare only `val`, not `lo`.
// The `lo` term is engine-internal precision metadata, not part of the
// cell's logical identity.

impl PartialEq for FiniteF64 {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.val == other.val
    }
}

/// `Eq` is sound because NaN is excluded by construction.
impl Eq for FiniteF64 {}

impl PartialOrd for FiniteF64 {
    #[inline]
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for FiniteF64 {
    #[inline]
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.val.total_cmp(&other.val)
    }
}

impl std::hash::Hash for FiniteF64 {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.val.to_bits().hash(state);
    }
}

// ---------------------------------------------------------------------------
// Conversions & Deref
// ---------------------------------------------------------------------------

impl Deref for FiniteF64 {
    type Target = f64;

    #[inline]
    fn deref(&self) -> &f64 {
        &self.val
    }
}

impl From<FiniteF64> for f64 {
    #[inline]
    fn from(f: FiniteF64) -> Self {
        f.val
    }
}

// ---------------------------------------------------------------------------
// Serde
// ---------------------------------------------------------------------------
// Always serialize/deserialize only the `val` field (f64).
// The `lo` term is engine-internal and not persisted across IPC boundaries.

impl Serialize for FiniteF64 {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.val.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for FiniteF64 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let n = f64::deserialize(deserializer)?;
        Self::new(n)
            .ok_or_else(|| serde::de::Error::custom("expected finite f64, got NaN or Infinity"))
    }
}

// ---------------------------------------------------------------------------
// Default
// ---------------------------------------------------------------------------

impl Default for FiniteF64 {
    /// Returns [`FiniteF64::ZERO`].
    #[inline]
    fn default() -> Self {
        Self::ZERO
    }
}

// ---------------------------------------------------------------------------
// Arithmetic operators
// ---------------------------------------------------------------------------

/// Negation of a finite value is always finite (no overflow possible).
impl Neg for FiniteF64 {
    type Output = Self;

    #[inline]
    fn neg(self) -> Self {
        // -0.0 must normalize to +0.0 to preserve the invariant
        if self.val == 0.0 {
            Self::ZERO
        } else {
            Self {
                val: -self.val,
                #[cfg(feature = "dd-precision")]
                lo: -self.lo,
            }
        }
    }
}

/// Addition that returns `Option<FiniteF64>` because the result can overflow to infinity.
impl Add for FiniteF64 {
    type Output = Option<Self>;

    #[inline]
    fn add(self, rhs: Self) -> Option<Self> {
        self.checked_add(rhs)
    }
}

/// Subtraction that returns `Option<FiniteF64>` because the result can overflow to infinity.
impl Sub for FiniteF64 {
    type Output = Option<Self>;

    #[inline]
    fn sub(self, rhs: Self) -> Option<Self> {
        self.checked_sub(rhs)
    }
}

/// Multiplication that returns `Option<FiniteF64>` because the result can overflow to infinity.
impl Mul for FiniteF64 {
    type Output = Option<Self>;

    #[inline]
    fn mul(self, rhs: Self) -> Option<Self> {
        self.checked_mul(rhs)
    }
}

/// Division that returns `Option<FiniteF64>` because the result can be NaN or infinity.
impl Div for FiniteF64 {
    type Output = Option<Self>;

    #[inline]
    fn div(self, rhs: Self) -> Option<Self> {
        self.checked_div(rhs)
    }
}

/// Remainder that returns `Option<FiniteF64>` because the result can be NaN.
impl Rem for FiniteF64 {
    type Output = Option<Self>;

    #[inline]
    fn rem(self, rhs: Self) -> Option<Self> {
        self.checked_rem(rhs)
    }
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;
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
    fn try_from_finite_succeeds() {
        let v: Result<FiniteF64, _> = 42.0_f64.try_into();
        assert!(v.is_ok());
        assert_eq!(v.unwrap().get(), 42.0);
    }

    #[test]
    fn try_from_nan_fails() {
        let v = FiniteF64::try_from(f64::NAN);
        assert!(v.is_err());
        assert_eq!(
            v.unwrap_err().to_string(),
            "expected finite f64, got NaN or Infinity"
        );
    }

    #[test]
    fn try_from_infinity_fails() {
        assert!(FiniteF64::try_from(f64::INFINITY).is_err());
        assert!(FiniteF64::try_from(f64::NEG_INFINITY).is_err());
    }

    #[test]
    fn non_finite_error_is_std_error() {
        fn assert_error<T: std::error::Error>() {}
        assert_error::<NonFiniteError>();
    }

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
    fn serde_roundtrip() {
        let v = FiniteF64::new(42.5).unwrap();
        let json = serde_json::to_string(&v).unwrap();
        let v2: FiniteF64 = serde_json::from_str(&json).unwrap();
        assert_eq!(v, v2);
        assert_eq!(v2.get(), 42.5);
    }

    #[test]
    fn serde_roundtrip_zero() {
        let v = FiniteF64::new(0.0).unwrap();
        let json = serde_json::to_string(&v).unwrap();
        let v2: FiniteF64 = serde_json::from_str(&json).unwrap();
        assert_eq!(v, v2);
    }

    #[test]
    fn get_returns_inner() {
        let v = FiniteF64::new(99.9).unwrap();
        assert_eq!(v.get(), 99.9);
    }

    #[test]
    fn display_format() {
        let v = FiniteF64::new(3.25).unwrap();
        assert_eq!(format!("{v}"), "3.25");
    }

    #[test]
    fn debug_format() {
        let v = FiniteF64::new(3.25).unwrap();
        assert_eq!(format!("{v:?}"), "3.25");
    }

    #[test]
    fn clone_and_copy() {
        let a = FiniteF64::new(1.0).unwrap();
        let b = a; // Copy
        let c = a; // Also Copy
        assert_eq!(a, b);
        assert_eq!(a, c);
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

    // === Regression tests: -0.0 normalization across all construction paths ===

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

    // === dd-precision tests ===

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
    fn eq_ignores_lo() {
        let a = FiniteF64::with_dd(42.0, 1e-16).unwrap();
        let b = FiniteF64::with_dd(42.0, 2e-16).unwrap();
        // Eq only compares val, not lo
        assert_eq!(a, b);
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

    // === Default ===

    #[test]
    fn default_is_zero() {
        let d = FiniteF64::default();
        assert_eq!(d, FiniteF64::ZERO);
        assert_eq!(d.get(), 0.0);
    }

    // === Constants ===

    #[test]
    fn constants() {
        assert_eq!(FiniteF64::ZERO.get(), 0.0);
        assert_eq!(FiniteF64::ONE.get(), 1.0);
    }

    // === Negation ===

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

    // === Checked arithmetic ===

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

    // === Operator trait tests ===

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

    // === Mathematical convenience methods ===

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

    // === Property-based tests ===

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
}
