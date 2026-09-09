use value_types::{CellError, CellValue};

use super::super::helpers::{coerce_num, coerce_str};
use super::types::{format_complex, parse_complex};
use super::wrappers::complex_unary_fn;
use crate::PureFunction;

complex_unary_fn!(FnImSqrt, "IMSQRT", |re: f64,
                                       im: f64,
                                       suffix: char|
 -> CellValue {
    // The principal square root is exact on the real axis. Avoid cos(pi/2)
    // introducing a spurious real component for a negative real input.
    if im == 0.0 {
        let (r, i) = if re < 0.0 {
            (0.0, (-re).sqrt().copysign(im))
        } else {
            (re.sqrt(), 0.0)
        };
        return CellValue::Text(format_complex(r, i, suffix).into());
    }
    let modulus = (re * re + im * im).sqrt();
    let theta = im.atan2(re);
    let sqrt_r = modulus.sqrt();
    let r = sqrt_r * (theta / 2.0).cos();
    let i = sqrt_r * (theta / 2.0).sin();
    CellValue::Text(format_complex(r, i, suffix).into())
});

pub(super) struct FnImPower;
impl PureFunction for FnImPower {
    fn name(&self) -> &'static str {
        "IMPOWER"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let s = match coerce_str(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let (re, im, suffix) = match parse_complex(&s) {
            Some(v) => v,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    "IMPOWER: first argument is not a valid complex number".to_string(),
                );
            }
        };
        let n = match coerce_num(args, 1) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let r = (re * re + im * im).sqrt();
        let theta = im.atan2(re);
        if r == 0.0 && n <= 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                "IMPOWER: cannot raise zero to a negative or zero power".to_string(),
            );
        }
        let rn = r.powf(n);
        let result_re = rn * (n * theta).cos();
        let result_im = rn * (n * theta).sin();
        CellValue::Text(format_complex(result_re, result_im, suffix).into())
    }
}

// IMDIV: complex / complex
pub(super) struct FnImDiv;
impl PureFunction for FnImDiv {
    fn name(&self) -> &'static str {
        "IMDIV"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let s1 = match coerce_str(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let s2 = match coerce_str(args, 1) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let (a, b, suf1) = match parse_complex(&s1) {
            Some(v) => v,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    "IMDIV: numerator is not a valid complex number".to_string(),
                );
            }
        };
        let (c, d, suf2) = match parse_complex(&s2) {
            Some(v) => v,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    "IMDIV: denominator is not a valid complex number".to_string(),
                );
            }
        };
        // Validate suffix consistency: if both have imaginary parts, suffixes must match
        if b != 0.0 && d != 0.0 && suf1 != suf2 {
            return CellValue::error_with_message(
                CellError::Value,
                "IMDIV: mismatched imaginary suffixes ('i' vs 'j')".to_string(),
            );
        }
        let suffix = if b != 0.0 { suf1 } else { suf2 };
        if c == 0.0 && d == 0.0 {
            return CellValue::error_with_message(
                CellError::Num,
                "IMDIV: division by zero".to_string(),
            );
        }
        let (re, im) = finite_complex_divide(a, b, c, d);
        if !re.is_finite() || !im.is_finite() {
            return CellValue::error_with_message(
                CellError::Num,
                "IMDIV: result is not finite".to_string(),
            );
        }
        CellValue::Text(format_complex(re, im, suffix).into())
    }
}

/// Keep Smith's ordinary evaluation order, but use explicit binary exponents
/// when an intermediate loses range. A tiny product can become representable
/// again after division, so testing only the final quotient is insufficient.
fn finite_complex_divide(a: f64, b: f64, c: f64, d: f64) -> (f64, f64) {
    if ![a, b, c, d].iter().all(|v| v.is_finite()) {
        return (f64::NAN, f64::NAN);
    }
    let (ratio, denominator, left_re, right_re, left_im, right_im, factors) = if c.abs() >= d.abs()
    {
        let ratio = d / c;
        (ratio, c + d * ratio, a, b * ratio, b, -a * ratio, [d, b, a])
    } else {
        let ratio = c / d;
        (ratio, d + c * ratio, a * ratio, b, b * ratio, -a, [c, a, b])
    };
    let product_lost_range = |factor: f64| {
        let product = factor * ratio;
        factor != 0.0 && ratio != 0.0 && (product == 0.0 || product.is_subnormal())
    };
    let re_numerator = left_re + right_re;
    let im_numerator = left_im + right_im;
    if (factors[0] != 0.0 && (ratio == 0.0 || ratio.is_subnormal()))
        || product_lost_range(factors[1])
        || product_lost_range(factors[2])
        || !denominator.is_normal()
        || !re_numerator.is_finite()
        || !im_numerator.is_finite()
        || re_numerator.is_subnormal()
        || im_numerator.is_subnormal()
    {
        let denominator = scaled_product_sum(c, c, d, d);
        return (
            scaled_quotient(scaled_product_sum(a, c, b, d), denominator),
            scaled_quotient(scaled_product_sum(b, c, -a, d), denominator),
        );
    }
    (re_numerator / denominator, im_numerator / denominator)
}

/// A normalized signed significand and an unrestricted binary exponent.
/// Keeping exponents separate allows products outside f64's range to cancel
/// or be divided before the final result is rounded back into that range.
#[derive(Clone, Copy)]
struct ScaledComplexComponent {
    significand: f64,
    exponent: i32,
}

fn scaled_component(value: f64) -> ScaledComplexComponent {
    if value == 0.0 {
        return ScaledComplexComponent {
            significand: value,
            exponent: 0,
        };
    }
    if value.is_subnormal() {
        let mut result = scaled_component(value * 18014398509481984.0); // exactly 2^54
        result.exponent -= 54;
        return result;
    }
    let bits = value.to_bits();
    ScaledComplexComponent {
        significand: f64::from_bits((bits & 0x800f_ffff_ffff_ffff) | (1023_u64 << 52)),
        exponent: ((bits >> 52) & 0x7ff) as i32 - 1023,
    }
}

fn scale_complex_significand(value: f64, exponent: i32) -> f64 {
    if value == 0.0 {
        return value;
    }
    if exponent > 1023 {
        return f64::INFINITY.copysign(value);
    }
    if exponent < -1075 {
        return 0.0_f64.copysign(value);
    }
    if exponent < -1022 {
        // Only the last multiplication rounds into the subnormal range.
        return (value * f64::MIN_POSITIVE)
            * f64::from_bits(((exponent + 1022 + 1023) as u64) << 52);
    }
    value * f64::from_bits(((exponent + 1023) as u64) << 52)
}

fn scaled_product_sum(a: f64, b: f64, c: f64, d: f64) -> ScaledComplexComponent {
    let (a, b, c, d) = (
        scaled_component(a),
        scaled_component(b),
        scaled_component(c),
        scaled_component(d),
    );
    let left = a.significand * b.significand;
    let right = c.significand * d.significand;
    let left_exp = a.exponent + b.exponent;
    let right_exp = c.exponent + d.exponent;
    let exponent = if left == 0.0 {
        right_exp
    } else if right == 0.0 {
        left_exp
    } else {
        left_exp.max(right_exp)
    };
    let left_error = a.significand.mul_add(b.significand, -left);
    let right_error = c.significand.mul_add(d.significand, -right);
    let x = scale_complex_significand(left, left_exp - exponent);
    let y = scale_complex_significand(right, right_exp - exponent);
    let sum = x + y;
    // Error-free two-sum plus the FMA product residuals retains a small
    // determinant when the two large products almost cancel.
    let recovered_y = sum - x;
    let sum_error = (x - (sum - recovered_y)) + (y - recovered_y);
    let residual = scale_complex_significand(left_error, left_exp - exponent)
        + scale_complex_significand(right_error, right_exp - exponent)
        + sum_error;
    let mut result = scaled_component(sum + residual);
    result.exponent += exponent;
    result
}

fn scaled_quotient(numerator: ScaledComplexComponent, denominator: ScaledComplexComponent) -> f64 {
    let mut result = scaled_component(numerator.significand / denominator.significand);
    result.exponent += numerator.exponent - denominator.exponent;
    scale_complex_significand(result.significand, result.exponent)
}

// IMSUB: complex - complex
pub(super) struct FnImSub;
impl PureFunction for FnImSub {
    fn name(&self) -> &'static str {
        "IMSUB"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let s1 = match coerce_str(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let s2 = match coerce_str(args, 1) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let (a, b, suf1) = match parse_complex(&s1) {
            Some(v) => v,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    "IMSUB: first argument is not a valid complex number".to_string(),
                );
            }
        };
        let (c, d, suf2) = match parse_complex(&s2) {
            Some(v) => v,
            None => {
                return CellValue::error_with_message(
                    CellError::Num,
                    "IMSUB: second argument is not a valid complex number".to_string(),
                );
            }
        };
        // Validate suffix consistency: if both have imaginary parts, suffixes must match
        if b != 0.0 && d != 0.0 && suf1 != suf2 {
            return CellValue::error_with_message(
                CellError::Value,
                "IMSUB: mismatched imaginary suffixes ('i' vs 'j')".to_string(),
            );
        }
        let suffix = if b != 0.0 { suf1 } else { suf2 };
        CellValue::Text(format_complex(a - c, b - d, suffix).into())
    }
}

// IMSUM: sum of 1..N complex numbers
pub(super) struct FnImSum;
impl PureFunction for FnImSum {
    fn name(&self) -> &'static str {
        "IMSUM"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        aggregate_complex(args, "IMSUM", (0.0, 0.0), |(a, b), (c, d)| (a + c, b + d))
    }
}

// IMPRODUCT: product of 1..N complex numbers
pub(super) struct FnImProduct;
impl PureFunction for FnImProduct {
    fn name(&self) -> &'static str {
        "IMPRODUCT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        aggregate_complex(args, "IMPRODUCT", (1.0, 0.0), |(a, b), (c, d)| {
            (a * c - b * d, a * d + b * c)
        })
    }
}

/// Aggregate scalar arguments and every cell of range/array arguments in order.
/// Empty range cells do not contribute an operand; explicit scalar arguments
/// retain the same coercion and error behavior as the other complex functions.
fn aggregate_complex(
    args: &[CellValue],
    name: &str,
    mut result: (f64, f64),
    combine: impl Fn((f64, f64), (f64, f64)) -> (f64, f64),
) -> CellValue {
    let mut result_suffix = 'i';
    let mut suffix_set = false;
    for (idx, argument) in args.iter().enumerate() {
        let mut pending = vec![(argument, false)];
        while let Some((value, in_array)) = pending.pop() {
            match value {
                CellValue::Array(rows) => {
                    pending.extend(rows.data().iter().rev().map(|cell| (cell, true)));
                    continue;
                }
                CellValue::Null if in_array => continue,
                CellValue::Error(..) => return value.clone(),
                _ => {}
            }
            let s = match value.coerce_to_string() {
                Ok(s) => s,
                Err(error) => return CellValue::Error(error, None),
            };
            let (re, im, suffix) = match parse_complex(&s) {
                Some(value) => value,
                None => {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("{name}: argument {} is not a valid complex number", idx + 1),
                    );
                }
            };
            result = combine(result, (re, im));
            // Preserve the existing scalar suffix policy for array operands.
            if suffix != 'i' || im != 0.0 {
                if !suffix_set {
                    result_suffix = suffix;
                    suffix_set = true;
                } else if suffix != result_suffix && suffix != 'i' {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!("{name}: mismatched imaginary suffixes ('i' vs 'j')"),
                    );
                }
            }
        }
    }
    CellValue::Text(format_complex(result.0, result.1, result_suffix).into())
}
