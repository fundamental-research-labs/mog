//! Coercion methods for [`CellValue`] following Excel semantics.

use std::borrow::Cow;

use super::{CellValue, format_number};
use crate::CellError;

/// Parse a string as f64, rejecting NaN and ±∞.
///
/// `fast_float::parse` accepts "NaN", "inf", and overflow values like "1e309",
/// returning non-finite f64s. This wrapper enforces the crate's finite-only
/// invariant at the trust boundary between the external parser and our domain.
fn parse_finite(s: &str) -> Option<f64> {
    fast_float::parse::<f64, _>(s)
        .ok()
        .filter(|v| v.is_finite())
}

/// Quick check for date/time separators to avoid expensive parsing on plain words.
fn has_date_separator(s: &str) -> bool {
    s.bytes()
        .any(|b| matches!(b, b'/' | b'-' | b':' | b' ' | b','))
}

/// Try to parse trimmed text as a date, datetime, or time serial value.
/// Returns `None` if the text does not match any recognized date/time format.
fn try_parse_date_text(trimmed: &str) -> Option<f64> {
    crate::date_serial::try_parse_date(trimmed)
        .ok()
        .or_else(|| crate::date_serial::try_parse_datetime(trimmed).ok())
        .or_else(|| crate::date_serial::try_parse_time(trimmed).ok())
}

impl CellValue {
    /// Coerce for criteria/comparison contexts (SUMIF, COUNTIF, AVERAGEIF, etc.).
    ///
    /// Unlike `coerce_to_number()` which uses arithmetic semantics (Null -> 0,
    /// Boolean -> 0/1), this method enforces participation rules: only `Number`
    /// and parseable `Text` cells are comparable. Null, Boolean, Error, Array,
    /// and Array values are non-participants and return `None`.
    ///
    /// This matches Excel's behavior where empty and boolean cells never
    /// participate in numeric criteria matching.
    #[must_use]
    pub fn as_comparable_number(&self) -> Option<f64> {
        match self {
            CellValue::Number(n) => Some(n.get()),
            CellValue::Text(s) => {
                if s.is_empty() {
                    None
                } else {
                    let trimmed = s.trim();
                    parse_finite(trimmed).or_else(|| {
                        // Date/time text must contain a separator (/, -, :, space, or comma).
                        // Skip parsing for pure-alpha or separator-free text like "Revenue",
                        // "Active", "CONTRACT12345" -- these dominate criteria ranges.
                        if !has_date_separator(trimmed) {
                            return None;
                        }
                        try_parse_date_text(trimmed)
                    })
                }
            }
            _ => None, // Null, Boolean, Error, Array, Control -> non-participant
        }
    }

    /// Coerce this cell value to a number, following Excel coercion rules.
    ///
    /// - `Null` (empty cell) -> `0.0` (Excel treats blank cells as 0 in arithmetic)
    /// - `Text("")` -> `Err(Value)` (empty string is NOT the same as blank cell)
    /// - `Text("5")` -> `Ok(5.0)` (parseable numeric strings coerce)
    /// - `Boolean(true)` -> `1.0`, `Boolean(false)` -> `0.0`
    ///
    /// In Excel, `="" + 1` -> `#VALUE!` but `empty_cell + 1` -> `1`.
    ///
    /// # Known divergence
    ///
    /// Text parsing uses `fast_float` which accepts scientific notation (e.g., `"1e5"`)
    /// that Excel cell input does not. Excel formulas like `VALUE("1E5")` do parse
    /// scientific notation, so this divergence only matters for direct cell input coercion.
    ///
    /// # Errors
    ///
    /// Returns `CellError` when the value cannot be coerced to a number:
    /// - `CellError::Value` for non-numeric text and arrays
    /// - The original error for `CellValue::Error` variants
    #[inline]
    pub fn coerce_to_number(&self) -> Result<f64, CellError> {
        match self {
            CellValue::Number(n) => Ok(n.get()),
            CellValue::Null => Ok(0.0),
            CellValue::Boolean(b) => Ok(if *b { 1.0 } else { 0.0 }),
            CellValue::Text(s) => {
                let trimmed = s.trim();
                if trimmed.is_empty() {
                    Err(CellError::Value)
                } else {
                    parse_finite(trimmed).ok_or(CellError::Value).or_else(|_| {
                        // Same pre-check as as_comparable_number: skip date parsing
                        // for text without date/time separators.
                        if !has_date_separator(trimmed) {
                            return Err(CellError::Value);
                        }
                        try_parse_date_text(trimmed).ok_or(CellError::Value)
                    })
                }
            }
            CellValue::Error(e, _) => Err(*e),
            CellValue::Array(_) | CellValue::Image(_) => Err(CellError::Value),
            CellValue::Control(c) => Ok(if c.value { 1.0 } else { 0.0 }),
        }
    }

    /// Coerce to string (Excel coercion rules).
    ///
    /// Returns `Cow::Borrowed` for Text and Null (zero-allocation fast path),
    /// and `Cow::Owned` for Number and Boolean (requires formatting).
    ///
    /// # Errors
    /// Returns the cell's error for `Error` variants, or `CellError::Value` for `Array`.
    #[inline]
    pub fn coerce_to_string(&self) -> Result<Cow<'_, str>, CellError> {
        match self {
            CellValue::Text(s) => Ok(Cow::Borrowed(s)),
            CellValue::Null => Ok(Cow::Borrowed("")),
            CellValue::Number(n) => Ok(Cow::Owned(format_number(n.get()))),
            CellValue::Boolean(b) => Ok(Cow::Borrowed(if *b { "TRUE" } else { "FALSE" })),
            CellValue::Error(e, _) => Err(*e),
            CellValue::Array(_) => Err(CellError::Value),
            CellValue::Control(c) => Ok(Cow::Borrowed(if c.value { "TRUE" } else { "FALSE" })),
            CellValue::Image(image) => Ok(Cow::Borrowed(image.fallback_text())),
        }
    }

    /// Coerce to boolean (Excel coercion rules).
    ///
    /// # Known divergence
    ///
    /// Uses `eq_ignore_ascii_case` for "TRUE"/"FALSE" comparison, which matches
    /// Excel's ASCII-only behavior. Non-ASCII case folding (e.g., Turkish dotless-i)
    /// is intentionally not supported -- Excel itself is ASCII-only here.
    ///
    /// # Errors
    ///
    /// Returns `CellError` when the value cannot be coerced to a boolean:
    /// - `CellError::Value` for non-boolean text and arrays
    /// - The original error for `CellValue::Error` variants
    #[inline]
    pub fn coerce_to_bool(&self) -> Result<bool, CellError> {
        match self {
            CellValue::Boolean(b) => Ok(*b),
            CellValue::Null => Ok(false),
            CellValue::Number(n) => Ok(n.get() != 0.0),
            CellValue::Text(s) => {
                if s.eq_ignore_ascii_case("TRUE") {
                    Ok(true)
                } else if s.eq_ignore_ascii_case("FALSE") {
                    Ok(false)
                } else {
                    Err(CellError::Value)
                }
            }
            CellValue::Error(e, _) => Err(*e),
            CellValue::Array(_) | CellValue::Image(_) => Err(CellError::Value),
            CellValue::Control(c) => Ok(c.value),
        }
    }
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;
    use crate::cell_value::cv_number as n;

    #[test]
    fn test_coerce_null_to_number() {
        assert_eq!(CellValue::Null.coerce_to_number().unwrap(), 0.0);
    }

    #[test]
    fn test_coerce_bool_to_number() {
        assert_eq!(CellValue::Boolean(true).coerce_to_number().unwrap(), 1.0);
        assert_eq!(CellValue::Boolean(false).coerce_to_number().unwrap(), 0.0);
    }

    #[test]
    fn test_coerce_text_to_number() {
        assert_eq!(
            CellValue::Text("42.5".into()).coerce_to_number().unwrap(),
            42.5
        );
        assert!(CellValue::Text("hello".into()).coerce_to_number().is_err());
    }

    #[test]
    fn test_error_propagation() {
        assert_eq!(
            CellValue::Error(CellError::Div0, None).coerce_to_number(),
            Err(CellError::Div0)
        );
    }

    // === as_comparable_number tests (criteria/comparison context) ===

    #[test]
    fn comparable_number_from_number() {
        assert_eq!(n(5.0).as_comparable_number(), Some(5.0));
        assert_eq!(n(0.0).as_comparable_number(), Some(0.0));
        assert_eq!(n(-3.25).as_comparable_number(), Some(-3.25));
    }

    #[test]
    fn comparable_number_from_parseable_text() {
        assert_eq!(
            CellValue::Text("42".into()).as_comparable_number(),
            Some(42.0)
        );
        assert_eq!(
            CellValue::Text(" 3.25 ".into()).as_comparable_number(),
            Some(3.25)
        );
    }

    #[test]
    fn comparable_number_non_participants() {
        assert_eq!(CellValue::Null.as_comparable_number(), None);
        assert_eq!(CellValue::Boolean(false).as_comparable_number(), None);
        assert_eq!(CellValue::Boolean(true).as_comparable_number(), None);
        assert_eq!(CellValue::Text("".into()).as_comparable_number(), None);
        assert_eq!(CellValue::Text("hello".into()).as_comparable_number(), None);
        assert_eq!(
            CellValue::Error(CellError::Value, None).as_comparable_number(),
            None
        );
        assert_eq!(
            CellValue::Error(CellError::Na, None).as_comparable_number(),
            None
        );
        assert_eq!(CellValue::from_rows(vec![]).as_comparable_number(), None);
    }

    // === coerce_to_string tests ===

    #[test]
    fn coerce_to_string_number_integer_like() {
        let v = n(42.0);
        let r = v.coerce_to_string().unwrap();
        assert_eq!(r.as_ref(), "42");
    }

    #[test]
    fn coerce_to_string_number_decimal() {
        let v = n(3.25);
        let r = v.coerce_to_string().unwrap();
        assert_eq!(r.as_ref(), "3.25");
    }

    #[test]
    fn coerce_to_string_text() {
        let v = CellValue::Text("hello".into());
        let r = v.coerce_to_string().unwrap();
        assert_eq!(r.as_ref(), "hello");
    }

    #[test]
    fn coerce_to_string_bool_true() {
        assert_eq!(
            CellValue::Boolean(true)
                .coerce_to_string()
                .unwrap()
                .as_ref(),
            "TRUE"
        );
    }

    #[test]
    fn coerce_to_string_bool_false() {
        assert_eq!(
            CellValue::Boolean(false)
                .coerce_to_string()
                .unwrap()
                .as_ref(),
            "FALSE"
        );
    }

    #[test]
    fn coerce_to_string_error() {
        assert_eq!(
            CellValue::Error(CellError::Div0, None).coerce_to_string(),
            Err(CellError::Div0)
        );
    }

    #[test]
    fn coerce_to_string_null() {
        assert_eq!(CellValue::Null.coerce_to_string().unwrap().as_ref(), "");
    }

    #[test]
    fn coerce_to_string_array_errors() {
        let arr = CellValue::from_rows(vec![vec![n(1.0)]]);
        assert_eq!(arr.coerce_to_string(), Err(CellError::Value));
    }

    // === coerce_to_bool tests ===

    #[test]
    fn coerce_to_bool_text_true_variants() {
        assert!(CellValue::Text("true".into()).coerce_to_bool().unwrap());
        assert!(CellValue::Text("True".into()).coerce_to_bool().unwrap());
        assert!(CellValue::Text("tRuE".into()).coerce_to_bool().unwrap());
        assert!(CellValue::Text("TRUE".into()).coerce_to_bool().unwrap());
    }

    #[test]
    fn coerce_to_bool_text_false_variants() {
        assert!(!CellValue::Text("false".into()).coerce_to_bool().unwrap());
        assert!(!CellValue::Text("FALSE".into()).coerce_to_bool().unwrap());
    }

    #[test]
    fn coerce_to_bool_empty_text_errors() {
        assert_eq!(
            CellValue::Text("".into()).coerce_to_bool(),
            Err(CellError::Value)
        );
    }

    #[test]
    fn coerce_to_bool_numbers() {
        assert!(!n(0.0).coerce_to_bool().unwrap());
        assert!(!n(-0.0).coerce_to_bool().unwrap());
        assert!(n(1.0).coerce_to_bool().unwrap());
        assert!(n(-1.0).coerce_to_bool().unwrap());
    }

    #[test]
    fn coerce_to_bool_error_propagation() {
        assert_eq!(
            CellValue::Error(CellError::Na, None).coerce_to_bool(),
            Err(CellError::Na)
        );
    }

    #[test]
    fn coerce_to_bool_array_errors() {
        let arr = CellValue::from_rows(vec![]);
        assert_eq!(arr.coerce_to_bool(), Err(CellError::Value));
    }

    #[test]
    fn coerce_to_bool_null() {
        assert!(!CellValue::Null.coerce_to_bool().unwrap());
    }

    // === coerce_to_number extended tests ===

    #[test]
    fn coerce_to_number_whitespace_trimming() {
        assert_eq!(
            CellValue::Text(" 42 ".into()).coerce_to_number().unwrap(),
            42.0
        );
    }

    #[test]
    fn coerce_to_number_scientific_notation() {
        assert_eq!(
            CellValue::Text("1e5".into()).coerce_to_number().unwrap(),
            100_000.0
        );
    }

    #[test]
    fn coerce_to_number_negative() {
        assert_eq!(
            CellValue::Text("-3.25".into()).coerce_to_number().unwrap(),
            -3.25
        );
    }

    #[test]
    fn coerce_to_number_empty_string() {
        // Excel: Text("") in arithmetic -> #VALUE! (not the same as Null/empty cell -> 0)
        assert_eq!(
            CellValue::Text("".into()).coerce_to_number(),
            Err(CellError::Value)
        );
    }

    #[test]
    fn coerce_to_number_whitespace_only() {
        // Excel: Text("  ") in arithmetic -> #VALUE!
        assert_eq!(
            CellValue::Text("  ".into()).coerce_to_number(),
            Err(CellError::Value)
        );
    }

    #[test]
    fn coerce_to_number_very_large() {
        let v = CellValue::Text("1e308".into()).coerce_to_number().unwrap();
        assert_eq!(v, 1e308);
    }

    #[test]
    fn coerce_to_number_error_propagation_all() {
        assert_eq!(
            CellValue::Error(CellError::Ref, None).coerce_to_number(),
            Err(CellError::Ref)
        );
        assert_eq!(
            CellValue::Error(CellError::Name, None).coerce_to_number(),
            Err(CellError::Name)
        );
    }

    // === Regression tests: NaN/Infinity must never leak through coercion ===

    #[test]
    fn coerce_to_number_rejects_nan_text() {
        assert_eq!(
            CellValue::Text("NaN".into()).coerce_to_number(),
            Err(CellError::Value)
        );
        assert_eq!(
            CellValue::Text("nan".into()).coerce_to_number(),
            Err(CellError::Value)
        );
    }

    #[test]
    fn coerce_to_number_rejects_infinity_text() {
        assert_eq!(
            CellValue::Text("inf".into()).coerce_to_number(),
            Err(CellError::Value)
        );
        assert_eq!(
            CellValue::Text("Infinity".into()).coerce_to_number(),
            Err(CellError::Value)
        );
        assert_eq!(
            CellValue::Text("-inf".into()).coerce_to_number(),
            Err(CellError::Value)
        );
    }

    #[test]
    fn coerce_to_number_rejects_overflow() {
        // 1e309 overflows f64 to infinity — must be rejected
        assert_eq!(
            CellValue::Text("1e309".into()).coerce_to_number(),
            Err(CellError::Value)
        );
        assert_eq!(
            CellValue::Text("-1e309".into()).coerce_to_number(),
            Err(CellError::Value)
        );
    }

    #[test]
    fn as_comparable_rejects_nan_text() {
        assert_eq!(CellValue::Text("NaN".into()).as_comparable_number(), None);
        assert_eq!(CellValue::Text("nan".into()).as_comparable_number(), None);
    }

    #[test]
    fn as_comparable_rejects_infinity_text() {
        assert_eq!(CellValue::Text("inf".into()).as_comparable_number(), None);
        assert_eq!(CellValue::Text("1e309".into()).as_comparable_number(), None);
    }

    // === Date parsing through coerce_to_number ===

    #[test]
    fn coerce_to_number_datetime_ampm() {
        let v = CellValue::Text("01/30/2026 03:50 PM".into());
        let n = v.coerce_to_number().unwrap();
        assert!((n - 46_052.659_722_222_22).abs() < 1e-6);
    }

    #[test]
    fn coerce_to_number_datetime_ampm_arithmetic() {
        // Simulates the workbook pattern: "01/30/2026 03:50 PM" - 0.25
        let v = CellValue::Text("01/30/2026 03:50 PM".into());
        let n = v.coerce_to_number().unwrap();
        let result = n - 0.25;
        assert!((result - 46_052.409_722_222_22).abs() < 1e-6);
    }

    #[test]
    fn as_comparable_number_scientific_notation() {
        assert_eq!(
            CellValue::Text("1e5".into()).as_comparable_number(),
            Some(100_000.0)
        );
        assert_eq!(
            CellValue::Text("2.5E3".into()).as_comparable_number(),
            Some(2500.0)
        );
    }

    #[test]
    fn coerce_to_bool_whitespace_only_text() {
        assert_eq!(
            CellValue::Text("   ".into()).coerce_to_bool(),
            Err(CellError::Value)
        );
    }

    #[test]
    fn coerce_to_number_date_jan_1_2024() {
        let result = CellValue::from("1/1/2024").coerce_to_number();
        assert!(result.is_ok(), "expected Ok, got {result:?}");
        let serial = result.unwrap();
        // Dates after 2009 should have serial > 40000
        assert!(serial > 40_000.0, "serial {serial} too small for 2024 date");
    }

    #[test]
    fn coerce_to_number_date_dec_31_2023() {
        let result = CellValue::from("12/31/2023").coerce_to_number();
        assert!(result.is_ok(), "expected Ok, got {result:?}");
        let serial = result.unwrap();
        assert!(serial > 40_000.0, "serial {serial} too small for 2023 date");
    }

    #[test]
    fn coerce_to_number_date_ordering() {
        let jan1 = CellValue::from("1/1/2024").coerce_to_number().unwrap();
        let dec31 = CellValue::from("12/31/2023").coerce_to_number().unwrap();
        assert!(
            jan1 > dec31,
            "Jan 1 2024 ({jan1}) should be after Dec 31 2023 ({dec31})"
        );
    }
}
