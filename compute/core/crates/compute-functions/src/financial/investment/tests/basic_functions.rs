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
