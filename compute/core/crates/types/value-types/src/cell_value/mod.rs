//! Cell value types -- the fundamental data type in the compute engine.
//!
//! [`CellValue`] is the universal value representation shared by parser, evaluator, and IPC.
//! NaN enforcement is by constructor discipline: [`CellValue::number()`] maps
//! non-finite f64 to `Error(Num)`. Coercion methods (`coerce_to_number`, `coerce_to_string`,
//! `coerce_to_bool`) follow Excel semantics and avoid allocation on common paths.

mod coerce;
mod control;
mod display;
mod serde_impl;

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod proptests;
#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests;

// Re-export `format_number` so `pub use cell_value::format_number` in lib.rs still works.
pub use display::format_number;

pub use control::{CellControl, CellControlType};

use std::sync::Arc;

use crate::CellError;
use crate::CellImage;
use crate::FiniteF64;
use crate::cell_array::CellArray;

/// The value stored in a cell. Matches the TypeScript `CellValue` union.
///
/// # Equality semantics
///
/// Text values compare case-insensitively, matching Excel's behavior
/// (`"hello" == "HELLO"`). This type intentionally does **not** implement
/// `Hash`, so this non-standard `PartialEq` cannot cause hash-map bugs.
///
/// # NaN enforcement
///
/// The `Number` variant stores a [`FiniteF64`], which guarantees NaN and
/// Infinity are structurally impossible. The [`CellValue::number`] constructor
/// maps non-finite `f64` values to `CellError::Num` (matching Excel behavior).
///
/// # Ergonomic construction via `From`
///
/// Standard types convert into `CellValue` via `From` impls:
///
/// ```
/// use value_types::{CellValue, CellError};
///
/// let num: CellValue = 42.0_f64.into();
/// let text: CellValue = "hello".into();
/// let flag: CellValue = true.into();
/// let err: CellValue = CellError::Na.into();
/// ```
///
/// Note: Custom Serialize/Deserialize because the tagged error format
/// (`{"type":"error","value":"..."}`) does not match any serde derive layout.
#[derive(Debug, Clone, Default)]
pub enum CellValue {
    /// Numeric value. `FiniteF64` guarantees no NaN or Infinity by construction.
    Number(FiniteF64),
    /// Text string. Wrapped in `Arc<str>` for O(1) cloning -- the parallel demand
    /// evaluator clones every cell value on read, and with millions of text cells
    /// this eliminates the dominant malloc/memcpy/free pressure (see value conversion diagnosis).
    Text(Arc<str>),
    /// Boolean
    Boolean(bool),
    /// Excel error with optional diagnostic message.
    /// `Arc<str>` matches `Text(Arc<str>)` -- O(1) clone for the parallel evaluator.
    /// Message does NOT participate in `PartialEq` (Excel: two `#DIV/0!` are equal regardless of context).
    Error(CellError, Option<Arc<str>>),
    /// Empty cell (no value)
    #[default]
    Null,
    /// Array result (from dynamic array formulas like FILTER, SORT, SEQUENCE).
    /// Wrapped in `Arc` for zero-cost cloning -- range materialization caching
    /// and array passing throughout the engine avoid deep copies.
    /// Internal layout: flat row-major [`CellArray`] -- zero inner-Vec overhead.
    Array(Arc<CellArray>),
    /// Cell-embedded interactive control (checkbox, future: toggle, dropdown).
    /// For formula evaluation, coerces to `Boolean(control.value)`.
    Control(CellControl),
    /// Cell-embedded image result produced by formulas such as `IMAGE`.
    Image(CellImage),
}

// ---------------------------------------------------------------------------
// From impls -- ergonomic construction (a la serde_json::Value)
// ---------------------------------------------------------------------------

/// Convert an `f64` into a `CellValue`, mapping NaN/Infinity to `Error(Num)`.
///
/// This goes through [`CellValue::number()`] to maintain the NaN invariant.
///
/// # Examples
///
/// ```
/// use value_types::CellValue;
///
/// assert!(matches!(CellValue::from(42.0_f64), CellValue::Number(_)));
/// assert!(matches!(CellValue::from(f64::NAN), CellValue::Error(..)));
/// ```
impl From<f64> for CellValue {
    fn from(n: f64) -> Self {
        CellValue::number(n)
    }
}

/// Convert an `i64` into a `CellValue::Number`.
///
/// # Examples
///
/// ```
/// use value_types::CellValue;
///
/// let v = CellValue::from(42_i64);
/// assert_eq!(v.as_number(), Some(42.0));
/// ```
impl From<i64> for CellValue {
    #[allow(clippy::cast_precision_loss)]
    fn from(n: i64) -> Self {
        CellValue::Number(FiniteF64::must(n as f64))
    }
}

/// Convert an `i32` into a `CellValue::Number`.
///
/// # Examples
///
/// ```
/// use value_types::CellValue;
///
/// let v = CellValue::from(7_i32);
/// assert_eq!(v.as_number(), Some(7.0));
/// ```
impl From<i32> for CellValue {
    fn from(n: i32) -> Self {
        CellValue::Number(FiniteF64::must(f64::from(n)))
    }
}

/// Convert a `bool` into a `CellValue::Boolean`.
///
/// # Examples
///
/// ```
/// use value_types::CellValue;
///
/// assert_eq!(CellValue::from(true), CellValue::Boolean(true));
/// ```
impl From<bool> for CellValue {
    fn from(b: bool) -> Self {
        CellValue::Boolean(b)
    }
}

/// Convert a `String` into a `CellValue::Text`.
///
/// # Examples
///
/// ```
/// use value_types::CellValue;
///
/// let v = CellValue::from(String::from("world"));
/// assert_eq!(v.as_text(), Some("world"));
/// ```
impl From<String> for CellValue {
    fn from(s: String) -> Self {
        CellValue::Text(Arc::from(s))
    }
}

/// Convert a `&str` into a `CellValue::Text` (clones the string).
///
/// # Examples
///
/// ```
/// use value_types::CellValue;
///
/// let v = CellValue::from("hello");
/// assert_eq!(v.as_text(), Some("hello"));
/// ```
impl From<&str> for CellValue {
    fn from(s: &str) -> Self {
        CellValue::Text(Arc::from(s))
    }
}

/// Convert a [`CellError`] into a `CellValue::Error`.
///
/// # Examples
///
/// ```
/// use value_types::{CellValue, CellError};
///
/// let v = CellValue::from(CellError::Na);
/// assert_eq!(v.as_error(), Some(CellError::Na));
/// ```
impl From<CellError> for CellValue {
    fn from(e: CellError) -> Self {
        CellValue::Error(e, None)
    }
}

// ---------------------------------------------------------------------------
// Core constructors and accessors
// ---------------------------------------------------------------------------

impl CellValue {
    /// Construct a Number value, mapping NaN and Infinity to #NUM! error (matching Excel behavior).
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::CellValue;
    ///
    /// // Normal finite values produce Number
    /// let v = CellValue::number(42.5);
    /// assert_eq!(v.as_number(), Some(42.5));
    ///
    /// // NaN maps to #NUM! error
    /// let v = CellValue::number(f64::NAN);
    /// assert!(v.is_error());
    ///
    /// // Infinity also maps to #NUM! error
    /// let v = CellValue::number(f64::INFINITY);
    /// assert!(v.is_error());
    /// ```
    #[must_use]
    #[inline]
    pub fn number(n: f64) -> CellValue {
        match FiniteF64::new(n) {
            Some(f) => CellValue::Number(f),
            None => CellValue::Error(CellError::Num, None),
        }
    }

    /// Create a number with a double-double error term.
    ///
    /// When `dd-precision` is not enabled, the `lo` parameter is ignored
    /// and this is equivalent to `CellValue::number(hi)`.
    #[must_use]
    pub fn number_dd(hi: f64, lo: f64) -> CellValue {
        match FiniteF64::with_dd(hi, lo) {
            Some(f) => CellValue::Number(f),
            None => CellValue::Error(CellError::Num, None),
        }
    }

    /// Create an array from flat row-major data with given column count.
    ///
    /// # Panics
    /// Panics if `cols` is 0 and `data` is non-empty, or if `data.len()` is not
    /// divisible by `cols`.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::CellValue;
    ///
    /// let arr = CellValue::array(vec![1.0.into(), 2.0.into(), 3.0.into(), 4.0.into()], 2);
    /// assert!(arr.as_array().is_some());
    /// assert_eq!(arr.as_array().unwrap().rows(), 2);
    /// assert_eq!(arr.as_array().unwrap().cols(), 2);
    /// ```
    #[must_use]
    pub fn array(data: Vec<CellValue>, cols: usize) -> Self {
        CellValue::Array(Arc::new(CellArray::new(data, cols)))
    }

    /// Create a single-column array (the hot path for range materialization).
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::CellValue;
    ///
    /// let arr = CellValue::column_array(vec![1.0.into(), 2.0.into()]);
    /// assert_eq!(arr.as_array().unwrap().cols(), 1);
    /// assert_eq!(arr.as_array().unwrap().rows(), 2);
    /// ```
    #[must_use]
    pub fn column_array(data: Vec<CellValue>) -> Self {
        CellValue::Array(Arc::new(CellArray::single_column(data)))
    }

    /// Create a single-row array.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::CellValue;
    ///
    /// let arr = CellValue::row_array(vec![1.0.into(), 2.0.into()]);
    /// assert_eq!(arr.as_array().unwrap().rows(), 1);
    /// assert_eq!(arr.as_array().unwrap().cols(), 2);
    /// ```
    #[must_use]
    pub fn row_array(data: Vec<CellValue>) -> Self {
        CellValue::Array(Arc::new(CellArray::single_row(data)))
    }

    /// Create an array from nested row vectors (legacy API -- prefer `array()` with flat data).
    /// This exists only to ease migration. Will be removed once all call sites use flat
    /// construction.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::CellValue;
    ///
    /// let arr = CellValue::from_rows(vec![vec![1.0.into(), 2.0.into()]]);
    /// assert!(arr.as_array().is_some());
    /// ```
    #[must_use]
    pub fn from_rows(rows: Vec<Vec<CellValue>>) -> Self {
        let num_cols = rows.first().map_or(0, std::vec::Vec::len);
        let data: Vec<CellValue> = rows
            .into_iter()
            .flat_map(std::iter::IntoIterator::into_iter)
            .collect();
        if data.is_empty() {
            CellValue::Array(Arc::new(CellArray::empty()))
        } else {
            CellValue::Array(Arc::new(CellArray::new(data, num_cols)))
        }
    }

    /// Check if this is a null/empty value.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::CellValue;
    ///
    /// assert!(CellValue::Null.is_null());
    /// assert!(!CellValue::Boolean(false).is_null());
    /// ```
    #[must_use]
    #[inline]
    pub fn is_null(&self) -> bool {
        matches!(self, CellValue::Null)
    }

    /// Whether this value appears blank to the user.
    ///
    /// Returns `true` for `Null` and for `Text` that is empty or whitespace-only.
    /// This is the canonical definition for all user-facing features (autofilter,
    /// pivot tables, conditional formatting, COUNTBLANK). For formula-level
    /// `ISBLANK()`, use `is_null()` instead.
    #[must_use]
    #[inline]
    pub fn is_visually_blank(&self) -> bool {
        match self {
            CellValue::Null => true,
            CellValue::Text(s) => s.trim().is_empty(),
            _ => false,
        }
    }

    /// Check if this is an error.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::{CellValue, CellError};
    ///
    /// assert!(CellValue::Error(CellError::Na, None).is_error());
    /// assert!(!CellValue::Null.is_error());
    /// ```
    #[must_use]
    #[inline]
    pub fn is_error(&self) -> bool {
        matches!(self, CellValue::Error(..))
    }

    /// Check if this is a number.
    #[must_use]
    #[inline]
    pub fn is_number(&self) -> bool {
        matches!(self, CellValue::Number(_))
    }

    /// Extract error if this is an error value.
    #[must_use]
    #[inline]
    pub fn as_error(&self) -> Option<CellError> {
        match self {
            CellValue::Error(e, _) => Some(*e),
            _ => None,
        }
    }

    /// Create an error with a diagnostic message.
    #[must_use]
    pub fn error_with_message(e: CellError, msg: impl Into<Arc<str>>) -> Self {
        CellValue::Error(e, Some(msg.into()))
    }

    /// Get the diagnostic message if this is an error with one.
    #[must_use]
    #[inline]
    pub fn error_message(&self) -> Option<&str> {
        match self {
            CellValue::Error(_, Some(msg)) => Some(msg),
            _ => None,
        }
    }

    /// Extract number if this is a numeric value.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::CellValue;
    ///
    /// assert_eq!(CellValue::number(5.0).as_number(), Some(5.0));
    /// assert_eq!(CellValue::Text("5".into()).as_number(), None);
    /// ```
    #[must_use]
    #[inline]
    pub fn as_number(&self) -> Option<f64> {
        match self {
            CellValue::Number(n) => Some(n.get()),
            _ => None,
        }
    }

    /// Extract text if this is a text value.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::CellValue;
    ///
    /// assert_eq!(CellValue::Text("hi".into()).as_text(), Some("hi"));
    /// assert_eq!(CellValue::number(1.0).as_text(), None);
    /// ```
    #[must_use]
    #[inline]
    pub fn as_text(&self) -> Option<&str> {
        match self {
            CellValue::Text(s) => Some(s),
            _ => None,
        }
    }

    /// Check if this is a text value.
    #[must_use]
    #[inline]
    pub fn is_text(&self) -> bool {
        matches!(self, CellValue::Text(_))
    }

    /// Check if this is a boolean value.
    #[must_use]
    #[inline]
    pub fn is_boolean(&self) -> bool {
        matches!(self, CellValue::Boolean(_))
    }

    /// Check if this is an array value.
    #[must_use]
    #[inline]
    pub fn is_array(&self) -> bool {
        matches!(self, CellValue::Array(_))
    }

    /// Check if this is an in-cell image value.
    #[must_use]
    #[inline]
    pub fn is_image(&self) -> bool {
        matches!(self, CellValue::Image(_))
    }

    /// Extract boolean if this is a boolean value.
    #[must_use]
    #[inline]
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            CellValue::Boolean(b) => Some(*b),
            CellValue::Control(c) => Some(c.value),
            _ => None,
        }
    }

    /// Extract array if this is an array value.
    #[must_use]
    #[inline]
    pub fn as_array(&self) -> Option<&CellArray> {
        match self {
            CellValue::Array(arr) => Some(arr.as_ref()),
            _ => None,
        }
    }

    /// Extract the image payload if this is an in-cell image value.
    #[must_use]
    #[inline]
    pub fn as_image(&self) -> Option<&CellImage> {
        match self {
            CellValue::Image(image) => Some(image),
            _ => None,
        }
    }

    /// Extract the `FiniteF64` if this is a numeric value.
    ///
    /// Unlike [`as_number()`](Self::as_number) which returns raw `f64`, this
    /// preserves the `FiniteF64` wrapper so callers stay inside the type-safe
    /// numeric domain.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::{CellValue, FiniteF64};
    ///
    /// let v = CellValue::number(5.0);
    /// let f = v.as_finite_f64().unwrap();
    /// assert_eq!(f.get(), 5.0);
    ///
    /// assert!(CellValue::Null.as_finite_f64().is_none());
    /// ```
    #[must_use]
    #[inline]
    pub fn as_finite_f64(&self) -> Option<FiniteF64> {
        match self {
            CellValue::Number(n) => Some(*n),
            _ => None,
        }
    }

    /// Extract the `FiniteF64` or return the contained error.
    ///
    /// This is the idiomatic one-step extraction that replaces the common
    /// two-step pattern:
    /// ```ignore
    /// let n = v.as_number().ok_or(CellError::Value)?;
    /// let f = FiniteF64::new(n).ok_or(CellError::Num)?;
    /// ```
    ///
    /// # Errors
    ///
    /// Returns `CellError::Value` for non-numeric, non-error values (Text,
    /// Boolean, Null, Array). Returns the contained error for `Error` variants.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::{CellValue, CellError};
    ///
    /// let v = CellValue::number(5.0);
    /// assert_eq!(v.try_as_finite_f64().unwrap().get(), 5.0);
    ///
    /// let e = CellValue::Error(CellError::Div0, None);
    /// assert_eq!(e.try_as_finite_f64(), Err(CellError::Div0));
    ///
    /// assert_eq!(CellValue::Null.try_as_finite_f64(), Err(CellError::Value));
    /// ```
    #[inline]
    pub fn try_as_finite_f64(&self) -> Result<FiniteF64, CellError> {
        match self {
            CellValue::Number(n) => Ok(*n),
            CellValue::Error(e, _) => Err(*e),
            _ => Err(CellError::Value),
        }
    }
}

/// Case-insensitive text comparison matching Excel semantics.
///
/// Text values are compared case-insensitively using Unicode `to_lowercase()`.
/// This matches Excel's `=("hello" = "HELLO")` which returns `TRUE`.
///
/// Note: This means `CellValue::Text("abc")` == `CellValue::Text("ABC")`.
/// This is intentional -- the compute engine needs Excel-compatible equality.
/// `CellValue` intentionally does NOT implement `Hash`, so this
/// non-standard `PartialEq` cannot cause hash-map inconsistencies.
impl PartialEq for CellValue {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (CellValue::Number(a), CellValue::Number(b)) => a == b,
            (CellValue::Text(a), CellValue::Text(b)) => {
                if a.is_ascii() && b.is_ascii() {
                    a.eq_ignore_ascii_case(b)
                } else {
                    a.chars()
                        .flat_map(char::to_lowercase)
                        .eq(b.chars().flat_map(char::to_lowercase))
                }
            }
            (CellValue::Boolean(a), CellValue::Boolean(b)) => a == b,
            (CellValue::Error(a, _), CellValue::Error(b, _)) => a == b,
            (CellValue::Null, CellValue::Null) => true,
            (CellValue::Array(a), CellValue::Array(b)) => a == b,
            (CellValue::Control(a), CellValue::Control(b)) => a == b,
            (CellValue::Image(a), CellValue::Image(b)) => a == b,
            _ => false,
        }
    }
}

impl Eq for CellValue {}

// ---------------------------------------------------------------------------
// TryFrom impls -- scalar extraction via standard conversion traits
// ---------------------------------------------------------------------------

/// Extract the inner `f64` from a `CellValue::Number`.
///
/// # Errors
///
/// Returns the contained `CellError` for error variants, or `CellError::Value`
/// for non-numeric types.
///
/// # Examples
///
/// ```
/// use value_types::{CellValue, CellError};
///
/// let v = CellValue::number(42.0);
/// let n: f64 = v.try_into().unwrap();
/// assert_eq!(n, 42.0);
///
/// let v = CellValue::from("hello");
/// assert_eq!(f64::try_from(v), Err(CellError::Value));
/// ```
impl TryFrom<CellValue> for f64 {
    type Error = CellError;

    #[inline]
    fn try_from(v: CellValue) -> Result<Self, Self::Error> {
        match v {
            CellValue::Number(n) => Ok(n.get()),
            CellValue::Error(e, _) => Err(e),
            _ => Err(CellError::Value),
        }
    }
}

/// Extract the inner `FiniteF64` from a `CellValue::Number`.
///
/// # Errors
///
/// Returns `CellError::Value` for non-numeric types, or the contained error.
///
/// # Examples
///
/// ```
/// use value_types::{CellValue, CellError, FiniteF64};
///
/// let v = CellValue::number(42.0);
/// let f: FiniteF64 = v.try_into().unwrap();
/// assert_eq!(f.get(), 42.0);
/// ```
impl TryFrom<CellValue> for FiniteF64 {
    type Error = CellError;

    #[inline]
    fn try_from(v: CellValue) -> Result<Self, Self::Error> {
        match v {
            CellValue::Number(n) => Ok(n),
            CellValue::Error(e, _) => Err(e),
            _ => Err(CellError::Value),
        }
    }
}

/// Extract the inner `bool` from a `CellValue::Boolean`.
///
/// # Errors
///
/// Returns `CellError::Value` for non-boolean types, or the contained error.
///
/// # Examples
///
/// ```
/// use value_types::{CellValue, CellError};
///
/// let v = CellValue::Boolean(true);
/// let b: bool = v.try_into().unwrap();
/// assert!(b);
///
/// let v = CellValue::number(1.0);
/// assert_eq!(bool::try_from(v), Err(CellError::Value));
/// ```
impl TryFrom<CellValue> for bool {
    type Error = CellError;

    #[inline]
    fn try_from(v: CellValue) -> Result<Self, Self::Error> {
        match v {
            CellValue::Boolean(b) => Ok(b),
            CellValue::Error(e, _) => Err(e),
            _ => Err(CellError::Value),
        }
    }
}

#[cfg(test)]
pub(crate) fn cv_number(v: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(v))
}
