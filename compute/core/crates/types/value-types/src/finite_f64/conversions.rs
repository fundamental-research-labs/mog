use super::{FiniteF64, NonFiniteError};
use std::fmt;
use std::ops::Deref;

impl fmt::Display for NonFiniteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("expected finite f64, got NaN or Infinity")
    }
}

impl std::error::Error for NonFiniteError {}

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

impl Default for FiniteF64 {
    /// Returns [`FiniteF64::ZERO`].
    #[inline]
    fn default() -> Self {
        Self::ZERO
    }
}
