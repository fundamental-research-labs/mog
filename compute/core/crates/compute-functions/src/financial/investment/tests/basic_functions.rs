use crate::PureFunction;
use value_types::{CellError, CellValue};

use super::{FnIrr, FnMirr, FnNpv, err, num};

#[test]
fn npv_discounts_numeric_cash_flows_only() {
    let values = CellValue::from_rows(vec![vec![
        num(100.0),
        CellValue::Text("ignored".into()),
        num(100.0),
    ]]);

    let result = FnNpv.call(&[num(0.1), values]);
    match &result {
        CellValue::Number(n) => {
            let expected = 100.0 / 1.1_f64.powi(1) + 100.0 / 1.1_f64.powi(2);
            assert!((n.get() - expected).abs() < 1e-10);
        }
        _ => panic!("Expected number, got {:?}", result),
    }
}

#[test]
fn npv_propagates_error_cash_flow() {
    let values = CellValue::from_rows(vec![vec![num(100.0), err(CellError::Value)]]);

    assert_eq!(FnNpv.call(&[num(0.1), values]), err(CellError::Value));
}

#[test]
fn irr_solves_simple_annual_return() {
    let values = CellValue::from_rows(vec![vec![num(-100.0), num(110.0)]]);

    let result = FnIrr.call(&[values]);
    match &result {
        CellValue::Number(n) => assert!((n.get() - 0.1).abs() < 1e-8),
        _ => panic!("Expected number, got {:?}", result),
    }
}

#[test]
fn irr_is_scale_invariant_for_tiny_and_large_cash_flows() {
    for magnitude in [1e-200, 1e200] {
        let values = CellValue::from_rows(vec![vec![num(-magnitude), num(2.0 * magnitude)]]);
        match FnIrr.call(&[values]) {
            CellValue::Number(rate) => {
                assert!((rate.get() - 1.0).abs() < 1e-10, "IRR = {}", rate.get());
            }
            other => panic!("Expected numeric IRR at scale {magnitude}, got {other:?}"),
        }
    }
}

#[test]
fn irr_accepts_the_nearest_representable_rate_above_minus_one() {
    let one_step_above_minus_one = -1.0 + f64::EPSILON / 2.0;
    let final_cash_flow = f64::EPSILON / 2.0;
    let values = CellValue::from_rows(vec![vec![num(-1.0), num(final_cash_flow)]]);
    match FnIrr.call(&[values]) {
        CellValue::Number(rate) => assert_eq!(rate.get(), one_step_above_minus_one),
        other => panic!("Expected boundary IRR, got {other:?}"),
    }
}

#[test]
fn irr_guess_selects_nearby_root() {
    // -100 + 230/(1+r) - 132/(1+r)^2 has roots at 10% and 20%.
    // The supplied guess is the root-selection seed; unrelated fallback
    // guesses must not silently choose a different root.
    let values = CellValue::from_rows(vec![vec![num(-100.0), num(230.0), num(-132.0)]]);
    let near_first = FnIrr.call(&[values.clone(), num(0.1)]);
    let near_second = FnIrr.call(&[values, num(0.5)]);
    match (near_first, near_second) {
        (CellValue::Number(first), CellValue::Number(second)) => {
            assert!((first.get() - 0.1).abs() < 1e-10);
            assert!((second.get() - 0.2).abs() < 1e-10);
        }
        other => panic!("Expected both IRR roots, got {other:?}"),
    }
}

#[test]
fn irr_returns_num_when_cash_flow_has_no_real_root() {
    // 1 - 1/(1+r) + 1/(1+r)^2 has a negative discriminant in q = 1/(1+r),
    // so it is positive throughout the valid domain despite containing both
    // signs.
    let values = CellValue::from_rows(vec![vec![num(1.0), num(-1.0), num(1.0)]]);
    assert_eq!(FnIrr.call(&[values, num(0.1)]), err(CellError::Num));
}

#[test]
fn irr_does_not_accept_a_near_zero_residual_at_a_stationary_point() {
    // This curve has no real root. At the default guess 0.1 its residual is
    // close to zero only because its derivative is also nearly zero.
    let values = CellValue::from_rows(vec![vec![
        num(0.8264462809918355),
        num(-1.8181818181818181),
        num(1.0),
    ]]);
    assert_eq!(FnIrr.call(&[values, num(0.1)]), err(CellError::Num));
}

#[test]
fn irr_rejects_guess_at_domain_boundary() {
    let values = CellValue::from_rows(vec![vec![num(-100.0), num(110.0)]]);
    assert_eq!(FnIrr.call(&[values, num(-1.0)]), err(CellError::Num));
}

#[test]
fn irr_requires_positive_and_negative_cash_flows() {
    let values = CellValue::from_rows(vec![vec![num(100.0), num(110.0)]]);

    assert_eq!(FnIrr.call(&[values]), err(CellError::Num));
}

#[test]
fn mirr_uses_finance_and_reinvest_rates() {
    let values = CellValue::from_rows(vec![vec![num(-1000.0), num(300.0), num(400.0), num(500.0)]]);

    let result = FnMirr.call(&[values, num(0.1), num(0.12)]);
    match &result {
        CellValue::Number(n) => {
            let expected = ((300.0_f64 * 1.12_f64.powi(2) + 400.0 * 1.12 + 500.0) / 1000.0)
                .powf(1.0 / 3.0)
                - 1.0;
            assert!((n.get() - expected).abs() < 1e-10);
        }
        _ => panic!("Expected number, got {:?}", result),
    }
}

#[test]
fn mirr_requires_positive_and_negative_cash_flows() {
    let values = CellValue::from_rows(vec![vec![num(-100.0), num(-110.0)]]);

    assert_eq!(
        FnMirr.call(&[values, num(0.1), num(0.12)]),
        err(CellError::Num)
    );
}
