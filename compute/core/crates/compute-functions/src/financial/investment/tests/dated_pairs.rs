use crate::PureFunction;
use value_types::{CellError, CellValue};

use super::{FnXirr, FnXnpv, err, num, ymd};

/// Empty value cells with valid dates should be treated as zero cash flow.
#[test]
fn xirr_empty_value_cells_treated_as_zero() {
    let vals = CellValue::from_rows(vec![vec![
        num(-1000.0),
        num(1100.0),
        CellValue::Null,
        CellValue::Null,
        CellValue::Null,
        CellValue::Null,
    ]]);
    let dates = CellValue::from_rows(vec![vec![
        num(ymd(2023, 1, 1)),
        num(ymd(2024, 1, 1)),
        num(ymd(2025, 1, 1)),
        num(ymd(2026, 1, 1)),
        num(ymd(2027, 1, 1)),
        num(ymd(2028, 1, 1)),
    ]]);
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

/// XNPV should also handle empty value cells as zero.
#[test]
fn xnpv_empty_value_cells_treated_as_zero() {
    let rate = num(0.1);
    let vals_with_nulls = CellValue::from_rows(vec![vec![
        num(-1000.0),
        num(500.0),
        CellValue::Null,
        CellValue::Null,
    ]]);
    let vals_with_zeros =
        CellValue::from_rows(vec![vec![num(-1000.0), num(500.0), num(0.0), num(0.0)]]);
    let dates = CellValue::from_rows(vec![vec![
        num(ymd(2023, 1, 1)),
        num(ymd(2024, 1, 1)),
        num(ymd(2025, 1, 1)),
        num(ymd(2026, 1, 1)),
    ]]);
    let r_nulls = FnXnpv.call(&[rate.clone(), vals_with_nulls, dates.clone()]);
    let r_zeros = FnXnpv.call(&[rate, vals_with_zeros, dates]);
    match (&r_nulls, &r_zeros) {
        (CellValue::Number(a), CellValue::Number(b)) => {
            assert!(
                (a.get() - b.get()).abs() < 1e-10,
                "XNPV with nulls ({}) should equal XNPV with zeros ({})",
                a.get(),
                b.get()
            );
        }
        _ => panic!("Expected numbers, got {:?} and {:?}", r_nulls, r_zeros),
    }
}

/// If both value and date are empty, the pair should be skipped entirely.
#[test]
fn xirr_both_empty_pair_skipped() {
    let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(1100.0), CellValue::Null]]);
    let dates = CellValue::from_rows(vec![vec![
        num(ymd(2023, 1, 1)),
        num(ymd(2024, 1, 1)),
        CellValue::Null,
    ]]);
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

/// Non-numeric text in value position should cause the pair to be skipped.
#[test]
fn xirr_text_in_values_skipped() {
    let vals = CellValue::from_rows(vec![vec![
        num(-1000.0),
        CellValue::Text("N/A".into()),
        num(1100.0),
    ]]);
    let dates = CellValue::from_rows(vec![vec![
        num(ymd(2023, 1, 1)),
        num(ymd(2023, 7, 1)),
        num(ymd(2024, 1, 1)),
    ]]);
    let r = FnXirr.call(&[vals, dates]);
    match &r {
        CellValue::Number(n) => {
            assert!(
                (n.get() - 0.1).abs() < 0.001,
                "XIRR = {}, expected ~0.10 (text pair skipped)",
                n.get()
            );
        }
        _ => panic!("Expected number, got {:?}", r),
    }
}

/// Text date in first position should be coerced to a serial number.
#[test]
fn xirr_text_date_coerced() {
    let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(1100.0)]]);
    let dates_text = CellValue::from_rows(vec![vec![
        CellValue::Text("1/1/2023".into()),
        num(ymd(2024, 1, 1)),
    ]]);
    let dates_numeric =
        CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
    let r_text = FnXirr.call(&[vals.clone(), dates_text]);
    let r_num = FnXirr.call(&[vals, dates_numeric]);
    match (&r_text, &r_num) {
        (CellValue::Number(a), CellValue::Number(b)) => {
            assert!(
                (a.get() - b.get()).abs() < 1e-10,
                "XIRR with text date ({}) should equal XIRR with numeric date ({})",
                a.get(),
                b.get()
            );
        }
        _ => panic!("Expected numbers, got {:?} and {:?}", r_text, r_num),
    }
}

/// Numeric text in value position should be coerced (e.g. "1100" -> 1100.0).
#[test]
fn xirr_text_number_in_value_coerced() {
    let vals_text = CellValue::from_rows(vec![vec![num(-1000.0), CellValue::Text("1100".into())]]);
    let vals_num = CellValue::from_rows(vec![vec![num(-1000.0), num(1100.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
    let r_text = FnXirr.call(&[vals_text, dates.clone()]);
    let r_num = FnXirr.call(&[vals_num, dates]);
    match (&r_text, &r_num) {
        (CellValue::Number(a), CellValue::Number(b)) => {
            assert!(
                (a.get() - b.get()).abs() < 1e-10,
                "XIRR with text value ({}) should equal XIRR with numeric value ({})",
                a.get(),
                b.get()
            );
        }
        _ => panic!("Expected numbers, got {:?} and {:?}", r_text, r_num),
    }
}

/// XNPV should coerce text dates the same way.
#[test]
fn xnpv_text_date_coerced() {
    let rate = num(0.1);
    let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(500.0), num(600.0)]]);
    let dates_text = CellValue::from_rows(vec![vec![
        CellValue::Text("1/1/2023".into()),
        num(ymd(2023, 7, 1)),
        num(ymd(2024, 1, 1)),
    ]]);
    let dates_numeric = CellValue::from_rows(vec![vec![
        num(ymd(2023, 1, 1)),
        num(ymd(2023, 7, 1)),
        num(ymd(2024, 1, 1)),
    ]]);
    let r_text = FnXnpv.call(&[rate.clone(), vals.clone(), dates_text]);
    let r_num = FnXnpv.call(&[rate, vals, dates_numeric]);
    match (&r_text, &r_num) {
        (CellValue::Number(a), CellValue::Number(b)) => {
            assert!(
                (a.get() - b.get()).abs() < 1e-10,
                "XNPV with text date ({}) should equal XNPV with numeric date ({})",
                a.get(),
                b.get()
            );
        }
        _ => panic!("Expected numbers, got {:?} and {:?}", r_text, r_num),
    }
}

/// XIRR/XNPV truncate date serials to whole calendar days before evaluating.
#[test]
fn dated_functions_truncate_fractional_serials() {
    let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(1100.0)]]);
    let fractional_dates = CellValue::from_rows(vec![vec![num(100.75), num(465.25)]]);
    let integer_dates = CellValue::from_rows(vec![vec![num(100.0), num(465.0)]]);

    let xirr_fractional = FnXirr.call(&[vals.clone(), fractional_dates.clone()]);
    let xirr_integer = FnXirr.call(&[vals.clone(), integer_dates.clone()]);
    let xnpv_fractional = FnXnpv.call(&[num(0.1), vals.clone(), fractional_dates]);
    let xnpv_integer = FnXnpv.call(&[num(0.1), vals, integer_dates]);

    match (xirr_fractional, xirr_integer, xnpv_fractional, xnpv_integer) {
        (
            CellValue::Number(xirr_fractional),
            CellValue::Number(xirr_integer),
            CellValue::Number(xnpv_fractional),
            CellValue::Number(xnpv_integer),
        ) => {
            assert_eq!(xirr_fractional, xirr_integer);
            assert_eq!(xnpv_fractional, xnpv_integer);
        }
        other => panic!("Expected numeric results, got {other:?}"),
    }
}

/// XNPV requires at least one positive and one negative cash flow.
#[test]
fn xnpv_requires_positive_and_negative_cash_flows() {
    let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
    let positive = CellValue::from_rows(vec![vec![num(100.0), num(200.0)]]);
    let negative = CellValue::from_rows(vec![vec![num(-100.0), num(-200.0)]]);
    assert_eq!(
        FnXnpv.call(&[num(0.1), positive, dates.clone()]),
        err(CellError::Num)
    );
    assert_eq!(
        FnXnpv.call(&[num(0.1), negative, dates]),
        err(CellError::Num)
    );
}

/// Invalid numeric date serials are #VALUE!, rather than clamped by the date
/// conversion helper.
#[test]
fn xnpv_invalid_numeric_date_is_value_error() {
    let vals = CellValue::from_rows(vec![vec![num(-100.0), num(110.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(2_958_466.0), num(2_958_465.0)]]);
    assert_eq!(FnXnpv.call(&[num(0.1), vals, dates]), err(CellError::Value));
}

#[test]
fn xnpv_truncates_time_on_last_valid_date() {
    let vals = CellValue::from_rows(vec![vec![num(-100.0), num(110.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(2_958_465.75), num(2_958_465.25)]]);
    match FnXnpv.call(&[num(0.1), vals, dates]) {
        CellValue::Number(n) => assert_eq!(n.get(), 10.0),
        other => panic!("Expected numeric result, got {other:?}"),
    }
}

#[test]
fn xnpv_rejects_mismatched_source_lengths() {
    let vals = CellValue::from_rows(vec![vec![num(-100.0), num(50.0), num(60.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(100.0), num(465.0)]]);
    assert_eq!(FnXnpv.call(&[num(0.1), vals, dates]), err(CellError::Num));
}

#[test]
fn xnpv_rejects_date_before_base_date() {
    let vals = CellValue::from_rows(vec![vec![num(-100.0), num(110.0)]]);
    let dates = CellValue::from_rows(vec![vec![num(100.0), num(50.0)]]);
    assert_eq!(FnXnpv.call(&[num(0.1), vals, dates]), err(CellError::Num));
}

/// Unparseable text date among enough valid pairs: bad pair skipped, rest computed.
#[test]
fn xirr_unparseable_text_date_skipped() {
    let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(0.0), num(500.0), num(600.0)]]);
    let dates_with_bad = CellValue::from_rows(vec![vec![
        num(ymd(2023, 1, 1)),
        CellValue::Text("hello".into()),
        num(ymd(2023, 7, 1)),
        num(ymd(2024, 1, 1)),
    ]]);
    let dates_without_bad = CellValue::from_rows(vec![vec![
        num(ymd(2023, 1, 1)),
        num(ymd(2023, 7, 1)),
        num(ymd(2024, 1, 1)),
    ]]);
    let vals_without_bad = CellValue::from_rows(vec![vec![num(-1000.0), num(500.0), num(600.0)]]);
    let r_bad = FnXirr.call(&[vals, dates_with_bad]);
    let r_clean = FnXirr.call(&[vals_without_bad, dates_without_bad]);
    match (&r_bad, &r_clean) {
        (CellValue::Number(a), CellValue::Number(b)) => {
            assert!(
                (a.get() - b.get()).abs() < 1e-10,
                "XIRR with bad text date ({}) should equal XIRR without it ({})",
                a.get(),
                b.get()
            );
        }
        _ => panic!("Expected numbers, got {:?} and {:?}", r_bad, r_clean),
    }
}
