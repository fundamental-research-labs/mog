//! Payment Breakdown: IPMT, PPMT, ISPMT, CUMIPMT, CUMPRINC

use value_types::{CellError, CellValue};

use super::helpers::{arg_num, err_val, fv_core, num_or_err_msg, pmt_core, req_num};
use crate::{FunctionRegistry, PureFunction};

// ===========================================================================
// IPMT
// ===========================================================================

pub(super) struct FnIpmt;
impl PureFunction for FnIpmt {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "IPMT"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let rate = req_num(args, 0).map_err(err_val)?;
            let per = req_num(args, 1).map_err(err_val)?;
            let nper = req_num(args, 2).map_err(err_val)?;
            let pv = req_num(args, 3).map_err(err_val)?;
            let fv = arg_num(args, 4, 0.0).map_err(err_val)?;
            let type_raw = arg_num(args, 5, 0.0).map_err(err_val)?;
            let type_ = type_raw.trunc();
            if per < 1.0 || per > nper {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("IPMT: per must be in 1..{nper}, got {per}"),
                ));
            }
            if nper <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("IPMT: nper must be > 0, got {nper}"),
                ));
            }
            if type_ != 0.0 && type_ != 1.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("IPMT: type must be 0 or 1, got {type_}"),
                ));
            }
            if rate == 0.0 {
                return Ok(0.0);
            }

            let pmt = pmt_core(rate, nper, pv, fv, type_);
            // For type=1, adjust period
            let actual_per = if type_ != 0.0 { per - 1.0 } else { per };
            if actual_per == 0.0 {
                return Ok(0.0);
            }
            // Balance at start of actual_per: FV after (actual_per - 1) periods
            let fv_at_per = fv_core(rate, actual_per - 1.0, pmt, pv, type_);
            Ok(fv_at_per * rate)
        })())
    }
}

// ===========================================================================
// PPMT
// ===========================================================================

pub(super) struct FnPpmt;
impl PureFunction for FnPpmt {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "PPMT"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let rate = req_num(args, 0).map_err(err_val)?;
            let per = req_num(args, 1).map_err(err_val)?;
            let nper = req_num(args, 2).map_err(err_val)?;
            let pv = req_num(args, 3).map_err(err_val)?;
            let fv = arg_num(args, 4, 0.0).map_err(err_val)?;
            let type_raw = arg_num(args, 5, 0.0).map_err(err_val)?;
            let type_ = type_raw.trunc();
            if per < 1.0 || per > nper {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("PPMT: per must be in 1..{nper}, got {per}"),
                ));
            }
            if nper <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("PPMT: nper must be > 0, got {nper}"),
                ));
            }
            if type_ != 0.0 && type_ != 1.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("PPMT: type must be 0 or 1, got {type_}"),
                ));
            }

            let pmt = pmt_core(rate, nper, pv, fv, type_);
            // Get IPMT
            let ipmt_val = match FnIpmt.call(args) {
                CellValue::Number(n) => n.get(),
                CellValue::Error(e, msg) => return Err(CellValue::Error(e, msg)),
                _ => {
                    return Err(CellValue::error_with_message(
                        CellError::Value,
                        "PPMT: unexpected IPMT result",
                    ));
                }
            };
            Ok(pmt - ipmt_val)
        })())
    }
}

// ===========================================================================
// ISPMT
// ===========================================================================

pub(super) struct FnIspmt;
impl PureFunction for FnIspmt {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "ISPMT"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let rate = req_num(args, 0).map_err(err_val)?;
            let per = req_num(args, 1).map_err(err_val)?;
            let nper = req_num(args, 2).map_err(err_val)?;
            let pv = req_num(args, 3).map_err(err_val)?;
            if nper == 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "ISPMT: nper must not be 0",
                ));
            }
            Ok(pv * rate * (per / nper - 1.0))
        })())
    }
}

// ===========================================================================
// CUMIPMT
// ===========================================================================

pub(super) struct FnCumipmt;
impl PureFunction for FnCumipmt {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "CUMIPMT"
    }
    fn min_args(&self) -> usize {
        6
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let rate = req_num(args, 0).map_err(err_val)?;
            let nper = req_num(args, 1).map_err(err_val)?;
            let pv = req_num(args, 2).map_err(err_val)?;
            let start_per = req_num(args, 3).map_err(err_val)?;
            let end_per = req_num(args, 4).map_err(err_val)?;
            let type_raw = req_num(args, 5).map_err(err_val)?;
            let type_ = type_raw.trunc();
            if rate <= 0.0 || nper <= 0.0 || pv <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "CUMIPMT: rate, nper, pv must be > 0 (rate={rate}, nper={nper}, pv={pv})"
                    ),
                ));
            }
            if start_per < 1.0 || end_per < start_per || end_per > nper {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "CUMIPMT: invalid period range (start={start_per}, end={end_per}, nper={nper})"
                    ),
                ));
            }
            if type_ != 0.0 && type_ != 1.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("CUMIPMT: type must be 0 or 1, got {type_}"),
                ));
            }

            let pmt = pmt_core(rate, nper, pv, 0.0, type_);
            let mut cum_interest = 0.0;
            let mut balance = pv;

            for period in 1..=(end_per as i64) {
                let interest = if type_ != 0.0 && period == 1 {
                    0.0
                } else {
                    balance * rate
                };
                let principal = pmt + interest;
                balance += principal;
                if period >= start_per as i64 {
                    cum_interest += interest;
                }
            }
            Ok(-cum_interest)
        })())
    }
}

// ===========================================================================
// CUMPRINC
// ===========================================================================

pub(super) struct FnCumprinc;
impl PureFunction for FnCumprinc {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "CUMPRINC"
    }
    fn min_args(&self) -> usize {
        6
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let rate = req_num(args, 0).map_err(err_val)?;
            let nper = req_num(args, 1).map_err(err_val)?;
            let pv = req_num(args, 2).map_err(err_val)?;
            let start_per = req_num(args, 3).map_err(err_val)?;
            let end_per = req_num(args, 4).map_err(err_val)?;
            let type_raw = req_num(args, 5).map_err(err_val)?;
            let type_ = type_raw.trunc();
            if rate <= 0.0 || nper <= 0.0 || pv <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "CUMPRINC: rate, nper, pv must be > 0 (rate={rate}, nper={nper}, pv={pv})"
                    ),
                ));
            }
            if start_per < 1.0 || end_per < start_per || end_per > nper {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "CUMPRINC: invalid period range (start={start_per}, end={end_per}, nper={nper})"
                    ),
                ));
            }
            if type_ != 0.0 && type_ != 1.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("CUMPRINC: type must be 0 or 1, got {type_}"),
                ));
            }

            let pmt = pmt_core(rate, nper, pv, 0.0, type_);
            let mut cum_principal = 0.0;
            let mut balance = pv;

            for period in 1..=(end_per as i64) {
                let interest = if type_ != 0.0 && period == 1 {
                    0.0
                } else {
                    balance * rate
                };
                let principal = pmt + interest;
                balance += principal;
                if period >= start_per as i64 {
                    cum_principal += principal;
                }
            }
            Ok(cum_principal)
        })())
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnIpmt));
    registry.register(Box::new(FnPpmt));
    registry.register(Box::new(FnIspmt));
    registry.register(Box::new(FnCumipmt));
    registry.register(Box::new(FnCumprinc));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PureFunction;
    use value_types::{CellError, CellValue};

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }
    fn err(e: CellError) -> CellValue {
        CellValue::Error(e, None)
    }

    fn approx(a: &CellValue, expected: f64, tol: f64) -> bool {
        match a {
            CellValue::Number(n) => (n.get() - expected).abs() < tol,
            _ => false,
        }
    }

    // -- ISPMT --

    #[test]
    fn test_ispmt() {
        let r = FnIspmt.call(&[num(0.10), num(1.0), num(3.0), num(8000000.0)]);
        match r {
            CellValue::Number(n) => assert!(n.get() < 0.0),
            _ => panic!("Expected number"),
        }
    }

    // -- CUMIPMT / CUMPRINC --

    #[test]
    fn test_cumipmt_basic() {
        // CUMIPMT(0.09/12, 30*12, 125000, 1, 1, 0)
        // First month interest = 125000 * 0.0075 = 937.50
        let r = FnCumipmt.call(&[
            num(0.09 / 12.0),
            num(360.0),
            num(125000.0),
            num(1.0),
            num(1.0),
            num(0.0),
        ]);
        assert!(
            approx(&r, -937.50, 0.01),
            "CUMIPMT first month = {:?}, expected -937.50",
            r
        );
    }

    #[test]
    fn test_cumipmt_range() {
        // CUMIPMT(0.09/12, 30*12, 125000, 1, 12, 0)
        let r = FnCumipmt.call(&[
            num(0.09 / 12.0),
            num(360.0),
            num(125000.0),
            num(1.0),
            num(12.0),
            num(0.0),
        ]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    n.get() < -11000.0 && n.get() > -12000.0,
                    "CUMIPMT first year = {}, expected around -11200",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    #[test]
    fn test_cumprinc_basic() {
        let r = FnCumprinc.call(&[
            num(0.09 / 12.0),
            num(360.0),
            num(125000.0),
            num(1.0),
            num(1.0),
            num(0.0),
        ]);
        match &r {
            CellValue::Number(n) => {
                assert!(n.get() < 0.0, "CUMPRINC should be negative for a loan");
                assert!(
                    (n.get() - (-68.12)).abs() < 1.0,
                    "CUMPRINC first month = {}, expected ~-68.12",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    #[test]
    fn test_cumipmt_plus_cumprinc_equals_payments() {
        use super::super::helpers::pmt_core;
        let rate = 0.09 / 12.0;
        let nper = 360.0;
        let pv = 125000.0;
        let cum_i = FnCumipmt.call(&[num(rate), num(nper), num(pv), num(1.0), num(nper), num(0.0)]);
        let cum_p =
            FnCumprinc.call(&[num(rate), num(nper), num(pv), num(1.0), num(nper), num(0.0)]);
        let pmt_val = pmt_core(rate, nper, pv, 0.0, 0.0);
        match (&cum_i, &cum_p) {
            (CellValue::Number(ci), CellValue::Number(cp)) => {
                let total_payments = pmt_val * nper;
                assert!(
                    (ci.get() + cp.get() - total_payments).abs() < 1.0,
                    "CUMIPMT({}) + CUMPRINC({}) = {}, expected PMT*nper = {}",
                    ci.get(),
                    cp.get(),
                    ci.get() + cp.get(),
                    total_payments
                );
            }
            _ => panic!("Expected numbers"),
        }
    }

    #[test]
    fn test_cumipmt_invalid_args() {
        // rate <= 0
        assert_eq!(
            FnCumipmt.call(&[
                num(0.0),
                num(12.0),
                num(1000.0),
                num(1.0),
                num(12.0),
                num(0.0)
            ]),
            err(CellError::Num)
        );
        // start > end
        assert_eq!(
            FnCumipmt.call(&[
                num(0.05),
                num(12.0),
                num(1000.0),
                num(5.0),
                num(3.0),
                num(0.0)
            ]),
            err(CellError::Num)
        );
    }

    // -- IPMT / PPMT --

    #[test]
    fn test_ipmt_basic() {
        // IPMT(0.1/12, 1, 3*12, 8000, 0, 0)
        // First month interest on 8000 at 10%/12: 8000 * 0.1/12 = 66.67
        let r = FnIpmt.call(&[
            num(0.1 / 12.0),
            num(1.0),
            num(36.0),
            num(8000.0),
            num(0.0),
            num(0.0),
        ]);
        assert!(approx(&r, -66.67, 0.01), "IPMT = {:?}, expected ~-66.67", r);
    }

    #[test]
    fn test_ppmt_basic() {
        // PPMT(0.1/12, 1, 3*12, 8000, 0, 0)
        let r = FnPpmt.call(&[
            num(0.1 / 12.0),
            num(1.0),
            num(36.0),
            num(8000.0),
            num(0.0),
            num(0.0),
        ]);
        match &r {
            CellValue::Number(n) => {
                assert!(n.get() < 0.0, "PPMT should be negative");
                assert!(
                    (n.get() - (-191.47)).abs() < 1.0,
                    "PPMT = {}, expected ~-191.47",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    #[test]
    fn test_ipmt_plus_ppmt_equals_pmt() {
        use super::super::helpers::pmt_core;
        let rate = 0.1 / 12.0;
        let nper = 36.0;
        let pv = 8000.0;
        let pmt_val = pmt_core(rate, nper, pv, 0.0, 0.0);
        for per in [1.0, 12.0, 36.0] {
            let ipmt = FnIpmt.call(&[num(rate), num(per), num(nper), num(pv), num(0.0), num(0.0)]);
            let ppmt = FnPpmt.call(&[num(rate), num(per), num(nper), num(pv), num(0.0), num(0.0)]);
            match (&ipmt, &ppmt) {
                (CellValue::Number(i), CellValue::Number(pp)) => {
                    assert!(
                        (i.get() + pp.get() - pmt_val).abs() < 0.01,
                        "Period {}: IPMT({}) + PPMT({}) = {}, expected PMT = {}",
                        per,
                        i.get(),
                        pp.get(),
                        i.get() + pp.get(),
                        pmt_val
                    );
                }
                _ => panic!("Expected numbers for period {}", per),
            }
        }
    }
}
