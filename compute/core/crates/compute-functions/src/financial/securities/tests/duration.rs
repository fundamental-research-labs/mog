use super::super::{FnDuration, FnMduration};
use super::{approx, num, ymd_to_serial};
use crate::{FunctionContext, PureFunction};
use value_types::{CellError, CellValue};

#[test]
fn test_duration_excel_example() {
    // Excel: settlement=2008-01-01, maturity=2016-01-01, coupon=8%, yield=9%, freq=2
    // Expected: ~5.9937
    let s = ymd_to_serial(2008, 1, 1);
    let m = ymd_to_serial(2016, 1, 1);
    let r = FnDuration.call(&[num(s), num(m), num(0.08), num(0.09), num(2.0), num(0.0)]);
    assert!(
        approx(&r, 5.9937, 0.05),
        "DURATION Excel = {:?}, expected ~5.9937",
        r
    );
}

#[test]
fn test_duration_higher_coupon_lower_duration() {
    // Higher coupon => lower duration (more weight on earlier payments)
    let s = ymd_to_serial(2020, 1, 1);
    let m = ymd_to_serial(2030, 1, 1);
    let dur_low = FnDuration.call(&[num(s), num(m), num(0.02), num(0.05), num(2.0), num(0.0)]);
    let dur_high = FnDuration.call(&[num(s), num(m), num(0.10), num(0.05), num(2.0), num(0.0)]);
    match (&dur_low, &dur_high) {
        (CellValue::Number(lo), CellValue::Number(hi)) => {
            assert!(
                lo.get() > hi.get(),
                "Low coupon duration {} should > high coupon duration {}",
                lo.get(),
                hi.get()
            );
        }
        _ => panic!("Expected numbers, got {:?} and {:?}", dur_low, dur_high),
    }
}

#[test]
fn test_duration_error_settlement_ge_maturity() {
    let d = ymd_to_serial(2020, 1, 1);
    let r = FnDuration.call(&[num(d), num(d), num(0.05), num(0.05), num(2.0)]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_duration_error_negative_coupon() {
    let s = ymd_to_serial(2020, 1, 1);
    let m = ymd_to_serial(2025, 1, 1);
    let r = FnDuration.call(&[num(s), num(m), num(-0.05), num(0.05), num(2.0)]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_duration_error_negative_yield() {
    let s = ymd_to_serial(2020, 1, 1);
    let m = ymd_to_serial(2025, 1, 1);
    let r = FnDuration.call(&[num(s), num(m), num(0.05), num(-0.05), num(2.0)]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_duration_error_invalid_frequency() {
    let s = ymd_to_serial(2020, 1, 1);
    let m = ymd_to_serial(2025, 1, 1);
    let r = FnDuration.call(&[num(s), num(m), num(0.05), num(0.05), num(3.0)]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_mduration_less_than_duration() {
    // MDURATION = DURATION / (1 + yield/freq) < DURATION always
    let s = ymd_to_serial(2020, 1, 1);
    let m = ymd_to_serial(2030, 1, 1);
    let args = [num(s), num(m), num(0.06), num(0.05), num(2.0), num(0.0)];
    let dur = FnDuration.call(&args);
    let mdur = FnMduration.call(&args);
    match (&dur, &mdur) {
        (CellValue::Number(d), CellValue::Number(md)) => {
            assert!(
                md.get() < d.get(),
                "MDURATION {} should be < DURATION {}",
                md.get(),
                d.get()
            );
        }
        _ => panic!("Expected numbers, got dur={:?}, mdur={:?}", dur, mdur),
    }
}

#[test]
fn test_mduration_formula_relationship() {
    // MDURATION = DURATION / (1 + yield/freq)
    let s = ymd_to_serial(2008, 1, 1);
    let m = ymd_to_serial(2016, 1, 1);
    let yld = 0.09;
    let freq = 2.0;
    let args = [num(s), num(m), num(0.08), num(yld), num(freq), num(0.0)];
    let dur = FnDuration.call(&args);
    let mdur = FnMduration.call(&args);
    match (&dur, &mdur) {
        (CellValue::Number(d), CellValue::Number(md)) => {
            let expected_md = d.get() / (1.0 + yld / freq);
            assert!(
                (md.get() - expected_md).abs() < 1e-6,
                "MDURATION {} should = DURATION/(1+y/f) = {}",
                md.get(),
                expected_md
            );
        }
        _ => panic!("Expected numbers"),
    }
}

#[test]
fn duration_functions_are_date_system_invariant() {
    let settlement = ymd_to_serial(2020, 1, 1);
    let maturity = ymd_to_serial(2030, 1, 1);
    let offset = value_types::DateSystem::DATE_SYSTEM_1904_OFFSET;
    let context = FunctionContext {
        date1904: true,
        ..FunctionContext::default()
    };
    let args_1900 = [
        num(settlement),
        num(maturity),
        num(0.08),
        num(0.09),
        num(2.0),
        num(1.0),
    ];
    let args_1904 = [
        num(settlement - offset),
        num(maturity - offset),
        num(0.08),
        num(0.09),
        num(2.0),
        num(1.0),
    ];
    let duration_1900 = FnDuration.call(&args_1900);
    let duration_1904 = FnDuration.call_with_context(&args_1904, &context);
    let mduration_1900 = FnMduration.call(&args_1900);
    let mduration_1904 = FnMduration.call_with_context(&args_1904, &context);
    match (duration_1900, duration_1904, mduration_1900, mduration_1904) {
        (
            CellValue::Number(duration_1900),
            CellValue::Number(duration_1904),
            CellValue::Number(mduration_1900),
            CellValue::Number(mduration_1904),
        ) => {
            assert!((duration_1900.get() - duration_1904.get()).abs() < 1e-10);
            assert!((mduration_1900.get() - mduration_1904.get()).abs() < 1e-10);
        }
        other => panic!("Expected numeric duration results, got {other:?}"),
    }
}

#[test]
fn test_mduration_error_propagates() {
    // Invalid args should propagate error from DURATION
    let d = ymd_to_serial(2020, 1, 1);
    let r = FnMduration.call(&[num(d), num(d), num(0.05), num(0.05), num(2.0)]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}
