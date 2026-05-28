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

mod conversions;
mod math;
mod operators;
mod ordering;
mod serde_impl;

#[cfg(test)]
mod tests;

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
