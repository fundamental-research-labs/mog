//! Excel-compatible 15-significant-digit precision model.
//!
//! IEEE 754 f64 has ~15.95 significant decimal digits. Excel commits to 15,
//! discarding the unreliable 16th digit. This eliminates ghost residuals in
//! formulas like `Total_Assets - Total_Liabilities` where both sides compute
//! the same sum via different dependency chains.
//!
//! Combined with Kahan summation (which ensures the first 15 digits are
//! maximally accurate), this creates a precision model that is both more
//! accurate AND more predictable than Excel's.

/// Snap a floating-point value to 15 significant digits, matching Excel's
/// internal precision model.
///
/// This compensates for accumulated floating-point error in upstream arithmetic
/// (e.g., `50*0.57 = 28.499999999999996` in IEEE 754, but Excel treats this as
/// `28.5` because it only maintains 15 significant digits).
///
/// # Examples
///
/// ```
/// use value_types::precision::snap_to_15_significant_digits;
///
/// // Sub-ULP drift is eliminated
/// assert_eq!(snap_to_15_significant_digits(28.499999999999996), 28.5);
///
/// // Clean values pass through unchanged
/// assert_eq!(snap_to_15_significant_digits(42.0), 42.0);
///
/// // Special values pass through unchanged
/// assert_eq!(snap_to_15_significant_digits(0.0), 0.0);
/// assert!(snap_to_15_significant_digits(f64::NAN).is_nan());
/// ```
#[inline]
#[must_use]
pub fn snap_to_15_significant_digits(x: f64) -> f64 {
    if x == 0.0 || !x.is_finite() {
        return x;
    }
    // Safe: log10().floor() of any finite f64 is within i32 range
    #[allow(clippy::cast_possible_truncation)]
    let magnitude = x.abs().log10().floor() as i32;
    let precision = 15 - 1 - magnitude;
    if !(0..=20).contains(&precision) {
        return x;
    }
    // Safe: precision is guarded by the 0..=20 range check above
    #[allow(clippy::cast_sign_loss)]
    let factor = POW10_TABLE[precision as usize];
    (x * factor).round() / factor
}

/// Compare two f64 values using Excel's 15-significant-digit precision model.
/// This is equivalent to `snap_to_15(a).partial_cmp(&snap_to_15(b))` but
/// avoids redundant work: if both values are bitwise equal, or if both values
/// snap to the same result, we detect this early.
#[inline]
#[must_use]
pub fn cmp_15_significant_digits(a: f64, b: f64) -> Option<std::cmp::Ordering> {
    // Fast path: bitwise equality (covers exact matches, common in spreadsheets)
    if a.to_bits() == b.to_bits() {
        return Some(std::cmp::Ordering::Equal);
    }
    snap_to_15_significant_digits(a).partial_cmp(&snap_to_15_significant_digits(b))
}

/// Check whether a subtraction `a - b` should produce zero under 15-digit
/// precision.
///
/// Returns true when both operands, snapped to 15 significant digits, are
/// either identical **or** differ by at most 1 ULP at the 15th digit. The
/// latter case arises when the same mathematical total is computed via
/// different aggregation paths (e.g. `A+B+C` vs `SUM(A:C)`) — each path
/// may round independently, landing on adjacent 15-digit values whose
/// difference is pure rounding noise.
#[inline]
#[must_use]
pub fn subtraction_cancels_at_15_digits(a: f64, b: f64) -> bool {
    if a == 0.0 || b == 0.0 || !a.is_finite() || !b.is_finite() {
        return false;
    }
    let sa = snap_to_15_significant_digits(a);
    let sb = snap_to_15_significant_digits(b);
    // Intentional: exact equality after snapping detects identical 15-digit representations
    #[allow(clippy::float_cmp)]
    if sa == sb {
        return true;
    }
    let diff = (sa - sb).abs();
    let mag = sa.abs().max(sb.abs());
    // Note: when both sa and sb are zero, mag is 0.0 and `diff < 0.0` is
    // false, correctly returning false. The early return at line 79 already
    // handles the case where either *original* operand is zero.
    //
    // A 1-ULP difference at 15 significant digits gives diff/mag in the
    // range [1e-15, 1e-14] depending on position within a decade.
    // Multiple computation steps can accumulate several ULPs of error,
    // so we use 1e-13 which covers up to ~10 ULPs — still far below
    // any meaningful numerical difference in a spreadsheet.
    diff < mag * 1e-13
}

/// Pre-computed powers of 10 for `snap_to_15_significant_digits`.
/// Index i holds 10^i. Avoids calling `10f64.powi()` (which goes through libm)
/// on every comparison.
static POW10_TABLE: [f64; 21] = [
    1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16,
    1e17, 1e18, 1e19, 1e20,
];

/// Round half away from zero, matching Excel's ROUND semantics.
///
/// Rust's `f64::round()` uses "round half to even" (banker's rounding),
/// but Excel always rounds 0.5 away from zero:
///   - `excel_round(2.5)  == 3.0`  (Rust round: 2.0)
///   - `excel_round(-2.5) == -3.0` (Rust round: -2.0)
///
/// # Examples
///
/// ```
/// use value_types::precision::excel_round;
///
/// assert_eq!(excel_round(2.5), 3.0);
/// assert_eq!(excel_round(-2.5), -3.0);
/// assert_eq!(excel_round(1.5), 2.0);
/// assert_eq!(excel_round(2.4), 2.0);
/// ```
#[inline]
#[must_use]
pub fn excel_round(x: f64) -> f64 {
    if x >= 0.0 {
        (x + 0.5).floor()
    } else {
        (x - 0.5).ceil()
    }
}

/// Round a value to `digits` decimal places using Excel semantics:
/// 1. Snap to 15 significant digits (eliminate IEEE 754 ghost residuals)
/// 2. Round half away from zero (not banker's rounding)
///
/// This is the canonical rounding used by both the `ROUND()` function
/// and the TEXT/format number display pipeline.
///
/// # Examples
///
/// ```
/// use value_types::precision::excel_round_to_decimal_places;
///
/// // The classic midpoint case: 1.275 rounds to 1.28, not 1.27
/// assert_eq!(excel_round_to_decimal_places(1.275, 2), 1.28);
///
/// // Standard rounding
/// assert_eq!(excel_round_to_decimal_places(3.24159, 2), 3.24);
/// assert_eq!(excel_round_to_decimal_places(-1.275, 2), -1.28);
/// ```
#[inline]
#[must_use]
pub fn excel_round_to_decimal_places(value: f64, digits: i32) -> f64 {
    let factor = 10f64.powi(digits);
    let scaled = snap_to_15_significant_digits(value * factor);
    if scaled.is_infinite() {
        return value;
    }
    let result = excel_round(scaled) / factor;
    if result.is_infinite() || result.is_nan() {
        return value;
    }
    result
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;

    #[test]
    fn no_op_for_clean_values() {
        assert_eq!(snap_to_15_significant_digits(0.0), 0.0);
        assert_eq!(snap_to_15_significant_digits(-0.0), 0.0); // -0.0 == 0.0
        assert_eq!(snap_to_15_significant_digits(1.0), 1.0);
        assert_eq!(snap_to_15_significant_digits(42.0), 42.0);
        assert_eq!(snap_to_15_significant_digits(3.25), 3.25);
        assert_eq!(snap_to_15_significant_digits(-7.5), -7.5);
    }

    #[test]
    fn snaps_sub_ulp_drift() {
        // 50.0 * 0.57 = 28.499999999999996 in IEEE 754
        assert_eq!(snap_to_15_significant_digits(50.0 * 0.57), 28.5);
        // 710.0 * 0.35 = 248.49999999999997 in IEEE 754
        assert_eq!(snap_to_15_significant_digits(710.0 * 0.35), 248.5);
    }

    #[test]
    fn check_row_scenario() {
        // Simulate: two dependency chains computing the same sum
        let a = snap_to_15_significant_digits(1000.0 * 0.1 + 1000.0 * 0.2);
        let b = snap_to_15_significant_digits(1000.0 * 0.3);
        assert_eq!(a - b, 0.0, "check row should produce exact zero");
    }

    #[test]
    fn special_values_unchanged() {
        assert!(snap_to_15_significant_digits(f64::NAN).is_nan());
        assert_eq!(snap_to_15_significant_digits(f64::INFINITY), f64::INFINITY);
        assert_eq!(
            snap_to_15_significant_digits(f64::NEG_INFINITY),
            f64::NEG_INFINITY
        );
        assert_eq!(snap_to_15_significant_digits(f64::MAX), f64::MAX);
        assert_eq!(
            snap_to_15_significant_digits(f64::MIN_POSITIVE),
            f64::MIN_POSITIVE
        );
    }

    #[test]
    fn idempotent() {
        let values = [28.5, std::f64::consts::PI, 1e10, 0.001, -999.999, 1e-5];
        for x in values {
            let once = snap_to_15_significant_digits(x);
            let twice = snap_to_15_significant_digits(once);
            assert_eq!(once, twice, "snap must be idempotent for {x}");
        }
    }

    #[test]
    fn sign_preservation() {
        let values = [28.499_999_999_999_996, 3.25, 1e10, 0.001];
        for x in values {
            let pos = snap_to_15_significant_digits(x);
            let neg = snap_to_15_significant_digits(-x);
            assert_eq!(neg, -pos, "snap(-x) must equal -snap(x) for {x}");
        }
    }

    #[test]
    fn excel_round_half_away_from_zero() {
        assert_eq!(excel_round(2.5), 3.0);
        assert_eq!(excel_round(1.5), 2.0);
        assert_eq!(excel_round(-2.5), -3.0);
        assert_eq!(excel_round(-1.5), -2.0);
        assert_eq!(excel_round(2.4), 2.0);
        assert_eq!(excel_round(2.6), 3.0);
        assert_eq!(excel_round(0.0), 0.0);
    }

    #[test]
    fn excel_round_to_decimal_places_midpoint() {
        // The original bug: TEXT(1.275, "0.00") should produce "1.28"
        assert_eq!(excel_round_to_decimal_places(1.275, 2), 1.28);
        assert_eq!(excel_round_to_decimal_places(-1.275, 2), -1.28);
        assert_eq!(excel_round_to_decimal_places(2.345, 2), 2.35);
        assert_eq!(excel_round_to_decimal_places(3.24159, 2), 3.24);
    }

    #[test]
    fn excel_round_to_decimal_places_negative_digits() {
        assert_eq!(excel_round_to_decimal_places(1250.0, -2), 1300.0);
        assert_eq!(excel_round_to_decimal_places(1249.0, -2), 1200.0);
    }

    #[test]
    fn excel_round_to_decimal_places_zero_digits() {
        assert_eq!(excel_round_to_decimal_places(2.5, 0), 3.0);
        assert_eq!(excel_round_to_decimal_places(1.5, 0), 2.0);
    }

    #[test]
    fn excel_round_to_decimal_places_special_values() {
        assert_eq!(excel_round_to_decimal_places(0.0, 2), 0.0);
        // Overflow: factor too large, should return value as-is
        assert_eq!(excel_round_to_decimal_places(1.0, 308), 1.0);
    }

    #[test]
    fn cancellation_exact_match() {
        // Identical snapped values → cancels
        let v = snap_to_15_significant_digits(12_345.678_901_234_5);
        assert!(subtraction_cancels_at_15_digits(v, v));
    }

    #[test]
    fn cancellation_adjacent_15_digit_values() {
        // Simulate: same total via different paths lands on adjacent 15-digit values.
        // Magnitude ~57403, 1 ULP at 15 digits = 1e-10.
        let a = 57_403.175_752_646_8; // 15 significant digits
        let b = 57_403.175_752_646_7; // adjacent 15-digit value
        assert!(
            subtraction_cancels_at_15_digits(a, b),
            "adjacent 15-digit values should cancel"
        );
        assert!(
            subtraction_cancels_at_15_digits(b, a),
            "order should not matter"
        );
    }

    #[test]
    fn cancellation_does_not_fire_for_real_differences() {
        // 10000 - 9999 = 1 — a meaningful difference
        assert!(!subtraction_cancels_at_15_digits(10000.0, 9999.0));
        // 100.0 - 99.9 = 0.1
        assert!(!subtraction_cancels_at_15_digits(100.0, 99.9));
        // Completely different values
        assert!(!subtraction_cancels_at_15_digits(1.0, 2.0));
    }

    #[test]
    fn cancellation_zero_operand() {
        // Zero operand → never cancels (avoid zeroing 5.0 - 0.0)
        assert!(!subtraction_cancels_at_15_digits(5.0, 0.0));
        assert!(!subtraction_cancels_at_15_digits(0.0, 5.0));
    }

    #[test]
    fn cancellation_at_various_magnitudes() {
        // Near 1.0: ULP at 15 digits = 1e-14
        let a = 1.2_f64;
        let b = 1.199_999_999_999_99_f64;
        assert!(
            subtraction_cancels_at_15_digits(a, b),
            "1-ULP diff near magnitude 1 should cancel"
        );

        // Near 1e8: ULP at 15 digits = 1e-6
        let a = 123_456_789.012_346_f64;
        let b = 123_456_789.012_345_f64;
        assert!(
            subtraction_cancels_at_15_digits(a, b),
            "1-ULP diff near magnitude 1e8 should cancel"
        );

        // Small values near 0.001: ULP at 15 digits = 1e-17
        let a = 0.001_000_000_000_000_01_f64;
        let b = 0.001_f64;
        assert!(
            subtraction_cancels_at_15_digits(a, b),
            "1-ULP diff near magnitude 0.001 should cancel"
        );
    }

    // === Property-based tests ===

    use proptest::prelude::*;

    proptest! {
        // snap is idempotent
        #[test]
        fn prop_snap_idempotent(x in prop::num::f64::NORMAL) {
            let once = snap_to_15_significant_digits(x);
            let twice = snap_to_15_significant_digits(once);
            prop_assert_eq!(once.to_bits(), twice.to_bits());
        }

        // snap preserves sign
        #[test]
        fn prop_snap_preserves_sign(x in prop::num::f64::NORMAL.prop_filter("nonzero", |x| *x != 0.0)) {
            let snapped = snap_to_15_significant_digits(x);
            prop_assert_eq!(x.signum(), snapped.signum());
        }

        // snap(x) is close to x (within 15-digit precision)
        #[test]
        fn prop_snap_within_precision(x in prop::num::f64::NORMAL.prop_filter("reasonable", |x| x.abs() > 1e-100 && x.abs() < 1e100)) {
            let snapped = snap_to_15_significant_digits(x);
            let rel_err = ((snapped - x) / x).abs();
            prop_assert!(rel_err < 1e-14, "relative error {} too large for x={}", rel_err, x);
        }

        // excel_round(-x) == -excel_round(x)
        #[test]
        fn prop_excel_round_antisymmetric(x in prop::num::f64::NORMAL) {
            prop_assert_eq!(excel_round(-x).to_bits(), (-excel_round(x)).to_bits());
        }
    }
}
