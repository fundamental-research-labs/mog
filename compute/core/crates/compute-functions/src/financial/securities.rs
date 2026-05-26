//! Securities & Bonds: ACCRINT, ACCRINTM, COUPDAYBS, COUPDAYS, COUPDAYSNC,
//! COUPNCD, COUPNUM, COUPPCD, DURATION, MDURATION, PRICE, YIELD

use value_types::{CellError, CellValue};

use super::helpers::{
    actual_days_between, arg_num, count_coupons_remaining, coupdaybs_calc, coupdaysnc_calc,
    days_in_coupon_period, days_in_year_by_basis, days360_between, err_val, next_coupon_date,
    num_or_err_msg, prev_coupon_date, price_core, req_num, serial_to_ymd, validate_bond_args,
};
use crate::{FunctionRegistry, PureFunction};

// ===========================================================================
// COUPDAYS
// ===========================================================================

pub(super) struct FnCoupdays;
impl PureFunction for FnCoupdays {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "COUPDAYS"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let frequency = req_num(args, 2).map_err(err_val)? as i32;
            let basis = arg_num(args, 3, 0.0).map_err(err_val)? as i32;
            validate_bond_args(settlement, maturity, frequency, basis)?;
            Ok(days_in_coupon_period(
                settlement, maturity, frequency, basis,
            ))
        })())
    }
}

// ===========================================================================
// COUPDAYBS
// ===========================================================================

pub(super) struct FnCoupdaybs;
impl PureFunction for FnCoupdaybs {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "COUPDAYBS"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let frequency = req_num(args, 2).map_err(err_val)? as i32;
            let basis = arg_num(args, 3, 0.0).map_err(err_val)? as i32;
            validate_bond_args(settlement, maturity, frequency, basis)?;
            Ok(coupdaybs_calc(settlement, maturity, frequency, basis))
        })())
    }
}

// ===========================================================================
// COUPDAYSNC
// ===========================================================================

pub(super) struct FnCoupdaysnc;
impl PureFunction for FnCoupdaysnc {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "COUPDAYSNC"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let frequency = req_num(args, 2).map_err(err_val)? as i32;
            let basis = arg_num(args, 3, 0.0).map_err(err_val)? as i32;
            validate_bond_args(settlement, maturity, frequency, basis)?;
            Ok(coupdaysnc_calc(settlement, maturity, frequency, basis))
        })())
    }
}

// ===========================================================================
// COUPNCD
// ===========================================================================

pub(super) struct FnCoupncd;
impl PureFunction for FnCoupncd {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "COUPNCD"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let frequency = req_num(args, 2).map_err(err_val)? as i32;
            let basis = arg_num(args, 3, 0.0).map_err(err_val)? as i32;
            validate_bond_args(settlement, maturity, frequency, basis)?;
            Ok(next_coupon_date(settlement, maturity, frequency))
        })())
    }
}

// ===========================================================================
// COUPPCD
// ===========================================================================

pub(super) struct FnCouppcd;
impl PureFunction for FnCouppcd {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "COUPPCD"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let frequency = req_num(args, 2).map_err(err_val)? as i32;
            let basis = arg_num(args, 3, 0.0).map_err(err_val)? as i32;
            validate_bond_args(settlement, maturity, frequency, basis)?;
            Ok(prev_coupon_date(settlement, maturity, frequency))
        })())
    }
}

// ===========================================================================
// COUPNUM
// ===========================================================================

pub(super) struct FnCoupnum;
impl PureFunction for FnCoupnum {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "COUPNUM"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let frequency = req_num(args, 2).map_err(err_val)? as i32;
            let basis = arg_num(args, 3, 0.0).map_err(err_val)? as i32;
            validate_bond_args(settlement, maturity, frequency, basis)?;
            Ok(count_coupons_remaining(settlement, maturity, frequency))
        })())
    }
}

// ===========================================================================
// ACCRINT
// ===========================================================================

pub(super) struct FnAccrint;
impl PureFunction for FnAccrint {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "ACCRINT"
    }
    fn min_args(&self) -> usize {
        6
    }
    fn max_args(&self) -> Option<usize> {
        Some(8)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let issue = req_num(args, 0).map_err(err_val)?;
            let first_interest = req_num(args, 1).map_err(err_val)?;
            let settlement = req_num(args, 2).map_err(err_val)?;
            let rate = req_num(args, 3).map_err(err_val)?;
            let par = req_num(args, 4).map_err(err_val)?;
            let frequency = req_num(args, 5).map_err(err_val)? as i32;
            let basis = arg_num(args, 6, 0.0).map_err(err_val)? as i32;
            let calc_from_issue = if args.len() >= 8 {
                match &args[7] {
                    CellValue::Boolean(b) => *b,
                    CellValue::Number(n) => n.get() != 0.0,
                    _ => true,
                }
            } else {
                true
            };

            if issue >= settlement {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "ACCRINT: issue must be before settlement",
                ));
            }
            if rate <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("ACCRINT: rate must be > 0, got {rate}"),
                ));
            }
            if par <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("ACCRINT: par must be > 0, got {par}"),
                ));
            }
            if frequency != 1 && frequency != 2 && frequency != 4 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("ACCRINT: frequency must be 1, 2, or 4, got {frequency}"),
                ));
            }
            if !(0..=4).contains(&basis) {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("ACCRINT: basis must be 0..4, got {basis}"),
                ));
            }

            let start_date = if calc_from_issue {
                issue
            } else {
                first_interest
            };
            let (days, year_days) = match basis {
                0 => (days360_between(start_date, settlement, 0), 360.0),
                1 => {
                    let (y, _, _) = serial_to_ymd(settlement);
                    (
                        actual_days_between(start_date, settlement),
                        days_in_year_by_basis(y, basis),
                    )
                }
                2 => (actual_days_between(start_date, settlement), 360.0),
                3 => (actual_days_between(start_date, settlement), 365.0),
                4 => (days360_between(start_date, settlement, 4), 360.0),
                _ => (days360_between(start_date, settlement, 0), 360.0),
            };
            Ok(par * rate * days / year_days)
        })())
    }
}

// ===========================================================================
// ACCRINTM
// ===========================================================================

pub(super) struct FnAccrintm;
impl PureFunction for FnAccrintm {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "ACCRINTM"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let issue = req_num(args, 0).map_err(err_val)?;
            let settlement = req_num(args, 1).map_err(err_val)?;
            let rate = req_num(args, 2).map_err(err_val)?;
            let par = req_num(args, 3).map_err(err_val)?;
            let basis = arg_num(args, 4, 0.0).map_err(err_val)? as i32;
            if issue >= settlement {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "ACCRINTM: issue must be before settlement",
                ));
            }
            if rate <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("ACCRINTM: rate must be > 0, got {rate}"),
                ));
            }
            if par <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("ACCRINTM: par must be > 0, got {par}"),
                ));
            }
            if !(0..=4).contains(&basis) {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("ACCRINTM: basis must be 0..4, got {basis}"),
                ));
            }

            let (days, year_days) = match basis {
                0 => (days360_between(issue, settlement, 0), 360.0),
                1 => {
                    let (y, _, _) = serial_to_ymd(settlement);
                    (
                        actual_days_between(issue, settlement),
                        days_in_year_by_basis(y, basis),
                    )
                }
                2 => (actual_days_between(issue, settlement), 360.0),
                3 => (actual_days_between(issue, settlement), 365.0),
                4 => (days360_between(issue, settlement, 4), 360.0),
                _ => (days360_between(issue, settlement, 0), 360.0),
            };
            Ok(par * rate * days / year_days)
        })())
    }
}

// ===========================================================================
// PRICE
// ===========================================================================

pub(super) struct FnPrice;
impl PureFunction for FnPrice {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "PRICE"
    }
    fn min_args(&self) -> usize {
        6
    }
    fn max_args(&self) -> Option<usize> {
        Some(7)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let rate = req_num(args, 2).map_err(err_val)?;
            let yld = req_num(args, 3).map_err(err_val)?;
            let redemption = req_num(args, 4).map_err(err_val)?;
            let frequency = req_num(args, 5).map_err(err_val)? as i32;
            let basis = arg_num(args, 6, 0.0).map_err(err_val)? as i32;
            if settlement >= maturity {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "PRICE: settlement must be before maturity",
                ));
            }
            if rate < 0.0 || yld < 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("PRICE: rate and yield must be >= 0 (rate={rate}, yield={yld})"),
                ));
            }
            if redemption <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("PRICE: redemption must be > 0, got {redemption}"),
                ));
            }
            if frequency != 1 && frequency != 2 && frequency != 4 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("PRICE: frequency must be 1, 2, or 4, got {frequency}"),
                ));
            }
            if !(0..=4).contains(&basis) {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("PRICE: basis must be 0..4, got {basis}"),
                ));
            }
            let p = price_core(
                settlement, maturity, rate, yld, redemption, frequency, basis,
            );
            if p.is_nan() || p.is_infinite() {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "PRICE: result is not finite",
                ));
            }
            Ok(p)
        })())
    }
}

// ===========================================================================
// YIELD
// ===========================================================================

pub(super) struct FnYield;
impl PureFunction for FnYield {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "YIELD"
    }
    fn min_args(&self) -> usize {
        6
    }
    fn max_args(&self) -> Option<usize> {
        Some(7)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let rate = req_num(args, 2).map_err(err_val)?;
            let pr = req_num(args, 3).map_err(err_val)?;
            let redemption = req_num(args, 4).map_err(err_val)?;
            let frequency = req_num(args, 5).map_err(err_val)? as i32;
            let basis = arg_num(args, 6, 0.0).map_err(err_val)? as i32;
            if settlement >= maturity {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "YIELD: settlement must be before maturity",
                ));
            }
            if rate < 0.0 || pr <= 0.0 || redemption <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "YIELD: rate >= 0, pr > 0, redemption > 0 required (rate={rate}, pr={pr}, redemption={redemption})"
                    ),
                ));
            }
            if frequency != 1 && frequency != 2 && frequency != 4 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("YIELD: frequency must be 1, 2, or 4, got {frequency}"),
                ));
            }
            if !(0..=4).contains(&basis) {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("YIELD: basis must be 0..4, got {basis}"),
                ));
            }

            let f = |yld: f64| -> f64 {
                price_core(
                    settlement, maturity, rate, yld, redemption, frequency, basis,
                ) - pr
            };
            let df = |yld: f64| -> f64 {
                let delta = 1e-7;
                let p1 = price_core(
                    settlement,
                    maturity,
                    rate,
                    yld + delta,
                    redemption,
                    frequency,
                    basis,
                );
                let p0 = price_core(
                    settlement, maturity, rate, yld, redemption, frequency, basis,
                );
                (p1 - p0) / delta
            };

            let config = compute_solver::SolverConfig {
                objective: compute_solver::Objective::Target(0.0),
                x0: vec![rate],
                bounds: vec![compute_solver::Bound::bounded(-1.0, 10.0)],
                ftol: 1e-7,
                xtol: 1e-10,
                max_evals: 500,
                max_time_ms: 0,
                ..Default::default()
            };

            let result = compute_solver::solve_root_nr(f, df, &config, &[0.0, 0.05, 0.1, 0.5]);

            if result.converged {
                Ok(result.x[0])
            } else {
                Err(CellValue::error_with_message(
                    CellError::Num,
                    "YIELD: failed to converge — check inputs",
                ))
            }
        })())
    }
}

// ===========================================================================
// DURATION
// ===========================================================================

pub(super) struct FnDuration;
impl PureFunction for FnDuration {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "DURATION"
    }
    fn min_args(&self) -> usize {
        5
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let coupon = req_num(args, 2).map_err(err_val)?;
            let yld = req_num(args, 3).map_err(err_val)?;
            let frequency = req_num(args, 4).map_err(err_val)? as i32;
            let basis = arg_num(args, 5, 0.0).map_err(err_val)? as i32;
            if settlement >= maturity {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "DURATION: settlement must be before maturity",
                ));
            }
            if coupon < 0.0 || yld < 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "DURATION: coupon and yield must be >= 0 (coupon={coupon}, yield={yld})"
                    ),
                ));
            }
            if frequency != 1 && frequency != 2 && frequency != 4 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("DURATION: frequency must be 1, 2, or 4, got {frequency}"),
                ));
            }
            if !(0..=4).contains(&basis) {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("DURATION: basis must be 0..4, got {basis}"),
                ));
            }

            let n = count_coupons_remaining(settlement, maturity, frequency);
            let coupon_payment = (100.0 * coupon) / frequency as f64;
            let yld_per = yld / frequency as f64;
            let dsc = coupdaysnc_calc(settlement, maturity, frequency, basis);
            let e = days_in_coupon_period(settlement, maturity, frequency, basis);
            if e == 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "DURATION: coupon period has zero days",
                ));
            }
            let dsc_frac = dsc / e;

            let mut price = 0.0;
            let mut weighted_sum = 0.0;
            let n_int = n as i32;
            for k in 1..=n_int {
                let t = k as f64 - 1.0 + dsc_frac;
                let df = (1.0 + yld_per).powf(t);
                let pv = coupon_payment / df;
                price += pv;
                weighted_sum += (t / frequency as f64) * pv;
            }
            let t_mat = n - 1.0 + dsc_frac;
            let df_mat = (1.0 + yld_per).powf(t_mat);
            let pv_red = 100.0 / df_mat;
            price += pv_red;
            weighted_sum += (t_mat / frequency as f64) * pv_red;
            if price <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "DURATION: computed price is non-positive",
                ));
            }
            Ok(weighted_sum / price)
        })())
    }
}

// ===========================================================================
// MDURATION
// ===========================================================================

pub(super) struct FnMduration;
impl PureFunction for FnMduration {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "MDURATION"
    }
    fn min_args(&self) -> usize {
        5
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let mac_dur = FnDuration.call(args);
        match mac_dur {
            CellValue::Number(d) => {
                let yld = match req_num(args, 3) {
                    Ok(y) => y,
                    Err(e) => return CellValue::Error(e, None),
                };
                let frequency = match req_num(args, 4) {
                    Ok(f) => f,
                    Err(e) => return CellValue::Error(e, None),
                };
                CellValue::number(d.get() / (1.0 + yld / frequency))
            }
            other => other,
        }
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnAccrint));
    registry.register(Box::new(FnAccrintm));
    registry.register(Box::new(FnCoupdaybs));
    registry.register(Box::new(FnCoupdays));
    registry.register(Box::new(FnCoupdaysnc));
    registry.register(Box::new(FnCoupncd));
    registry.register(Box::new(FnCoupnum));
    registry.register(Box::new(FnCouppcd));
    registry.register(Box::new(FnDuration));
    registry.register(Box::new(FnMduration));
    registry.register(Box::new(FnPrice));
    registry.register(Box::new(FnYield));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PureFunction;
    use value_types::CellValue;

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }
    fn approx(a: &CellValue, expected: f64, tol: f64) -> bool {
        match a {
            CellValue::Number(n) => (n.get() - expected).abs() < tol,
            _ => false,
        }
    }

    #[test]
    fn test_accrint_basic() {
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
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
    fn test_price_basic() {
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
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

    // =========================================================================
    // ACCRINT — first-principles tests
    // =========================================================================

    #[test]
    fn test_accrint_annual_30_360_half_year() {
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
        let d = ymd_to_serial(2020, 7, 1);
        let r = FnAccrint.call(&[
            num(d),
            num(d + 180.0),
            num(d), // issue == settlement
            num(0.05),
            num(1000.0),
            num(2.0),
        ]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    #[test]
    fn test_accrint_error_negative_rate() {
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
        let issue = ymd_to_serial(2020, 1, 1);
        let r = FnAccrint.call(&[
            num(issue),
            num(issue + 180.0),
            num(issue + 90.0),
            num(0.05),
            num(1000.0),
            num(3.0), // freq=3 is invalid
        ]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    #[test]
    fn test_accrint_error_invalid_basis() {
        use super::super::helpers::ymd_to_serial;
        let issue = ymd_to_serial(2020, 1, 1);
        let r = FnAccrint.call(&[
            num(issue),
            num(issue + 180.0),
            num(issue + 90.0),
            num(0.05),
            num(1000.0),
            num(2.0),
            num(5.0), // basis=5 is invalid
        ]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    #[test]
    fn test_accrint_calc_from_issue_false() {
        use super::super::helpers::ymd_to_serial;
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

    // =========================================================================
    // ACCRINTM — first-principles tests
    // =========================================================================

    #[test]
    fn test_accrintm_30_360() {
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
        let d = ymd_to_serial(2020, 7, 1);
        let r = FnAccrintm.call(&[num(d), num(d), num(0.05), num(1000.0)]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    #[test]
    fn test_accrintm_error_negative_rate() {
        use super::super::helpers::ymd_to_serial;
        let issue = ymd_to_serial(2020, 1, 1);
        let settlement = ymd_to_serial(2020, 7, 1);
        let r = FnAccrintm.call(&[num(issue), num(settlement), num(-0.05), num(1000.0)]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    #[test]
    fn test_accrintm_error_negative_par() {
        use super::super::helpers::ymd_to_serial;
        let issue = ymd_to_serial(2020, 1, 1);
        let settlement = ymd_to_serial(2020, 7, 1);
        let r = FnAccrintm.call(&[num(issue), num(settlement), num(0.05), num(-1000.0)]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    #[test]
    fn test_accrintm_error_invalid_basis() {
        use super::super::helpers::ymd_to_serial;
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

    // =========================================================================
    // PRICE — first-principles tests
    // =========================================================================

    #[test]
    fn test_price_excel_example() {
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
        let d = ymd_to_serial(2020, 1, 15);
        let r = FnPrice.call(&[num(d), num(d), num(0.05), num(0.05), num(100.0), num(2.0)]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    #[test]
    fn test_price_error_negative_rate() {
        use super::super::helpers::ymd_to_serial;
        let s = ymd_to_serial(2020, 1, 15);
        let m = ymd_to_serial(2025, 1, 15);
        let r = FnPrice.call(&[num(s), num(m), num(-0.05), num(0.05), num(100.0), num(2.0)]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    #[test]
    fn test_price_error_negative_yield() {
        use super::super::helpers::ymd_to_serial;
        let s = ymd_to_serial(2020, 1, 15);
        let m = ymd_to_serial(2025, 1, 15);
        let r = FnPrice.call(&[num(s), num(m), num(0.05), num(-0.05), num(100.0), num(2.0)]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    #[test]
    fn test_price_error_invalid_frequency() {
        use super::super::helpers::ymd_to_serial;
        let s = ymd_to_serial(2020, 1, 15);
        let m = ymd_to_serial(2025, 1, 15);
        let r = FnPrice.call(&[num(s), num(m), num(0.05), num(0.05), num(100.0), num(3.0)]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    #[test]
    fn test_price_annual_frequency() {
        use super::super::helpers::ymd_to_serial;
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

    // =========================================================================
    // YIELD — first-principles tests
    // =========================================================================

    #[test]
    fn test_yield_at_par() {
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
        let d = ymd_to_serial(2020, 1, 15);
        let r = FnYield.call(&[num(d), num(d), num(0.05), num(100.0), num(100.0), num(2.0)]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    #[test]
    fn test_yield_error_negative_rate() {
        use super::super::helpers::ymd_to_serial;
        let s = ymd_to_serial(2020, 1, 15);
        let m = ymd_to_serial(2025, 1, 15);
        let r = FnYield.call(&[num(s), num(m), num(-0.05), num(100.0), num(100.0), num(2.0)]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    #[test]
    fn test_yield_error_zero_price() {
        use super::super::helpers::ymd_to_serial;
        let s = ymd_to_serial(2020, 1, 15);
        let m = ymd_to_serial(2025, 1, 15);
        let r = FnYield.call(&[num(s), num(m), num(0.05), num(0.0), num(100.0), num(2.0)]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    #[test]
    fn test_yield_error_invalid_basis() {
        use super::super::helpers::ymd_to_serial;
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

    // =========================================================================
    // DURATION — first-principles tests
    // =========================================================================

    #[test]
    fn test_duration_excel_example() {
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
        let d = ymd_to_serial(2020, 1, 1);
        let r = FnDuration.call(&[num(d), num(d), num(0.05), num(0.05), num(2.0)]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    #[test]
    fn test_duration_error_negative_coupon() {
        use super::super::helpers::ymd_to_serial;
        let s = ymd_to_serial(2020, 1, 1);
        let m = ymd_to_serial(2025, 1, 1);
        let r = FnDuration.call(&[num(s), num(m), num(-0.05), num(0.05), num(2.0)]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    #[test]
    fn test_duration_error_negative_yield() {
        use super::super::helpers::ymd_to_serial;
        let s = ymd_to_serial(2020, 1, 1);
        let m = ymd_to_serial(2025, 1, 1);
        let r = FnDuration.call(&[num(s), num(m), num(0.05), num(-0.05), num(2.0)]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    #[test]
    fn test_duration_error_invalid_frequency() {
        use super::super::helpers::ymd_to_serial;
        let s = ymd_to_serial(2020, 1, 1);
        let m = ymd_to_serial(2025, 1, 1);
        let r = FnDuration.call(&[num(s), num(m), num(0.05), num(0.05), num(3.0)]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    // =========================================================================
    // MDURATION — first-principles tests
    // =========================================================================

    #[test]
    fn test_mduration_less_than_duration() {
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
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
    fn test_mduration_error_propagates() {
        use super::super::helpers::ymd_to_serial;
        // Invalid args should propagate error from DURATION
        let d = ymd_to_serial(2020, 1, 1);
        let r = FnMduration.call(&[num(d), num(d), num(0.05), num(0.05), num(2.0)]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    // =========================================================================
    // COUPDAYS — first-principles tests
    // =========================================================================

    #[test]
    fn test_coupdays_semi_30_360() {
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
        let d = ymd_to_serial(2020, 1, 15);
        let r = FnCoupdays.call(&[num(d), num(d), num(2.0)]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    // =========================================================================
    // COUPDAYBS — first-principles tests
    // =========================================================================

    #[test]
    fn test_coupdaybs_mid_period() {
        use super::super::helpers::ymd_to_serial;
        // settlement=2020-03-15, maturity=2025-01-15, freq=2, basis=0
        // Prev coupon: 2020-01-15, days from Jan15 to Mar15 = 2*30 = 60
        let s = ymd_to_serial(2020, 3, 15);
        let m = ymd_to_serial(2025, 1, 15);
        let r = FnCoupdaybs.call(&[num(s), num(m), num(2.0), num(0.0)]);
        assert!(approx(&r, 60.0, 0.01), "COUPDAYBS = {:?}, expected 60", r);
    }

    #[test]
    fn test_coupdaybs_error_invalid_frequency() {
        use super::super::helpers::ymd_to_serial;
        let s = ymd_to_serial(2020, 3, 15);
        let m = ymd_to_serial(2025, 1, 15);
        let r = FnCoupdaybs.call(&[num(s), num(m), num(5.0)]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }

    // =========================================================================
    // COUPDAYSNC — first-principles tests
    // =========================================================================

    #[test]
    fn test_coupdaysnc_mid_period() {
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
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

    // =========================================================================
    // COUPNCD — first-principles tests
    // =========================================================================

    #[test]
    fn test_coupncd_semi() {
        use super::super::helpers::ymd_to_serial;
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

    // =========================================================================
    // COUPPCD — first-principles tests
    // =========================================================================

    #[test]
    fn test_couppcd_semi() {
        use super::super::helpers::ymd_to_serial;
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

    // =========================================================================
    // COUPNUM — first-principles tests
    // =========================================================================

    #[test]
    fn test_coupnum_semi_10yr() {
        use super::super::helpers::ymd_to_serial;
        // settlement=2020-01-15, maturity=2025-01-15, freq=2
        // 5 years * 2 = 10 coupons remaining
        let s = ymd_to_serial(2020, 1, 15);
        let m = ymd_to_serial(2025, 1, 15);
        let r = FnCoupnum.call(&[num(s), num(m), num(2.0)]);
        assert!(approx(&r, 10.0, 0.01), "COUPNUM = {:?}, expected 10", r);
    }

    #[test]
    fn test_coupnum_annual() {
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
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
        use super::super::helpers::ymd_to_serial;
        let d = ymd_to_serial(2025, 1, 15);
        let r = FnCoupnum.call(&[num(d), num(d), num(2.0)]);
        assert!(matches!(r, CellValue::Error(CellError::Num, _)));
    }
}
