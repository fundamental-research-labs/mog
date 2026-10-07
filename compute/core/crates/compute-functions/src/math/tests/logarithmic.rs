use super::super::logarithmic::*;
use super::helpers::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

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
fn test_log() {
    let f = FnLog;
    assert_eq!(f.call(&[num(100.0)]), num(2.0));
    assert_eq!(f.call(&[num(8.0), num(2.0)]), num(3.0));
    assert_eq!(f.call(&[num(0.0)]), err(CellError::Num));
}

#[test]
fn test_log_base_one_returns_div0() {
    // LOG(10, 1) divides by ln(1)=0 -> #DIV/0!
    assert_eq!(FnLog.call(&[num(10.0), num(1.0)]), err(CellError::Div0));
}

#[test]
fn test_power() {
    let f = FnPower;
    assert_eq!(f.call(&[num(2.0), num(3.0)]), num(8.0));
    assert_eq!(f.call(&[num(4.0), num(0.5)]), num(2.0));
}

#[test]
fn test_power_huge_exp_base_1_returns_one() {
    // base=1 always returns 1 regardless of exponent
    assert_eq!(FnPower.call(&[num(1.0), num(1e308)]), num(1.0));
    assert_eq!(FnPower.call(&[num(1.0), num(-1e308)]), num(1.0));
}

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
fn test_power_normal_cases_unaffected() {
    // Normal POWER cases should still work
    assert_eq!(FnPower.call(&[num(2.0), num(10.0)]), num(1024.0));
    assert_eq!(
        FnPower.call(&[num(f64::MIN_POSITIVE), num(1.0)]),
        num(f64::MIN_POSITIVE)
    );
    assert_eq!(
        FnPower.call(&[num(-f64::MIN_POSITIVE), num(1.0)]),
        num(-f64::MIN_POSITIVE)
    );
    assert_eq!(FnPower.call(&[num(0.0), num(0.0)]), err(CellError::Num)); // 0^0 = #NUM!
    assert_eq!(FnPower.call(&[num(0.0), num(5.0)]), num(0.0)); // 0^5 = 0
    assert_eq!(FnPower.call(&[num(0.0), num(-1.0)]), err(CellError::Div0)); // 0^(-1) = #DIV/0!
}

#[test]
fn test_power_negative_base_rational_domain_remains_real() {
    let check = |exponent: f64, expected: f64| {
        let result = FnPower.call(&[num(-8.0), num(exponent)]);
        let CellValue::Number(result) = result else {
            panic!("POWER(-8, {exponent}) must return a real number");
        };
        assert!(
            (result.get() - expected).abs() < 1e-12,
            "POWER(-8, {exponent}) = {}, expected {expected}",
            result.get()
        );
    };
    check(1.0 / 3.0, -2.0);
    check(2.0 / 3.0, 4.0);
    check(-1.0 / 3.0, -0.5);
}

#[test]
fn test_negative_integer_powers_match_native_excel() {
    // Fresh Excel full calculation, covering five bases and seven exponents.
    // Exact values matter: rounding here can change a downstream QUOTIENT.
    for (base, exponent, expected) in [
        (-10.0, -307.0, -9.999999999999995e-308),
        (-10.0, -20.0, 1e-20),
        (-10.0, -3.0, -0.001),
        (-10.0, 2.0, 100.0),
        (-10.0, 3.0, -1000.0),
        (-10.0, 20.0, 1e+20),
        (-10.0, 307.0, -1.0000000000000005e+307),
        (-2.0, -307.0, -3.835229269763849e-93),
        (-2.0, -20.0, 9.5367431640625e-07),
        (-2.0, -3.0, -0.125),
        (-2.0, 2.0, 4.0),
        (-2.0, 3.0, -8.0),
        (-2.0, 20.0, 1048576.0),
        (-2.0, 307.0, -2.6074060497081422e+92),
        (-3.0, -307.0, -3.340217915476827e-147),
        (-3.0, -20.0, 2.8679719907924413e-10),
        (-3.0, -3.0, -0.037037037037037035),
        (-3.0, 2.0, 9.0),
        (-3.0, 3.0, -27.0),
        (-3.0, 20.0, 3486784401.0),
        (-3.0, 307.0, -2.9938166470113275e+146),
        (-1.1, -307.0, -1.9608557968541054e-13),
        (-1.1, -20.0, 0.1486436280241435),
        (-1.1, -3.0, -0.7513148009015775),
        (-1.1, 2.0, 1.2100000000000002),
        (-1.1, 3.0, -1.3310000000000004),
        (-1.1, 20.0, 6.727499949325609),
        (-1.1, 307.0, -5099814079160.476),
        (-0.1, -307.0, -9.99999999999967e+306),
        (-0.1, -20.0, 9.999999999999979e+19),
        (-0.1, -3.0, -999.9999999999998),
        (-0.1, 2.0, 0.010000000000000002),
        (-0.1, 3.0, -0.0010000000000000002),
        (-0.1, 20.0, 1.0000000000000022e-20),
        (-0.1, 307.0, -1.000000000000033e-307),
    ] {
        assert_eq!(
            FnPower.call(&[num(base), num(exponent)]),
            num(expected),
            "POWER({base}, {exponent})"
        );
    }
}

#[test]
fn test_power_subnormal_result_flushes_to_zero() {
    // Office's formula value space excludes denormalized IEC 60559 values.
    // MAX^-1 is finite but subnormal; both signs therefore underflow to zero.
    let max = f64::MAX;
    assert_eq!(FnPower.call(&[num(max), num(-1.0)]), num(0.0));
    assert_eq!(FnPower.call(&[num(-max), num(-1.0)]), num(0.0));

    // The same boundary applies through the supported odd-denominator real
    // root path for negative bases.
    assert_eq!(FnPower.call(&[num(-1e-132), num(7.0 / 3.0)]), num(0.0));
}

// ---- POWER edge cases: huge exponents and tiny bases ----

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
fn test_sqrt() {
    let f = FnSqrt;
    assert_eq!(f.call(&[num(9.0)]), num(3.0));
    assert_eq!(f.call(&[num(-1.0)]), err(CellError::Num));
    assert_eq!(f.call(&[num(0.0)]), num(0.0));
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
    // Native Excel returns #NUM! when the product overflows, even though the
    // mathematical square root would fit in a floating-point number.
    assert_eq!(FnSqrtPi.call(&[num(6e307)]), err(CellError::Num));
}
