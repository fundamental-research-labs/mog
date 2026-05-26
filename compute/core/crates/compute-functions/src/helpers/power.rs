//! Shared power/exponentiation helpers for Excel-compatible behavior.
//!
//! Used by both the `^` binary operator (compute-core) and the `POWER()`
//! function (compute-functions) to avoid duplicating edge-case logic.

use value_types::CellValue;

/// Maximum odd denominator to test when detecting rational exponents.
/// Covers all common fractional exponents like 1/3, 2/3, 1/5, 3/7, etc.
const MAX_ODD_DENOM: u64 = 99;

/// Tolerance for detecting whether `exponent * q` is close to an integer.
/// 1e-9 is tight enough to avoid false positives while accommodating
/// the floating-point representation of fractions like 1/3.
const RATIONAL_TOLERANCE: f64 = 1e-9;

/// Attempt to compute `base^exponent` when `base < 0` and `exponent` is
/// non-integer, using the real-valued n-th root when the exponent is a
/// rational number p/q with odd denominator q.
///
/// Returns `Some(result)` if the exponent is detected as a rational with
/// odd denominator (Excel computes real roots in this case), or `None` if
/// the exponent doesn't match (caller should return `#NUM!`).
///
/// # Examples
/// - `(-8)^(1/3)` → `Some(-2.0)` (cube root)
/// - `(-8)^(2/3)` → `Some(4.0)` (cube root squared)
/// - `(-32)^(1/5)` → `Some(-2.0)` (fifth root)
/// - `(-8)^(1/2)` → `None` (even denominator, not real-valued)
pub fn try_negative_base_pow(base: f64, exponent: f64) -> Option<CellValue> {
    debug_assert!(base < 0.0);
    debug_assert!(exponent != exponent.floor());

    // Try odd denominators 3, 5, 7, ... up to MAX_ODD_DENOM.
    // For each q, check if exponent ≈ p/q for some integer p.
    for q in (3..=MAX_ODD_DENOM).step_by(2) {
        let qf = q as f64;
        let p_approx = exponent * qf;
        let p_rounded = p_approx.round();

        // Skip p=0 — that would mean exponent ≈ 0, which is integer-like
        // and should have been caught by the `exp != exp.floor()` guard.
        if p_rounded == 0.0 {
            continue;
        }

        if (p_approx - p_rounded).abs() < RATIONAL_TOLERANCE {
            let p = p_rounded as i64;
            // Compute |base|^exponent (always positive and well-defined)
            let magnitude = base.abs().powf(exponent);
            if magnitude.is_nan() || magnitude.is_infinite() {
                return None;
            }
            // Sign: (-1)^p — negative when p is odd, positive when p is even
            let result = if p % 2 != 0 { -magnitude } else { magnitude };
            return Some(CellValue::number(result));
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unwrap_num(v: CellValue) -> f64 {
        match v {
            CellValue::Number(n) => n.get(),
            other => panic!("expected Number, got {:?}", other),
        }
    }

    #[test]
    fn cube_root_of_negative_8() {
        let result = try_negative_base_pow(-8.0, 1.0 / 3.0).unwrap();
        assert!((unwrap_num(result) - (-2.0)).abs() < 1e-10);
    }

    #[test]
    fn cube_root_of_negative_27() {
        let result = try_negative_base_pow(-27.0, 1.0 / 3.0).unwrap();
        assert!((unwrap_num(result) - (-3.0)).abs() < 1e-10);
    }

    #[test]
    fn fifth_root_of_negative_32() {
        let result = try_negative_base_pow(-32.0, 1.0 / 5.0).unwrap();
        assert!((unwrap_num(result) - (-2.0)).abs() < 1e-10);
    }

    #[test]
    fn two_thirds_power_of_negative_8() {
        // (-8)^(2/3) = (cube_root(-8))^2 = (-2)^2 = 4
        let result = try_negative_base_pow(-8.0, 2.0 / 3.0).unwrap();
        assert!((unwrap_num(result) - 4.0).abs() < 1e-10);
    }

    #[test]
    fn even_denominator_returns_none() {
        // (-8)^(1/2) — square root of negative, not real-valued
        assert!(try_negative_base_pow(-8.0, 0.5).is_none());
    }

    #[test]
    fn even_denominator_one_fourth_returns_none() {
        assert!(try_negative_base_pow(-16.0, 0.25).is_none());
    }

    #[test]
    fn seventh_root() {
        let result = try_negative_base_pow(-128.0, 1.0 / 7.0).unwrap();
        assert!((unwrap_num(result) - (-2.0)).abs() < 1e-10);
    }

    #[test]
    fn negative_exponent_odd_denom() {
        // (-8)^(-1/3) = 1/(-2) = -0.5
        let result = try_negative_base_pow(-8.0, -1.0 / 3.0).unwrap();
        assert!((unwrap_num(result) - (-0.5)).abs() < 1e-10);
    }
}
