use super::FiniteF64;
use std::ops::{Add, Div, Mul, Neg, Rem, Sub};

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
