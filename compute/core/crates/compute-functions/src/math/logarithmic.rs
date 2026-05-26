//! Logarithmic / Exponential functions: LOG, LOG10, LN, EXP, POWER, SQRT, SQRTPI

use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::helpers::power::try_negative_base_pow;
use crate::{FunctionRegistry, PureFunction};

pub(super) struct FnLog;
impl PureFunction for FnLog {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "LOG"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            1 => Some(CellValue::number(10.0)), // base defaults to 10 (common logarithm)
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let base = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(b) if b <= 0.0 => {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("LOG: base must be > 0, got {b}"),
                    );
                }
                Ok(1.0) => {
                    return CellValue::error_with_message(
                        CellError::Div0,
                        "LOG: base must not be 1 (division by ln(1)=0)",
                    );
                }
                Ok(b) => b,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            10.0
        };
        match args[0].coerce_to_number() {
            Ok(n) if n <= 0.0 => CellValue::error_with_message(
                CellError::Num,
                format!("LOG: number must be > 0, got {n}"),
            ),
            Ok(n) => CellValue::number(n.ln() / base.ln()),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnLog10Proper;
impl PureFunction for FnLog10Proper {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "LOG10"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) if n <= 0.0 => CellValue::error_with_message(
                CellError::Num,
                format!("LOG10: number must be > 0, got {n}"),
            ),
            Ok(n) => CellValue::number(n.log10()),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnLn;
impl PureFunction for FnLn {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "LN"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) if n <= 0.0 => CellValue::error_with_message(
                CellError::Num,
                format!("LN: number must be > 0, got {n}"),
            ),
            Ok(n) => CellValue::number(n.ln()),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnExp;
impl PureFunction for FnExp {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "EXP"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                let r = n.exp();
                if r.is_infinite() {
                    CellValue::error_with_message(
                        CellError::Num,
                        format!("EXP: result overflow for exponent {n}"),
                    )
                } else {
                    CellValue::number(r)
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnPower;
impl PureFunction for FnPower {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "POWER"
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
            (Ok(base), Ok(exp)) => {
                // Handle base=0 cases first
                if base == 0.0 {
                    if exp == 0.0 {
                        return CellValue::error_with_message(
                            CellError::Num,
                            "POWER: 0 raised to power 0 is undefined",
                        ); // Excel: POWER(0,0) = #NUM!
                    } else if exp > 0.0 {
                        return CellValue::number(0.0); // 0^positive = 0
                    } else {
                        return CellValue::error_with_message(
                            CellError::Div0,
                            format!("POWER: 0 raised to negative power {exp} (division by zero)"),
                        ); // 0^negative = #DIV/0!
                    }
                }
                // Negative base with non-integer exponent: try real-valued
                // n-th root for rational exponents with odd denominator
                // (e.g., (-8)^(1/3) = -2), otherwise #NUM!.
                if base < 0.0 && exp != 0.0 && exp.is_finite() && exp != exp.floor() {
                    if let Some(result) = try_negative_base_pow(base, exp) {
                        return result;
                    }
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("POWER: negative base {base} with non-integer exponent {exp}"),
                    );
                }
                // 1^anything = 1
                if base == 1.0 {
                    return CellValue::number(1.0);
                }
                // When |exp| is astronomically large (>= 1e308 ≈ f64::MAX),
                // Excel always returns #NUM! for any base != 1.
                // Special case: small positive base with huge negative exp —
                // Excel returns 0 (underflow to zero rather than error).
                if exp.abs() >= 1e308 {
                    if base > 0.0 && exp < 0.0 {
                        // Any positive base with huge negative exp underflows to 0
                        // (base=1 already handled above)
                        return CellValue::number(0.0);
                    }
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("POWER: exponent {exp} too large for base {base}"),
                    );
                }
                // When |exp| exceeds f64 integer precision (2^53), the result is
                // unreliable for any base != 1 — Excel returns #NUM!.
                // Exception: positive base with huge negative exp underflows to 0.
                const MAX_SAFE_INT: f64 = 9_007_199_254_740_992.0; // 2^53
                if exp.abs() > MAX_SAFE_INT {
                    if base > 0.0 && exp < 0.0 {
                        return CellValue::number(0.0);
                    }
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("POWER: exponent {exp} exceeds precision for base {base}"),
                    );
                }
                // Subnormal bases that are effectively zero with negative exponent
                if base.abs() < f64::MIN_POSITIVE && exp < 0.0 {
                    return CellValue::error_with_message(
                        CellError::Div0,
                        format!(
                            "POWER: subnormal base {base} with negative exponent {exp} (division by zero)"
                        ),
                    );
                }
                // (-1)^n: handle integer exponents
                if base == -1.0 {
                    let is_even = exp % 2.0 == 0.0;
                    return CellValue::number(if is_even { 1.0 } else { -1.0 });
                }
                let r = base.powf(exp);
                if r.is_nan() || r.is_infinite() {
                    // Small positive base with negative exp overflows to inf
                    // → Excel returns #DIV/0! (conceptually 1/0)
                    if r.is_infinite() && base > 0.0 && base < 1.0 && exp < 0.0 {
                        CellValue::error_with_message(
                            CellError::Div0,
                            format!("POWER: {base}^{exp} overflows (division by zero)"),
                        )
                    } else {
                        CellValue::error_with_message(
                            CellError::Num,
                            format!("POWER: {base}^{exp} is not a finite number"),
                        )
                    }
                } else {
                    CellValue::number(r)
                }
            }
            (Err(e), _) | (_, Err(e)) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnSqrt;
impl PureFunction for FnSqrt {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "SQRT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) if n < 0.0 => CellValue::error_with_message(
                CellError::Num,
                format!("SQRT: number must be >= 0, got {n}"),
            ),
            Ok(n) => CellValue::number(n.sqrt()),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnSqrtPi;
impl PureFunction for FnSqrtPi {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "SQRTPI"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) if n < 0.0 => CellValue::error_with_message(
                CellError::Num,
                format!("SQRTPI: number must be >= 0, got {n}"),
            ),
            Ok(n) => CellValue::number((n * std::f64::consts::PI).sqrt()),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnLog));
    registry.register(Box::new(FnLog10Proper));
    registry.register(Box::new(FnLn));
    registry.register(Box::new(FnExp));
    registry.register(Box::new(FnPower));
    registry.register(Box::new(FnSqrt));
    registry.register(Box::new(FnSqrtPi));
}
