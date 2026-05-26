//! Treasury Bills: TBILLPRICE, TBILLYIELD, TBILLEQ

use value_types::{CellError, CellValue};

use super::helpers::{actual_days_between, err_val, num_or_err_msg, req_num};
use crate::{FunctionRegistry, PureFunction};

// ===========================================================================
// TBILLPRICE
// ===========================================================================

pub(super) struct FnTbillprice;
impl PureFunction for FnTbillprice {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TBILLPRICE"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let discount = req_num(args, 2).map_err(err_val)?;
            if settlement >= maturity {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "TBILLPRICE: settlement must be before maturity",
                ));
            }
            if discount <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("TBILLPRICE: discount must be > 0, got {discount}"),
                ));
            }
            let days = actual_days_between(settlement, maturity);
            if days > 360.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("TBILLPRICE: days to maturity must be <= 360, got {days}"),
                ));
            }
            Ok(100.0 * (1.0 - discount * days / 360.0))
        })())
    }
}

// ===========================================================================
// TBILLYIELD
// ===========================================================================

pub(super) struct FnTbillyield;
impl PureFunction for FnTbillyield {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TBILLYIELD"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let pr = req_num(args, 2).map_err(err_val)?;
            if settlement >= maturity {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "TBILLYIELD: settlement must be before maturity",
                ));
            }
            if pr <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("TBILLYIELD: price must be > 0, got {pr}"),
                ));
            }
            let days = actual_days_between(settlement, maturity);
            if days > 360.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("TBILLYIELD: days to maturity must be <= 360, got {days}"),
                ));
            }
            Ok(((100.0 - pr) / pr) * (360.0 / days))
        })())
    }
}

// ===========================================================================
// TBILLEQ
// ===========================================================================

pub(super) struct FnTbilleq;
impl PureFunction for FnTbilleq {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TBILLEQ"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let discount = req_num(args, 2).map_err(err_val)?;
            if settlement >= maturity {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "TBILLEQ: settlement must be before maturity",
                ));
            }
            if discount <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("TBILLEQ: discount must be > 0, got {discount}"),
                ));
            }
            let days = actual_days_between(settlement, maturity);
            if days > 360.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("TBILLEQ: days to maturity must be <= 360, got {days}"),
                ));
            }
            let price = 100.0 * (1.0 - discount * days / 360.0);
            Ok(((100.0 - price) / price) * (365.0 / days))
        })())
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnTbilleq));
    registry.register(Box::new(FnTbillprice));
    registry.register(Box::new(FnTbillyield));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PureFunction;
    use value_types::{CellError, CellValue};

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }

    fn extract_num(v: &CellValue) -> f64 {
        match v {
            CellValue::Number(n) => n.get(),
            other => panic!("expected Number, got {:?}", other),
        }
    }

    fn assert_approx(v: &CellValue, expected: f64, tol: f64) {
        let got = extract_num(v);
        assert!(
            (got - expected).abs() < tol,
            "expected {expected} +/- {tol}, got {got}"
        );
    }

    fn assert_is_num_error(v: &CellValue) {
        assert!(
            matches!(v, CellValue::Error(CellError::Num, _)),
            "expected #NUM!, got {:?}",
            v
        );
    }

    // Excel serial dates used in tests:
    // 2008-03-31 = 39538, 2008-06-01 = 39600 (DSM = 62)
    const SETTLE_2008: f64 = 39538.0;
    const MATURE_2008: f64 = 39600.0;
    const DSM_2008: f64 = 62.0;
    const DISCOUNT_2008: f64 = 0.0914;

    // Arbitrary base serial for synthetic tests
    const BASE: f64 = 44927.0;

    // ===================================================================
    // TBILLPRICE — Formula: price = 100 * (1 - discount * DSM / 360)
    // ===================================================================

    #[test]
    fn tbillprice_basic_90_day() {
        // DSM=90, discount=5%
        // price = 100 * (1 - 0.05 * 90/360) = 100 * 0.9875 = 98.75
        let r = FnTbillprice.call(&[num(BASE), num(BASE + 90.0), num(0.05)]);
        assert_approx(&r, 98.75, 1e-9);
    }

    #[test]
    fn tbillprice_excel_example() {
        // settlement=39538, maturity=39600, discount=9.14%, DSM=62
        // price = 100 * (1 - 0.0914 * 62/360) = 100 * (1 - 0.01574111) = 98.42588889
        let expected = 100.0 * (1.0 - DISCOUNT_2008 * DSM_2008 / 360.0);
        let r = FnTbillprice.call(&[num(SETTLE_2008), num(MATURE_2008), num(DISCOUNT_2008)]);
        assert_approx(&r, expected, 1e-9);
    }

    #[test]
    fn tbillprice_180_day() {
        // DSM=180, discount=10%
        // price = 100 * (1 - 0.10 * 180/360) = 100 * 0.95 = 95.0
        let r = FnTbillprice.call(&[num(BASE), num(BASE + 180.0), num(0.10)]);
        assert_approx(&r, 95.0, 1e-9);
    }

    #[test]
    fn tbillprice_360_day() {
        // DSM=360, discount=8%
        // price = 100 * (1 - 0.08 * 360/360) = 100 * 0.92 = 92.0
        let r = FnTbillprice.call(&[num(BASE), num(BASE + 360.0), num(0.08)]);
        assert_approx(&r, 92.0, 1e-9);
    }

    #[test]
    fn tbillprice_1_day() {
        // DSM=1, discount=3.6%
        // price = 100 * (1 - 0.036 * 1/360) = 100 * (1 - 0.0001) = 99.99
        let expected = 100.0 * (1.0 - 0.036 / 360.0);
        let r = FnTbillprice.call(&[num(BASE), num(BASE + 1.0), num(0.036)]);
        assert_approx(&r, expected, 1e-9);
    }

    #[test]
    fn tbillprice_very_small_discount() {
        // DSM=90, discount=0.001 (0.1%)
        // price = 100 * (1 - 0.001 * 90/360) = 100 * (1 - 0.00025) = 99.975
        let r = FnTbillprice.call(&[num(BASE), num(BASE + 90.0), num(0.001)]);
        assert_approx(&r, 99.975, 1e-9);
    }

    #[test]
    fn tbillprice_high_discount() {
        // DSM=90, discount=0.99
        // price = 100 * (1 - 0.99 * 90/360) = 100 * (1 - 0.2475) = 75.25
        let r = FnTbillprice.call(&[num(BASE), num(BASE + 90.0), num(0.99)]);
        assert_approx(&r, 75.25, 1e-9);
    }

    // Error cases for TBILLPRICE

    #[test]
    fn tbillprice_error_settlement_equals_maturity() {
        let r = FnTbillprice.call(&[num(BASE), num(BASE), num(0.05)]);
        assert_is_num_error(&r);
    }

    #[test]
    fn tbillprice_error_settlement_after_maturity() {
        let r = FnTbillprice.call(&[num(BASE + 10.0), num(BASE), num(0.05)]);
        assert_is_num_error(&r);
    }

    #[test]
    fn tbillprice_error_discount_zero() {
        let r = FnTbillprice.call(&[num(BASE), num(BASE + 90.0), num(0.0)]);
        assert_is_num_error(&r);
    }

    #[test]
    fn tbillprice_error_discount_negative() {
        let r = FnTbillprice.call(&[num(BASE), num(BASE + 90.0), num(-0.05)]);
        assert_is_num_error(&r);
    }

    #[test]
    fn tbillprice_error_dsm_over_limit() {
        // DSM > 360 should error (code uses 360 threshold)
        let r = FnTbillprice.call(&[num(BASE), num(BASE + 361.0), num(0.05)]);
        assert_is_num_error(&r);
    }

    // ===================================================================
    // TBILLYIELD — Formula: yield = ((100 - price) / price) * (360 / DSM)
    // ===================================================================

    #[test]
    fn tbillyield_basic_90_day() {
        // DSM=90, price=98.75
        // yield = ((100 - 98.75) / 98.75) * (360 / 90)
        //       = (1.25 / 98.75) * 4.0 = 0.0126582... * 4 = 0.0506329...
        let expected = (1.25 / 98.75) * 4.0;
        let r = FnTbillyield.call(&[num(BASE), num(BASE + 90.0), num(98.75)]);
        assert_approx(&r, expected, 1e-9);
    }

    #[test]
    fn tbillyield_excel_example() {
        // settlement=39538, maturity=39600, price=98.45, DSM=62
        // yield = ((100 - 98.45) / 98.45) * (360 / 62)
        let price = 98.45;
        let expected = ((100.0 - price) / price) * (360.0 / DSM_2008);
        let r = FnTbillyield.call(&[num(SETTLE_2008), num(MATURE_2008), num(price)]);
        assert_approx(&r, expected, 1e-9);
        // Should be approximately 0.09141
        assert_approx(&r, 0.09141, 1e-3);
    }

    #[test]
    fn tbillyield_roundtrip_with_tbillprice() {
        // Compute price from discount, then yield from that price.
        // For DSM=90, discount=0.05:
        //   price = 100 * (1 - 0.05 * 90/360) = 98.75
        //   yield = ((100 - 98.75) / 98.75) * (360/90) = 0.050633
        // Note: yield != discount because yield is on price basis (money-market yield)
        let price_val = FnTbillprice.call(&[num(BASE), num(BASE + 90.0), num(0.05)]);
        let price = extract_num(&price_val);
        let yield_val = FnTbillyield.call(&[num(BASE), num(BASE + 90.0), num(price)]);
        let expected = ((100.0 - price) / price) * (360.0 / 90.0);
        assert_approx(&yield_val, expected, 1e-9);
    }

    #[test]
    fn tbillyield_180_day() {
        // DSM=180, price=95.0
        // yield = (5.0 / 95.0) * (360 / 180) = 0.0526316 * 2 = 0.1052632
        let expected = (5.0 / 95.0) * 2.0;
        let r = FnTbillyield.call(&[num(BASE), num(BASE + 180.0), num(95.0)]);
        assert_approx(&r, expected, 1e-9);
    }

    #[test]
    fn tbillyield_price_near_100() {
        // DSM=90, price=99.99
        // yield = (0.01 / 99.99) * (360 / 90) = 0.00040004
        let expected = (0.01 / 99.99) * 4.0;
        let r = FnTbillyield.call(&[num(BASE), num(BASE + 90.0), num(99.99)]);
        assert_approx(&r, expected, 1e-9);
    }

    #[test]
    fn tbillyield_low_price() {
        // DSM=90, price=50.0
        // yield = (50.0 / 50.0) * (360 / 90) = 1.0 * 4.0 = 4.0
        let r = FnTbillyield.call(&[num(BASE), num(BASE + 90.0), num(50.0)]);
        assert_approx(&r, 4.0, 1e-9);
    }

    // Error cases for TBILLYIELD

    #[test]
    fn tbillyield_error_settlement_equals_maturity() {
        let r = FnTbillyield.call(&[num(BASE), num(BASE), num(98.0)]);
        assert_is_num_error(&r);
    }

    #[test]
    fn tbillyield_error_settlement_after_maturity() {
        let r = FnTbillyield.call(&[num(BASE + 5.0), num(BASE), num(98.0)]);
        assert_is_num_error(&r);
    }

    #[test]
    fn tbillyield_error_price_zero() {
        let r = FnTbillyield.call(&[num(BASE), num(BASE + 90.0), num(0.0)]);
        assert_is_num_error(&r);
    }

    #[test]
    fn tbillyield_error_price_negative() {
        let r = FnTbillyield.call(&[num(BASE), num(BASE + 90.0), num(-5.0)]);
        assert_is_num_error(&r);
    }

    #[test]
    fn tbillyield_error_dsm_over_limit() {
        let r = FnTbillyield.call(&[num(BASE), num(BASE + 361.0), num(98.0)]);
        assert_is_num_error(&r);
    }

    // ===================================================================
    // TBILLEQ — Bond-equivalent yield
    // For DSM <= 182: BEY = 365 * discount / (360 - discount * DSM)
    // Algebraically equivalent to: price = 100*(1-d*DSM/360),
    //   then ((100-price)/price) * (365/DSM)
    // ===================================================================

    #[test]
    fn tbilleq_basic_90_day() {
        // DSM=90, discount=5%
        // BEY = 365 * 0.05 / (360 - 0.05 * 90)
        //     = 18.25 / (360 - 4.5) = 18.25 / 355.5 = 0.051336...
        let expected = 365.0 * 0.05 / (360.0 - 0.05 * 90.0);
        let r = FnTbilleq.call(&[num(BASE), num(BASE + 90.0), num(0.05)]);
        assert_approx(&r, expected, 1e-9);
    }

    #[test]
    fn tbilleq_excel_example() {
        // settlement=39538, maturity=39600, discount=0.0914, DSM=62
        // BEY = 365 * 0.0914 / (360 - 0.0914 * 62)
        //     = 33.361 / (360 - 5.6668) = 33.361 / 354.3332 = 0.094151...
        let expected = 365.0 * DISCOUNT_2008 / (360.0 - DISCOUNT_2008 * DSM_2008);
        let r = FnTbilleq.call(&[num(SETTLE_2008), num(MATURE_2008), num(DISCOUNT_2008)]);
        assert_approx(&r, expected, 1e-9);
        // Excel reports approximately 9.415%
        assert_approx(&r, 0.09415, 1e-4);
    }

    #[test]
    fn tbilleq_180_day() {
        // DSM=180, discount=10%
        // BEY = 365 * 0.10 / (360 - 0.10 * 180) = 36.5 / 342 = 0.106725...
        let expected = 365.0 * 0.10 / (360.0 - 0.10 * 180.0);
        let r = FnTbilleq.call(&[num(BASE), num(BASE + 180.0), num(0.10)]);
        assert_approx(&r, expected, 1e-9);
    }

    #[test]
    fn tbilleq_1_day() {
        // DSM=1, discount=3.6%
        // BEY = 365 * 0.036 / (360 - 0.036 * 1) = 13.14 / 359.964 = 0.036501...
        let expected = 365.0 * 0.036 / (360.0 - 0.036 * 1.0);
        let r = FnTbilleq.call(&[num(BASE), num(BASE + 1.0), num(0.036)]);
        assert_approx(&r, expected, 1e-9);
    }

    #[test]
    fn tbilleq_vs_tbillyield_higher() {
        // BEY (365-day basis) should always be higher than money-market yield
        // (360-day basis) for the same T-bill, because 365/DSM > 360/DSM.
        let dsm = 90.0;
        let discount = 0.05;
        let price_val = FnTbillprice.call(&[num(BASE), num(BASE + dsm), num(discount)]);
        let price = extract_num(&price_val);
        let mm_yield = FnTbillyield.call(&[num(BASE), num(BASE + dsm), num(price)]);
        let beq = FnTbilleq.call(&[num(BASE), num(BASE + dsm), num(discount)]);
        assert!(
            extract_num(&beq) > extract_num(&mm_yield),
            "BEY should exceed money-market yield"
        );
    }

    #[test]
    fn tbilleq_relationship_to_price_and_yield() {
        // TBILLEQ should equal ((100-price)/price) * (365/DSM) where
        // price comes from TBILLPRICE with the same inputs.
        let dsm = 120.0;
        let discount = 0.07;
        let price_val = FnTbillprice.call(&[num(BASE), num(BASE + dsm), num(discount)]);
        let price = extract_num(&price_val);
        let expected = ((100.0 - price) / price) * (365.0 / dsm);
        let r = FnTbilleq.call(&[num(BASE), num(BASE + dsm), num(discount)]);
        assert_approx(&r, expected, 1e-9);
    }

    #[test]
    fn tbilleq_algebraic_equivalence() {
        // Verify the two forms of the formula are equivalent:
        // Form 1: 365*d / (360 - d*DSM)
        // Form 2: ((100 - 100*(1-d*DSM/360)) / (100*(1-d*DSM/360))) * 365/DSM
        // They must agree for any valid d, DSM.
        for &(d, dsm) in &[
            (0.01, 30.0),
            (0.05, 90.0),
            (0.10, 180.0),
            (0.08, 150.0),
            (0.20, 60.0),
        ] {
            let form1: f64 = 365.0 * d / (360.0 - d * dsm);
            let price: f64 = 100.0 * (1.0 - d * dsm / 360.0);
            let form2: f64 = ((100.0 - price) / price) * (365.0 / dsm);
            assert!(
                (form1 - form2).abs() < 1e-12,
                "Forms disagree for d={d}, DSM={dsm}: {form1} vs {form2}"
            );
        }
    }

    // Error cases for TBILLEQ

    #[test]
    fn tbilleq_error_settlement_equals_maturity() {
        let r = FnTbilleq.call(&[num(BASE), num(BASE), num(0.05)]);
        assert_is_num_error(&r);
    }

    #[test]
    fn tbilleq_error_settlement_after_maturity() {
        let r = FnTbilleq.call(&[num(BASE + 1.0), num(BASE), num(0.05)]);
        assert_is_num_error(&r);
    }

    #[test]
    fn tbilleq_error_discount_zero() {
        let r = FnTbilleq.call(&[num(BASE), num(BASE + 90.0), num(0.0)]);
        assert_is_num_error(&r);
    }

    #[test]
    fn tbilleq_error_discount_negative() {
        let r = FnTbilleq.call(&[num(BASE), num(BASE + 90.0), num(-0.01)]);
        assert_is_num_error(&r);
    }

    #[test]
    fn tbilleq_error_dsm_over_limit() {
        let r = FnTbilleq.call(&[num(BASE), num(BASE + 361.0), num(0.05)]);
        assert_is_num_error(&r);
    }

    // ===================================================================
    // Cross-function consistency tests
    // ===================================================================

    #[test]
    fn price_yield_inverse_relationship() {
        // For a fixed settlement/maturity, higher discount -> lower price
        let p1 = FnTbillprice.call(&[num(BASE), num(BASE + 90.0), num(0.03)]);
        let p2 = FnTbillprice.call(&[num(BASE), num(BASE + 90.0), num(0.06)]);
        assert!(extract_num(&p1) > extract_num(&p2));
    }

    #[test]
    fn yield_increases_as_price_falls() {
        // Lower price -> higher yield
        let y1 = FnTbillyield.call(&[num(BASE), num(BASE + 90.0), num(99.0)]);
        let y2 = FnTbillyield.call(&[num(BASE), num(BASE + 90.0), num(97.0)]);
        assert!(extract_num(&y2) > extract_num(&y1));
    }

    #[test]
    fn tbilleq_increases_with_discount() {
        // Higher discount rate -> higher bond-equivalent yield
        let e1 = FnTbilleq.call(&[num(BASE), num(BASE + 90.0), num(0.03)]);
        let e2 = FnTbilleq.call(&[num(BASE), num(BASE + 90.0), num(0.08)]);
        assert!(extract_num(&e2) > extract_num(&e1));
    }

    #[test]
    fn all_three_consistent_on_excel_example() {
        // Using the Excel example data, verify all three functions are
        // consistent with each other and the mathematical definitions.
        let discount = DISCOUNT_2008;
        let dsm = DSM_2008;

        // 1. TBILLPRICE
        let price_val = FnTbillprice.call(&[num(SETTLE_2008), num(MATURE_2008), num(discount)]);
        let price = extract_num(&price_val);
        let expected_price = 100.0 * (1.0 - discount * dsm / 360.0);
        assert!((price - expected_price).abs() < 1e-9);

        // 2. TBILLYIELD on that price
        let yield_val = FnTbillyield.call(&[num(SETTLE_2008), num(MATURE_2008), num(price)]);
        let yld = extract_num(&yield_val);
        let expected_yield = ((100.0 - price) / price) * (360.0 / dsm);
        assert!((yld - expected_yield).abs() < 1e-9);

        // 3. TBILLEQ on the same discount
        let beq_val = FnTbilleq.call(&[num(SETTLE_2008), num(MATURE_2008), num(discount)]);
        let beq = extract_num(&beq_val);
        let expected_beq = 365.0 * discount / (360.0 - discount * dsm);
        assert!((beq - expected_beq).abs() < 1e-9);

        // 4. BEY > money-market yield (365-day vs 360-day basis)
        assert!(beq > yld);
    }
}
