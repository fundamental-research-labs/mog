use super::FiniteF64;

impl FiniteF64 {
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
