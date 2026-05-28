use super::super::{FnCoupdaybs, FnCoupdays, FnCoupdaysnc, FnCoupncd, FnCoupnum, FnCouppcd};
use super::{approx, num, ymd_to_serial};
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_coupdays_semi_30_360() {
    // Semi-annual, basis=0 (30/360): 360/2 = 180 days
    let s = ymd_to_serial(2020, 3, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let r = FnCoupdays.call(&[num(s), num(m), num(2.0), num(0.0)]);
    assert!(
        approx(&r, 180.0, 0.01),
        "COUPDAYS semi 30/360 = {:?}, expected 180",
        r
    );
}

#[test]
fn test_coupdays_annual_30_360() {
    // Annual, basis=0: 360/1 = 360 days
    let s = ymd_to_serial(2020, 3, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let r = FnCoupdays.call(&[num(s), num(m), num(1.0), num(0.0)]);
    assert!(
        approx(&r, 360.0, 0.01),
        "COUPDAYS annual 30/360 = {:?}, expected 360",
        r
    );
}

#[test]
fn test_coupdays_quarterly_30_360() {
    // Quarterly, basis=0: 360/4 = 90 days
    let s = ymd_to_serial(2020, 3, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let r = FnCoupdays.call(&[num(s), num(m), num(4.0), num(0.0)]);
    assert!(
        approx(&r, 90.0, 0.01),
        "COUPDAYS quarterly 30/360 = {:?}, expected 90",
        r
    );
}

#[test]
fn test_coupdays_semi_actual_365() {
    // Semi-annual, basis=3 (actual/365): 365/2 = 182.5
    let s = ymd_to_serial(2020, 3, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let r = FnCoupdays.call(&[num(s), num(m), num(2.0), num(3.0)]);
    assert!(
        approx(&r, 182.5, 0.01),
        "COUPDAYS semi actual/365 = {:?}, expected 182.5",
        r
    );
}

#[test]
fn test_coupdays_error_settlement_ge_maturity() {
    let d = ymd_to_serial(2020, 1, 15);
    let r = FnCoupdays.call(&[num(d), num(d), num(2.0)]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_coupdaybs_mid_period() {
    // settlement=2020-03-15, maturity=2025-01-15, freq=2, basis=0
    // Prev coupon: 2020-01-15, days from Jan15 to Mar15 = 2*30 = 60
    let s = ymd_to_serial(2020, 3, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let r = FnCoupdaybs.call(&[num(s), num(m), num(2.0), num(0.0)]);
    assert!(approx(&r, 60.0, 0.01), "COUPDAYBS = {:?}, expected 60", r);
}

#[test]
fn test_coupdaybs_error_invalid_frequency() {
    let s = ymd_to_serial(2020, 3, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let r = FnCoupdaybs.call(&[num(s), num(m), num(5.0)]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_coupdaysnc_mid_period() {
    // settlement=2020-03-15, maturity=2025-01-15, freq=2, basis=0
    // Next coupon: 2020-07-15, days from Mar15 to Jul15 = 4*30 = 120
    let s = ymd_to_serial(2020, 3, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let r = FnCoupdaysnc.call(&[num(s), num(m), num(2.0), num(0.0)]);
    assert!(
        approx(&r, 120.0, 0.01),
        "COUPDAYSNC = {:?}, expected 120",
        r
    );
}

#[test]
fn test_coupdaybs_plus_coupdaysnc_equals_coupdays() {
    // COUPDAYBS + COUPDAYSNC should equal COUPDAYS
    let s = ymd_to_serial(2020, 3, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let daybs = FnCoupdaybs.call(&[num(s), num(m), num(2.0), num(0.0)]);
    let daysnc = FnCoupdaysnc.call(&[num(s), num(m), num(2.0), num(0.0)]);
    let days = FnCoupdays.call(&[num(s), num(m), num(2.0), num(0.0)]);
    match (&daybs, &daysnc, &days) {
        (CellValue::Number(bs), CellValue::Number(nc), CellValue::Number(d)) => {
            assert!(
                (bs.get() + nc.get() - d.get()).abs() < 0.01,
                "COUPDAYBS({}) + COUPDAYSNC({}) should = COUPDAYS({})",
                bs.get(),
                nc.get(),
                d.get()
            );
        }
        _ => panic!("Expected numbers"),
    }
}

#[test]
fn test_coupncd_semi() {
    // settlement=2020-03-15, maturity=2025-01-15, freq=2
    // Next coupon after Mar 15 with maturity Jan 15 => Jul 15, 2020
    let s = ymd_to_serial(2020, 3, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let expected = ymd_to_serial(2020, 7, 15);
    let r = FnCoupncd.call(&[num(s), num(m), num(2.0)]);
    assert!(
        approx(&r, expected, 1.0),
        "COUPNCD = {:?}, expected {}",
        r,
        expected
    );
}

#[test]
fn test_couppcd_semi() {
    // settlement=2020-03-15, maturity=2025-01-15, freq=2
    // Previous coupon on or before Mar 15 => Jan 15, 2020
    let s = ymd_to_serial(2020, 3, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let expected = ymd_to_serial(2020, 1, 15);
    let r = FnCouppcd.call(&[num(s), num(m), num(2.0)]);
    assert!(
        approx(&r, expected, 1.0),
        "COUPPCD = {:?}, expected {}",
        r,
        expected
    );
}

#[test]
fn test_coupnum_semi_10yr() {
    // settlement=2020-01-15, maturity=2025-01-15, freq=2
    // 5 years * 2 = 10 coupons remaining
    let s = ymd_to_serial(2020, 1, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let r = FnCoupnum.call(&[num(s), num(m), num(2.0)]);
    assert!(approx(&r, 10.0, 0.01), "COUPNUM = {:?}, expected 10", r);
}

#[test]
fn test_coupnum_annual() {
    // settlement=2020-03-15, maturity=2025-01-15, freq=1
    // Next: Jan 2021, then Jan 2022, ..., Jan 2025 => 5 coupons
    let s = ymd_to_serial(2020, 3, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let r = FnCoupnum.call(&[num(s), num(m), num(1.0)]);
    assert!(
        approx(&r, 5.0, 0.01),
        "COUPNUM annual = {:?}, expected 5",
        r
    );
}

#[test]
fn test_coupnum_quarterly() {
    // settlement=2024-01-15, maturity=2025-01-15, freq=4
    // 1 year * 4 = 4 coupons
    let s = ymd_to_serial(2024, 1, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let r = FnCoupnum.call(&[num(s), num(m), num(4.0)]);
    assert!(
        approx(&r, 4.0, 0.01),
        "COUPNUM quarterly = {:?}, expected 4",
        r
    );
}

#[test]
fn test_coupnum_error_settlement_ge_maturity() {
    let d = ymd_to_serial(2025, 1, 15);
    let r = FnCoupnum.call(&[num(d), num(d), num(2.0)]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}
