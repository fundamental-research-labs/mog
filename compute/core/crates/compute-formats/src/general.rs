//! General number formatting (Excel "General" format).
//!
//! Excel's General format renders numbers without a fixed precision pattern.
//! It is the default when no format code is set and is what `format_idx = 0`
//! resolves to.
//!
//! # Excel-faithful rules
//!
//! Excel preserves up to 15 significant digits internally and General format
//! shows that full precision in wide-enough columns. This module produces the
//! canonical text at full precision — the renderer is responsible for any
//! column-width-driven truncation or overflow display (`#####`).
//!
//! 1. Integers with absolute value < 10^15 render with no thousands separator
//!    (`1234567`, never `1,234,567`).
//! 2. Otherwise, format the value with up to 15 significant digits, rounding
//!    (not truncating) to suppress IEEE 754 representation noise. Trailing
//!    zeros after the decimal point are stripped.
//! 3. Switch to scientific notation when the magnitude is too small (`< 1e-4`,
//!    matching Excel's `0.0001` cut-off) or too large to fit in 15 integer
//!    digits.
//! 4. Scientific notation uses a capital `E`, an explicit sign on the
//!    exponent, and a minimum of two digits in the exponent
//!    (`1.23E+05`, `1E-05`, `1.23E+100`).
//! 5. Negative numbers carry a leading minus sign.
//! 6. NaN / Infinity render as `#NUM!` so they surface like an error string;
//!    the upstream error-display path handles real `CellError` values.

/// Maximum significant digits Excel's General format preserves (matches the
/// 15-digit IEEE 754 double-precision storage limit).
const GENERAL_MAX_SIG_DIGITS: u32 = 15;

/// Magnitude (exponent of 10) at or above which we must switch to scientific
/// notation because the integer part would not fit in `GENERAL_MAX_SIG_DIGITS`
/// columns.
const GENERAL_SCIENTIFIC_HIGH_EXP: i32 = GENERAL_MAX_SIG_DIGITS as i32; // 15

/// Magnitude below which we switch to scientific. Matches Excel: values < 1e-4
/// (i.e., `0.00009999...`) render as `9.999...E-05`.
const GENERAL_SCIENTIFIC_LOW_EXP: i32 = -4;

pub(crate) fn format_general(value: f64) -> String {
    if value.is_nan() || value.is_infinite() {
        return "#NUM!".to_string();
    }
    if value == 0.0 {
        return "0".to_string();
    }

    // Integer-like values that fit in 15 digits render without separators.
    #[allow(clippy::float_cmp)] // Exact check is correct: we want lossless i64 display
    if value == value.trunc() && value.abs() < 10f64.powi(GENERAL_SCIENTIFIC_HIGH_EXP) {
        // Safe: bounded by 10^15 ≪ i64::MAX
        return format!("{}", value as i64);
    }

    let abs = value.abs();
    // Safe: log10 of a positive finite f64 fits in i32.
    let magnitude = abs.log10().floor() as i32;

    if (GENERAL_SCIENTIFIC_LOW_EXP..GENERAL_SCIENTIFIC_HIGH_EXP).contains(&magnitude) {
        round_to_sig_digits(value, GENERAL_MAX_SIG_DIGITS)
    } else {
        format_scientific(value, GENERAL_MAX_SIG_DIGITS)
    }
}

/// Round `value` to `sig` significant digits and return the display string
/// with trailing fractional zeros and trailing decimal point stripped. Used
/// for the fixed-notation branch of General format.
fn round_to_sig_digits(value: f64, sig: u32) -> String {
    let negative = value < 0.0;
    let abs = value.abs();

    // Number of digits before the decimal point.
    let magnitude = abs.log10().floor() as i32;
    // Decimal places needed to achieve `sig` significant digits.
    let decimal_places = (sig as i32 - 1 - magnitude).max(0);

    // Round at the required precision.
    let factor = 10f64.powi(decimal_places);
    let rounded = (abs * factor).round() / factor;

    // After rounding, the magnitude can step up (e.g. 9.9999... → 10) which
    // would push us into scientific territory. Re-check.
    if rounded.log10().floor() as i32 >= GENERAL_SCIENTIFIC_HIGH_EXP {
        return format_scientific(value, sig);
    }

    let s = format!("{:.prec$}", rounded, prec = decimal_places as usize);
    let trimmed = if s.contains('.') {
        s.trim_end_matches('0').trim_end_matches('.')
    } else {
        &s
    };
    if negative && trimmed != "0" {
        format!("-{trimmed}")
    } else {
        trimmed.to_string()
    }
}

/// Render `value` in Excel-style scientific notation with up to `sig`
/// significant digits in the mantissa. Examples:
/// `1.23E+05`, `-9.9E+11`, `1E-05`, `1.234E+100`.
fn format_scientific(value: f64, sig: u32) -> String {
    let negative = value < 0.0;
    let abs = value.abs();

    // Compute mantissa and exponent: value = mantissa * 10^exp, 1 <= |mantissa| < 10.
    let exp = abs.log10().floor() as i32;
    let mantissa = abs / 10f64.powi(exp);

    // Round mantissa to `sig - 1` decimal places (sig sig digits total: 1
    // before the decimal + (sig - 1) after).
    let prec = (sig - 1) as usize;
    // Guard against rounding pushing the mantissa to 10 — re-normalize.
    let factor = 10f64.powi(prec as i32);
    let rounded_mantissa = (mantissa * factor).round() / factor;
    let (mantissa_text, final_exp) = if rounded_mantissa >= 10.0 {
        (format!("{:.prec$}", rounded_mantissa / 10.0), exp + 1)
    } else {
        (format!("{rounded_mantissa:.prec$}"), exp)
    };

    // Strip trailing zeros after the decimal point, then a trailing decimal
    // point (e.g. `1.000` → `1`, `1.230` → `1.23`).
    let mantissa_trimmed = if mantissa_text.contains('.') {
        mantissa_text
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    } else {
        mantissa_text
    };

    // Format exponent with sign and minimum two digits.
    let exp_sign = if final_exp >= 0 { '+' } else { '-' };
    let exp_abs = final_exp.unsigned_abs();
    let exp_text = if exp_abs < 10 {
        format!("0{exp_abs}")
    } else {
        format!("{exp_abs}")
    };

    let sign = if negative { "-" } else { "" };
    format!("{sign}{mantissa_trimmed}E{exp_sign}{exp_text}")
}

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------
    // Integer rendering
    // -------------------------------------------------------------------

    #[test]
    fn integer_simple() {
        assert_eq!(format_general(0.0), "0");
        assert_eq!(format_general(1.0), "1");
        assert_eq!(format_general(42.0), "42");
        assert_eq!(format_general(1234.0), "1234"); // No thousands separator
        assert_eq!(format_general(1234567.0), "1234567");
    }

    #[test]
    fn integer_negative() {
        assert_eq!(format_general(-1.0), "-1");
        assert_eq!(format_general(-42.5), "-42.5");
        assert_eq!(format_general(-1234.0), "-1234");
    }

    #[test]
    fn integer_fifteen_digits_just_fits() {
        // 999,999,999,999,999 = 15 digits, magnitude 14 → fixed notation
        assert_eq!(format_general(999_999_999_999_999.0), "999999999999999");
    }

    #[test]
    fn integer_sixteen_digits_goes_scientific() {
        // 1e15 = magnitude 15 → scientific
        let s = format_general(1e15);
        assert_eq!(s, "1E+15");
        let s = format_general(1.23e16);
        assert_eq!(s, "1.23E+16");
    }

    // -------------------------------------------------------------------
    // Decimal rendering
    // -------------------------------------------------------------------

    #[test]
    fn decimal_simple() {
        assert_eq!(format_general(1.23), "1.23");
        assert_eq!(format_general(0.5), "0.5");
        assert_eq!(format_general(3.14159), "3.14159");
    }

    #[test]
    fn decimal_fifteen_sig_digits() {
        // 15 sig digits is the max — value rounds at the 15th digit
        assert_eq!(format_general(1.234567890123456), "1.23456789012346");
    }

    #[test]
    fn decimal_ieee754_noise_suppressed() {
        // 461.7 stored as 461.69999999... — rounding at 15 sig digits gives 461.7
        assert_eq!(format_general(461.7), "461.7");
        // 0.1 + 0.2 = 0.30000000000000004 — should display "0.3"
        assert_eq!(format_general(0.1 + 0.2), "0.3");
    }

    // -------------------------------------------------------------------
    // Scientific switchover
    // -------------------------------------------------------------------

    #[test]
    fn very_small_uses_scientific() {
        // 1e-5 < 1e-4 → scientific with 2-digit exponent
        assert_eq!(format_general(1e-5), "1E-05");
        // 1.23e-7 → scientific
        assert_eq!(format_general(1.23e-7), "1.23E-07");
    }

    #[test]
    fn boundary_one_e_minus_four_fixed() {
        // Magnitude exactly -4 → still fixed (Excel boundary)
        assert_eq!(format_general(0.0001), "0.0001");
        // Magnitude -5 (0.00009...) → scientific
        let s = format_general(0.00009);
        assert_eq!(s, "9E-05");
    }

    #[test]
    fn very_large_uses_scientific() {
        assert_eq!(format_general(1.23e15), "1.23E+15");
        // Three-digit exponent kept as-is (no leading zero pad past 2)
        assert_eq!(format_general(1e100), "1E+100");
    }

    #[test]
    fn scientific_capital_e_with_sign() {
        // Always capital E, always sign present
        let s = format_general(1e15);
        assert!(s.contains("E+"), "got {s}");
        let s = format_general(1e-5);
        assert!(s.contains("E-"), "got {s}");
        // Never lowercase e
        for n in [1e15, 1e-5, 1.5e20, -1.23e-10] {
            let s = format_general(n);
            assert!(!s.contains('e'), "expected capital E only, got {s}");
        }
    }

    #[test]
    fn scientific_negative() {
        assert_eq!(format_general(-1.23e15), "-1.23E+15");
        assert_eq!(format_general(-1e-5), "-1E-05");
    }

    #[test]
    fn scientific_mantissa_one_no_decimal() {
        // 1e5 fits in fixed (magnitude 5), but 1e15 must be scientific.
        // The mantissa is exactly 1 — no decimal point should be emitted.
        assert_eq!(format_general(1e15), "1E+15");
    }

    // -------------------------------------------------------------------
    // Special values
    // -------------------------------------------------------------------

    #[test]
    fn nan_and_infinity_render_as_num_error() {
        assert_eq!(format_general(f64::NAN), "#NUM!");
        assert_eq!(format_general(f64::INFINITY), "#NUM!");
        assert_eq!(format_general(f64::NEG_INFINITY), "#NUM!");
    }

    #[test]
    fn negative_zero_renders_as_zero() {
        assert_eq!(format_general(-0.0), "0");
    }
}
