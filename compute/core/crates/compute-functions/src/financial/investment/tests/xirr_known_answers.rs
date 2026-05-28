use crate::PureFunction;
use value_types::CellValue;

use super::{FnXirr, num, ymd};

/// Excel benchmark: returns 0.373362535.
#[test]
fn xirr_excel_benchmark() {
    let vals = CellValue::from_rows(vec![vec![
        num(-10000.0),
        num(2750.0),
        num(4250.0),
        num(3250.0),
        num(2750.0),
    ]]);
    let dates = CellValue::from_rows(vec![vec![
        num(ymd(2008, 1, 1)),
        num(ymd(2008, 3, 1)),
        num(ymd(2008, 10, 30)),
        num(ymd(2009, 2, 15)),
        num(ymd(2009, 4, 1)),
    ]]);
    let r = FnXirr.call(&[vals, dates]);
    match &r {
        CellValue::Number(n) => {
            assert!(
                (n.get() - 0.373362535).abs() < 1e-6,
                "XIRR = {}, expected ~0.373362535",
                n.get()
            );
        }
        _ => panic!("Expected number, got {:?}", r),
    }
}

/// Invest -1000, receive +1100 after exactly 365 days -> ~10%.
#[test]
fn xirr_exact_10_percent() {
    let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(1100.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
    let r = FnXirr.call(&[vals, dates]);
    match &r {
        CellValue::Number(n) => {
            assert!(
                (n.get() - 0.1).abs() < 0.001,
                "XIRR = {}, expected ~0.10",
                n.get()
            );
        }
        _ => panic!("Expected number, got {:?}", r),
    }
}

/// Break-even: invest -1000, receive +1000 -> 0%.
#[test]
fn xirr_break_even() {
    let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(1000.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
    let r = FnXirr.call(&[vals, dates]);
    match &r {
        CellValue::Number(n) => {
            assert!(n.get().abs() < 1e-6, "XIRR = {}, expected ~0.0", n.get());
        }
        _ => panic!("Expected number, got {:?}", r),
    }
}
