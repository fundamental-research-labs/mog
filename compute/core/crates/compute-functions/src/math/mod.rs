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
mod tests {
    use super::aggregation::*;
    use super::basic::*;
    use super::combinatorics::*;
    use super::conversion::*;
    use super::hyperbolic::*;
    use super::logarithmic::*;
    use super::matrix::*;
    use super::random::*;
    use super::rounding::*;
    use super::trigonometric::*;
    use crate::PureFunction;
    use value_types::{CellError, CellValue};

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }
    fn err(e: CellError) -> CellValue {
        CellValue::Error(e, None)
    }
    fn null() -> CellValue {
        CellValue::Null
    }
    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    #[test]
    fn test_abs() {
        let f = FnAbs;
        assert_eq!(f.call(&[num(-5.0)]), num(5.0));
        assert_eq!(f.call(&[num(5.0)]), num(5.0));
        assert_eq!(f.call(&[num(0.0)]), num(0.0));
    }

    #[test]
    fn test_sqrt() {
        let f = FnSqrt;
        assert_eq!(f.call(&[num(9.0)]), num(3.0));
        assert_eq!(f.call(&[num(-1.0)]), err(CellError::Num));
        assert_eq!(f.call(&[num(0.0)]), num(0.0));
    }

    #[test]
    fn test_percentof_standalone_sums_ranges() {
        let f = FnPercentOf;
        let subset = CellValue::from_rows(vec![
            vec![num(10.0), text("ignored")],
            vec![CellValue::Null, num(5.0)],
        ]);
        let all = CellValue::from_rows(vec![vec![num(10.0), num(20.0), num(30.0)]]);
        assert_eq!(f.call(&[subset, all]), num(0.25));
        assert_eq!(f.call(&[num(1.0), CellValue::Null]), err(CellError::Div0));
    }

    #[test]
    fn test_power() {
        let f = FnPower;
        assert_eq!(f.call(&[num(2.0), num(3.0)]), num(8.0));
        assert_eq!(f.call(&[num(4.0), num(0.5)]), num(2.0));
    }

    #[test]
    fn test_mod() {
        let f = FnMod;
        assert_eq!(f.call(&[num(7.0), num(3.0)]), num(1.0));
        assert_eq!(f.call(&[num(7.0), num(0.0)]), err(CellError::Div0));
        // Excel MOD: sign of divisor
        assert_eq!(f.call(&[num(-7.0), num(3.0)]), num(2.0));
    }

    #[test]
    fn test_round() {
        let f = FnRound;
        assert_eq!(f.call(&[num(2.567), num(2.0)]), num(2.57));
        assert_eq!(f.call(&[num(2.5)]), num(3.0));
        assert_eq!(f.call(&[num(1234.0), num(-2.0)]), num(1200.0));
    }

    #[test]
    fn test_roundup() {
        let f = FnRoundUp;
        assert_eq!(f.call(&[num(2.321), num(1.0)]), num(2.4));
        assert_eq!(f.call(&[num(-2.321), num(1.0)]), num(-2.4));
    }

    #[test]
    fn test_rounddown() {
        let f = FnRoundDown;
        assert_eq!(f.call(&[num(2.789), num(1.0)]), num(2.7));
        assert_eq!(f.call(&[num(-2.789), num(1.0)]), num(-2.7));
    }

    #[test]
    fn test_ceiling() {
        let f = FnCeiling;
        assert_eq!(f.call(&[num(2.1), num(1.0)]), num(3.0));
        assert_eq!(f.call(&[num(2.5), num(0.5)]), num(2.5));
        assert_eq!(f.call(&[num(2.6), num(0.5)]), num(3.0));
        // Excel 2010+: negative number + positive significance rounds toward zero
        assert_eq!(f.call(&[num(-5.0), num(2.0)]), num(-4.0));
        assert_eq!(f.call(&[num(-2.1), num(1.0)]), num(-2.0));
        assert_eq!(f.call(&[num(-11.0), num(3.0)]), num(-9.0));
        // Positive number + negative significance is still #NUM! in all versions
        assert_eq!(f.call(&[num(5.0), num(-2.0)]), err(CellError::Num));
    }

    #[test]
    fn test_floor() {
        let f = FnFloor;
        assert_eq!(f.call(&[num(2.9), num(1.0)]), num(2.0));
        assert_eq!(f.call(&[num(2.5), num(0.5)]), num(2.5));
        // Excel 2010+: negative number + positive significance rounds toward -infinity
        assert_eq!(f.call(&[num(-5.0), num(2.0)]), num(-6.0));
        assert_eq!(f.call(&[num(-2.1), num(1.0)]), num(-3.0));
        assert_eq!(f.call(&[num(-11.0), num(3.0)]), num(-12.0));
        assert_eq!(f.call(&[num(-351511.0), num(250000.0)]), num(-500000.0));
        // Positive number + negative significance is still #NUM! in all versions
        assert_eq!(f.call(&[num(5.0), num(-2.0)]), err(CellError::Num));
    }

    #[test]
    fn test_sign() {
        let f = FnSign;
        assert_eq!(f.call(&[num(5.0)]), num(1.0));
        assert_eq!(f.call(&[num(-5.0)]), num(-1.0));
        assert_eq!(f.call(&[num(0.0)]), num(0.0));
    }

    #[test]
    fn test_pi() {
        let f = FnPi;
        assert_eq!(f.call(&[]), num(std::f64::consts::PI));
    }

    #[test]
    fn test_product() {
        let f = FnProduct;
        assert_eq!(f.call(&[num(2.0), num(3.0), num(4.0)]), num(24.0));
    }

    #[test]
    fn test_log() {
        let f = FnLog;
        assert_eq!(f.call(&[num(100.0)]), num(2.0));
        assert_eq!(f.call(&[num(8.0), num(2.0)]), num(3.0));
        assert_eq!(f.call(&[num(0.0)]), err(CellError::Num));
    }

    #[test]
    fn test_ln() {
        let f = FnLn;
        let result = f.call(&[num(std::f64::consts::E)]);
        if let CellValue::Number(n) = result {
            assert!((n.get() - 1.0).abs() < 1e-10);
        } else {
            panic!("Expected number");
        }
    }

    #[test]
    fn test_exp() {
        let f = FnExp;
        let result = f.call(&[num(1.0)]);
        if let CellValue::Number(n) = result {
            assert!((n.get() - std::f64::consts::E).abs() < 1e-10);
        } else {
            panic!("Expected number");
        }
    }

    #[test]
    fn test_sin_cos_tan() {
        assert_eq!(FnSin.call(&[num(0.0)]), num(0.0));
        assert_eq!(FnCos.call(&[num(0.0)]), num(1.0));
        assert_eq!(FnTan.call(&[num(0.0)]), num(0.0));
    }

    #[test]
    fn test_int() {
        let f = FnInt;
        assert_eq!(f.call(&[num(4.7)]), num(4.0));
        assert_eq!(f.call(&[num(-4.7)]), num(-5.0));
    }

    #[test]
    fn test_rand_is_volatile() {
        assert!(FnRand.is_volatile());
        assert!(FnRandBetween.is_volatile());
        assert!(FnRandArray.is_volatile());
        assert!(!FnAbs.is_volatile());
    }

    // --- Tests for new trigonometric functions ---

    #[test]
    fn test_asin() {
        assert_eq!(FnAsin.call(&[num(0.0)]), num(0.0));
        // asin(1) = PI/2
        if let CellValue::Number(n) = FnAsin.call(&[num(1.0)]) {
            assert!((n.get() - std::f64::consts::FRAC_PI_2).abs() < 1e-10);
        } else {
            panic!("Expected number");
        }
        // Out of range
        assert_eq!(FnAsin.call(&[num(2.0)]), err(CellError::Num));
        assert_eq!(FnAsin.call(&[num(-2.0)]), err(CellError::Num));
    }

    #[test]
    fn test_acos() {
        if let CellValue::Number(n) = FnAcos.call(&[num(1.0)]) {
            assert!((n.get() - 0.0).abs() < 1e-10);
        } else {
            panic!("Expected number");
        }
        assert_eq!(FnAcos.call(&[num(2.0)]), err(CellError::Num));
    }

    #[test]
    fn test_atan() {
        assert_eq!(FnAtan.call(&[num(0.0)]), num(0.0));
    }

    #[test]
    fn test_atan2() {
        // ATAN2(1, 0) = atan2(0, 1) = 0
        assert_eq!(FnAtan2.call(&[num(1.0), num(0.0)]), num(0.0));
        // ATAN2(0, 0) = #DIV/0!
        assert_eq!(FnAtan2.call(&[num(0.0), num(0.0)]), err(CellError::Div0));
        // ATAN2(0, 1) = atan2(1, 0) = PI/2
        if let CellValue::Number(n) = FnAtan2.call(&[num(0.0), num(1.0)]) {
            assert!((n.get() - std::f64::consts::FRAC_PI_2).abs() < 1e-10);
        } else {
            panic!("Expected number");
        }
    }

    #[test]
    fn test_degrees_radians() {
        if let CellValue::Number(n) = FnDegrees.call(&[num(std::f64::consts::PI)]) {
            assert!((n.get() - 180.0).abs() < 1e-10);
        } else {
            panic!("Expected number");
        }
        if let CellValue::Number(n) = FnRadians.call(&[num(180.0)]) {
            assert!((n.get() - std::f64::consts::PI).abs() < 1e-10);
        } else {
            panic!("Expected number");
        }
    }

    #[test]
    fn test_cot() {
        // COT(PI/4) = 1
        if let CellValue::Number(n) = FnCot.call(&[num(std::f64::consts::FRAC_PI_4)]) {
            assert!((n.get() - 1.0).abs() < 1e-10);
        } else {
            panic!("Expected number");
        }
    }

    #[test]
    fn test_acot() {
        // ACOT(0) = PI/2
        if let CellValue::Number(n) = FnAcot.call(&[num(0.0)]) {
            assert!((n.get() - std::f64::consts::FRAC_PI_2).abs() < 1e-10);
        } else {
            panic!("Expected number");
        }
        // ACOT(1) = PI/4
        if let CellValue::Number(n) = FnAcot.call(&[num(1.0)]) {
            assert!((n.get() - std::f64::consts::FRAC_PI_4).abs() < 1e-10);
        } else {
            panic!("Expected number");
        }
    }

    #[test]
    fn test_sec_csc() {
        // SEC(0) = 1/cos(0) = 1
        assert_eq!(FnSec.call(&[num(0.0)]), num(1.0));
        // CSC(PI/2) = 1/sin(PI/2) = 1
        if let CellValue::Number(n) = FnCsc.call(&[num(std::f64::consts::FRAC_PI_2)]) {
            assert!((n.get() - 1.0).abs() < 1e-10);
        } else {
            panic!("Expected number");
        }
    }

    // --- Tests for hyperbolic functions ---

    #[test]
    fn test_sinh_cosh_tanh() {
        assert_eq!(FnSinh.call(&[num(0.0)]), num(0.0));
        assert_eq!(FnCosh.call(&[num(0.0)]), num(1.0));
        assert_eq!(FnTanh.call(&[num(0.0)]), num(0.0));
    }

    #[test]
    fn test_asinh() {
        assert_eq!(FnAsinh.call(&[num(0.0)]), num(0.0));
    }

    #[test]
    fn test_acosh() {
        assert_eq!(FnAcosh.call(&[num(1.0)]), num(0.0));
        assert_eq!(FnAcosh.call(&[num(0.5)]), err(CellError::Num));
    }

    #[test]
    fn test_atanh() {
        assert_eq!(FnAtanh.call(&[num(0.0)]), num(0.0));
        assert_eq!(FnAtanh.call(&[num(1.0)]), err(CellError::Num));
        assert_eq!(FnAtanh.call(&[num(-1.0)]), err(CellError::Num));
    }

    #[test]
    fn test_coth() {
        // COTH(0) = #DIV/0! since sinh(0) = 0
        assert_eq!(FnCoth.call(&[num(0.0)]), err(CellError::Div0));
    }

    #[test]
    fn test_acoth() {
        // ACOTH with |x| <= 1 = #NUM!
        assert_eq!(FnAcoth.call(&[num(0.5)]), err(CellError::Num));
        assert_eq!(FnAcoth.call(&[num(0.0)]), err(CellError::Num));
    }

    #[test]
    fn test_sech_csch() {
        // SECH(0) = 1/cosh(0) = 1
        assert_eq!(FnSech.call(&[num(0.0)]), num(1.0));
        // CSCH(0) = #DIV/0!
        assert_eq!(FnCsch.call(&[num(0.0)]), err(CellError::Div0));
    }

    // --- Tests for rounding functions ---

    #[test]
    fn test_trunc() {
        assert_eq!(FnTrunc.call(&[num(4.7)]), num(4.0));
        assert_eq!(FnTrunc.call(&[num(-4.7)]), num(-4.0));
        assert_eq!(FnTrunc.call(&[num(4.567), num(2.0)]), num(4.56));
    }

    #[test]
    fn test_mround() {
        assert_eq!(FnMround.call(&[num(10.0), num(3.0)]), num(9.0));
        assert_eq!(FnMround.call(&[num(0.0), num(3.0)]), num(0.0));
        // Unlike FLOOR/CEILING, MROUND still requires same signs in all Excel versions
        assert_eq!(FnMround.call(&[num(-5.0), num(3.0)]), err(CellError::Num));
    }

    #[test]
    fn test_even() {
        assert_eq!(FnEven.call(&[num(1.5)]), num(2.0));
        assert_eq!(FnEven.call(&[num(3.0)]), num(4.0));
        assert_eq!(FnEven.call(&[num(2.0)]), num(2.0));
        assert_eq!(FnEven.call(&[num(0.0)]), num(0.0));
        assert_eq!(FnEven.call(&[num(-1.0)]), num(-2.0));
    }

    #[test]
    fn test_odd() {
        assert_eq!(FnOdd.call(&[num(1.5)]), num(3.0));
        assert_eq!(FnOdd.call(&[num(3.0)]), num(3.0));
        assert_eq!(FnOdd.call(&[num(2.0)]), num(3.0));
        assert_eq!(FnOdd.call(&[num(0.0)]), num(1.0));
        assert_eq!(FnOdd.call(&[num(-1.0)]), num(-1.0));
        assert_eq!(FnOdd.call(&[num(-2.0)]), num(-3.0));
    }

    #[test]
    fn test_ceiling_math() {
        assert_eq!(FnCeilingMath.call(&[num(2.1)]), num(3.0));
        assert_eq!(FnCeilingMath.call(&[num(-2.1)]), num(-2.0));
        // With mode=1 for negative numbers, round away from zero
        assert_eq!(
            FnCeilingMath.call(&[num(-2.1), num(1.0), num(1.0)]),
            num(-3.0)
        );
    }

    #[test]
    fn test_ceiling_precise() {
        assert_eq!(FnCeilingPrecise.call(&[num(2.1)]), num(3.0));
        assert_eq!(FnCeilingPrecise.call(&[num(-2.1)]), num(-2.0));
        assert_eq!(FnCeilingPrecise.call(&[num(0.0)]), num(0.0));
    }

    #[test]
    fn test_floor_math() {
        assert_eq!(FnFloorMath.call(&[num(2.9)]), num(2.0));
        assert_eq!(FnFloorMath.call(&[num(-2.1)]), num(-3.0));
        // With mode=1 for negative numbers, round toward zero
        assert_eq!(
            FnFloorMath.call(&[num(-2.9), num(1.0), num(1.0)]),
            num(-2.0)
        );
    }

    #[test]
    fn test_floor_precise() {
        assert_eq!(FnFloorPrecise.call(&[num(2.9)]), num(2.0));
        assert_eq!(FnFloorPrecise.call(&[num(-2.1)]), num(-3.0));
    }

    // --- Tests for combinatorics ---

    #[test]
    fn test_fact() {
        assert_eq!(FnFact.call(&[num(0.0)]), num(1.0));
        assert_eq!(FnFact.call(&[num(1.0)]), num(1.0));
        assert_eq!(FnFact.call(&[num(5.0)]), num(120.0));
        assert_eq!(FnFact.call(&[num(10.0)]), num(3628800.0));
        assert_eq!(FnFact.call(&[num(-1.0)]), err(CellError::Num));
    }

    #[test]
    fn test_factdouble() {
        assert_eq!(FnFactDouble.call(&[num(0.0)]), num(1.0));
        assert_eq!(FnFactDouble.call(&[num(1.0)]), num(1.0));
        assert_eq!(FnFactDouble.call(&[num(5.0)]), num(15.0)); // 5*3*1
        assert_eq!(FnFactDouble.call(&[num(6.0)]), num(48.0)); // 6*4*2
    }

    #[test]
    fn test_combin() {
        assert_eq!(FnCombin.call(&[num(5.0), num(2.0)]), num(10.0));
        assert_eq!(FnCombin.call(&[num(10.0), num(3.0)]), num(120.0));
        assert_eq!(FnCombin.call(&[num(5.0), num(0.0)]), num(1.0));
        assert_eq!(FnCombin.call(&[num(5.0), num(5.0)]), num(1.0));
        assert_eq!(FnCombin.call(&[num(3.0), num(5.0)]), err(CellError::Num));
    }

    #[test]
    fn test_combina() {
        // COMBINA(4, 3) = COMBIN(6, 3) = 20
        assert_eq!(FnCombinA.call(&[num(4.0), num(3.0)]), num(20.0));
    }

    #[test]
    fn test_permut() {
        // PERMUT(5, 2) = 5*4 = 20
        assert_eq!(FnPermut.call(&[num(5.0), num(2.0)]), num(20.0));
        assert_eq!(FnPermut.call(&[num(5.0), num(0.0)]), num(1.0));
    }

    #[test]
    fn test_permutationa() {
        // PERMUTATIONA(3, 2) = 3^2 = 9
        assert_eq!(FnPermutationA.call(&[num(3.0), num(2.0)]), num(9.0));
    }

    #[test]
    fn test_gcd() {
        assert_eq!(FnGcd.call(&[num(12.0), num(8.0)]), num(4.0));
        assert_eq!(FnGcd.call(&[num(7.0), num(5.0)]), num(1.0));
        assert_eq!(FnGcd.call(&[num(24.0), num(36.0), num(48.0)]), num(12.0));
    }

    #[test]
    fn test_lcm() {
        assert_eq!(FnLcm.call(&[num(4.0), num(6.0)]), num(12.0));
        assert_eq!(FnLcm.call(&[num(3.0), num(5.0)]), num(15.0));
        assert_eq!(FnLcm.call(&[num(0.0), num(5.0)]), num(0.0));
    }

    #[test]
    fn test_multinomial() {
        // MULTINOMIAL(2, 3, 4) = 9!/(2!*3!*4!) = 362880/(2*6*24) = 1260
        assert_eq!(
            FnMultinomial.call(&[num(2.0), num(3.0), num(4.0)]),
            num(1260.0)
        );
    }

    // --- Tests for additional math ---

    #[test]
    fn test_quotient() {
        assert_eq!(FnQuotient.call(&[num(7.0), num(3.0)]), num(2.0));
        assert_eq!(FnQuotient.call(&[num(-7.0), num(3.0)]), num(-2.0));
        assert_eq!(FnQuotient.call(&[num(7.0), num(0.0)]), err(CellError::Div0));
    }

    #[test]
    fn test_sqrtpi() {
        // SQRTPI(1) = sqrt(PI)
        if let CellValue::Number(n) = FnSqrtPi.call(&[num(1.0)]) {
            assert!((n.get() - std::f64::consts::PI.sqrt()).abs() < 1e-10);
        } else {
            panic!("Expected number");
        }
        assert_eq!(FnSqrtPi.call(&[num(-1.0)]), err(CellError::Num));
    }

    #[test]
    fn test_countblank() {
        let arr = CellValue::from_rows(vec![vec![num(1.0), null(), text(""), num(3.0), null()]]);
        assert_eq!(FnCountBlank.call(&[arr]), num(3.0));
    }

    #[test]
    fn test_sumsq() {
        // 1^2 + 2^2 + 3^2 = 1 + 4 + 9 = 14
        assert_eq!(FnSumsq.call(&[num(1.0), num(2.0), num(3.0)]), num(14.0));
    }

    #[test]
    fn test_sumx2my2() {
        let xs = CellValue::from_rows(vec![vec![num(1.0), num(2.0), num(3.0)]]);
        let ys = CellValue::from_rows(vec![vec![num(4.0), num(5.0), num(6.0)]]);
        // (1-16) + (4-25) + (9-36) = -15 + -21 + -27 = -63
        assert_eq!(FnSumx2my2.call(&[xs, ys]), num(-63.0));
    }

    #[test]
    fn test_sumx2py2() {
        let xs = CellValue::from_rows(vec![vec![num(1.0), num(2.0)]]);
        let ys = CellValue::from_rows(vec![vec![num(3.0), num(4.0)]]);
        // (1+9) + (4+16) = 10 + 20 = 30
        assert_eq!(FnSumx2py2.call(&[xs, ys]), num(30.0));
    }

    #[test]
    fn test_sumxmy2() {
        let xs = CellValue::from_rows(vec![vec![num(1.0), num(2.0)]]);
        let ys = CellValue::from_rows(vec![vec![num(3.0), num(4.0)]]);
        // (1-3)^2 + (2-4)^2 = 4 + 4 = 8
        assert_eq!(FnSumxmy2.call(&[xs, ys]), num(8.0));
    }

    // --- Tests for conversion functions ---

    #[test]
    fn test_base() {
        assert_eq!(
            FnBase.call(&[num(15.0), num(16.0)]),
            CellValue::Text("F".into())
        );
        assert_eq!(
            FnBase.call(&[num(10.0), num(2.0)]),
            CellValue::Text("1010".into())
        );
        assert_eq!(
            FnBase.call(&[num(10.0), num(2.0), num(8.0)]),
            CellValue::Text("00001010".into())
        );
    }

    #[test]
    fn test_decimal() {
        assert_eq!(FnDecimal.call(&[text("FF"), num(16.0)]), num(255.0));
        assert_eq!(FnDecimal.call(&[text("1010"), num(2.0)]), num(10.0));
    }

    #[test]
    fn test_roman() {
        assert_eq!(
            FnRoman.call(&[num(499.0)]),
            CellValue::Text("CDXCIX".into())
        );
        assert_eq!(
            FnRoman.call(&[num(2024.0)]),
            CellValue::Text("MMXXIV".into())
        );
        assert_eq!(FnRoman.call(&[num(0.0)]), err(CellError::Value));
        assert_eq!(FnRoman.call(&[num(4000.0)]), err(CellError::Value));
    }

    #[test]
    fn test_arabic() {
        assert_eq!(FnArabic.call(&[text("XIV")]), num(14.0));
        assert_eq!(FnArabic.call(&[text("MCMXCIX")]), num(1999.0));
        assert_eq!(FnArabic.call(&[text("")]), num(0.0));
    }

    #[test]
    fn test_seriessum() {
        let coeffs = CellValue::from_rows(vec![vec![num(1.0), num(1.0), num(1.0)]]);
        // 1*2^0 + 1*2^1 + 1*2^2 = 1 + 2 + 4 = 7
        assert_eq!(
            FnSeriesSum.call(&[num(2.0), num(0.0), num(1.0), coeffs]),
            num(7.0)
        );
    }

    // --- Tests for matrix functions ---

    #[test]
    fn test_mdeterm() {
        let m = CellValue::from_rows(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]);
        // det = 1*4 - 2*3 = -2
        assert_eq!(FnMdeterm.call(&[m]), num(-2.0));
    }

    #[test]
    fn test_munit() {
        if let CellValue::Array(arr) = FnMunit.call(&[num(2.0)]) {
            assert_eq!(arr.rows(), 2);
            assert_eq!(*arr.get(0, 0).unwrap(), num(1.0));
            assert_eq!(*arr.get(0, 1).unwrap(), num(0.0));
            assert_eq!(*arr.get(1, 0).unwrap(), num(0.0));
            assert_eq!(*arr.get(1, 1).unwrap(), num(1.0));
        } else {
            panic!("Expected array");
        }
    }

    // --- Edge case tests for bug fixes ---

    #[test]
    fn test_sinh_overflow_returns_num_error() {
        // SINH(800) overflows f64 -> should return #NUM! not Infinity
        assert_eq!(FnSinh.call(&[num(800.0)]), err(CellError::Num));
    }

    #[test]
    fn test_cosh_overflow_returns_num_error() {
        // COSH(800) overflows f64 -> should return #NUM! not Infinity
        assert_eq!(FnCosh.call(&[num(800.0)]), err(CellError::Num));
    }

    #[test]
    fn test_power_zero_negative_returns_div0() {
        // POWER(0, -1) -> #DIV/0! per Excel semantics (equivalent to 1/0)
        assert_eq!(FnPower.call(&[num(0.0), num(-1.0)]), err(CellError::Div0));
    }

    #[test]
    fn test_power_zero_zero_returns_num_error() {
        // POWER(0, 0) = #NUM! per Excel 365
        assert_eq!(FnPower.call(&[num(0.0), num(0.0)]), err(CellError::Num));
    }

    #[test]
    fn test_log_base_one_returns_div0() {
        // LOG(10, 1) divides by ln(1)=0 -> #DIV/0!
        assert_eq!(FnLog.call(&[num(10.0), num(1.0)]), err(CellError::Div0));
    }

    #[test]
    fn test_roundup_single_arg_defaults_digits_zero() {
        // ROUNDUP(2.5) with 1 arg should default digits to 0 -> 3
        assert_eq!(FnRoundUp.call(&[num(2.5)]), num(3.0));
    }

    #[test]
    fn test_rounddown_single_arg_defaults_digits_zero() {
        // ROUNDDOWN(2.5) with 1 arg should default digits to 0 -> 2
        assert_eq!(FnRoundDown.call(&[num(2.5)]), num(2.0));
    }

    // ---- FIX 1: AGGREGATE error filtering for MAX/MIN/PRODUCT ----

    // ---- FIX 2: CEILING.MATH and FLOOR.MATH with significance=0 ----

    #[test]
    fn test_ceiling_math_significance_zero() {
        // Excel 365: CEILING.MATH(5, 0) = 0
        assert_eq!(FnCeilingMath.call(&[num(5.0), num(0.0)]), num(0.0));
        assert_eq!(FnCeilingMath.call(&[num(-3.7), num(0.0)]), num(0.0));
    }

    #[test]
    fn test_floor_math_significance_zero() {
        // Excel 365: FLOOR.MATH(5, 0) = 0
        assert_eq!(FnFloorMath.call(&[num(5.0), num(0.0)]), num(0.0));
        assert_eq!(FnFloorMath.call(&[num(-3.7), num(0.0)]), num(0.0));
    }

    #[test]
    fn test_ceiling_significance_zero() {
        // Excel 365: CEILING(5, 0) = 0
        assert_eq!(FnCeiling.call(&[num(5.0), num(0.0)]), num(0.0));
    }

    #[test]
    fn test_floor_significance_zero() {
        // Excel 365: FLOOR(5, 0) = #DIV/0!
        assert_eq!(FnFloor.call(&[num(5.0), num(0.0)]), err(CellError::Div0));
    }

    // ---- FIX 3: FACTDOUBLE(-1) = 1 ----

    #[test]
    fn test_factdouble_negative_one() {
        // (-1)!! = 1 by convention (base case of double factorial)
        assert_eq!(FnFactDouble.call(&[num(-1.0)]), num(1.0));
    }

    #[test]
    fn test_factdouble_negative_two_is_error() {
        // FACTDOUBLE(-2) should be #NUM!
        assert_eq!(FnFactDouble.call(&[num(-2.0)]), err(CellError::Num));
    }

    // ---- FIX 4: ROMAN form parameter ----

    #[test]
    fn test_roman_form_0_classic() {
        assert_eq!(
            FnRoman.call(&[num(499.0), num(0.0)]),
            CellValue::Text("CDXCIX".into())
        );
        assert_eq!(
            FnRoman.call(&[num(999.0), num(0.0)]),
            CellValue::Text("CMXCIX".into())
        );
    }

    #[test]
    fn test_roman_form_1() {
        // ROMAN(499, 1) = "LDVLIV"  (LD=450, VL=45, IV=4)
        assert_eq!(
            FnRoman.call(&[num(499.0), num(1.0)]),
            CellValue::Text("LDVLIV".into())
        );
        // ROMAN(999, 1) = "LMVLIV"  (LM=950, VL=45, IV=4)
        assert_eq!(
            FnRoman.call(&[num(999.0), num(1.0)]),
            CellValue::Text("LMVLIV".into())
        );
    }

    #[test]
    fn test_roman_form_2() {
        // ROMAN(499, 2) = "XDIX"  (XD=490, IX=9)
        assert_eq!(
            FnRoman.call(&[num(499.0), num(2.0)]),
            CellValue::Text("XDIX".into())
        );
        // ROMAN(999, 2) = "XMIX"  (XM=990, IX=9)
        assert_eq!(
            FnRoman.call(&[num(999.0), num(2.0)]),
            CellValue::Text("XMIX".into())
        );
    }

    #[test]
    fn test_roman_form_3() {
        // ROMAN(499, 3) = "VDIV"  (VD=495, IV=4)
        assert_eq!(
            FnRoman.call(&[num(499.0), num(3.0)]),
            CellValue::Text("VDIV".into())
        );
        // ROMAN(999, 3) = "VMIV"  (VM=995, IV=4)
        assert_eq!(
            FnRoman.call(&[num(999.0), num(3.0)]),
            CellValue::Text("VMIV".into())
        );
    }

    #[test]
    fn test_roman_form_4_simplified() {
        // ROMAN(499, 4) = "ID"
        assert_eq!(
            FnRoman.call(&[num(499.0), num(4.0)]),
            CellValue::Text("ID".into())
        );
        // ROMAN(999, 4) = "IM"
        assert_eq!(
            FnRoman.call(&[num(999.0), num(4.0)]),
            CellValue::Text("IM".into())
        );
    }

    #[test]
    fn test_roman_form_default_is_classic() {
        // Without form parameter, should use form 0 (classic)
        assert_eq!(
            FnRoman.call(&[num(499.0)]),
            CellValue::Text("CDXCIX".into())
        );
    }

    #[test]
    fn test_roman_form_invalid() {
        assert_eq!(FnRoman.call(&[num(100.0), num(5.0)]), err(CellError::Value));
        assert_eq!(
            FnRoman.call(&[num(100.0), num(-1.0)]),
            err(CellError::Value)
        );
    }

    // -----------------------------------------------------------------------
    // Edge-case tests for extreme float values (Issue fixes)
    // -----------------------------------------------------------------------

    #[test]
    fn test_mod_precision_limit_num_error() {
        // MOD(1, 1E-307): quotient = 1E+307 > 2^53 => #NUM!

        assert_eq!(FnMod.call(&[num(1.0), num(1e-307)]), err(CellError::Num));
        // MOD(42.5, 1E-307): quotient = 4.25E+308 > 2^53 => #NUM!
        assert_eq!(FnMod.call(&[num(42.5), num(1e-307)]), err(CellError::Num));
        // MOD(-1, 1E-307): quotient = -1E+307 > 2^53 => #NUM!
        assert_eq!(FnMod.call(&[num(-1.0), num(1e-307)]), err(CellError::Num));
    }

    #[test]
    fn test_mod_normal_cases_unaffected() {
        // Normal MOD cases should still work correctly
        assert_eq!(FnMod.call(&[num(7.0), num(3.0)]), num(1.0));
        assert_eq!(FnMod.call(&[num(10.0), num(3.0)]), num(1.0));
        // MOD with zero divisor
        assert_eq!(FnMod.call(&[num(1.0), num(0.0)]), err(CellError::Div0));
    }

    #[test]
    fn test_power_tiny_base_negative_exp_div0() {
        // POWER(1E-307, -42.5): result overflows to inf -> Excel returns #DIV/0!
        // (conceptually 1/0 since small_base^negative_exp = 1/(small_base^pos_exp) -> inf)

        assert_eq!(
            FnPower.call(&[num(1e-307), num(-42.5)]),
            err(CellError::Div0)
        );
        assert_eq!(
            FnPower.call(&[num(1e-200), num(-1000.0)]),
            err(CellError::Div0)
        );
    }

    #[test]
    fn test_power_normal_cases_unaffected() {
        // Normal POWER cases should still work
        assert_eq!(FnPower.call(&[num(2.0), num(10.0)]), num(1024.0));
        assert_eq!(FnPower.call(&[num(0.0), num(0.0)]), err(CellError::Num)); // 0^0 = #NUM!
        assert_eq!(FnPower.call(&[num(0.0), num(5.0)]), num(0.0)); // 0^5 = 0
        assert_eq!(FnPower.call(&[num(0.0), num(-1.0)]), err(CellError::Div0)); // 0^(-1) = #DIV/0!
    }

    // ---- POWER edge cases: huge exponents and tiny bases ----

    #[test]
    fn test_power_huge_exponent_returns_num() {
        // When |exp| >= 1e308, Excel returns #NUM! (except base=1)
        assert_eq!(FnPower.call(&[num(-1.0), num(1e308)]), err(CellError::Num));
        assert_eq!(FnPower.call(&[num(-1.0), num(-1e308)]), err(CellError::Num));
        assert_eq!(
            FnPower.call(&[num(-42.5), num(-1e308)]),
            err(CellError::Num)
        );
        assert_eq!(
            FnPower.call(&[num(1e-307), num(1e308)]),
            err(CellError::Num)
        );
        assert_eq!(
            FnPower.call(&[num(-1e-307), num(1e308)]),
            err(CellError::Num)
        );
        assert_eq!(
            FnPower.call(&[num(-1e-307), num(-1e308)]),
            err(CellError::Num)
        );
        assert_eq!(
            FnPower.call(&[num(-1e308), num(-1e308)]),
            err(CellError::Num)
        );
    }

    #[test]
    fn test_power_huge_exp_base_1_returns_one() {
        // base=1 always returns 1 regardless of exponent
        assert_eq!(FnPower.call(&[num(1.0), num(1e308)]), num(1.0));
        assert_eq!(FnPower.call(&[num(1.0), num(-1e308)]), num(1.0));
    }

    #[test]
    fn test_power_positive_base_huge_negative_exp_returns_zero() {
        // Any positive base with huge negative exp underflows to 0 in Excel
        // (base=1 handled separately as 1^anything = 1)
        assert_eq!(FnPower.call(&[num(1e-307), num(-1e308)]), num(0.0)); // small base, |exp| >= 1e308
        assert_eq!(FnPower.call(&[num(42.5), num(-9.99e307)]), num(0.0)); // base>1, |exp| > 2^53
        assert_eq!(FnPower.call(&[num(0.5), num(-1e308)]), num(0.0)); // base<1, |exp| >= 1e308
        assert_eq!(FnPower.call(&[num(1e308), num(-1e308)]), num(0.0)); // huge base, |exp| >= 1e308
    }

    #[test]
    fn test_power_negative_base_non_integer_exp_returns_num() {
        // Negative base with non-integer exponent -> #NUM! (complex result)
        assert_eq!(
            FnPower.call(&[num(-1e-307), num(-42.5)]),
            err(CellError::Num)
        );
        assert_eq!(
            FnPower.call(&[num(-1e-307), num(-1e-307)]),
            err(CellError::Num)
        );
    }

    #[test]
    fn test_ceiling_math_tiny_number() {
        // Subnormal ratio → treat as zero
        assert_eq!(FnCeilingMath.call(&[num(5e-324), num(10.0)]), num(0.0));
        // Normal small number → rounds normally
        assert_eq!(FnCeilingMath.call(&[num(1e-307), num(1.0)]), num(1.0));
        // Overflow ratio → #NUM!
        assert_eq!(
            FnCeilingMath.call(&[num(1e308), num(0.01)]),
            err(CellError::Num)
        );
    }

    #[test]
    fn test_ceiling_math_normal_cases_unaffected() {
        assert_eq!(FnCeilingMath.call(&[num(6.3), num(3.0)]), num(9.0));
        assert_eq!(FnCeilingMath.call(&[num(-6.3), num(3.0)]), num(-6.0));
    }

    #[test]
    fn test_floor_math_tiny_number() {
        // Subnormal ratio → treat as zero
        assert_eq!(FnFloorMath.call(&[num(-5e-324), num(10.0)]), num(0.0));
        // Normal small number → rounds normally
        assert_eq!(FnFloorMath.call(&[num(-1e-307), num(1.0)]), num(-1.0));
        // Overflow ratio → #NUM!
        assert_eq!(
            FnFloorMath.call(&[num(1e308), num(0.01)]),
            err(CellError::Num)
        );
    }

    #[test]
    fn test_floor_math_normal_cases_unaffected() {
        assert_eq!(FnFloorMath.call(&[num(6.3), num(3.0)]), num(6.0));
        assert_eq!(FnFloorMath.call(&[num(-6.3), num(3.0)]), num(-9.0));
    }

    #[test]
    fn test_round_near_max_float() {
        // ROUND(9.999E+307, 2): should return the number as-is since scaling
        // by 10^2 would not overflow (9.999E+307 * 100 = 9.999E+309 = inf).
        // The overflow guard should kick in and return n unchanged.

        let big = 9.999e307;
        let result = FnRound.call(&[num(big), num(2.0)]);
        assert_eq!(result, num(big));
    }

    #[test]
    fn test_round_15_digit_snap_fixes_ulp_boundary() {
        // 50 * 0.57 = 28.499999999999996 in IEEE 754 (1 ULP below 28.5).
        // Excel sees this as 28.5 (15 sig digits) and rounds to 29.
        let product = 50.0_f64 * 0.57;
        assert_eq!(FnRound.call(&[num(product), num(0.0)]), num(29.0));

        // 710 * 0.35 = 248.49999999999997 in IEEE 754 (1 ULP below 248.5).
        let product2 = 710.0_f64 * 0.35;
        assert_eq!(FnRound.call(&[num(product2), num(0.0)]), num(249.0));

        // 1.005 rounded to 2 digits: 1.005 * 100 = 100.49999999999999.
        // Excel rounds to 1.01.
        assert_eq!(FnRound.call(&[num(1.005), num(2.0)]), num(1.01));
    }

    #[test]
    fn test_round_15_digit_snap_no_false_positives() {
        // Values genuinely below .5 must still round down.
        assert_eq!(FnRound.call(&[num(28.4), num(0.0)]), num(28.0));
        assert_eq!(FnRound.call(&[num(28.49), num(0.0)]), num(28.0));
        assert_eq!(FnRound.call(&[num(-28.5), num(0.0)]), num(-29.0));

        // Exact .5 still rounds up (away from zero).
        assert_eq!(FnRound.call(&[num(2.5), num(0.0)]), num(3.0));
        assert_eq!(FnRound.call(&[num(-2.5), num(0.0)]), num(-3.0));
    }

    // =====================================================================
    // First-principles rounding tests
    // =====================================================================

    fn reg() -> crate::FunctionRegistry {
        crate::FunctionRegistry::new()
    }

    fn assert_is_err(actual: CellValue, expected: CellError) {
        match actual {
            CellValue::Error(e, _) => assert_eq!(e, expected, "wrong error variant"),
            other => panic!("expected Error({expected:?}), got {other:?}"),
        }
    }

    // -- ROUND: round half away from zero (Excel semantics) ---------------

    #[test]
    fn test_round_half_away_from_zero_positive() {
        let r = reg();
        // ROUND(2.5, 0) = 3
        assert_eq!(r.call("ROUND", &[num(2.5), num(0.0)]), num(3.0));
        // ROUND(3.5, 0) = 4
        assert_eq!(r.call("ROUND", &[num(3.5), num(0.0)]), num(4.0));
    }

    #[test]
    fn test_round_half_away_from_zero_negative() {
        let r = reg();
        // ROUND(-2.5, 0) = -3 (away from zero, not toward -inf)
        assert_eq!(r.call("ROUND", &[num(-2.5), num(0.0)]), num(-3.0));
        // ROUND(-3.5, 0) = -4
        assert_eq!(r.call("ROUND", &[num(-3.5), num(0.0)]), num(-4.0));
    }

    #[test]
    fn test_round_decimal_digits() {
        let r = reg();
        // ROUND(1.234, 2) = 1.23
        assert_eq!(r.call("ROUND", &[num(1.234), num(2.0)]), num(1.23));
        // ROUND(1.235, 2) = 1.24
        assert_eq!(r.call("ROUND", &[num(1.235), num(2.0)]), num(1.24));
    }

    #[test]
    fn test_round_negative_num_digits() {
        let r = reg();
        // ROUND(1234, -2) = 1200
        assert_eq!(r.call("ROUND", &[num(1234.0), num(-2.0)]), num(1200.0));
        // ROUND(1250, -2) = 1300
        assert_eq!(r.call("ROUND", &[num(1250.0), num(-2.0)]), num(1300.0));
    }

    #[test]
    fn test_round_single_arg_defaults_to_zero_digits() {
        let r = reg();
        assert_eq!(r.call("ROUND", &[num(2.7)]), num(3.0));
    }

    // -- ROUNDUP: always away from zero -----------------------------------

    #[test]
    fn test_roundup_positive() {
        let r = reg();
        assert_eq!(r.call("ROUNDUP", &[num(1.1), num(0.0)]), num(2.0));
        assert_eq!(r.call("ROUNDUP", &[num(1.0), num(0.0)]), num(1.0));
    }

    #[test]
    fn test_roundup_negative() {
        let r = reg();
        // ROUNDUP(-1.1, 0) = -2 (away from zero)
        assert_eq!(r.call("ROUNDUP", &[num(-1.1), num(0.0)]), num(-2.0));
    }

    #[test]
    fn test_roundup_with_digits() {
        let r = reg();
        assert_eq!(r.call("ROUNDUP", &[num(1.234), num(2.0)]), num(1.24));
        assert_eq!(r.call("ROUNDUP", &[num(-1.234), num(2.0)]), num(-1.24));
    }

    // -- ROUNDDOWN: always toward zero ------------------------------------

    #[test]
    fn test_rounddown_positive() {
        let r = reg();
        assert_eq!(r.call("ROUNDDOWN", &[num(1.9), num(0.0)]), num(1.0));
    }

    #[test]
    fn test_rounddown_negative() {
        let r = reg();
        // ROUNDDOWN(-1.9, 0) = -1 (toward zero)
        assert_eq!(r.call("ROUNDDOWN", &[num(-1.9), num(0.0)]), num(-1.0));
    }

    #[test]
    fn test_rounddown_with_digits() {
        let r = reg();
        assert_eq!(r.call("ROUNDDOWN", &[num(1.999), num(2.0)]), num(1.99));
        assert_eq!(r.call("ROUNDDOWN", &[num(-1.999), num(2.0)]), num(-1.99));
    }

    // -- TRUNC: truncate toward zero --------------------------------------

    #[test]
    fn test_trunc_no_digits() {
        let r = reg();
        assert_eq!(r.call("TRUNC", &[num(1.9)]), num(1.0));
        assert_eq!(r.call("TRUNC", &[num(-1.9)]), num(-1.0));
    }

    #[test]
    fn test_trunc_with_digits() {
        let r = reg();
        assert_eq!(r.call("TRUNC", &[num(1.234), num(2.0)]), num(1.23));
        assert_eq!(r.call("TRUNC", &[num(-1.236), num(2.0)]), num(-1.23));
    }

    // -- INT: floor toward negative infinity ------------------------------

    #[test]
    fn test_int_positive() {
        let r = reg();
        assert_eq!(r.call("INT", &[num(1.9)]), num(1.0));
    }

    #[test]
    fn test_int_negative_differs_from_trunc() {
        let r = reg();
        // INT(-1.9) = -2 (floor), TRUNC(-1.9) = -1 (toward zero)
        assert_eq!(r.call("INT", &[num(-1.9)]), num(-2.0));
        assert_eq!(r.call("TRUNC", &[num(-1.9)]), num(-1.0));
    }

    #[test]
    fn test_int_already_integer() {
        let r = reg();
        assert_eq!(r.call("INT", &[num(5.0)]), num(5.0));
        assert_eq!(r.call("INT", &[num(-5.0)]), num(-5.0));
    }

    // -- CEILING ----------------------------------------------------------

    #[test]
    fn test_ceiling_basic() {
        let r = reg();
        assert_eq!(r.call("CEILING", &[num(2.5), num(1.0)]), num(3.0));
        assert_eq!(r.call("CEILING", &[num(2.1), num(0.5)]), num(2.5));
    }

    #[test]
    fn test_ceiling_negative_number_negative_sig() {
        let r = reg();
        // CEILING(-2.5, -1) = -3
        assert_eq!(r.call("CEILING", &[num(-2.5), num(-1.0)]), num(-3.0));
    }

    #[test]
    fn test_ceiling_positive_num_negative_sig_error() {
        let r = reg();
        // CEILING(2.5, -1) -> #NUM!
        assert_is_err(r.call("CEILING", &[num(2.5), num(-1.0)]), CellError::Num);
    }

    #[test]
    fn test_ceiling_zero_significance() {
        let r = reg();
        assert_eq!(r.call("CEILING", &[num(5.0), num(0.0)]), num(0.0));
    }

    // -- CEILING.MATH -----------------------------------------------------

    #[test]
    fn test_ceiling_math_positive() {
        let r = reg();
        // CEILING.MATH(6.3, 5) = 10
        assert_eq!(r.call("CEILING.MATH", &[num(6.3), num(5.0)]), num(10.0));
    }

    #[test]
    fn test_ceiling_math_negative_default_toward_zero() {
        let r = reg();
        // CEILING.MATH(-6.3, 5) = -5 (toward zero by default, mode=0)
        assert_eq!(r.call("CEILING.MATH", &[num(-6.3), num(5.0)]), num(-5.0));
    }

    #[test]
    fn test_ceiling_math_negative_mode1_away_from_zero() {
        let r = reg();
        // CEILING.MATH(-6.3, 5, 1) = -10 (mode=1 rounds away from zero)
        assert_eq!(
            r.call("CEILING.MATH", &[num(-6.3), num(5.0), num(1.0)]),
            num(-10.0)
        );
    }

    #[test]
    fn test_ceiling_math_single_arg() {
        let r = reg();
        // Defaults: significance=1, mode=0
        assert_eq!(r.call("CEILING.MATH", &[num(2.3)]), num(3.0));
        assert_eq!(r.call("CEILING.MATH", &[num(-2.3)]), num(-2.0));
    }

    #[test]
    fn test_ceiling_math_zero_significance_returns_zero() {
        let r = reg();
        assert_eq!(r.call("CEILING.MATH", &[num(5.0), num(0.0)]), num(0.0));
    }

    // -- CEILING.PRECISE --------------------------------------------------

    #[test]
    fn test_ceiling_precise_positive() {
        let r = reg();
        // CEILING.PRECISE(4.3, 2) = 6
        assert_eq!(r.call("CEILING.PRECISE", &[num(4.3), num(2.0)]), num(6.0));
    }

    #[test]
    fn test_ceiling_precise_negative_always_toward_pos_inf() {
        let r = reg();
        // CEILING.PRECISE(-4.3, 2) = -4 (always toward +infinity)
        assert_eq!(r.call("CEILING.PRECISE", &[num(-4.3), num(2.0)]), num(-4.0));
    }

    #[test]
    fn test_ceiling_precise_negative_significance_ignored() {
        let r = reg();
        // Sign of significance is ignored in CEILING.PRECISE
        assert_eq!(r.call("CEILING.PRECISE", &[num(4.3), num(-2.0)]), num(6.0));
    }

    // -- ISO.CEILING = CEILING.PRECISE ------------------------------------

    #[test]
    fn test_iso_ceiling_same_as_ceiling_precise() {
        let r = reg();
        assert_eq!(r.call("ISO.CEILING", &[num(4.3), num(2.0)]), num(6.0));
        assert_eq!(r.call("ISO.CEILING", &[num(-4.3), num(2.0)]), num(-4.0));
    }

    // -- FLOOR ------------------------------------------------------------

    #[test]
    fn test_floor_basic() {
        let r = reg();
        assert_eq!(r.call("FLOOR", &[num(2.5), num(1.0)]), num(2.0));
        assert_eq!(r.call("FLOOR", &[num(2.7), num(0.5)]), num(2.5));
    }

    #[test]
    fn test_floor_negative_number_negative_sig() {
        let r = reg();
        // FLOOR(-2.5, -1) = -2
        assert_eq!(r.call("FLOOR", &[num(-2.5), num(-1.0)]), num(-2.0));
    }

    #[test]
    fn test_floor_positive_num_negative_sig_error() {
        let r = reg();
        // FLOOR(2.5, -1) -> #NUM!
        assert_is_err(r.call("FLOOR", &[num(2.5), num(-1.0)]), CellError::Num);
    }

    #[test]
    fn test_floor_zero_significance_div0() {
        let r = reg();
        assert_is_err(r.call("FLOOR", &[num(5.0), num(0.0)]), CellError::Div0);
    }

    // -- FLOOR.MATH -------------------------------------------------------

    #[test]
    fn test_floor_math_positive() {
        let r = reg();
        // FLOOR.MATH(6.7, 5) = 5
        assert_eq!(r.call("FLOOR.MATH", &[num(6.7), num(5.0)]), num(5.0));
    }

    #[test]
    fn test_floor_math_negative_default_away_from_zero() {
        let r = reg();
        // FLOOR.MATH(-6.7, 5) = -10 (away from zero by default, mode=0)
        assert_eq!(r.call("FLOOR.MATH", &[num(-6.7), num(5.0)]), num(-10.0));
    }

    #[test]
    fn test_floor_math_negative_mode1_toward_zero() {
        let r = reg();
        // FLOOR.MATH(-6.7, 5, 1) = -5 (mode=1 rounds toward zero)
        assert_eq!(
            r.call("FLOOR.MATH", &[num(-6.7), num(5.0), num(1.0)]),
            num(-5.0)
        );
    }

    #[test]
    fn test_floor_math_single_arg() {
        let r = reg();
        assert_eq!(r.call("FLOOR.MATH", &[num(6.7)]), num(6.0));
        assert_eq!(r.call("FLOOR.MATH", &[num(-6.7)]), num(-7.0));
    }

    #[test]
    fn test_floor_math_zero_significance_returns_zero() {
        let r = reg();
        assert_eq!(r.call("FLOOR.MATH", &[num(5.0), num(0.0)]), num(0.0));
    }

    // -- FLOOR.PRECISE ----------------------------------------------------

    #[test]
    fn test_floor_precise_positive() {
        let r = reg();
        // FLOOR.PRECISE(4.7, 2) = 4
        assert_eq!(r.call("FLOOR.PRECISE", &[num(4.7), num(2.0)]), num(4.0));
    }

    #[test]
    fn test_floor_precise_negative_always_toward_neg_inf() {
        let r = reg();
        // FLOOR.PRECISE(-4.7, 2) = -6 (always toward -infinity)
        assert_eq!(r.call("FLOOR.PRECISE", &[num(-4.7), num(2.0)]), num(-6.0));
    }

    #[test]
    fn test_floor_precise_negative_significance_ignored() {
        let r = reg();
        assert_eq!(r.call("FLOOR.PRECISE", &[num(4.7), num(-2.0)]), num(4.0));
    }

    // -- MROUND -----------------------------------------------------------

    #[test]
    fn test_mround_basic() {
        let r = reg();
        // MROUND(10, 3) = 9
        assert_eq!(r.call("MROUND", &[num(10.0), num(3.0)]), num(9.0));
        // MROUND(7.5, 3) = 9
        assert_eq!(r.call("MROUND", &[num(7.5), num(3.0)]), num(9.0));
    }

    #[test]
    fn test_mround_negative() {
        let r = reg();
        // MROUND(-10, -3) = -9
        assert_eq!(r.call("MROUND", &[num(-10.0), num(-3.0)]), num(-9.0));
    }

    #[test]
    fn test_mround_mixed_signs_error() {
        let r = reg();
        assert_is_err(r.call("MROUND", &[num(10.0), num(-3.0)]), CellError::Num);
        assert_is_err(r.call("MROUND", &[num(-10.0), num(3.0)]), CellError::Num);
    }

    #[test]
    fn test_mround_zero_multiple() {
        let r = reg();
        assert_eq!(r.call("MROUND", &[num(10.0), num(0.0)]), num(0.0));
    }

    // -- EVEN -------------------------------------------------------------

    #[test]
    fn test_even_first_principles() {
        let r = reg();
        assert_eq!(r.call("EVEN", &[num(1.5)]), num(2.0));
        assert_eq!(r.call("EVEN", &[num(3.0)]), num(4.0));
        assert_eq!(r.call("EVEN", &[num(2.0)]), num(2.0));
        assert_eq!(r.call("EVEN", &[num(0.0)]), num(0.0));
    }

    #[test]
    fn test_even_negative_away_from_zero() {
        let r = reg();
        // EVEN(-1) = -2 (away from zero)
        assert_eq!(r.call("EVEN", &[num(-1.0)]), num(-2.0));
        assert_eq!(r.call("EVEN", &[num(-3.0)]), num(-4.0));
    }

    // -- ODD --------------------------------------------------------------

    #[test]
    fn test_odd_first_principles() {
        let r = reg();
        assert_eq!(r.call("ODD", &[num(1.5)]), num(3.0));
        assert_eq!(r.call("ODD", &[num(2.0)]), num(3.0));
        assert_eq!(r.call("ODD", &[num(3.0)]), num(3.0));
    }

    #[test]
    fn test_odd_negative_away_from_zero() {
        let r = reg();
        // ODD(-1) = -1 (already odd, away from zero)
        assert_eq!(r.call("ODD", &[num(-1.0)]), num(-1.0));
        assert_eq!(r.call("ODD", &[num(-2.0)]), num(-3.0));
    }

    #[test]
    fn test_odd_of_zero() {
        let r = reg();
        // ODD(0) = 1
        assert_eq!(r.call("ODD", &[num(0.0)]), num(1.0));
    }

    // =====================================================================
    // First-principles trigonometric tests
    // =====================================================================

    const TOL: f64 = 1e-10;
    use std::f64::consts::{FRAC_PI_2, FRAC_PI_4, PI};

    fn assert_close(actual: CellValue, expected: f64) {
        match actual {
            CellValue::Number(n) => {
                let v = f64::from(n);
                assert!(
                    (v - expected).abs() < TOL,
                    "expected {expected}, got {v} (diff={})",
                    (v - expected).abs()
                );
            }
            other => panic!("expected Number({expected}), got {other:?}"),
        }
    }

    // -- SIN --------------------------------------------------------------

    #[test]
    fn test_sin_cardinal_points() {
        let r = reg();
        assert_close(r.call("SIN", &[num(0.0)]), 0.0);
        assert_close(r.call("SIN", &[num(FRAC_PI_2)]), 1.0);
        assert_close(r.call("SIN", &[num(PI)]), 0.0);
        assert_close(r.call("SIN", &[num(3.0 * FRAC_PI_2)]), -1.0);
    }

    // -- COS --------------------------------------------------------------

    #[test]
    fn test_cos_cardinal_points() {
        let r = reg();
        assert_close(r.call("COS", &[num(0.0)]), 1.0);
        assert_close(r.call("COS", &[num(FRAC_PI_2)]), 0.0);
        assert_close(r.call("COS", &[num(PI)]), -1.0);
    }

    // -- TAN --------------------------------------------------------------

    #[test]
    fn test_tan_basic() {
        let r = reg();
        assert_close(r.call("TAN", &[num(0.0)]), 0.0);
        assert_close(r.call("TAN", &[num(FRAC_PI_4)]), 1.0);
    }

    // -- ASIN -------------------------------------------------------------

    #[test]
    fn test_asin_basic() {
        let r = reg();
        assert_close(r.call("ASIN", &[num(0.0)]), 0.0);
        assert_close(r.call("ASIN", &[num(1.0)]), FRAC_PI_2);
        assert_close(r.call("ASIN", &[num(-1.0)]), -FRAC_PI_2);
    }

    #[test]
    fn test_asin_domain_error() {
        let r = reg();
        assert_is_err(r.call("ASIN", &[num(2.0)]), CellError::Num);
        assert_is_err(r.call("ASIN", &[num(-1.5)]), CellError::Num);
    }

    // -- ACOS -------------------------------------------------------------

    #[test]
    fn test_acos_basic() {
        let r = reg();
        assert_close(r.call("ACOS", &[num(0.0)]), FRAC_PI_2);
        assert_close(r.call("ACOS", &[num(1.0)]), 0.0);
        assert_close(r.call("ACOS", &[num(-1.0)]), PI);
    }

    #[test]
    fn test_acos_domain_error() {
        let r = reg();
        assert_is_err(r.call("ACOS", &[num(2.0)]), CellError::Num);
        assert_is_err(r.call("ACOS", &[num(-2.0)]), CellError::Num);
    }

    // -- ATAN -------------------------------------------------------------

    #[test]
    fn test_atan_basic() {
        let r = reg();
        assert_close(r.call("ATAN", &[num(0.0)]), 0.0);
        assert_close(r.call("ATAN", &[num(1.0)]), FRAC_PI_4);
        assert_close(r.call("ATAN", &[num(-1.0)]), -FRAC_PI_4);
    }

    // -- ATAN2 ------------------------------------------------------------

    #[test]
    fn test_atan2_basic() {
        let r = reg();
        // Excel ATAN2(x_num, y_num) — note arg order: x first, y second
        // ATAN2(1, 1) = pi/4
        assert_close(r.call("ATAN2", &[num(1.0), num(1.0)]), FRAC_PI_4);
        // ATAN2(0, 1) = pi/2 (x=0, y=1 => atan2(1,0) = pi/2)
        assert_close(r.call("ATAN2", &[num(0.0), num(1.0)]), FRAC_PI_2);
        // ATAN2(1, 0) = 0
        assert_close(r.call("ATAN2", &[num(1.0), num(0.0)]), 0.0);
    }

    #[test]
    fn test_atan2_both_zero_div0() {
        let r = reg();
        assert_is_err(r.call("ATAN2", &[num(0.0), num(0.0)]), CellError::Div0);
    }

    // -- DEGREES / RADIANS ------------------------------------------------

    #[test]
    fn test_degrees() {
        let r = reg();
        assert_close(r.call("DEGREES", &[num(PI)]), 180.0);
        assert_close(r.call("DEGREES", &[num(0.0)]), 0.0);
        assert_close(r.call("DEGREES", &[num(FRAC_PI_2)]), 90.0);
    }

    #[test]
    fn test_radians() {
        let r = reg();
        assert_close(r.call("RADIANS", &[num(180.0)]), PI);
        assert_close(r.call("RADIANS", &[num(0.0)]), 0.0);
        assert_close(r.call("RADIANS", &[num(90.0)]), FRAC_PI_2);
    }

    // -- COT --------------------------------------------------------------

    #[test]
    fn test_cot_basic() {
        let r = reg();
        // COT(pi/4) = 1/tan(pi/4) = 1
        assert_close(r.call("COT", &[num(FRAC_PI_4)]), 1.0);
    }

    #[test]
    fn test_cot_zero_div0() {
        let r = reg();
        // COT(0) -> sin(0)=0 -> #DIV/0!
        assert_is_err(r.call("COT", &[num(0.0)]), CellError::Div0);
    }

    // -- ACOT -------------------------------------------------------------

    #[test]
    fn test_acot_basic() {
        let r = reg();
        // ACOT(1) = pi/4
        assert_close(r.call("ACOT", &[num(1.0)]), FRAC_PI_4);
        // ACOT(0) = pi/2
        assert_close(r.call("ACOT", &[num(0.0)]), FRAC_PI_2);
    }

    // -- SEC --------------------------------------------------------------

    #[test]
    fn test_sec_basic() {
        let r = reg();
        // SEC(0) = 1/cos(0) = 1
        assert_close(r.call("SEC", &[num(0.0)]), 1.0);
    }

    // -- CSC --------------------------------------------------------------

    #[test]
    fn test_csc_basic() {
        let r = reg();
        // CSC(pi/2) = 1/sin(pi/2) = 1
        assert_close(r.call("CSC", &[num(FRAC_PI_2)]), 1.0);
    }

    // -- Hyperbolic functions ---------------------------------------------

    #[test]
    fn test_sinh_zero() {
        let r = reg();
        assert_close(r.call("SINH", &[num(0.0)]), 0.0);
    }

    #[test]
    fn test_cosh_zero() {
        let r = reg();
        assert_close(r.call("COSH", &[num(0.0)]), 1.0);
    }

    #[test]
    fn test_tanh_zero() {
        let r = reg();
        assert_close(r.call("TANH", &[num(0.0)]), 0.0);
    }

    #[test]
    fn test_asinh_zero() {
        let r = reg();
        assert_close(r.call("ASINH", &[num(0.0)]), 0.0);
    }

    #[test]
    fn test_acosh_one() {
        let r = reg();
        assert_close(r.call("ACOSH", &[num(1.0)]), 0.0);
    }

    #[test]
    fn test_acosh_domain_error() {
        let r = reg();
        // ACOSH(0) -> #NUM! (domain: [1, inf))
        assert_is_err(r.call("ACOSH", &[num(0.0)]), CellError::Num);
        assert_is_err(r.call("ACOSH", &[num(-1.0)]), CellError::Num);
    }

    #[test]
    fn test_atanh_zero() {
        let r = reg();
        assert_close(r.call("ATANH", &[num(0.0)]), 0.0);
    }

    #[test]
    fn test_atanh_domain_error() {
        let r = reg();
        // ATANH(1) -> #NUM! (domain: (-1, 1))
        assert_is_err(r.call("ATANH", &[num(1.0)]), CellError::Num);
        assert_is_err(r.call("ATANH", &[num(-1.0)]), CellError::Num);
        assert_is_err(r.call("ATANH", &[num(2.0)]), CellError::Num);
    }

    // -- Pythagorean identity: sin^2(x) + cos^2(x) = 1 -------------------

    #[test]
    fn test_pythagorean_identity() {
        let r = reg();
        for x in [0.0, 0.5, 1.0, 1.5, 2.0, PI, 2.7, -1.3] {
            let sin_val = match r.call("SIN", &[num(x)]) {
                CellValue::Number(n) => f64::from(n),
                other => panic!("SIN({x}) failed: {other:?}"),
            };
            let cos_val = match r.call("COS", &[num(x)]) {
                CellValue::Number(n) => f64::from(n),
                other => panic!("COS({x}) failed: {other:?}"),
            };
            let sum = sin_val * sin_val + cos_val * cos_val;
            assert!(
                (sum - 1.0).abs() < TOL,
                "sin^2({x}) + cos^2({x}) = {sum}, expected 1.0"
            );
        }
    }

    // -- Hyperbolic identity: cosh^2(x) - sinh^2(x) = 1 ------------------

    #[test]
    fn test_hyperbolic_identity() {
        let r = reg();
        for x in [0.0, 0.5, 1.0, -1.0, 2.0, -0.3] {
            let sinh_val = match r.call("SINH", &[num(x)]) {
                CellValue::Number(n) => f64::from(n),
                other => panic!("SINH({x}) failed: {other:?}"),
            };
            let cosh_val = match r.call("COSH", &[num(x)]) {
                CellValue::Number(n) => f64::from(n),
                other => panic!("COSH({x}) failed: {other:?}"),
            };
            let diff = cosh_val * cosh_val - sinh_val * sinh_val;
            assert!(
                (diff - 1.0).abs() < TOL,
                "cosh^2({x}) - sinh^2({x}) = {diff}, expected 1.0"
            );
        }
    }

    // -- Inverse round-trip: asin(sin(x)) = x for x in [-pi/2, pi/2] -----

    #[test]
    fn test_asin_sin_roundtrip() {
        let r = reg();
        for x in [0.0, 0.3, -0.3, 1.0, -1.0, FRAC_PI_4] {
            let sin_val = r.call("SIN", &[num(x)]);
            let back = r.call("ASIN", &[sin_val]);
            assert_close(back, x);
        }
    }

    // -- Inverse round-trip: acos(cos(x)) = x for x in [0, pi] -----------

    #[test]
    fn test_acos_cos_roundtrip() {
        let r = reg();
        for x in [0.0, 0.5, 1.0, 2.0, PI] {
            let cos_val = r.call("COS", &[num(x)]);
            let back = r.call("ACOS", &[cos_val]);
            assert_close(back, x);
        }
    }

    // -- degrees(radians(x)) = x -----------------------------------------

    #[test]
    fn test_degrees_radians_roundtrip() {
        let r = reg();
        for x in [0.0, 45.0, 90.0, 180.0, 360.0, -30.0] {
            let rad = r.call("RADIANS", &[num(x)]);
            let back = r.call("DEGREES", &[rad]);
            assert_close(back, x);
        }
    }
}
