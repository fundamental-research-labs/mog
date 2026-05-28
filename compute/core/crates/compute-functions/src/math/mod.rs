//! Math functions: COUNTBLANK, ABS, SQRT, SQRTPI,
//! INT, ROUND, ROUNDUP, ROUNDDOWN, TRUNC, MROUND, EVEN, ODD, MOD, POWER, QUOTIENT,
//! CEILING, CEILING.MATH, CEILING.PRECISE, ISO.CEILING, FLOOR, FLOOR.MATH, FLOOR.PRECISE,
//! SIGN, PI, RAND, RANDBETWEEN, RANDARRAY, PRODUCT, LOG, LOG10, LN, EXP,
//! SIN, COS, TAN, ASIN, ACOS, ATAN, ATAN2, DEGREES, RADIANS, COT, ACOT, SEC, CSC,
//! SINH, COSH, TANH, ASINH, ACOSH, ATANH, COTH, ACOTH, SECH, CSCH,
//! FACT, FACTDOUBLE, COMBIN, COMBINA, PERMUT, PERMUTATIONA, GCD, LCM, MULTINOMIAL,
//! MMULT, MDETERM, MINVERSE, MUNIT, SUMSQ, SUMX2MY2, SUMX2PY2, SUMXMY2,
//! BASE, DECIMAL, ROMAN, ARABIC, SERIESSUM

use crate::FunctionRegistry;

// ---------------------------------------------------------------------------
// Shared macro for simple single-arg numeric functions
// ---------------------------------------------------------------------------

macro_rules! one_num_fn {
    ($struct_name:ident, $name:literal, $body:expr) => {
        pub(super) struct $struct_name;
        impl crate::PureFunction for $struct_name {
            fn name(&self) -> &'static str {
                $name
            }
            fn min_args(&self) -> usize {
                1
            }
            fn max_args(&self) -> Option<usize> {
                Some(1)
            }
            fn is_scalar_arg(&self, _index: usize) -> bool {
                true
            }
            fn call(&self, args: &[value_types::CellValue]) -> value_types::CellValue {
                if let Some(e) = crate::helpers::coercion::check_error(&args[0]) {
                    return e;
                }
                match args[0].coerce_to_number() {
                    Ok(n) => {
                        let f: fn(f64) -> f64 = $body;
                        let result = f(n);
                        if result.is_nan() || result.is_infinite() {
                            return value_types::CellValue::error_with_message(
                                value_types::CellError::Num,
                                format!("{}: result is not a finite number", $name),
                            );
                        }
                        value_types::CellValue::number(result)
                    }
                    Err(e) => value_types::CellValue::Error(e, None),
                }
            }
        }
    };
}

// ---------------------------------------------------------------------------
// Sub-modules
// ---------------------------------------------------------------------------

mod aggregation;
mod basic;
mod combinatorics;
mod conversion;
mod hyperbolic;
mod logarithmic;
mod matrix;
mod random;
mod rounding;
mod trigonometric;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

pub fn register(registry: &mut FunctionRegistry) {
    basic::register(registry);
    aggregation::register(registry);
    rounding::register(registry);
    trigonometric::register(registry);
    logarithmic::register(registry);
    hyperbolic::register(registry);
    combinatorics::register(registry);
    conversion::register(registry);
    matrix::register(registry);
    random::register(registry);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests;
