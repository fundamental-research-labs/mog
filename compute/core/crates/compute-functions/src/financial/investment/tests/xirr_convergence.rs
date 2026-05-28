use crate::PureFunction;
use value_types::{CellError, CellValue};

use super::{FnXirr, FnXnpv, num, ymd};

/// Different guesses should converge to the same root.
#[test]
fn xirr_guess_independence() {
    let vals = CellValue::from_rows(vec![vec![
        num(-10000.0),
        num(3000.0),
        num(4000.0),
        num(5000.0),
    ]]);
    let dates = CellValue::from_rows(vec![vec![
        num(ymd(2023, 1, 1)),
        num(ymd(2023, 6, 1)),
        num(ymd(2023, 12, 1)),
        num(ymd(2024, 6, 1)),
    ]]);
    let guesses = [0.01, 0.1, 0.5, 1.0, 5.0];
    let mut results = Vec::new();
    for &g in &guesses {
        let r = FnXirr.call(&[vals.clone(), dates.clone(), num(g)]);
        match r {
            CellValue::Number(n) => results.push(n.get()),
            other => panic!("XIRR(guess={}) = {:?}", g, other),
        }
    }
    for i in 1..results.len() {
        assert!(
            (results[i] - results[0]).abs() < 1e-6,
            "guess {} -> {}, but guess {} -> {} - diverged!",
            guesses[i],
            results[i],
            guesses[0],
            results[0]
        );
    }
}

/// Bad guess near the -1 singularity should still converge.
#[test]
fn xirr_bad_guess_near_singularity() {
    let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(1100.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
    let r = FnXirr.call(&[vals, dates, num(-0.99)]);
    match &r {
        CellValue::Number(n) => {
            assert!(
                (n.get() - 0.1).abs() < 0.01,
                "XIRR(guess=-0.99) = {}, expected ~0.10",
                n.get()
            );
        }
        _ => panic!("Expected convergence despite bad guess, got {:?}", r),
    }
}

/// Self-consistency: XNPV(XIRR_rate, values, dates) is approximately 0.
#[test]
fn xirr_self_consistency_with_xnpv() {
    let vals_inner = vec![
        num(-50000.0),
        num(10000.0),
        num(15000.0),
        num(18000.0),
        num(12000.0),
    ];
    let dates_inner = vec![
        num(ymd(2020, 3, 15)),
        num(ymd(2020, 9, 1)),
        num(ymd(2021, 2, 15)),
        num(ymd(2021, 11, 30)),
        num(ymd(2022, 6, 1)),
    ];
    let vals = CellValue::from_rows(vec![vals_inner.clone()]);
    let dates = CellValue::from_rows(vec![dates_inner.clone()]);

    let rate = match FnXirr.call(&[vals.clone(), dates.clone()]) {
        CellValue::Number(n) => n.get(),
        other => panic!("XIRR = {:?}", other),
    };

    let npv = FnXnpv.call(&[num(rate), vals, dates]);
    match &npv {
        CellValue::Number(n) => {
            assert!(
                n.get().abs() < 0.01,
                "XNPV(rate={}) = {}, expected ~0",
                rate,
                n.get()
            );
        }
        _ => panic!("XNPV = {:?}", npv),
    }
}

/// Alternating signs: stress test for multiple-root scenarios.
#[test]
fn xirr_alternating_signs() {
    let vals = CellValue::from_rows(vec![vec![
        num(-1000.0),
        num(3000.0),
        num(-3500.0),
        num(2000.0),
    ]]);
    let dates = CellValue::from_rows(vec![vec![
        num(ymd(2023, 1, 1)),
        num(ymd(2023, 4, 1)),
        num(ymd(2023, 7, 1)),
        num(ymd(2023, 10, 1)),
    ]]);
    let r = FnXirr.call(&[vals.clone(), dates.clone()]);
    match &r {
        CellValue::Number(n) => {
            assert!(
                n.get().is_finite(),
                "XIRR should be finite, got {}",
                n.get()
            );
        }
        CellValue::Error(CellError::Num, None) => {}
        other => panic!("Expected number or #NUM!, got {:?}", other),
    }
}
