//! Basic math functions: COUNTBLANK, ABS, SIGN, MOD, PRODUCT, QUOTIENT, PI

use value_types::{CellError, CellValue};

use crate::helpers::coercion::{check_error, extract_numbers, flatten_values};
use crate::{FunctionRegistry, PureFunction};

one_num_fn!(FnAbs, "ABS", |n: f64| n.abs());
one_num_fn!(FnSign, "SIGN", |n: f64| {
    if n > 0.0 {
        1.0
    } else if n < 0.0 {
        -1.0
    } else {
        0.0
    }
});

pub(super) struct FnCountBlank;
impl PureFunction for FnCountBlank {
    fn name(&self) -> &'static str {
        "COUNTBLANK"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        let count = flat
            .iter()
            .filter(|v| {
                matches!(v, CellValue::Null) || matches!(v, CellValue::Text(s) if s.is_empty())
            })
            .count();
        CellValue::number(count as f64)
    }
}

pub(super) struct FnMod;
impl PureFunction for FnMod {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "MOD"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        match (args[0].coerce_to_number(), args[1].coerce_to_number()) {
            (Ok(_), Ok(0.0)) => {
                CellValue::error_with_message(CellError::Div0, "MOD: divisor must not be 0")
            }
            (Ok(n), Ok(d)) => {
                // When both operands are at the extremes of the f64 range,
                // intermediate computations lose all precision — Excel returns #NUM!.
                // However, when n/d is an exact integer (e.g. n == d), the
                // remainder is trivially 0 and perfectly representable.
                const HUGE: f64 = 1e300;
                if n.abs() >= HUGE && d.abs() >= HUGE {
                    let ratio = n / d;
                    if !ratio.is_finite() {
                        return CellValue::error_with_message(
                            CellError::Num,
                            format!("MOD: operands too large ({n}, {d}), result loses precision"),
                        );
                    }
                    let rounded = ratio.round();
                    if (ratio - rounded).abs() <= ratio.abs().max(1.0) * f64::EPSILON * 4.0 {
                        // Ratio is an exact integer — remainder is 0
                        return CellValue::number(0.0);
                    }
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("MOD: operands too large ({n}, {d}), result loses precision"),
                    );
                }
                // When both operands are very tiny, precision is
                // unreliable — Excel returns #NUM! for most cases.
                // However, when both operands are the exact same value
                // (bitwise equal), MOD(x,x) = 0.  MOD(x,-x) for subnormals
                // has no meaningful answer due to precision loss → #NUM!.
                const TINY: f64 = 1e-300;
                if n != 0.0 && d != 0.0 && n.abs() < TINY && d.abs() < TINY {
                    if n == d {
                        return CellValue::number(0.0);
                    }
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("MOD: operands too small ({n}, {d}), result loses precision"),
                    );
                }
                // When n and d have opposite signs and |n/d| is negligibly
                // small (e.g. MOD(1, -1e308), MOD(42.5, -1e308),
                // MOD(1e-307, -1)), the mathematical quotient is a tiny
                // negative number.  floor() of such a value gives -1 instead
                // of 0, causing the result to jump to approximately d, which
                // is wildly wrong.  The snap-to-integer logic below catches
                // some of these but not all (when n is non-negligible relative
                // to EPSILON*8 of the magnitude, the residual snap misses it).
                // Excel returns 0 for all of these cases.
                //
                // When n and d have the SAME sign, the quotient is a tiny
                // POSITIVE number, floor() correctly gives 0, and r = n.
                // That's the correct answer (e.g. MOD(1e-16, 1) = 1e-16).
                if n * d < 0.0 && (n / d).abs() < f64::EPSILON {
                    return CellValue::number(0.0);
                }
                // Excel returns #NUM! when either input is near the floating-point limit
                // and the result would lose precision.
                let quotient = n / d;
                if quotient.is_infinite() || quotient.is_nan() {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("MOD: {n}/{d} is not finite"),
                    );
                }
                // Excel returns #NUM! when the quotient exceeds f64 integer
                // precision (2^53).  Beyond this threshold the floor() result
                // is unreliable and the MOD answer would be meaningless.
                const MAX_SAFE_INT: f64 = 9_007_199_254_740_992.0; // 2^53
                if quotient.abs() > MAX_SAFE_INT {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("MOD: quotient {n}/{d} exceeds safe integer precision"),
                    );
                }
                // Snap the quotient to an exact integer when it is very close
                // to one. Without this, floor() can be off by 1 for values
                // like 2.9999999999999996, causing the remainder to be ~d instead of 0.
                let rounded = quotient.round();
                let floored =
                    if (quotient - rounded).abs() <= quotient.abs().max(1.0) * f64::EPSILON * 4.0 {
                        rounded
                    } else {
                        quotient.floor()
                    };
                // Also check if the intermediate product d * floor(quotient) would overflow
                let product = d * floored;
                if product.is_infinite() || product.is_nan() {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("MOD: intermediate product overflow for {n} mod {d}"),
                    );
                }
                let r = n - product;
                // Final sanity check: result should have magnitude less than |d|
                if r.is_infinite() || r.is_nan() || r.abs() > d.abs() * (1.0 + 1e-10) {
                    CellValue::error_with_message(
                        CellError::Num,
                        format!("MOD: result not finite for {n} mod {d}"),
                    )
                } else {
                    // Snap tiny residuals to zero: when the remainder is
                    // negligibly small relative to the operand magnitudes,
                    // Excel returns exactly 0.  Two checks:
                    // 1. Absolute: |r| is tiny relative to magnitude * EPSILON
                    // 2. Relative: |r/n| is below EPSILON (r negligible vs dividend)
                    // Note: we compare against n.abs(), NOT d.abs(), because
                    // when |n| << |d| the correct remainder IS n itself.
                    let magnitude = n.abs();
                    if magnitude > 0.0
                        && (r.abs() < magnitude * f64::EPSILON * 8.0
                            || r.abs() < n.abs() * f64::EPSILON)
                    {
                        CellValue::number(0.0)
                    } else {
                        CellValue::number(r)
                    }
                }
            }
            (Err(e), _) | (_, Err(e)) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnProduct;
impl PureFunction for FnProduct {
    fn name(&self) -> &'static str {
        "PRODUCT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        match extract_numbers(&flat) {
            Ok(nums) => {
                if nums.is_empty() {
                    CellValue::number(0.0)
                } else {
                    CellValue::number(nums.iter().product())
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnQuotient;
impl PureFunction for FnQuotient {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "QUOTIENT"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        match (args[0].coerce_to_number(), args[1].coerce_to_number()) {
            (Ok(_), Ok(0.0)) => {
                CellValue::error_with_message(CellError::Div0, "QUOTIENT: divisor must not be 0")
            }
            (Ok(n), Ok(d)) => {
                // When both operands are very tiny, precision is
                // unreliable — return 0 for most cases to match Excel.
                // However, when both operands are the exact same value
                // (bitwise equal), QUOTIENT(x,x) = 1 and QUOTIENT(x,-x) = -1.
                const TINY: f64 = 1e-300;
                if n != 0.0 && d != 0.0 && n.abs() < TINY && d.abs() < TINY {
                    if n == d {
                        return CellValue::number(1.0);
                    }
                    if n == -d {
                        return CellValue::number(-1.0);
                    }
                    return CellValue::number(0.0);
                }
                let raw = n / d;
                if raw.is_infinite() || raw.is_nan() {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("QUOTIENT: {n}/{d} is not finite"),
                    );
                }
                // Snap values very close to zero to exactly zero.
                // When the true quotient is mathematically 0, floating-point
                // rounding can produce a tiny value whose trunc() is wrong.
                if raw.abs() < f64::EPSILON {
                    return CellValue::number(0.0);
                }
                // QUOTIENT = trunc(n/d).  Simply truncate toward zero.
                // We do NOT snap epsilon-close values to nearby integers,
                // because snapping can cross a trunc() boundary and change
                // the result (e.g. -0.9999999999999994 would snap to -1.0,
                // but QUOTIENT should return 0).  The only case where plain
                // trunc() could be wrong is when n/d is mathematically an
                // exact integer but FP division rounds down by 1 ULP (e.g.
                // 3.0/1.0 → 2.999...96).  In practice, IEEE 754 division
                // is correctly rounded, so n/d for exact-integer quotients
                // always produces the exact integer.
                let r = raw.trunc();
                if r.is_infinite() || r.is_nan() {
                    CellValue::error_with_message(
                        CellError::Num,
                        format!("QUOTIENT: truncated result of {n}/{d} is not finite"),
                    )
                } else {
                    CellValue::number(r)
                }
            }
            (Err(e), _) | (_, Err(e)) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnPi;
impl PureFunction for FnPi {
    fn name(&self) -> &'static str {
        "PI"
    }
    fn min_args(&self) -> usize {
        0
    }
    fn max_args(&self) -> Option<usize> {
        Some(0)
    }
    fn call(&self, _args: &[CellValue]) -> CellValue {
        CellValue::number(std::f64::consts::PI)
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnAbs));
    registry.register(Box::new(FnSign));
    registry.register(Box::new(FnCountBlank));
    registry.register(Box::new(FnMod));
    registry.register(Box::new(FnProduct));
    registry.register(Box::new(FnQuotient));
    registry.register(Box::new(FnPi));
}
