//! Discount & Yield: DISC, INTRATE, PRICEDISC, PRICEMAT, RECEIVED, YIELDDISC, YIELDMAT

use value_types::{CellError, CellValue};

use super::date_context::canonical_date_arg_truncated;
use super::helpers::{arg_num, err_val, num_or_err_msg, req_num, year_frac};
use crate::{FunctionContext, FunctionRegistry, PureFunction};

// ===========================================================================
// DISC
// ===========================================================================

pub(super) struct FnDisc;
impl PureFunction for FnDisc {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "DISC"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        self.call_with_context(args, &FunctionContext::default())
    }
    fn call_with_context(&self, args: &[CellValue], context: &FunctionContext) -> CellValue {
        num_or_err_msg((|| {
            let settlement = canonical_date_arg_truncated(args, 0, context).map_err(err_val)?;
            let maturity = canonical_date_arg_truncated(args, 1, context).map_err(err_val)?;
            let pr = req_num(args, 2).map_err(err_val)?;
            let redemption = req_num(args, 3).map_err(err_val)?;
            let basis = arg_num(args, 4, 0.0).map_err(err_val)? as i32;
            if settlement >= maturity {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "DISC: settlement must be before maturity",
                ));
            }
            if pr <= 0.0 || redemption <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "DISC: pr and redemption must be > 0 (pr={pr}, redemption={redemption})"
                    ),
                ));
            }
            if !(0..=4).contains(&basis) {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("DISC: basis must be 0..4, got {basis}"),
                ));
            }
            let yf = year_frac(settlement, maturity, basis);
            if yf == 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "DISC: year fraction is zero",
                ));
            }
            Ok((redemption - pr) / redemption / yf)
        })())
    }
}

// ===========================================================================
// INTRATE
// ===========================================================================

pub(super) struct FnIntrate;
impl PureFunction for FnIntrate {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "INTRATE"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        self.call_with_context(args, &FunctionContext::default())
    }
    fn call_with_context(&self, args: &[CellValue], context: &FunctionContext) -> CellValue {
        num_or_err_msg((|| {
            let settlement = canonical_date_arg_truncated(args, 0, context).map_err(err_val)?;
            let maturity = canonical_date_arg_truncated(args, 1, context).map_err(err_val)?;
            let investment = req_num(args, 2).map_err(err_val)?;
            let redemption = req_num(args, 3).map_err(err_val)?;
            let basis = arg_num(args, 4, 0.0).map_err(err_val)? as i32;
            if settlement >= maturity {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "INTRATE: settlement must be before maturity",
                ));
            }
            if investment <= 0.0 || redemption <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "INTRATE: investment and redemption must be > 0 (investment={investment}, redemption={redemption})"
                    ),
                ));
            }
            if !(0..=4).contains(&basis) {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("INTRATE: basis must be 0..4, got {basis}"),
                ));
            }
            let yf = year_frac(settlement, maturity, basis);
            if yf == 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "INTRATE: year fraction is zero",
                ));
            }
            Ok((redemption - investment) / investment / yf)
        })())
    }
}

// ===========================================================================
// PRICEDISC
// ===========================================================================

pub(super) struct FnPricedisc;
impl PureFunction for FnPricedisc {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "PRICEDISC"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        self.call_with_context(args, &FunctionContext::default())
    }
    fn call_with_context(&self, args: &[CellValue], context: &FunctionContext) -> CellValue {
        num_or_err_msg((|| {
            let settlement = canonical_date_arg_truncated(args, 0, context).map_err(err_val)?;
            let maturity = canonical_date_arg_truncated(args, 1, context).map_err(err_val)?;
            let discount = req_num(args, 2).map_err(err_val)?;
            let redemption = req_num(args, 3).map_err(err_val)?;
            let basis = arg_num(args, 4, 0.0).map_err(err_val)? as i32;
            if settlement >= maturity {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "PRICEDISC: settlement must be before maturity",
                ));
            }
            if discount <= 0.0 || redemption <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "PRICEDISC: discount and redemption must be > 0 (discount={discount}, redemption={redemption})"
                    ),
                ));
            }
            if !(0..=4).contains(&basis) {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("PRICEDISC: basis must be 0..4, got {basis}"),
                ));
            }
            let yf = year_frac(settlement, maturity, basis);
            Ok(redemption - discount * redemption * yf)
        })())
    }
}

// ===========================================================================
// PRICEMAT
// ===========================================================================

pub(super) struct FnPricemat;
impl PureFunction for FnPricemat {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "PRICEMAT"
    }
    fn min_args(&self) -> usize {
        5
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        self.call_with_context(args, &FunctionContext::default())
    }
    fn call_with_context(&self, args: &[CellValue], context: &FunctionContext) -> CellValue {
        num_or_err_msg((|| {
            let settlement = canonical_date_arg_truncated(args, 0, context).map_err(err_val)?;
            let maturity = canonical_date_arg_truncated(args, 1, context).map_err(err_val)?;
            let issue = canonical_date_arg_truncated(args, 2, context).map_err(err_val)?;
            let rate = req_num(args, 3).map_err(err_val)?;
            let yld = req_num(args, 4).map_err(err_val)?;
            let basis = arg_num(args, 5, 0.0).map_err(err_val)? as i32;
            if settlement >= maturity {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "PRICEMAT: settlement must be before maturity",
                ));
            }
            if issue >= settlement {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "PRICEMAT: issue must be before settlement",
                ));
            }
            if rate < 0.0 || yld < 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("PRICEMAT: rate and yield must be >= 0 (rate={rate}, yield={yld})"),
                ));
            }
            if !(0..=4).contains(&basis) {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("PRICEMAT: basis must be 0..4, got {basis}"),
                ));
            }

            let yf_im = year_frac(issue, maturity, basis);
            let yf_sm = year_frac(settlement, maturity, basis);
            let yf_is = year_frac(issue, settlement, basis);
            let num = 100.0 * (1.0 + rate * yf_im);
            let den = 1.0 + yld * yf_sm;
            if den <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "PRICEMAT: denominator (1 + yield * year_frac) is <= 0",
                ));
            }
            Ok(num / den - 100.0 * rate * yf_is)
        })())
    }
}

// ===========================================================================
// RECEIVED
// ===========================================================================

pub(super) struct FnReceived;
impl PureFunction for FnReceived {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "RECEIVED"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        self.call_with_context(args, &FunctionContext::default())
    }
    fn call_with_context(&self, args: &[CellValue], context: &FunctionContext) -> CellValue {
        num_or_err_msg((|| {
            let settlement = canonical_date_arg_truncated(args, 0, context).map_err(err_val)?;
            let maturity = canonical_date_arg_truncated(args, 1, context).map_err(err_val)?;
            let investment = req_num(args, 2).map_err(err_val)?;
            let discount = req_num(args, 3).map_err(err_val)?;
            let basis = arg_num(args, 4, 0.0).map_err(err_val)? as i32;
            if settlement >= maturity {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "RECEIVED: settlement must be before maturity",
                ));
            }
            if investment <= 0.0 || discount <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "RECEIVED: investment and discount must be > 0 (investment={investment}, discount={discount})"
                    ),
                ));
            }
            if !(0..=4).contains(&basis) {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("RECEIVED: basis must be 0..4, got {basis}"),
                ));
            }
            let yf = year_frac(settlement, maturity, basis);
            let den = 1.0 - discount * yf;
            if den <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "RECEIVED: denominator (1 - discount * year_frac) is <= 0",
                ));
            }
            Ok(investment / den)
        })())
    }
}

// ===========================================================================
// YIELDDISC
// ===========================================================================

pub(super) struct FnYielddisc;
impl PureFunction for FnYielddisc {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "YIELDDISC"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        self.call_with_context(args, &FunctionContext::default())
    }
    fn call_with_context(&self, args: &[CellValue], context: &FunctionContext) -> CellValue {
        num_or_err_msg((|| {
            let settlement = canonical_date_arg_truncated(args, 0, context).map_err(err_val)?;
            let maturity = canonical_date_arg_truncated(args, 1, context).map_err(err_val)?;
            let pr = req_num(args, 2).map_err(err_val)?;
            let redemption = req_num(args, 3).map_err(err_val)?;
            let basis = arg_num(args, 4, 0.0).map_err(err_val)? as i32;
            if settlement >= maturity {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "YIELDDISC: settlement must be before maturity",
                ));
            }
            if pr <= 0.0 || redemption <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "YIELDDISC: pr and redemption must be > 0 (pr={pr}, redemption={redemption})"
                    ),
                ));
            }
            if !(0..=4).contains(&basis) {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("YIELDDISC: basis must be 0..4, got {basis}"),
                ));
            }
            let yf = year_frac(settlement, maturity, basis);
            if yf == 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "YIELDDISC: year fraction is zero",
                ));
            }
            Ok((redemption - pr) / pr / yf)
        })())
    }
}

// ===========================================================================
// YIELDMAT
// ===========================================================================

pub(super) struct FnYieldmat;
impl PureFunction for FnYieldmat {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "YIELDMAT"
    }
    fn min_args(&self) -> usize {
        5
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        self.call_with_context(args, &FunctionContext::default())
    }
    fn call_with_context(&self, args: &[CellValue], context: &FunctionContext) -> CellValue {
        num_or_err_msg((|| {
            let settlement = canonical_date_arg_truncated(args, 0, context).map_err(err_val)?;
            let maturity = canonical_date_arg_truncated(args, 1, context).map_err(err_val)?;
            let issue = canonical_date_arg_truncated(args, 2, context).map_err(err_val)?;
            let rate = req_num(args, 3).map_err(err_val)?;
            let pr = req_num(args, 4).map_err(err_val)?;
            let basis = arg_num(args, 5, 0.0).map_err(err_val)? as i32;
            if settlement >= maturity {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "YIELDMAT: settlement must be before maturity",
                ));
            }
            if issue >= settlement {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "YIELDMAT: issue must be before settlement",
                ));
            }
            if rate < 0.0 || pr <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "YIELDMAT: rate must be >= 0 and pr must be > 0 (rate={rate}, pr={pr})"
                    ),
                ));
            }
            if !(0..=4).contains(&basis) {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("YIELDMAT: basis must be 0..4, got {basis}"),
                ));
            }

            let yf_im = year_frac(issue, maturity, basis);
            let yf_sm = year_frac(settlement, maturity, basis);
            let yf_is = year_frac(issue, settlement, basis);
            let num = 1.0 + rate * yf_im;
            let den = pr / 100.0 + rate * yf_is;
            if den <= 0.0 || yf_sm <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "YIELDMAT: denominator or year fraction is <= 0",
                ));
            }
            Ok((num / den - 1.0) / yf_sm)
        })())
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnDisc));
    registry.register(Box::new(FnIntrate));
    registry.register(Box::new(FnPricedisc));
    registry.register(Box::new(FnPricemat));
    registry.register(Box::new(FnReceived));
    registry.register(Box::new(FnYielddisc));
    registry.register(Box::new(FnYieldmat));
}

#[cfg(test)]
mod tests {
    use super::super::helpers::ymd_to_serial;
    use super::*;
    use crate::{FunctionContext, PureFunction};
    use value_types::CellValue;

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }

    #[test]
    fn discount_schedule_functions_are_date_system_invariant() {
        let settlement = ymd_to_serial(2023, 4, 1);
        let maturity = ymd_to_serial(2024, 1, 1);
        let issue = ymd_to_serial(2023, 1, 1);
        let offset = value_types::DateSystem::DATE_SYSTEM_1904_OFFSET;
        let context = FunctionContext {
            date1904: true,
            ..FunctionContext::default()
        };
        let s4 = settlement - offset;
        let m4 = maturity - offset;
        let i4 = issue - offset;
        let cases = [
            (
                FnDisc.call(&[
                    num(settlement),
                    num(maturity),
                    num(98.0),
                    num(100.0),
                    num(2.0),
                ]),
                FnDisc.call_with_context(
                    &[num(s4), num(m4), num(98.0), num(100.0), num(2.0)],
                    &context,
                ),
            ),
            (
                FnIntrate.call(&[
                    num(settlement),
                    num(maturity),
                    num(98.0),
                    num(100.0),
                    num(2.0),
                ]),
                FnIntrate.call_with_context(
                    &[num(s4), num(m4), num(98.0), num(100.0), num(2.0)],
                    &context,
                ),
            ),
            (
                FnPricedisc.call(&[
                    num(settlement),
                    num(maturity),
                    num(0.05),
                    num(100.0),
                    num(2.0),
                ]),
                FnPricedisc.call_with_context(
                    &[num(s4), num(m4), num(0.05), num(100.0), num(2.0)],
                    &context,
                ),
            ),
            (
                FnPricemat.call(&[
                    num(settlement),
                    num(maturity),
                    num(issue),
                    num(0.05),
                    num(0.06),
                    num(2.0),
                ]),
                FnPricemat.call_with_context(
                    &[num(s4), num(m4), num(i4), num(0.05), num(0.06), num(2.0)],
                    &context,
                ),
            ),
            (
                FnReceived.call(&[
                    num(settlement),
                    num(maturity),
                    num(100.0),
                    num(0.05),
                    num(2.0),
                ]),
                FnReceived.call_with_context(
                    &[num(s4), num(m4), num(100.0), num(0.05), num(2.0)],
                    &context,
                ),
            ),
            (
                FnYielddisc.call(&[
                    num(settlement),
                    num(maturity),
                    num(98.0),
                    num(100.0),
                    num(2.0),
                ]),
                FnYielddisc.call_with_context(
                    &[num(s4), num(m4), num(98.0), num(100.0), num(2.0)],
                    &context,
                ),
            ),
            (
                FnYieldmat.call(&[
                    num(settlement),
                    num(maturity),
                    num(issue),
                    num(0.05),
                    num(98.0),
                    num(2.0),
                ]),
                FnYieldmat.call_with_context(
                    &[num(s4), num(m4), num(i4), num(0.05), num(98.0), num(2.0)],
                    &context,
                ),
            ),
        ];
        for (canonical, workbook) in cases {
            match (canonical, workbook) {
                (CellValue::Number(canonical), CellValue::Number(workbook)) => {
                    assert!((canonical.get() - workbook.get()).abs() < 1e-10);
                }
                other => panic!("Expected numeric discount results, got {other:?}"),
            }
        }
    }

    #[test]
    fn discount_context_rejects_invalid_1904_dates() {
        let context = FunctionContext {
            date1904: true,
            ..FunctionContext::default()
        };
        for serial in [-1.0, 2_957_004.0] {
            let result = FnDisc.call_with_context(
                &[num(serial), num(serial + 1.0), num(98.0), num(100.0)],
                &context,
            );
            assert!(matches!(
                result,
                CellValue::Error(value_types::CellError::Value, _)
            ));
        }
    }

    #[test]
    fn test_disc_basic() {
        // DISC(settlement, maturity, price=98, redemption=100, basis=2)
        let settlement = ymd_to_serial(2023, 1, 1);
        let maturity = ymd_to_serial(2024, 1, 1);
        let r = FnDisc.call(&[
            num(settlement),
            num(maturity),
            num(98.0),
            num(100.0),
            num(2.0),
        ]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    n.get() > 0.0 && n.get() < 0.05,
                    "DISC = {}, expected positive rate",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    #[test]
    fn test_intrate_basic() {
        let settlement = ymd_to_serial(2023, 1, 1);
        let maturity = ymd_to_serial(2024, 1, 1);
        let r = FnIntrate.call(&[
            num(settlement),
            num(maturity),
            num(980.0),
            num(1000.0),
            num(2.0),
        ]);
        match &r {
            CellValue::Number(n) => {
                assert!(n.get() > 0.0 && n.get() < 0.1, "INTRATE = {}", n.get());
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    #[test]
    fn test_pricedisc_basic() {
        let settlement = ymd_to_serial(2023, 1, 1);
        let maturity = ymd_to_serial(2023, 7, 1);
        let r = FnPricedisc.call(&[
            num(settlement),
            num(maturity),
            num(0.05),
            num(100.0),
            num(0.0),
        ]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    n.get() > 95.0 && n.get() < 100.0,
                    "PRICEDISC = {}, expected between 95 and 100",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    #[test]
    fn test_received_basic() {
        let settlement = ymd_to_serial(2023, 1, 1);
        let maturity = ymd_to_serial(2024, 1, 1);
        let r = FnReceived.call(&[
            num(settlement),
            num(maturity),
            num(1000.0),
            num(0.05),
            num(0.0),
        ]);
        match &r {
            CellValue::Number(n) => {
                assert!(n.get() > 1000.0, "RECEIVED = {}, expected > 1000", n.get());
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    #[test]
    fn test_yielddisc_basic() {
        let settlement = ymd_to_serial(2023, 1, 1);
        let maturity = ymd_to_serial(2024, 1, 1);
        let r = FnYielddisc.call(&[
            num(settlement),
            num(maturity),
            num(98.0),
            num(100.0),
            num(0.0),
        ]);
        match &r {
            CellValue::Number(n) => {
                assert!(n.get() > 0.0 && n.get() < 0.1, "YIELDDISC = {}", n.get());
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    #[test]
    fn test_pricemat_basic() {
        let settlement = ymd_to_serial(2023, 4, 1);
        let maturity = ymd_to_serial(2024, 1, 1);
        let issue = ymd_to_serial(2023, 1, 1);
        let r = FnPricemat.call(&[
            num(settlement),
            num(maturity),
            num(issue),
            num(0.05),
            num(0.05),
            num(0.0),
        ]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    (n.get() - 100.0).abs() < 2.0,
                    "PRICEMAT with rate=yield = {}, expected ~100",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    #[test]
    fn test_yieldmat_basic() {
        let settlement = ymd_to_serial(2023, 4, 1);
        let maturity = ymd_to_serial(2024, 1, 1);
        let issue = ymd_to_serial(2023, 1, 1);
        let r = FnYieldmat.call(&[
            num(settlement),
            num(maturity),
            num(issue),
            num(0.05),
            num(100.0),
            num(0.0),
        ]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    (n.get() - 0.05).abs() < 0.02,
                    "YIELDMAT = {}, expected ~0.05",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }
}
