//! Overflow-safe fallback for the public PV function.

use super::super::helpers::{
    finite_inputs, stable_annuity_payment, stable_discount_product, stable_factor_terms, tvm_power,
};

pub(super) fn pv_with_stable_fallback(rate: f64, nper: f64, pmt: f64, fv: f64, type_: f64) -> f64 {
    let current = if rate == 0.0 {
        -(fv + pmt * nper)
    } else {
        let power = tvm_power(rate, nper).unwrap_or(f64::NAN);
        let type_adjustment = if type_ != 0.0 { 1.0 + rate } else { 1.0 };
        let annuity_factor = (power - 1.0) / rate;
        -(fv / power + (pmt * annuity_factor * type_adjustment) / power)
    };

    if current.is_finite() || !finite_inputs(&[rate, nper, pmt, fv, type_]) {
        return current;
    }

    let Some((log_power, _inv_power, annuity_over_power)) = stable_factor_terms(rate, nper) else {
        return current;
    };
    let type_adjustment = if type_ != 0.0 { 1.0 + rate } else { 1.0 };

    let discounted_fv = stable_discount_product(fv, rate, nper, log_power);
    let discounted_payments = stable_annuity_payment(
        rate,
        nper,
        log_power,
        annuity_over_power,
        pmt,
        type_adjustment,
    )
    .unwrap_or(f64::NAN);
    let stable = -(discounted_fv + discounted_payments);
    if stable.is_finite() { stable } else { current }
}

#[cfg(test)]
mod tests {
    use super::super::super::helpers::{fv_core, pmt_core};
    use super::*;

    fn assert_relative(actual: f64, expected: f64, tolerance: f64) {
        assert!(actual.is_finite(), "expected finite value, got {actual}");
        let scale = expected.abs().max(1e-300);
        assert!(
            (actual - expected).abs() <= scale * tolerance,
            "{actual:.17e} is not within {tolerance:.1e} relative error of {expected:.17e}"
        );
    }

    #[test]
    fn test_tvm_stable_fallbacks_cover_negative_periods_and_timing() {
        // These values are rounded from the independent 120-digit Decimal
        // audit, not copied from the production implementation.
        let pv_end = pv_with_stable_fallback(-0.9999999999999999, -360.5, -200.0, 0.0, 0.0);
        assert_relative(pv_end, -200.00000000000003, 1e-14);

        let pv_begin = pv_with_stable_fallback(-0.9999999999999999, -360.5, -200.0, 0.0, 1.0);
        assert_relative(pv_begin, -2.2204460492503134e-14, 1e-12);

        let pmt_end = pmt_core(-0.9999999999999999, -360.5, -200.0, 8000.0, 0.0);
        assert_relative(pmt_end, -199.99999999999997, 1e-14);

        let pmt_begin = pmt_core(-0.9999999999999999, -360.5, -200.0, 8000.0, 1.0);
        assert_relative(pmt_begin, -1.8014398509481981e18, 1e-14);
    }

    #[test]
    fn test_tvm_stable_fallbacks_repair_large_power_intermediates() {
        let pv = pv_with_stable_fallback(10.0, 360.0, -200.0, 0.0, 0.0);
        assert_relative(pv, 20.0, 1e-14);

        let pmt = pmt_core(10.0, 360.0, -200.0, 8000.0, 0.0);
        assert_relative(pmt, 2000.0, 1e-14);

        let fv = fv_core(1.0, 1000.0, 1e8, -1e8, 0.0);
        assert_relative(fv, 1e8, 1e-14);

        let fv_larger = fv_core(1.0, 10000.0, 1e8, -1e8, 0.0);
        assert_relative(fv_larger, 1e8, 1e-14);
    }

    #[test]
    fn test_tvm_fallbacks_preserve_large_cash_flow_underflow_products() {
        // The direct power overflows here, while the true discounted value is
        // an ordinary normal binary64 number.  Multiplying 1e308
        // by exp(-2000*ln(2)) after exp has rounded to zero would lose it.
        let expected = -8.709809816217217e-295;
        let pv = pv_with_stable_fallback(1.0, 2000.0, 0.0, 1e308, 0.0);
        assert_relative(pv, expected, 2e-14);

        let pmt = pmt_core(1.0, 2000.0, 0.0, 1e308, 0.0);
        assert_relative(pmt, expected, 2e-14);

        let pmt_begin = pmt_core(1.0, 2000.0, 0.0, 1e308, 1.0);
        assert_relative(pmt_begin, expected / 2.0, 2e-14);
    }

    #[test]
    fn test_tvm_scaled_cash_flows_avoid_annuity_and_numerator_overflow() {
        // PV's annuity factor is about 2^2001 here.  Multiplying it by the
        // minimum normal payment is nevertheless exactly 2^979 after the
        // timing adjustment; forming the annuity factor first incorrectly
        // reports a non-finite result.
        let expected_pv = -5.109351192408883e294;
        let pv_end = pv_with_stable_fallback(
            -0.5,
            2000.0,
            f64::from_bits(0x0010_0000_0000_0000),
            0.0,
            0.0,
        );
        assert_relative(pv_end, expected_pv, 2e-15);

        let pv_begin = pv_with_stable_fallback(
            -0.5,
            2000.0,
            f64::from_bits(0x0010_0000_0000_0000),
            0.0,
            1.0,
        );
        assert_relative(pv_begin, expected_pv / 2.0, 2e-15);

        // PMT's direct pv * power + fv numerator overflows before division,
        // although distributing the finite denominator produces a normal
        // binary64 result.  Both timing modes use the same scaled sum path.
        let expected_pmt = -1.0523809523809525e308;
        let pmt_end = pmt_core(0.1, 2.0, 1e308, 1e308, 0.0);
        assert_relative(pmt_end, expected_pmt, 2e-15);

        let pmt_begin = pmt_core(0.1, 2.0, 1e308, 1e308, 1.0);
        assert_relative(pmt_begin, -9.567099567099567e307, 2e-15);
    }

    #[test]
    fn test_tvm_extreme_integer_period_falls_back_without_panicking() {
        // This finite input makes -log_power / ln(2) round to 2^63.  The
        // scaled exponential must reject that exponent before an i64 cast or
        // normalization carry can overflow; the exact result is outside
        // binary64, so retaining the direct non-finite result is correct.
        let result = pv_with_stable_fallback(
            0.1,
            -6.7077350349424345e19,
            f64::from_bits(0x0010_0000_0000_0000),
            0.0,
            0.0,
        );
        assert!(
            !result.is_finite(),
            "unsupported extreme result: {result:?}"
        );
    }

    #[test]
    fn test_fv_fallback_does_not_accept_rounded_cancellation() {
        // pmt/rate rounds to -pv in binary64, but the exact residual is
        // positive.  With a huge power, returning the rounded residual would
        // be incorrect; the guarded path conservatively keeps the direct
        // non-finite result.
        let result = fv_core(3.0, 1000.0, 1.0, -0.3333333333333333, 0.0);
        assert!(
            !result.is_finite(),
            "rounded cancellation must not become a finite result, got {result:?}"
        );

        // The power is finite here, but the cash-flow products overflow and
        // the rounded payment/rate division erases a nonzero coefficient.
        // Returning that rounded residual would hide an unrepresentable exact
        // result.
        let finite_power_rounded_zero = fv_core(3.0, 500.0, 1e100, -(1e100 / 3.0), 0.0);
        assert!(
            !finite_power_rounded_zero.is_finite(),
            "rounded finite-power cancellation must retain the direct error: {finite_power_rounded_zero:?}"
        );
    }

    #[test]
    fn test_fv_adversarial_large_rate_cases_do_not_accept_rounded_zero() {
        // Both rows previously became a finite rounded residual when a
        // rounded payment/rate division looked like exact cancellation.
        let tiny_present = fv_core(1e308, 2.0, 1.0, -1e-308, 0.0);
        assert!(
            !tiny_present.is_finite(),
            "non-exact cancellation must not return a finite residual: {tiny_present:?}"
        );

        let subnormal_payment = fv_core(1e308, 2.0, f64::from_bits(1), 0.0, 0.0);
        assert!(
            !subnormal_payment.is_finite(),
            "non-exact subnormal cancellation must not return a finite residual: {subnormal_payment:?}"
        );

        // Although 1 + 1e308 rounds to 1e308 in binary64, the exact input
        // equation still contains the lost +1.  Do not turn that rounded
        // type-1 adjustment into a false cancellation proof.
        let rounded_type_adjustment = fv_core(1e308, 2.0, 1e308, -1e308, 1.0);
        assert!(
            !rounded_type_adjustment.is_finite(),
            "rounded type adjustment must not create a finite result: {rounded_type_adjustment:?}"
        );

        // With rate=1, the type adjustment is exactly representable, so the
        // same binary-product proof is valid and returns the finite residual.
        let exact_type_adjustment = fv_core(1.0, 2000.0, 2.0, -4.0, 1.0);
        assert_eq!(exact_type_adjustment.to_bits(), 4.0_f64.to_bits());
    }

    #[test]
    fn test_tvm_fallbacks_preserve_finite_near_zero_and_zero_rate_paths() {
        let rate: f64 = 1e-12;
        let pv_direct = {
            let power = (1.0 + rate).powf(24.0);
            let af = (power - 1.0) / rate;
            -(1e-10 / power + (5e-11 * af) / power)
        };
        let pv = pv_with_stable_fallback(rate, 24.0, 5e-11, 1e-10, 0.0);
        assert_eq!(pv.to_bits(), pv_direct.to_bits());

        let pmt = pmt_core(rate, -360.5, -200.0, 8000.0, 0.0);
        // Independent Python IEEE-754 evaluation of the established direct
        // expression gives this bit pattern.  Keep the finite operation-order
        // result unchanged while the guarded path remains non-invasive.
        assert_eq!(pmt.to_bits(), 21.63469247481333_f64.to_bits());

        let fv = fv_core(1e-12, 1000.0, 5000.0, -1e12, 1.0);
        assert_eq!(fv.to_bits(), 999_995_000_555.5859_f64.to_bits());

        assert_eq!(
            pv_with_stable_fallback(0.0, 24.0, 5e-11, 1e-10, 1.0).to_bits(),
            (-1.3e-9_f64).to_bits()
        );
        assert_eq!(
            pmt_core(0.0, 24.0, -2e-12, 1e-10, 1.0).to_bits(),
            (-4.083333333333333e-12_f64).to_bits()
        );
        assert_eq!(
            fv_core(0.0, 24.0, 5e-11, -2e-12, 1.0).to_bits(),
            (-1.198e-9_f64).to_bits()
        );
    }
}
