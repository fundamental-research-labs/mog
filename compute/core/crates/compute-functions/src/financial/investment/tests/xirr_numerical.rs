use crate::PureFunction;
use value_types::CellValue;

use super::{FnXirr, num, ymd};

/// Near-total loss: invest -1000, receive +10 -> ~-99%.
#[test]
fn xirr_near_total_loss() {
    let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(10.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
    let r = FnXirr.call(&[vals, dates]);
    match &r {
        CellValue::Number(n) => {
            assert!(
                (n.get() - (-0.99)).abs() < 0.01,
                "XIRR = {}, expected ~-0.99",
                n.get()
            );
        }
        _ => panic!("Expected number, got {:?}", r),
    }
}

/// Very high return: -100 -> +1000 in one year -> 900%.
#[test]
fn xirr_high_return_900_percent() {
    let vals = CellValue::from_rows(vec![vec![num(-100.0), num(1000.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
    let r = FnXirr.call(&[vals, dates]);
    match &r {
        CellValue::Number(n) => {
            assert!(
                (n.get() - 9.0).abs() < 0.01,
                "XIRR = {}, expected ~9.0",
                n.get()
            );
        }
        _ => panic!("Expected number, got {:?}", r),
    }
}

/// 1-day holding period: 0.1% gain -> annualized ~44%.
#[test]
fn xirr_one_day_holding() {
    let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(1001.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 6, 15)), num(ymd(2023, 6, 16))]]);
    let r = FnXirr.call(&[vals, dates]);
    match &r {
        CellValue::Number(n) => {
            // 1.001^365 - 1 is about 0.4402.
            assert!(
                n.get() > 0.3 && n.get().is_finite(),
                "XIRR = {}, expected high annualized rate",
                n.get()
            );
        }
        _ => panic!("Expected number, got {:?}", r),
    }
}

/// Short intervals: cash flows days apart -> very high annualized rate.
#[test]
fn xirr_short_intervals() {
    let vals = CellValue::from_rows(vec![vec![
        num(-10000.0),
        num(3000.0),
        num(4000.0),
        num(4000.0),
    ]]);
    let dates = CellValue::from_rows(vec![vec![
        num(ymd(2023, 6, 1)),
        num(ymd(2023, 6, 3)),
        num(ymd(2023, 6, 5)),
        num(ymd(2023, 6, 10)),
    ]]);
    let r = FnXirr.call(&[vals, dates]);
    match &r {
        CellValue::Number(n) => {
            assert!(
                n.get() > 10.0 && n.get().is_finite(),
                "XIRR = {}, expected very high annualized rate",
                n.get()
            );
        }
        _ => panic!("Expected number, got {:?}", r),
    }
}

/// Long time span: 20-year investment. -1000 -> +4000. r is about 7.18%.
#[test]
fn xirr_20_year_span() {
    let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(4000.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(ymd(2000, 1, 1)), num(ymd(2020, 1, 1))]]);
    let r = FnXirr.call(&[vals, dates]);
    match &r {
        CellValue::Number(n) => {
            assert!(
                (n.get() - 0.07177).abs() < 0.005,
                "XIRR = {}, expected ~0.07177",
                n.get()
            );
        }
        _ => panic!("Expected number, got {:?}", r),
    }
}

/// Large magnitudes (millions) should not overflow.
#[test]
fn xirr_large_magnitudes() {
    let vals = CellValue::from_rows(vec![vec![
        num(-5_000_000.0),
        num(1_500_000.0),
        num(2_000_000.0),
        num(2_500_000.0),
    ]]);
    let dates = CellValue::from_rows(vec![vec![
        num(ymd(2020, 1, 1)),
        num(ymd(2020, 7, 1)),
        num(ymd(2021, 1, 1)),
        num(ymd(2021, 7, 1)),
    ]]);
    let r = FnXirr.call(&[vals, dates]);
    match &r {
        CellValue::Number(n) => {
            assert!(
                n.get() > 0.0 && n.get().is_finite(),
                "XIRR = {}, expected positive finite",
                n.get()
            );
        }
        _ => panic!("Expected number, got {:?}", r),
    }
}

/// Tiny fractional amounts: precision near zero (scale-invariant).
#[test]
fn xirr_tiny_amounts() {
    let vals = CellValue::from_rows(vec![vec![num(-0.001), num(0.0011)]]);
    let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
    let r = FnXirr.call(&[vals, dates]);
    match &r {
        CellValue::Number(n) => {
            assert!(
                (n.get() - 0.1).abs() < 0.01,
                "XIRR = {}, expected ~0.10 (scale-invariant)",
                n.get()
            );
        }
        _ => panic!("Expected number, got {:?}", r),
    }
}

/// Monthly cash flows for 12 months.
#[test]
fn xirr_monthly_12() {
    let mut v = vec![num(-12000.0)];
    let mut d = vec![num(ymd(2023, 1, 1))];
    for m in 2..=13i32 {
        v.push(num(1100.0));
        let year = if m > 12 { 2024 } else { 2023 };
        let month = if m > 12 { m - 12 } else { m };
        d.push(num(ymd(year, month, 1)));
    }
    let vals = CellValue::from_rows(vec![v]);
    let dates = CellValue::from_rows(vec![d]);
    let r = FnXirr.call(&[vals, dates]);
    match &r {
        CellValue::Number(n) => {
            assert!(
                n.get() > 0.05 && n.get() < 0.30,
                "XIRR = {}, expected in [0.05, 0.30]",
                n.get()
            );
        }
        _ => panic!("Expected number, got {:?}", r),
    }
}

/// 60 monthly payments (5-year loan).
#[test]
fn xirr_60_months() {
    let mut v = vec![num(50000.0)];
    let mut d = vec![num(ymd(2020, 1, 1))];
    for i in 1..=60i32 {
        v.push(num(-1000.0));
        let year = 2020 + i / 12;
        let month = (i % 12) + 1;
        d.push(num(ymd(year, month, 1)));
    }
    let vals = CellValue::from_rows(vec![v]);
    let dates = CellValue::from_rows(vec![d]);
    let r = FnXirr.call(&[vals, dates]);
    match &r {
        CellValue::Number(n) => {
            assert!(
                n.get() > 0.0 && n.get() < 0.20,
                "XIRR = {}, expected modest positive rate",
                n.get()
            );
        }
        _ => panic!("Expected number, got {:?}", r),
    }
}
