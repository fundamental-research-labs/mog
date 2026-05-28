use super::super::rounding::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

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
fn test_ceiling_basic() {
    let r = reg();
    assert_eq!(r.call("CEILING", &[num(2.5), num(1.0)]), num(3.0));
    assert_eq!(r.call("CEILING", &[num(2.1), num(0.5)]), num(2.5));
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
fn test_ceiling_math_normal_cases_unaffected() {
    assert_eq!(FnCeilingMath.call(&[num(6.3), num(3.0)]), num(9.0));
    assert_eq!(FnCeilingMath.call(&[num(-6.3), num(3.0)]), num(-6.0));
}

#[test]
fn test_ceiling_math_positive() {
    let r = reg();
    // CEILING.MATH(6.3, 5) = 10
    assert_eq!(r.call("CEILING.MATH", &[num(6.3), num(5.0)]), num(10.0));
}

#[test]
fn test_ceiling_math_significance_zero() {
    // Excel 365: CEILING.MATH(5, 0) = 0
    assert_eq!(FnCeilingMath.call(&[num(5.0), num(0.0)]), num(0.0));
    assert_eq!(FnCeilingMath.call(&[num(-3.7), num(0.0)]), num(0.0));
}

#[test]
fn test_ceiling_math_single_arg() {
    let r = reg();
    // Defaults: significance=1, mode=0
    assert_eq!(r.call("CEILING.MATH", &[num(2.3)]), num(3.0));
    assert_eq!(r.call("CEILING.MATH", &[num(-2.3)]), num(-2.0));
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
fn test_ceiling_math_zero_significance_returns_zero() {
    let r = reg();
    assert_eq!(r.call("CEILING.MATH", &[num(5.0), num(0.0)]), num(0.0));
}

// -- CEILING.PRECISE --------------------------------------------------

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
fn test_ceiling_precise() {
    assert_eq!(FnCeilingPrecise.call(&[num(2.1)]), num(3.0));
    assert_eq!(FnCeilingPrecise.call(&[num(-2.1)]), num(-2.0));
    assert_eq!(FnCeilingPrecise.call(&[num(0.0)]), num(0.0));
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
fn test_ceiling_precise_positive() {
    let r = reg();
    // CEILING.PRECISE(4.3, 2) = 6
    assert_eq!(r.call("CEILING.PRECISE", &[num(4.3), num(2.0)]), num(6.0));
}

#[test]
fn test_ceiling_significance_zero() {
    // Excel 365: CEILING(5, 0) = 0
    assert_eq!(FnCeiling.call(&[num(5.0), num(0.0)]), num(0.0));
}

#[test]
fn test_ceiling_zero_significance() {
    let r = reg();
    assert_eq!(r.call("CEILING", &[num(5.0), num(0.0)]), num(0.0));
}

// -- CEILING.MATH -----------------------------------------------------

#[test]
fn test_even() {
    assert_eq!(FnEven.call(&[num(1.5)]), num(2.0));
    assert_eq!(FnEven.call(&[num(3.0)]), num(4.0));
    assert_eq!(FnEven.call(&[num(2.0)]), num(2.0));
    assert_eq!(FnEven.call(&[num(0.0)]), num(0.0));
    assert_eq!(FnEven.call(&[num(-1.0)]), num(-2.0));
}

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
fn test_floor_basic() {
    let r = reg();
    assert_eq!(r.call("FLOOR", &[num(2.5), num(1.0)]), num(2.0));
    assert_eq!(r.call("FLOOR", &[num(2.7), num(0.5)]), num(2.5));
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
fn test_floor_math_normal_cases_unaffected() {
    assert_eq!(FnFloorMath.call(&[num(6.3), num(3.0)]), num(6.0));
    assert_eq!(FnFloorMath.call(&[num(-6.3), num(3.0)]), num(-9.0));
}

#[test]
fn test_floor_math_positive() {
    let r = reg();
    // FLOOR.MATH(6.7, 5) = 5
    assert_eq!(r.call("FLOOR.MATH", &[num(6.7), num(5.0)]), num(5.0));
}

#[test]
fn test_floor_math_significance_zero() {
    // Excel 365: FLOOR.MATH(5, 0) = 0
    assert_eq!(FnFloorMath.call(&[num(5.0), num(0.0)]), num(0.0));
    assert_eq!(FnFloorMath.call(&[num(-3.7), num(0.0)]), num(0.0));
}

#[test]
fn test_floor_math_single_arg() {
    let r = reg();
    assert_eq!(r.call("FLOOR.MATH", &[num(6.7)]), num(6.0));
    assert_eq!(r.call("FLOOR.MATH", &[num(-6.7)]), num(-7.0));
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
fn test_floor_math_zero_significance_returns_zero() {
    let r = reg();
    assert_eq!(r.call("FLOOR.MATH", &[num(5.0), num(0.0)]), num(0.0));
}

// -- FLOOR.PRECISE ----------------------------------------------------

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
fn test_floor_precise() {
    assert_eq!(FnFloorPrecise.call(&[num(2.9)]), num(2.0));
    assert_eq!(FnFloorPrecise.call(&[num(-2.1)]), num(-3.0));
}

// --- Tests for combinatorics ---

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
fn test_floor_precise_positive() {
    let r = reg();
    // FLOOR.PRECISE(4.7, 2) = 4
    assert_eq!(r.call("FLOOR.PRECISE", &[num(4.7), num(2.0)]), num(4.0));
}

#[test]
fn test_floor_significance_zero() {
    // Excel 365: FLOOR(5, 0) = #DIV/0!
    assert_eq!(FnFloor.call(&[num(5.0), num(0.0)]), err(CellError::Div0));
}

// ---- FIX 3: FACTDOUBLE(-1) = 1 ----

#[test]
fn test_floor_zero_significance_div0() {
    let r = reg();
    assert_is_err(r.call("FLOOR", &[num(5.0), num(0.0)]), CellError::Div0);
}

// -- FLOOR.MATH -------------------------------------------------------

#[test]
fn test_int() {
    let f = FnInt;
    assert_eq!(f.call(&[num(4.7)]), num(4.0));
    assert_eq!(f.call(&[num(-4.7)]), num(-5.0));
}

#[test]
fn test_int_already_integer() {
    let r = reg();
    assert_eq!(r.call("INT", &[num(5.0)]), num(5.0));
    assert_eq!(r.call("INT", &[num(-5.0)]), num(-5.0));
}

// -- CEILING ----------------------------------------------------------

#[test]
fn test_int_negative_differs_from_trunc() {
    let r = reg();
    // INT(-1.9) = -2 (floor), TRUNC(-1.9) = -1 (toward zero)
    assert_eq!(r.call("INT", &[num(-1.9)]), num(-2.0));
    assert_eq!(r.call("TRUNC", &[num(-1.9)]), num(-1.0));
}

#[test]
fn test_int_positive() {
    let r = reg();
    assert_eq!(r.call("INT", &[num(1.9)]), num(1.0));
}

#[test]
fn test_iso_ceiling_same_as_ceiling_precise() {
    let r = reg();
    assert_eq!(r.call("ISO.CEILING", &[num(4.3), num(2.0)]), num(6.0));
    assert_eq!(r.call("ISO.CEILING", &[num(-4.3), num(2.0)]), num(-4.0));
}

// -- FLOOR ------------------------------------------------------------

#[test]
fn test_mround() {
    assert_eq!(FnMround.call(&[num(10.0), num(3.0)]), num(9.0));
    assert_eq!(FnMround.call(&[num(0.0), num(3.0)]), num(0.0));
    // Unlike FLOOR/CEILING, MROUND still requires same signs in all Excel versions
    assert_eq!(FnMround.call(&[num(-5.0), num(3.0)]), err(CellError::Num));
}

#[test]
fn test_mround_basic() {
    let r = reg();
    // MROUND(10, 3) = 9
    assert_eq!(r.call("MROUND", &[num(10.0), num(3.0)]), num(9.0));
    // MROUND(7.5, 3) = 9
    assert_eq!(r.call("MROUND", &[num(7.5), num(3.0)]), num(9.0));
}

#[test]
fn test_mround_mixed_signs_error() {
    let r = reg();
    assert_is_err(r.call("MROUND", &[num(10.0), num(-3.0)]), CellError::Num);
    assert_is_err(r.call("MROUND", &[num(-10.0), num(3.0)]), CellError::Num);
}

#[test]
fn test_mround_negative() {
    let r = reg();
    // MROUND(-10, -3) = -9
    assert_eq!(r.call("MROUND", &[num(-10.0), num(-3.0)]), num(-9.0));
}

#[test]
fn test_mround_zero_multiple() {
    let r = reg();
    assert_eq!(r.call("MROUND", &[num(10.0), num(0.0)]), num(0.0));
}

// -- EVEN -------------------------------------------------------------

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
fn test_round() {
    let f = FnRound;
    assert_eq!(f.call(&[num(2.567), num(2.0)]), num(2.57));
    assert_eq!(f.call(&[num(2.5)]), num(3.0));
    assert_eq!(f.call(&[num(1234.0), num(-2.0)]), num(1200.0));
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
fn test_round_decimal_digits() {
    let r = reg();
    // ROUND(1.234, 2) = 1.23
    assert_eq!(r.call("ROUND", &[num(1.234), num(2.0)]), num(1.23));
    // ROUND(1.235, 2) = 1.24
    assert_eq!(r.call("ROUND", &[num(1.235), num(2.0)]), num(1.24));
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
fn test_round_half_away_from_zero_positive() {
    let r = reg();
    // ROUND(2.5, 0) = 3
    assert_eq!(r.call("ROUND", &[num(2.5), num(0.0)]), num(3.0));
    // ROUND(3.5, 0) = 4
    assert_eq!(r.call("ROUND", &[num(3.5), num(0.0)]), num(4.0));
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
fn test_rounddown() {
    let f = FnRoundDown;
    assert_eq!(f.call(&[num(2.789), num(1.0)]), num(2.7));
    assert_eq!(f.call(&[num(-2.789), num(1.0)]), num(-2.7));
}

#[test]
fn test_rounddown_negative() {
    let r = reg();
    // ROUNDDOWN(-1.9, 0) = -1 (toward zero)
    assert_eq!(r.call("ROUNDDOWN", &[num(-1.9), num(0.0)]), num(-1.0));
}

#[test]
fn test_rounddown_positive() {
    let r = reg();
    assert_eq!(r.call("ROUNDDOWN", &[num(1.9), num(0.0)]), num(1.0));
}

#[test]
fn test_rounddown_single_arg_defaults_digits_zero() {
    // ROUNDDOWN(2.5) with 1 arg should default digits to 0 -> 2
    assert_eq!(FnRoundDown.call(&[num(2.5)]), num(2.0));
}

// ---- FIX 1: AGGREGATE error filtering for MAX/MIN/PRODUCT ----

// ---- FIX 2: CEILING.MATH and FLOOR.MATH with significance=0 ----

#[test]
fn test_rounddown_with_digits() {
    let r = reg();
    assert_eq!(r.call("ROUNDDOWN", &[num(1.999), num(2.0)]), num(1.99));
    assert_eq!(r.call("ROUNDDOWN", &[num(-1.999), num(2.0)]), num(-1.99));
}

// -- TRUNC: truncate toward zero --------------------------------------

#[test]
fn test_roundup() {
    let f = FnRoundUp;
    assert_eq!(f.call(&[num(2.321), num(1.0)]), num(2.4));
    assert_eq!(f.call(&[num(-2.321), num(1.0)]), num(-2.4));
}

#[test]
fn test_roundup_negative() {
    let r = reg();
    // ROUNDUP(-1.1, 0) = -2 (away from zero)
    assert_eq!(r.call("ROUNDUP", &[num(-1.1), num(0.0)]), num(-2.0));
}

#[test]
fn test_roundup_positive() {
    let r = reg();
    assert_eq!(r.call("ROUNDUP", &[num(1.1), num(0.0)]), num(2.0));
    assert_eq!(r.call("ROUNDUP", &[num(1.0), num(0.0)]), num(1.0));
}

#[test]
fn test_roundup_single_arg_defaults_digits_zero() {
    // ROUNDUP(2.5) with 1 arg should default digits to 0 -> 3
    assert_eq!(FnRoundUp.call(&[num(2.5)]), num(3.0));
}

#[test]
fn test_roundup_with_digits() {
    let r = reg();
    assert_eq!(r.call("ROUNDUP", &[num(1.234), num(2.0)]), num(1.24));
    assert_eq!(r.call("ROUNDUP", &[num(-1.234), num(2.0)]), num(-1.24));
}

// -- ROUNDDOWN: always toward zero ------------------------------------

#[test]
fn test_trunc() {
    assert_eq!(FnTrunc.call(&[num(4.7)]), num(4.0));
    assert_eq!(FnTrunc.call(&[num(-4.7)]), num(-4.0));
    assert_eq!(FnTrunc.call(&[num(4.567), num(2.0)]), num(4.56));
}

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
