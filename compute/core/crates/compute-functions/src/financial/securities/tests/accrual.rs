use super::super::{FnAccrint, FnAccrintm};
use super::{approx, num, ymd_to_serial};
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_accrint_basic() {
    // ACCRINT(issue=2020-01-01, first_interest=2020-07-01, settlement=2020-04-01,
    //         rate=0.10, par=1000, frequency=2, basis=0)
    let issue = ymd_to_serial(2020, 1, 1);
    let first_int = ymd_to_serial(2020, 7, 1);
    let settlement = ymd_to_serial(2020, 4, 1);
    let r = FnAccrint.call(&[
        num(issue),
        num(first_int),
        num(settlement),
        num(0.10),
        num(1000.0),
        num(2.0),
    ]);
    match &r {
        CellValue::Number(n) => {
            // 3 months (90 days in 30/360) of interest at 10% on 1000
            // 1000 * 0.10 * 90/360 = 25.0
            assert!(
                (n.get() - 25.0).abs() < 1.0,
                "ACCRINT = {}, expected ~25.0",
                n.get()
            );
        }
        _ => panic!("Expected number, got {:?}", r),
    }
}

#[test]
fn test_accrintm_basic() {
    // ACCRINTM(issue=2020-01-01, settlement=2020-04-01, rate=0.10, par=1000, basis=0)
    let issue = ymd_to_serial(2020, 1, 1);
    let settlement = ymd_to_serial(2020, 4, 1);
    let r = FnAccrintm.call(&[
        num(issue),
        num(settlement),
        num(0.10),
        num(1000.0),
        num(0.0),
    ]);
    assert!(approx(&r, 25.0, 1.0), "ACCRINTM = {:?}, expected ~25.0", r);
}

#[test]
fn test_accrint_annual_30_360_half_year() {
    // Issue=2020-01-01, settlement=2020-07-01, rate=0.10, par=1000, freq=1, basis=0
    // 30/360: Jan1 to Jul1 = 6*30 = 180 days, year=360
    // accrint = 1000 * 0.10 * 180/360 = 50.0
    let issue = ymd_to_serial(2020, 1, 1);
    let first_int = ymd_to_serial(2021, 1, 1);
    let settlement = ymd_to_serial(2020, 7, 1);
    let r = FnAccrint.call(&[
        num(issue),
        num(first_int),
        num(settlement),
        num(0.10),
        num(1000.0),
        num(1.0),
        num(0.0),
    ]);
    assert!(
        approx(&r, 50.0, 0.01),
        "ACCRINT annual half-year = {:?}, expected 50.0",
        r
    );
}

#[test]
fn test_accrint_semiannual_30_360_quarter() {
    // Issue=2020-01-01, settlement=2020-04-01, rate=0.10, par=1000, freq=2, basis=0
    // 30/360: Jan1 to Apr1 = 3*30 = 90 days, year=360
    // accrint = 1000 * 0.10 * 90/360 = 25.0
    let issue = ymd_to_serial(2020, 1, 1);
    let first_int = ymd_to_serial(2020, 7, 1);
    let settlement = ymd_to_serial(2020, 4, 1);
    let r = FnAccrint.call(&[
        num(issue),
        num(first_int),
        num(settlement),
        num(0.10),
        num(1000.0),
        num(2.0),
        num(0.0),
    ]);
    assert!(
        approx(&r, 25.0, 0.01),
        "ACCRINT semi quarter = {:?}, expected 25.0",
        r
    );
}

#[test]
fn test_accrint_quarterly_frequency() {
    // freq=4, basis=0, Issue=2020-01-01, settlement=2020-07-01
    // 30/360: 180 days, accrint = 1000 * 0.08 * 180/360 = 40.0
    let issue = ymd_to_serial(2020, 1, 1);
    let first_int = ymd_to_serial(2020, 4, 1);
    let settlement = ymd_to_serial(2020, 7, 1);
    let r = FnAccrint.call(&[
        num(issue),
        num(first_int),
        num(settlement),
        num(0.08),
        num(1000.0),
        num(4.0),
        num(0.0),
    ]);
    assert!(
        approx(&r, 40.0, 0.01),
        "ACCRINT quarterly = {:?}, expected 40.0",
        r
    );
}

#[test]
fn test_accrint_basis3_actual_365() {
    // basis=3 (actual/365), Issue=2020-01-01, settlement=2020-07-01
    // Actual days from Jan1 to Jul1 in 2020 = 182 days (leap year)
    // accrint = 1000 * 0.10 * 182/365 = 49.8630...
    let issue = ymd_to_serial(2020, 1, 1);
    let first_int = ymd_to_serial(2021, 1, 1);
    let settlement = ymd_to_serial(2020, 7, 1);
    let r = FnAccrint.call(&[
        num(issue),
        num(first_int),
        num(settlement),
        num(0.10),
        num(1000.0),
        num(1.0),
        num(3.0),
    ]);
    let expected = 1000.0 * 0.10 * 182.0 / 365.0;
    assert!(
        approx(&r, expected, 0.01),
        "ACCRINT basis3 = {:?}, expected {}",
        r,
        expected
    );
}

#[test]
fn test_accrint_error_issue_ge_settlement() {
    let d = ymd_to_serial(2020, 7, 1);
    let r = FnAccrint.call(&[
        num(d),
        num(d + 180.0),
        num(d),
        num(0.05),
        num(1000.0),
        num(2.0),
    ]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_accrint_error_negative_rate() {
    let issue = ymd_to_serial(2020, 1, 1);
    let r = FnAccrint.call(&[
        num(issue),
        num(issue + 180.0),
        num(issue + 90.0),
        num(-0.05),
        num(1000.0),
        num(2.0),
    ]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_accrint_error_zero_rate() {
    let issue = ymd_to_serial(2020, 1, 1);
    let r = FnAccrint.call(&[
        num(issue),
        num(issue + 180.0),
        num(issue + 90.0),
        num(0.0),
        num(1000.0),
        num(2.0),
    ]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_accrint_error_invalid_frequency() {
    let issue = ymd_to_serial(2020, 1, 1);
    let r = FnAccrint.call(&[
        num(issue),
        num(issue + 180.0),
        num(issue + 90.0),
        num(0.05),
        num(1000.0),
        num(3.0),
    ]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_accrint_error_invalid_basis() {
    let issue = ymd_to_serial(2020, 1, 1);
    let r = FnAccrint.call(&[
        num(issue),
        num(issue + 180.0),
        num(issue + 90.0),
        num(0.05),
        num(1000.0),
        num(2.0),
        num(5.0),
    ]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_accrint_calc_from_issue_false() {
    // When calc_from_issue=FALSE, accrual starts from first_interest
    // issue=2020-01-01, first_interest=2020-04-01, settlement=2020-07-01
    // With calc_from_issue=FALSE: days from Apr1 to Jul1 = 90 (30/360)
    // accrint = 1000 * 0.10 * 90/360 = 25.0
    let issue = ymd_to_serial(2020, 1, 1);
    let first_int = ymd_to_serial(2020, 4, 1);
    let settlement = ymd_to_serial(2020, 7, 1);
    let r = FnAccrint.call(&[
        num(issue),
        num(first_int),
        num(settlement),
        num(0.10),
        num(1000.0),
        num(2.0),
        num(0.0),
        CellValue::Boolean(false),
    ]);
    assert!(
        approx(&r, 25.0, 0.01),
        "ACCRINT from first_interest = {:?}, expected 25.0",
        r
    );
}

#[test]
fn test_accrintm_30_360() {
    // issue=2020-01-01, settlement=2020-07-01, rate=0.10, par=1000, basis=0
    // 30/360: 180 days, accrintm = 1000 * 0.10 * 180/360 = 50.0
    let issue = ymd_to_serial(2020, 1, 1);
    let settlement = ymd_to_serial(2020, 7, 1);
    let r = FnAccrintm.call(&[
        num(issue),
        num(settlement),
        num(0.10),
        num(1000.0),
        num(0.0),
    ]);
    assert!(
        approx(&r, 50.0, 0.01),
        "ACCRINTM 30/360 = {:?}, expected 50.0",
        r
    );
}

#[test]
fn test_accrintm_actual_365() {
    // basis=3, issue=2020-01-01, settlement=2020-07-01
    // actual days = 182 (leap year 2020), accrintm = 1000 * 0.05 * 182/365
    let issue = ymd_to_serial(2020, 1, 1);
    let settlement = ymd_to_serial(2020, 7, 1);
    let expected = 1000.0 * 0.05 * 182.0 / 365.0;
    let r = FnAccrintm.call(&[
        num(issue),
        num(settlement),
        num(0.05),
        num(1000.0),
        num(3.0),
    ]);
    assert!(
        approx(&r, expected, 0.01),
        "ACCRINTM actual/365 = {:?}, expected {}",
        r,
        expected
    );
}

#[test]
fn test_accrintm_error_issue_ge_settlement() {
    let d = ymd_to_serial(2020, 7, 1);
    let r = FnAccrintm.call(&[num(d), num(d), num(0.05), num(1000.0)]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_accrintm_error_negative_rate() {
    let issue = ymd_to_serial(2020, 1, 1);
    let settlement = ymd_to_serial(2020, 7, 1);
    let r = FnAccrintm.call(&[num(issue), num(settlement), num(-0.05), num(1000.0)]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_accrintm_error_negative_par() {
    let issue = ymd_to_serial(2020, 1, 1);
    let settlement = ymd_to_serial(2020, 7, 1);
    let r = FnAccrintm.call(&[num(issue), num(settlement), num(0.05), num(-1000.0)]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_accrintm_error_invalid_basis() {
    let issue = ymd_to_serial(2020, 1, 1);
    let settlement = ymd_to_serial(2020, 7, 1);
    let r = FnAccrintm.call(&[
        num(issue),
        num(settlement),
        num(0.05),
        num(1000.0),
        num(5.0),
    ]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}
