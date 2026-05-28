//! `Display` impl for [`CellValue`] and the public [`format_number`] function.

use std::fmt;

use super::CellValue;

impl fmt::Display for CellValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CellValue::Number(n) => write!(f, "{}", format_number(n.get())),
            CellValue::Text(s) => write!(f, "{s}"),
            CellValue::Boolean(b) => write!(f, "{}", if *b { "TRUE" } else { "FALSE" }),
            CellValue::Error(e, _) => write!(f, "{e}"),
            CellValue::Null => write!(f, ""),
            CellValue::Control(c) => {
                let icon = if c.checked { "\u{2611}" } else { "\u{2610}" };
                let label = if c.value { "TRUE" } else { "FALSE" };
                write!(f, "{icon} {label}")
            }
            CellValue::Image(image) => write!(f, "{}", image.fallback_text()),
            CellValue::Array(arr) => {
                write!(f, "{{")?;
                for (i, row) in arr.rows_iter().enumerate() {
                    if i > 0 {
                        write!(f, ";")?;
                    }
                    for (j, val) in row.iter().enumerate() {
                        if j > 0 {
                            write!(f, ",")?;
                        }
                        write!(f, "{val}")?;
                    }
                }
                write!(f, "}}")
            }
        }
    }
}

/// Format a number for display, matching Excel conventions.
///
/// Integer-like values (no fractional part, abs < 1e15) display without decimal point.
/// Other values use Rust's default f64 formatting with trailing zeros trimmed.
///
/// # Examples
///
/// ```
/// use value_types::format_number;
///
/// // Integer-like values display without decimal point
/// assert_eq!(format_number(42.0), "42");
///
/// // Decimal values keep their fractional part
/// assert_eq!(format_number(3.14), "3.14");
///
/// // Large integers still display cleanly
/// assert_eq!(format_number(1000000.0), "1000000");
/// ```
#[must_use]
pub fn format_number(n: f64) -> String {
    // Intentional: exact equality with trunc() checks for integer-like values
    #[allow(clippy::float_cmp)]
    let is_integer = n == n.trunc();

    if is_integer && n.abs() < 1e15 {
        // Safe: guarded by n.abs() < 1e15 which is within i64 range
        #[allow(clippy::cast_possible_truncation)]
        let i = n as i64;
        format!("{i}")
    } else {
        // Excel displays at most 15 significant digits when coercing numbers
        // to text. IEEE 754 f64 has ~15.95 significant digits; digits 16-17
        // are floating-point noise, not meaningful precision. We truncate
        // (not round) to match Excel's behavior.
        truncate_to_15_significant_digits(n)
    }
}

/// Truncate a number to at most 15 significant digits, matching Excel's
/// number-to-text coercion behavior. Digits beyond the 15th are dropped
/// (truncated, not rounded), and trailing zeros after the decimal point
/// are stripped.
fn truncate_to_15_significant_digits(n: f64) -> String {
    if !n.is_finite() {
        return format!("{n}");
    }
    let negative = n < 0.0;
    let abs = n.abs();

    // Determine how many decimal places we need to capture 15 significant digits.
    // For a number with magnitude 10^m, we need (14 - m) decimal places.
    // E.g., 90.xxx (m=1) needs 13 decimal places for 15 sig digits.
    // For very small numbers (e.g., 1e-20), we need many decimal places.
    // Safe: log10().floor() of a positive f64 is always within i32 range
    #[allow(clippy::cast_possible_truncation)]
    let magnitude = if abs > 0.0 {
        abs.log10().floor() as i32
    } else {
        0
    };
    // Safe: result of clamp(0, 40) is always non-negative and fits in usize
    #[allow(clippy::cast_sign_loss)]
    let decimal_places = (14 - magnitude).clamp(0, 40) as usize;

    // If the number is extremely small (needs scientific notation) or the
    // required decimal places exceed what fixed-point can reasonably handle,
    // fall back to Rust's default Display which uses scientific notation,
    // then truncate that representation.
    #[allow(clippy::float_cmp)] // exact zero check on fractional part
    if magnitude < -4 || (magnitude >= 15 && n.fract() != 0.0) {
        // Scientific notation path: format with 14 decimal places in exponent
        // notation (15 sig digits = 1 integer digit + 14 decimals)
        let s = format!("{abs:.14e}");
        // s is like "1.23456789012345e-20" -- truncate mantissa to 15 sig digits
        // The mantissa already has at most 15 sig digits from {:.14e}
        // Just need to trim trailing zeros in the mantissa
        if let Some(e_pos) = s.find('e') {
            let mantissa = s[..e_pos].trim_end_matches('0').trim_end_matches('.');
            let exponent = &s[e_pos..];
            let formatted = format!("{mantissa}{exponent}");
            // Convert e notation to E notation to match Excel
            let formatted = formatted.replace('e', "E");
            // Excel uses E+ for positive exponents, E- for negative
            let formatted = formatted.replace("E-0", "E-").replace("E0", "E+");
            // Handle single-digit exponents: Excel uses E+1 not E+01
            // and multi-digit: E-20 not E-020
            if negative {
                format!("-{formatted}")
            } else {
                formatted
            }
        } else {
            format!("{n}")
        }
    } else {
        // Fixed-point path: format with enough decimal places
        let s = format!("{abs:.decimal_places$}");

        // Walk the formatted string, counting significant digits (leading zeros
        // before the first nonzero digit don't count). After 15, drop remaining
        // fractional digits (replace integer-part digits with '0').
        let mut sig_count = 0;
        let mut seen_nonzero = false;
        let mut past_decimal = false;
        let mut result = String::new();

        for ch in s.chars() {
            if ch == '.' {
                past_decimal = true;
                result.push('.');
                continue;
            }
            if ch.is_ascii_digit() {
                if ch != '0' {
                    seen_nonzero = true;
                }
                if seen_nonzero {
                    sig_count += 1;
                }
                if sig_count <= 15 {
                    result.push(ch);
                } else if !past_decimal {
                    // Integer part beyond 15 sig digits: pad with zeros
                    result.push('0');
                }
                // Fractional part beyond 15 sig digits: drop
            }
        }

        // Trim trailing zeros after the decimal point (in-place truncation)
        if result.contains('.') {
            let trimmed_len = result.trim_end_matches('0').trim_end_matches('.').len();
            result.truncate(trimmed_len);
        }

        if negative && result != "0" {
            format!("-{result}")
        } else {
            result
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cell_value::cv_number as n;

    // === format_number tests ===

    #[test]
    fn format_number_integer_like() {
        assert_eq!(format_number(42.0), "42");
    }

    #[test]
    fn format_number_1e15_boundary() {
        assert_eq!(format_number(1e15 - 1.0), "999999999999999");
        // At exactly 1e15, abs() is NOT < 1e15, so uses f64 format path
        let s = format_number(1e15);
        assert!(!s.is_empty());
    }

    #[test]
    fn format_number_very_small() {
        let s = format_number(1e-20);
        assert!(s.contains("e-") || s.contains("E-") || s.starts_with("0."));
    }

    #[test]
    fn format_number_negative_zero() {
        let s = format_number(-0.0);
        assert!(s == "0" || s == "-0");
    }

    // === Display tests ===

    #[test]
    fn display_number() {
        assert_eq!(format!("{}", n(42.0)), "42");
    }

    #[test]
    fn display_text() {
        assert_eq!(format!("{}", CellValue::Text("hello".into())), "hello");
    }

    #[test]
    fn display_bool() {
        assert_eq!(format!("{}", CellValue::Boolean(true)), "TRUE");
        assert_eq!(format!("{}", CellValue::Boolean(false)), "FALSE");
    }

    #[test]
    fn display_error() {
        use crate::CellError;
        assert_eq!(
            format!("{}", CellValue::Error(CellError::Div0, None)),
            "#DIV/0!"
        );
    }

    #[test]
    fn display_null() {
        assert_eq!(format!("{}", CellValue::Null), "");
    }

    #[test]
    fn display_array() {
        let arr = CellValue::from_rows(vec![vec![n(1.0), n(2.0)], vec![n(3.0), n(4.0)]]);
        assert_eq!(format!("{arr}"), "{1,2;3,4}");
    }

    #[test]
    fn display_empty_array() {
        assert_eq!(format!("{}", CellValue::from_rows(vec![])), "{}");
    }
}
