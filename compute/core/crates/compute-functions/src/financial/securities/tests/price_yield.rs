use super::super::{FnPrice, FnYield};
use super::{approx, num, ymd_to_serial};
use crate::PureFunction;
use value_types::{CellError, CellValue};

#[test]
fn test_price_basic() {
    // PRICE(settlement=2023-01-15, maturity=2033-01-15, rate=0.05, yield=0.05,
    //       redemption=100, frequency=2, basis=0)
    // When coupon rate = yield, price should be ~100
    let settlement = ymd_to_serial(2023, 1, 15);
    let maturity = ymd_to_serial(2033, 1, 15);
    let r = FnPrice.call(&[
        num(settlement),
        num(maturity),
        num(0.05),
        num(0.05),
        num(100.0),
        num(2.0),
        num(0.0),
    ]);
    match &r {
        CellValue::Number(n) => {
            assert!(
                (n.get() - 100.0).abs() < 1.0,
                "PRICE with rate=yield should be ~100, got {}",
                n.get()
            );
        }
        _ => panic!("Expected number, got {:?}", r),
    }
}

#[test]
fn test_price_premium() {
    // When coupon rate > yield, price should be > 100 (premium)
    let settlement = ymd_to_serial(2023, 1, 15);
    let maturity = ymd_to_serial(2033, 1, 15);
    let r = FnPrice.call(&[
        num(settlement),
        num(maturity),
        num(0.08),
        num(0.05),
        num(100.0),
        num(2.0),
        num(0.0),
    ]);
    match &r {
        CellValue::Number(n) => {
            assert!(
                n.get() > 100.0,
                "PRICE with rate>yield should be premium, got {}",
                n.get()
            );
        }
        _ => panic!("Expected number, got {:?}", r),
    }
}

#[test]
fn test_yield_basic() {
    // YIELD should return ~0.05 when price is 100 and coupon is 5%
    let settlement = ymd_to_serial(2023, 1, 15);
    let maturity = ymd_to_serial(2033, 1, 15);
    let r = FnYield.call(&[
        num(settlement),
        num(maturity),
        num(0.05),
        num(100.0),
        num(100.0),
        num(2.0),
        num(0.0),
    ]);
    match &r {
        CellValue::Number(n) => {
            assert!(
                (n.get() - 0.05).abs() < 0.01,
                "YIELD with price=100 and rate=0.05 should be ~0.05, got {}",
                n.get()
            );
        }
        _ => panic!("Expected number, got {:?}", r),
    }
}

#[test]
fn test_price_excel_example() {
    // Excel example: settlement=2008-02-15, maturity=2017-11-15,
    // rate=5.75%, yield=6.5%, redemption=100, freq=2, basis=0
    // Expected: ~94.634
    let settlement = ymd_to_serial(2008, 2, 15);
    let maturity = ymd_to_serial(2017, 11, 15);
    let r = FnPrice.call(&[
        num(settlement),
        num(maturity),
        num(0.0575),
        num(0.065),
        num(100.0),
        num(2.0),
        num(0.0),
    ]);
    assert!(
        approx(&r, 94.634, 0.1),
        "PRICE Excel example = {:?}, expected ~94.634",
        r
    );
}

#[test]
fn test_price_par_bond() {
    // When rate == yield on a coupon date, price should be exactly 100
    let settlement = ymd_to_serial(2020, 1, 15);
    let maturity = ymd_to_serial(2030, 1, 15);
    let r = FnPrice.call(&[
        num(settlement),
        num(maturity),
        num(0.06),
        num(0.06),
        num(100.0),
        num(2.0),
        num(0.0),
    ]);
    assert!(
        approx(&r, 100.0, 0.5),
        "PRICE par bond = {:?}, expected ~100",
        r
    );
}

#[test]
fn test_price_discount_bond() {
    // rate < yield => discount => price < 100
    let settlement = ymd_to_serial(2020, 1, 15);
    let maturity = ymd_to_serial(2030, 1, 15);
    let r = FnPrice.call(&[
        num(settlement),
        num(maturity),
        num(0.04),
        num(0.06),
        num(100.0),
        num(2.0),
        num(0.0),
    ]);
    match &r {
        CellValue::Number(n) => assert!(
            n.get() < 100.0,
            "Discount bond price {} should be < 100",
            n.get()
        ),
        _ => panic!("Expected number, got {:?}", r),
    }
}

#[test]
fn test_price_zero_coupon() {
    // rate=0, yield=0.05, redemption=100, freq=2, basis=0
    // Pure discount: price = 100 / (1.05/2)^(n*dsc_frac...) < 100
    let settlement = ymd_to_serial(2020, 1, 15);
    let maturity = ymd_to_serial(2025, 1, 15);
    let r = FnPrice.call(&[
        num(settlement),
        num(maturity),
        num(0.0),
        num(0.05),
        num(100.0),
        num(2.0),
        num(0.0),
    ]);
    match &r {
        CellValue::Number(n) => {
            assert!(
                n.get() < 100.0 && n.get() > 50.0,
                "Zero coupon 5yr at 5% yield = {}, expected ~78",
                n.get()
            );
        }
        _ => panic!("Expected number, got {:?}", r),
    }
}

#[test]
fn test_price_error_settlement_ge_maturity() {
    let d = ymd_to_serial(2020, 1, 15);
    let r = FnPrice.call(&[num(d), num(d), num(0.05), num(0.05), num(100.0), num(2.0)]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_price_error_negative_rate() {
    let s = ymd_to_serial(2020, 1, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let r = FnPrice.call(&[num(s), num(m), num(-0.05), num(0.05), num(100.0), num(2.0)]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_price_error_negative_yield() {
    let s = ymd_to_serial(2020, 1, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let r = FnPrice.call(&[num(s), num(m), num(0.05), num(-0.05), num(100.0), num(2.0)]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_price_error_invalid_frequency() {
    let s = ymd_to_serial(2020, 1, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let r = FnPrice.call(&[num(s), num(m), num(0.05), num(0.05), num(100.0), num(3.0)]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_price_annual_frequency() {
    // freq=1, par bond
    let s = ymd_to_serial(2020, 1, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let r = FnPrice.call(&[
        num(s),
        num(m),
        num(0.05),
        num(0.05),
        num(100.0),
        num(1.0),
        num(0.0),
    ]);
    assert!(
        approx(&r, 100.0, 0.5),
        "PRICE annual par = {:?}, expected ~100",
        r
    );
}

#[test]
fn test_yield_at_par() {
    // At par (price=100), yield should equal coupon rate
    let s = ymd_to_serial(2020, 1, 15);
    let m = ymd_to_serial(2030, 1, 15);
    let r = FnYield.call(&[
        num(s),
        num(m),
        num(0.06),
        num(100.0),
        num(100.0),
        num(2.0),
        num(0.0),
    ]);
    assert!(
        approx(&r, 0.06, 0.005),
        "YIELD at par = {:?}, expected ~0.06",
        r
    );
}

#[test]
fn test_yield_price_roundtrip() {
    // YIELD(s,m,rate,PRICE(s,m,rate,y,100,2,0),100,2,0) should ≈ y
    let s = ymd_to_serial(2020, 1, 15);
    let m = ymd_to_serial(2030, 1, 15);
    let target_yield = 0.08;
    let price = FnPrice.call(&[
        num(s),
        num(m),
        num(0.05),
        num(target_yield),
        num(100.0),
        num(2.0),
        num(0.0),
    ]);
    match &price {
        CellValue::Number(p) => {
            let recovered_yield = FnYield.call(&[
                num(s),
                num(m),
                num(0.05),
                num(p.get()),
                num(100.0),
                num(2.0),
                num(0.0),
            ]);
            assert!(
                approx(&recovered_yield, target_yield, 0.001),
                "YIELD roundtrip = {:?}, expected {}",
                recovered_yield,
                target_yield
            );
        }
        _ => panic!("PRICE failed: {:?}", price),
    }
}

#[test]
fn test_yield_error_settlement_ge_maturity() {
    let d = ymd_to_serial(2020, 1, 15);
    let r = FnYield.call(&[num(d), num(d), num(0.05), num(100.0), num(100.0), num(2.0)]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_yield_error_negative_rate() {
    let s = ymd_to_serial(2020, 1, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let r = FnYield.call(&[num(s), num(m), num(-0.05), num(100.0), num(100.0), num(2.0)]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_yield_error_zero_price() {
    let s = ymd_to_serial(2020, 1, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let r = FnYield.call(&[num(s), num(m), num(0.05), num(0.0), num(100.0), num(2.0)]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}

#[test]
fn test_yield_error_invalid_basis() {
    let s = ymd_to_serial(2020, 1, 15);
    let m = ymd_to_serial(2025, 1, 15);
    let r = FnYield.call(&[
        num(s),
        num(m),
        num(0.05),
        num(100.0),
        num(100.0),
        num(2.0),
        num(5.0),
    ]);
    assert!(matches!(r, CellValue::Error(CellError::Num, _)));
}
