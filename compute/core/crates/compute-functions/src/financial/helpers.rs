//! Shared financial helpers: argument coercion, TVM core calculations,
//! date/serial conversions, coupon/bond helpers, and the PRICE core formula.

use value_types::{CellError, CellValue};

#[allow(unused_imports)]
pub(crate) use crate::helpers::date_serial::{
    actual_days_between, add_months_to_serial, days_in_year_by_basis, days360_between,
    serial_to_ymd, year_frac, ymd_to_serial,
};

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

/// Coerce argument at index to f64, defaulting to `default` if absent.
pub(crate) fn arg_num(args: &[CellValue], idx: usize, default: f64) -> Result<f64, CellError> {
    if idx >= args.len() || args[idx].is_null() {
        return Ok(default);
    }
    if let CellValue::Error(e, _) = &args[idx] {
        return Err(*e);
    }
    args[idx].coerce_to_number()
}

/// Coerce required argument at index to f64.
pub(crate) fn req_num(args: &[CellValue], idx: usize) -> Result<f64, CellError> {
    if let CellValue::Error(e, _) = &args[idx] {
        return Err(*e);
    }
    args[idx].coerce_to_number()
}

/// Return CellValue::Number or propagate error.
#[allow(dead_code)]
pub(crate) fn num_or_err(result: Result<f64, CellError>) -> CellValue {
    match result {
        Ok(n) => CellValue::number(n),
        Err(e) => CellValue::Error(e, None),
    }
}

/// Like `num_or_err`, but the closure returns `Err(CellValue)` so that
/// diagnostic messages can be attached to errors via `CellValue::error_with_message`.
/// Coercion-propagated errors (from `req_num` / `arg_num`) should be wrapped
/// with `Err(CellValue::Error(e, None))` — a `.map_err(err_val)` adapter works.
pub(crate) fn num_or_err_msg(result: Result<f64, CellValue>) -> CellValue {
    match result {
        Ok(n) => CellValue::number(n),
        Err(cv) => cv,
    }
}

/// Adapter for converting `CellError` into a bare `CellValue::Error` (no message).
/// Use with `.map_err(err_val)` inside `num_or_err_msg` closures for coercion propagation.
#[inline]
pub(crate) fn err_val(e: CellError) -> CellValue {
    CellValue::Error(e, None)
}

// ---------------------------------------------------------------------------
// Core TVM helpers (used by multiple functions)
// ---------------------------------------------------------------------------

/// PMT's established direct arithmetic.  Keep this operation order intact so
/// callers that already produce a finite result retain their existing bits.
#[inline]
pub(crate) fn pmt_core_direct(rate: f64, nper: f64, pv: f64, fv: f64, type_: f64) -> f64 {
    if rate == 0.0 {
        return -(pv + fv) / nper;
    }
    let Some(pow) = tvm_power(rate, nper) else {
        return f64::NAN;
    };
    let type_adj = if type_ != 0.0 { 1.0 + rate } else { 1.0 };
    let af = (pow - 1.0) / rate;
    -(pv * pow + fv) / (af * type_adj)
}

/// FV's established direct arithmetic.  Keep this operation order intact so
/// callers that already produce a finite result retain their existing bits.
#[inline]
pub(crate) fn fv_core_direct(rate: f64, nper: f64, pmt: f64, pv: f64, type_: f64) -> f64 {
    if rate == 0.0 {
        return -(pv + pmt * nper);
    }
    let Some(pow) = tvm_power(rate, nper) else {
        return f64::NAN;
    };
    let type_adj = if type_ != 0.0 { 1.0 + rate } else { 1.0 };
    let af = (pow - 1.0) / rate;
    -(pv * pow + pmt * af * type_adj)
}

/// Avoid handing extreme positive-base exponents to host `powf` routines
/// whose argument reduction can be unbounded.  Such a power is already
/// outside binary64's representable range; the guarded caller can either
/// evaluate a scaled cash-flow expression or retain its non-finite result.
#[inline]
pub(crate) fn tvm_power(rate: f64, nper: f64) -> Option<f64> {
    let base = 1.0 + rate;
    if base > 0.0 && rate.is_finite() && nper.is_finite() {
        let log_power = nper * rate.ln_1p();
        if !log_power.is_finite() || log_power.abs() > 1000.0 {
            return None;
        }
    }
    Some(base.powf(nper))
}

/// PMT core calculation with a guarded overflow/underflow fallback.
///
/// The direct formula is authoritative whenever it is finite.  The guarded
/// path is deliberately entered only for finite inputs and a non-finite
/// direct result, so it cannot change the established finite operation order.
pub(crate) fn pmt_core(rate: f64, nper: f64, pv: f64, fv: f64, type_: f64) -> f64 {
    let current = pmt_core_direct(rate, nper, pv, fv, type_);
    if current.is_finite() || !finite_inputs(&[rate, nper, pv, fv, type_]) {
        return current;
    }

    let Some((log_power, _inv_power, annuity_over_power)) = stable_factor_terms(rate, nper) else {
        return current;
    };
    let type_adjustment = if type_ != 0.0 { 1.0 + rate } else { 1.0 };

    let discounted_fv = stable_discount_product(fv, rate, nper, log_power);
    let denominator = annuity_over_power * type_adjustment;
    let numerator = pv + discounted_fv;
    let stable = if numerator.is_finite() {
        -numerator / denominator
    } else {
        stable_sum_divide(pv, discounted_fv, denominator)
            .map(|value| -value)
            .unwrap_or(current)
    };
    if stable.is_finite() { stable } else { current }
}

/// FV core calculation with a guarded, exact-cancellation fallback.
pub(crate) fn fv_core(rate: f64, nper: f64, pmt: f64, pv: f64, type_: f64) -> f64 {
    let current = fv_core_direct(rate, nper, pmt, pv, type_);
    if current.is_finite() || !finite_inputs(&[rate, nper, pmt, pv, type_]) {
        return current;
    }

    let type_adjustment = if type_ != 0.0 { 1.0 + rate } else { 1.0 };

    // Before factoring an overflowing power, prove the only cancellation
    // that permits a finite residual without evaluating that power.  The
    // comparison is exact over the binary64 input values; it does not use a
    // rounded division or a double-double approximation as a proof.
    if rate.is_finite() && rate != 0.0 && rate > -1.0 && type_adjustment.is_finite() {
        // For type=1 the algebra uses the exact sum 1 + rate.  A rounded
        // adjustment can manufacture a cancellation that the mathematical
        // inputs do not have, so require an error-free sum before using it as
        // an exact-product proof.
        let exact_type_adjustment = if type_ == 0.0 {
            Some(1.0)
        } else {
            exact_binary_sum(1.0, rate)
        };
        if let Some(adjustment) = exact_type_adjustment {
            if exact_opposite_products(pv, rate, pmt, adjustment) {
                return -pv;
            }
        } else {
            // The same rounded type adjustment would make a factored fallback
            // depend on a lost low limb.  Keep the established direct error
            // until a scaled type-1 evaluation with that residual is proved.
            return current;
        }
    }

    // A nonzero residual still needs multiplication by the potentially
    // overflowing power.  A rounded factored evaluation cannot prove that
    // the exact residual is representable, so preserve the established
    // non-finite result for this unsupported class.  The exact product branch
    // above remains the only newly finite FV fallback.
    current
}

// ---------------------------------------------------------------------------
// Guarded TVM factor helpers
// ---------------------------------------------------------------------------

/// Return the positive-base power and annuity factor divided by that power.
///
///   ((1 + rate)^nper - 1) / (rate * (1 + rate)^nper)
///       = -expm1(-nper * ln1p(rate)) / rate
///
/// This ratio remains finite when the direct power is too large or when
/// `power - 1` loses the near-zero-rate difference.
#[inline]
pub(crate) fn stable_factor_terms(rate: f64, nper: f64) -> Option<(f64, f64, f64)> {
    if !rate.is_finite() || !nper.is_finite() || rate <= -1.0 || rate == 0.0 {
        return None;
    }
    let log_power = nper * rate.ln_1p();
    if log_power.is_nan() {
        return None;
    }
    let inv_power = (-log_power).exp();
    let annuity_over_power = -(-log_power).exp_m1() / rate;
    Some((log_power, inv_power, annuity_over_power))
}

/// Avoid manufacturing `NaN` for a zero cash flow multiplied by an infinite
/// scaling factor.  The guarded path is reached only after the direct formula
/// fails, so this does not alter finite direct results.
#[inline]
pub(crate) fn stable_mul(left: f64, right: f64) -> f64 {
    if (left == 0.0 && right.is_infinite()) || (right == 0.0 && left.is_infinite()) {
        0.0
    } else {
        left * right
    }
}

/// Evaluate `value * exp(exponent)` without first rounding the exponential to
/// zero.  A large cash flow can offset a discount factor that underflows on
/// its own, so multiplying by `exp(exponent)` after it has become zero loses a
/// finite result.
#[inline]
pub(crate) fn stable_exp_product(value: f64, exponent: f64) -> f64 {
    if value == 0.0 {
        return value;
    }
    if !value.is_finite() || exponent.is_nan() {
        return value * exponent.exp();
    }
    let log_abs = value.abs().ln() + exponent;
    if log_abs > f64::MAX.ln() {
        return if value.is_sign_negative() {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    if log_abs < f64::from_bits(1).ln() {
        return if value.is_sign_negative() { -0.0 } else { 0.0 };
    }
    let magnitude = log_abs.exp();
    if value.is_sign_negative() {
        -magnitude
    } else {
        magnitude
    }
}

#[derive(Clone, Copy)]
struct ScaledBinary {
    mantissa: f64,
    exponent: i64,
}

#[inline]
fn scaled_from_f64(value: f64) -> Option<ScaledBinary> {
    if value == 0.0 || !value.is_finite() {
        return None;
    }
    let bits = value.to_bits();
    let negative = (bits >> 63) != 0;
    let exponent_bits = ((bits >> 52) & 0x7ff) as i32;
    let fraction = bits & ((1_u64 << 52) - 1);
    let (significand, exponent, mantissa_scale) = if exponent_bits == 0 {
        let significand = fraction;
        let highest_bit = 63 - significand.leading_zeros();
        (
            significand as f64,
            -1074_i64 + i64::from(highest_bit) + 1,
            -((highest_bit as i32) + 1),
        )
    } else {
        (
            ((1_u64 << 52) | fraction) as f64,
            i64::from(exponent_bits) - 1022,
            -53,
        )
    };
    let mut mantissa = significand * 2.0_f64.powi(mantissa_scale);
    if negative {
        mantissa = -mantissa;
    }
    Some(ScaledBinary { mantissa, exponent })
}

#[inline]
fn scaled_normalize(mantissa: f64, exponent: i64) -> Option<ScaledBinary> {
    // Addition can cancel many leading bits. Decode the complete binary64
    // significand instead of assuming a single-bit adjustment is sufficient.
    let normalized = scaled_from_f64(mantissa)?;
    Some(ScaledBinary {
        mantissa: normalized.mantissa,
        exponent: exponent.checked_add(normalized.exponent)?,
    })
}

#[inline]
fn scaled_mul(left: ScaledBinary, right: ScaledBinary) -> Option<ScaledBinary> {
    let exponent = left.exponent.checked_add(right.exponent)?;
    scaled_normalize(left.mantissa * right.mantissa, exponent)
}

#[inline]
fn scaled_add(left: ScaledBinary, right: ScaledBinary) -> Option<ScaledBinary> {
    let (larger, smaller) = if left.exponent >= right.exponent {
        (left, right)
    } else {
        (right, left)
    };
    let exponent_delta = larger.exponent.checked_sub(smaller.exponent)?;
    if exponent_delta > 1074 {
        return Some(larger);
    }
    let scale = 2.0_f64.powi(-(exponent_delta as i32));
    let mantissa = larger.mantissa + smaller.mantissa * scale;
    if mantissa == 0.0 {
        None
    } else {
        scaled_normalize(mantissa, larger.exponent)
    }
}

#[inline]
fn scaled_exp(exponent: f64) -> Option<ScaledBinary> {
    if !exponent.is_finite() {
        return None;
    }
    let log2 = exponent / 2.0_f64.ln();
    // `i64::MAX as f64` rounds to 2^63, so comparing with MAX-2 as f64
    // cannot exclude the saturating cast at exactly 2^63.  Reject at the
    // representable boundary before converting, and let checked normalization
    // reject the final carry as well.
    if log2 <= i64::MIN as f64 || log2 >= i64::MAX as f64 {
        return None;
    }
    let exponent2 = log2.floor() as i64;
    let remainder = exponent - exponent2 as f64 * 2.0_f64.ln();
    scaled_normalize(remainder.exp(), exponent2)
}

#[inline]
fn scaled_expm1(exponent: f64) -> Option<ScaledBinary> {
    if !exponent.is_finite() {
        return None;
    }
    let ordinary = exponent.exp_m1();
    if ordinary.is_finite() {
        return scaled_from_f64(ordinary);
    }
    // Only an overflowing positive exponential needs the scaled path.
    // Subtracting one at that magnitude is below binary64 precision, while
    // expm1 retains its full precision throughout the finite range above.
    scaled_exp(exponent)
}

#[inline]
fn scaled_reciprocal(value: ScaledBinary) -> Option<ScaledBinary> {
    scaled_normalize(1.0 / value.mantissa, value.exponent.checked_neg()?)
}

#[inline]
fn scaled_to_finite(value: ScaledBinary) -> Option<f64> {
    let result = scaled_to_f64(value);
    result.is_finite().then_some(result)
}

/// Evaluate `pmt * (((1 + rate)^nper - 1) / rate) * type_adjustment` from
/// scaled factors when the ordinary annuity factor or one of its products
/// overflows.  The direct finite product is retained whenever available.
pub(crate) fn stable_annuity_payment(
    rate: f64,
    nper: f64,
    log_power: f64,
    annuity_over_power: f64,
    pmt: f64,
    type_adjustment: f64,
) -> Option<f64> {
    let ordinary = stable_mul(pmt, stable_mul(annuity_over_power, type_adjustment));
    if ordinary.is_finite() {
        return Some(ordinary);
    }
    if pmt == 0.0 {
        return Some(pmt);
    }

    let numerator = scaled_annuity_numerator(rate, nper, log_power)?;
    let rate = scaled_from_f64(rate)?;
    let type_adjustment = scaled_from_f64(type_adjustment)?;
    let factor = scaled_mul(
        scaled_mul(numerator, scaled_reciprocal(rate)?)?,
        type_adjustment,
    )?;
    scaled_to_finite(scaled_mul(scaled_from_f64(pmt)?, factor)?)
}

#[inline]
fn scaled_annuity_numerator(rate: f64, nper: f64, log_power: f64) -> Option<ScaledBinary> {
    if rate > -1.0 && nper.is_finite() && nper.fract() == 0.0 && nper.abs() <= (1_u64 << 53) as f64
    {
        let base = scaled_from_f64(1.0 + rate)?;
        let periods = nper.abs() as u64;
        let power = scaled_pow(base, periods)?;
        let inverse_power = if nper >= 0.0 {
            scaled_reciprocal(power)?
        } else {
            power
        };
        let one = scaled_from_f64(1.0)?;
        let negative_inverse = ScaledBinary {
            mantissa: -inverse_power.mantissa,
            exponent: inverse_power.exponent,
        };
        return scaled_add(one, negative_inverse);
    }

    let numerator = scaled_expm1(-log_power)?;
    Some(ScaledBinary {
        mantissa: -numerator.mantissa,
        exponent: numerator.exponent,
    })
}

/// Divide a sum only after distributing the division, so an overflowing
/// numerator can still produce a representable result.  If either quotient
/// remains non-finite, return `None` rather than guessing through cancellation.
pub(crate) fn stable_sum_divide(left: f64, right: f64, denominator: f64) -> Option<f64> {
    if !left.is_finite() || !right.is_finite() || !denominator.is_finite() || denominator == 0.0 {
        return None;
    }
    let left_quotient = left / denominator;
    let right_quotient = right / denominator;
    let result = left_quotient + right_quotient;
    result.is_finite().then_some(result)
}

#[inline]
fn scaled_pow(mut base: ScaledBinary, mut exponent: u64) -> Option<ScaledBinary> {
    let mut result = ScaledBinary {
        mantissa: 0.5,
        exponent: 1,
    };
    while exponent != 0 {
        if exponent & 1 != 0 {
            result = scaled_mul(result, base)?;
        }
        exponent >>= 1;
        if exponent != 0 {
            base = scaled_mul(base, base)?;
        }
    }
    Some(result)
}

#[inline]
fn scaled_to_f64(value: ScaledBinary) -> f64 {
    if value.exponent < -1074 {
        return if value.mantissa.is_sign_negative() {
            -0.0
        } else {
            0.0
        };
    }
    if value.exponent > 1024 {
        return if value.mantissa.is_sign_negative() {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    if value.exponent == 1024 {
        return value.mantissa * 2.0 * f64::from_bits(0x7fe0_0000_0000_0000);
    }
    if value.exponent >= -1022 {
        let scale_bits = ((value.exponent + 1023) as u64) << 52;
        return value.mantissa * f64::from_bits(scale_bits);
    }
    // Form subnormal output through its integer significand.  Multiplying by
    // 2^e directly would first round 2^e to zero for e < -1022, even when
    // the final product is an exactly representable subnormal.
    let scaled = value.mantissa.abs() * 2.0_f64.powi((value.exponent + 1074) as i32);
    let lower = scaled.floor();
    let fraction = scaled - lower;
    let rounded = if fraction > 0.5 || (fraction == 0.5 && (lower as u64) & 1 != 0) {
        lower + 1.0
    } else {
        lower
    } as u64;
    let sign = if value.mantissa.is_sign_negative() {
        1_u64 << 63
    } else {
        0
    };
    f64::from_bits(sign | rounded)
}

/// Evaluate `value / (1 + rate)^nper` without forming an overflowing or
/// underflowing power.  Exact integer periods use a scaled repeated-square
/// path, while fractional periods use the compensated log/exp product.
#[inline]
pub(crate) fn stable_discount_product(value: f64, rate: f64, nper: f64, log_power: f64) -> f64 {
    if value == 0.0 {
        return value;
    }
    if rate > -1.0 && nper.is_finite() && nper.fract() == 0.0 && nper.abs() <= (1_u64 << 53) as f64
    {
        let base = 1.0 + rate;
        if let (Some(value), Some(base)) = (scaled_from_f64(value), scaled_from_f64(base)) {
            let periods = nper.abs() as u64;
            if let Some(power) = scaled_pow(base, periods) {
                let factor = if nper >= 0.0 {
                    scaled_reciprocal(power)
                } else {
                    Some(power)
                };
                if let Some(factor) = factor.and_then(|factor| scaled_mul(value, factor)) {
                    return scaled_to_f64(factor);
                }
            }
        }
    }
    stable_exp_product(value, -log_power)
}

#[inline]
pub(crate) fn finite_inputs(values: &[f64]) -> bool {
    values.iter().all(|value| value.is_finite())
}

/// Compare two finite binary64 products exactly, without computing either
/// product in binary64.  A product is represented as an integer significand
/// and a power of two; two 53-bit significands fit in `u128` after
/// multiplication.  This is used only for FV's exact cancellation proof.
#[derive(Clone, Copy)]
struct BinaryProduct {
    negative: bool,
    significand: u128,
    exponent: i32,
}

#[inline]
fn binary_components(value: f64) -> (bool, u128, i32) {
    let bits = value.to_bits();
    let negative = (bits >> 63) != 0;
    let exponent_bits = ((bits >> 52) & 0x7ff) as i32;
    let fraction = (bits & ((1_u64 << 52) - 1)) as u128;
    if exponent_bits == 0 {
        // A subnormal is fraction * 2^-1074.
        (negative, fraction, -1074)
    } else {
        // A normal is (2^52 + fraction) * 2^(exp - 1023 - 52).
        (negative, (1_u128 << 52) | fraction, exponent_bits - 1075)
    }
}

#[inline]
fn exact_binary_product(left: f64, right: f64) -> BinaryProduct {
    let (left_negative, left_significand, left_exponent) = binary_components(left);
    let (right_negative, right_significand, right_exponent) = binary_components(right);
    let mut significand = left_significand * right_significand;
    let mut exponent = left_exponent + right_exponent;
    if significand != 0 {
        while significand & 1 == 0 {
            significand >>= 1;
            exponent += 1;
        }
    }
    BinaryProduct {
        negative: left_negative ^ right_negative,
        significand,
        exponent,
    }
}

#[inline]
fn exact_binary_sum(left: f64, right: f64) -> Option<f64> {
    let sum = left + right;
    let right_virtual = sum - left;
    let left_virtual = sum - right_virtual;
    let right_round = right - right_virtual;
    let left_round = left - left_virtual;
    if left_round + right_round == 0.0 {
        Some(sum)
    } else {
        None
    }
}

#[inline]
fn exact_opposite_products(left_a: f64, left_b: f64, right_a: f64, right_b: f64) -> bool {
    let left = exact_binary_product(left_a, left_b);
    let right = exact_binary_product(right_a, right_b);
    if left.significand == 0 || right.significand == 0 {
        return left.significand == right.significand;
    }
    left.negative != right.negative
        && left.significand == right.significand
        && left.exponent == right.exponent
}

// ---------------------------------------------------------------------------
// Coupon/bond helpers
// ---------------------------------------------------------------------------

/// Coupon period months for a given frequency.
pub(crate) fn coupon_period_months(frequency: i32) -> i32 {
    match frequency {
        1 => 12,
        2 => 6,
        4 => 3,
        _ => 12,
    }
}

/// Previous coupon date on or before settlement.
pub(crate) fn prev_coupon_date(settlement: f64, maturity: f64, frequency: i32) -> f64 {
    let months = coupon_period_months(frequency);
    let mut coupon = maturity;
    let mut iterations = 0;
    while coupon > settlement {
        iterations += 1;
        if iterations > 12000 {
            return f64::NAN;
        }
        let prev = coupon;
        coupon = add_months_to_serial(coupon, -months);
        if coupon == prev {
            break;
        }
    }
    coupon
}

/// Next coupon date after settlement.
pub(crate) fn next_coupon_date(settlement: f64, maturity: f64, frequency: i32) -> f64 {
    let prev = prev_coupon_date(settlement, maturity, frequency);
    let months = coupon_period_months(frequency);
    add_months_to_serial(prev, months)
}

/// Count coupons remaining.
pub(crate) fn count_coupons_remaining(settlement: f64, maturity: f64, frequency: i32) -> f64 {
    let months = coupon_period_months(frequency);
    let mut next = next_coupon_date(settlement, maturity, frequency);
    let mut count = 0.0;
    let mut iterations = 0;
    while next <= maturity {
        iterations += 1;
        if iterations > 12000 {
            return f64::NAN;
        }
        count += 1.0;
        let prev = next;
        next = add_months_to_serial(next, months);
        if next == prev {
            break;
        }
    }
    count
}

/// Days in coupon period.
pub(crate) fn days_in_coupon_period(
    settlement: f64,
    maturity: f64,
    frequency: i32,
    basis: i32,
) -> f64 {
    match basis {
        0 | 4 => 360.0 / frequency as f64,
        1 => {
            let prev = prev_coupon_date(settlement, maturity, frequency);
            let next = next_coupon_date(settlement, maturity, frequency);
            actual_days_between(prev, next)
        }
        2 => 360.0 / frequency as f64,
        3 => 365.0 / frequency as f64,
        _ => 360.0 / frequency as f64,
    }
}

/// Coupon days from beginning of period to settlement.
pub(crate) fn coupdaybs_calc(settlement: f64, maturity: f64, frequency: i32, basis: i32) -> f64 {
    let prev = prev_coupon_date(settlement, maturity, frequency);
    match basis {
        0 => days360_between(prev, settlement, 0),
        1..=3 => actual_days_between(prev, settlement),
        4 => days360_between(prev, settlement, 4),
        _ => days360_between(prev, settlement, 0),
    }
}

/// Coupon days from settlement to next coupon.
pub(crate) fn coupdaysnc_calc(settlement: f64, maturity: f64, frequency: i32, basis: i32) -> f64 {
    let next = next_coupon_date(settlement, maturity, frequency);
    match basis {
        0 => days360_between(settlement, next, 0),
        1..=3 => actual_days_between(settlement, next),
        4 => days360_between(settlement, next, 4),
        _ => days360_between(settlement, next, 0),
    }
}

/// PRICE core calculation (used by PRICE and YIELD).
pub(crate) fn price_core(
    settlement: f64,
    maturity: f64,
    rate: f64,
    yld: f64,
    redemption: f64,
    frequency: i32,
    basis: i32,
) -> f64 {
    let n = count_coupons_remaining(settlement, maturity, frequency);
    let coupon_payment = (100.0 * rate) / frequency as f64;
    let yld_per_period = yld / frequency as f64;

    let dsc = coupdaysnc_calc(settlement, maturity, frequency, basis);
    let e = days_in_coupon_period(settlement, maturity, frequency, basis);
    let a = coupdaybs_calc(settlement, maturity, frequency, basis);

    if e == 0.0 {
        return f64::NAN;
    }
    let dsc_frac = dsc / e;
    let n_int = n as i32;

    if n_int == 1 {
        let price = (redemption + coupon_payment) / (1.0 + dsc_frac * yld_per_period)
            - (coupon_payment * a) / e;
        return price;
    }

    // General case
    let mut price = redemption / (1.0 + yld_per_period).powf(n - 1.0 + dsc_frac);
    for k in 1..=n_int {
        price += coupon_payment / (1.0 + yld_per_period).powf(k as f64 - 1.0 + dsc_frac);
    }
    price -= (coupon_payment * a) / e;
    price
}

/// Validate common bond arguments.
pub(crate) fn validate_bond_args(
    settlement: f64,
    maturity: f64,
    frequency: i32,
    basis: i32,
) -> Result<(), CellValue> {
    if settlement >= maturity {
        return Err(CellValue::error_with_message(
            CellError::Num,
            "settlement must be before maturity",
        ));
    }
    if frequency != 1 && frequency != 2 && frequency != 4 {
        return Err(CellValue::error_with_message(
            CellError::Num,
            format!("frequency must be 1, 2, or 4, got {frequency}"),
        ));
    }
    if !(0..=4).contains(&basis) {
        return Err(CellValue::error_with_message(
            CellError::Num,
            format!("basis must be 0..4, got {basis}"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_yearfrac_basis1_multi_year() {
        // From 2019-01-01 to 2021-01-01 = 731 actual days
        // Years 2019, 2020, 2021: 365, 366, 365 = 1096 / 3 = 365.333...
        // YEARFRAC = 731 / 365.333... = 2.0
        let start = ymd_to_serial(2019, 1, 1);
        let end = ymd_to_serial(2021, 1, 1);
        let yf = year_frac(start, end, 1);
        assert!(
            (yf - 2.0).abs() < 0.01,
            "YEARFRAC(2019-01-01, 2021-01-01, 1) = {}, expected ~2.0",
            yf
        );
    }

    #[test]
    fn test_yearfrac_basis0_feb28_adjustment() {
        // Feb 28 (non-leap year) to Mar 31: should be 30/360 with Feb adjusted to 30
        // sd=28 (last of Feb) -> sd=30, ed=31 -> ed=30 (since sd>=30)
        // Days = 0*360 + 1*30 + 0 = 30, YEARFRAC = 30/360
        let start = ymd_to_serial(2023, 2, 28); // non-leap year
        let end = ymd_to_serial(2023, 3, 31);
        let yf = year_frac(start, end, 0);
        assert!(
            (yf - 30.0 / 360.0).abs() < 0.001,
            "YEARFRAC(Feb28, Mar31, 0) = {}, expected {}",
            yf,
            30.0 / 360.0
        );
    }

    #[test]
    fn test_yearfrac_basis0_feb29_leap_adjustment() {
        // Feb 29 (leap year) to Mar 31: last day of Feb -> sd=30
        let start = ymd_to_serial(2024, 2, 29); // leap year
        let end = ymd_to_serial(2024, 3, 31);
        let yf = year_frac(start, end, 0);
        // sd=29 (last of Feb 2024) -> sd=30, ed=31 -> ed=30 (sd>=30)
        // Days = 0*360 + 1*30 + 0 = 30
        assert!(
            (yf - 30.0 / 360.0).abs() < 0.001,
            "YEARFRAC(Feb29-2024, Mar31, 0) = {}, expected {}",
            yf,
            30.0 / 360.0
        );
    }
}
