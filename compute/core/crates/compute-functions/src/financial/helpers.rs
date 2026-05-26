//! Shared financial helpers: argument coercion, TVM core calculations,
//! date/serial conversions, coupon/bond helpers, and the PRICE core formula.

use value_types::{CellError, CellValue};

#[allow(unused_imports)]
pub(crate) use crate::helpers::date_serial::{
    actual_days_between, add_months_to_serial, days_in_year_by_basis, days360_between,
    serial_to_ymd, year_frac, ymd_to_serial,
};

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

/// Coerce argument at index to f64, defaulting to `default` if absent.
pub(crate) fn arg_num(args: &[CellValue], idx: usize, default: f64) -> Result<f64, CellError> {
    if idx >= args.len() || args[idx].is_null() {
        return Ok(default);
    }
    if let CellValue::Error(e, _) = &args[idx] {
        return Err(*e);
    }
    args[idx].coerce_to_number()
}

/// Coerce required argument at index to f64.
pub(crate) fn req_num(args: &[CellValue], idx: usize) -> Result<f64, CellError> {
    if let CellValue::Error(e, _) = &args[idx] {
        return Err(*e);
    }
    args[idx].coerce_to_number()
}

/// Return CellValue::Number or propagate error.
#[allow(dead_code)]
pub(crate) fn num_or_err(result: Result<f64, CellError>) -> CellValue {
    match result {
        Ok(n) => CellValue::number(n),
        Err(e) => CellValue::Error(e, None),
    }
}

/// Like `num_or_err`, but the closure returns `Err(CellValue)` so that
/// diagnostic messages can be attached to errors via `CellValue::error_with_message`.
/// Coercion-propagated errors (from `req_num` / `arg_num`) should be wrapped
/// with `Err(CellValue::Error(e, None))` — a `.map_err(err_val)` adapter works.
pub(crate) fn num_or_err_msg(result: Result<f64, CellValue>) -> CellValue {
    match result {
        Ok(n) => CellValue::number(n),
        Err(cv) => cv,
    }
}

/// Adapter for converting `CellError` into a bare `CellValue::Error` (no message).
/// Use with `.map_err(err_val)` inside `num_or_err_msg` closures for coercion propagation.
#[inline]
pub(crate) fn err_val(e: CellError) -> CellValue {
    CellValue::Error(e, None)
}

// ---------------------------------------------------------------------------
// Core TVM helpers (used by multiple functions)
// ---------------------------------------------------------------------------

/// PMT core calculation
pub(crate) fn pmt_core(rate: f64, nper: f64, pv: f64, fv: f64, type_: f64) -> f64 {
    if rate == 0.0 {
        return -(pv + fv) / nper;
    }
    let pow = (1.0 + rate).powf(nper);
    let type_adj = if type_ != 0.0 { 1.0 + rate } else { 1.0 };
    let af = (pow - 1.0) / rate;
    -(pv * pow + fv) / (af * type_adj)
}

/// FV core calculation
pub(crate) fn fv_core(rate: f64, nper: f64, pmt: f64, pv: f64, type_: f64) -> f64 {
    if rate == 0.0 {
        return -(pv + pmt * nper);
    }
    let pow = (1.0 + rate).powf(nper);
    let type_adj = if type_ != 0.0 { 1.0 + rate } else { 1.0 };
    let af = (pow - 1.0) / rate;
    -(pv * pow + pmt * af * type_adj)
}

// ---------------------------------------------------------------------------
// Coupon/bond helpers
// ---------------------------------------------------------------------------

/// Coupon period months for a given frequency.
pub(crate) fn coupon_period_months(frequency: i32) -> i32 {
    match frequency {
        1 => 12,
        2 => 6,
        4 => 3,
        _ => 12,
    }
}

/// Previous coupon date on or before settlement.
pub(crate) fn prev_coupon_date(settlement: f64, maturity: f64, frequency: i32) -> f64 {
    let months = coupon_period_months(frequency);
    let mut coupon = maturity;
    let mut iterations = 0;
    while coupon > settlement {
        iterations += 1;
        if iterations > 12000 {
            return f64::NAN;
        }
        let prev = coupon;
        coupon = add_months_to_serial(coupon, -months);
        if coupon == prev {
            break;
        }
    }
    coupon
}

/// Next coupon date after settlement.
pub(crate) fn next_coupon_date(settlement: f64, maturity: f64, frequency: i32) -> f64 {
    let prev = prev_coupon_date(settlement, maturity, frequency);
    let months = coupon_period_months(frequency);
    add_months_to_serial(prev, months)
}

/// Count coupons remaining.
pub(crate) fn count_coupons_remaining(settlement: f64, maturity: f64, frequency: i32) -> f64 {
    let months = coupon_period_months(frequency);
    let mut next = next_coupon_date(settlement, maturity, frequency);
    let mut count = 0.0;
    let mut iterations = 0;
    while next <= maturity {
        iterations += 1;
        if iterations > 12000 {
            return f64::NAN;
        }
        count += 1.0;
        let prev = next;
        next = add_months_to_serial(next, months);
        if next == prev {
            break;
        }
    }
    count
}

/// Days in coupon period.
pub(crate) fn days_in_coupon_period(
    settlement: f64,
    maturity: f64,
    frequency: i32,
    basis: i32,
) -> f64 {
    match basis {
        0 | 4 => 360.0 / frequency as f64,
        1 => {
            let prev = prev_coupon_date(settlement, maturity, frequency);
            let next = next_coupon_date(settlement, maturity, frequency);
            actual_days_between(prev, next)
        }
        2 => 360.0 / frequency as f64,
        3 => 365.0 / frequency as f64,
        _ => 360.0 / frequency as f64,
    }
}

/// Coupon days from beginning of period to settlement.
pub(crate) fn coupdaybs_calc(settlement: f64, maturity: f64, frequency: i32, basis: i32) -> f64 {
    let prev = prev_coupon_date(settlement, maturity, frequency);
    match basis {
        0 => days360_between(prev, settlement, 0),
        1..=3 => actual_days_between(prev, settlement),
        4 => days360_between(prev, settlement, 4),
        _ => days360_between(prev, settlement, 0),
    }
}

/// Coupon days from settlement to next coupon.
pub(crate) fn coupdaysnc_calc(settlement: f64, maturity: f64, frequency: i32, basis: i32) -> f64 {
    let next = next_coupon_date(settlement, maturity, frequency);
    match basis {
        0 => days360_between(settlement, next, 0),
        1..=3 => actual_days_between(settlement, next),
        4 => days360_between(settlement, next, 4),
        _ => days360_between(settlement, next, 0),
    }
}

/// PRICE core calculation (used by PRICE and YIELD).
pub(crate) fn price_core(
    settlement: f64,
    maturity: f64,
    rate: f64,
    yld: f64,
    redemption: f64,
    frequency: i32,
    basis: i32,
) -> f64 {
    let n = count_coupons_remaining(settlement, maturity, frequency);
    let coupon_payment = (100.0 * rate) / frequency as f64;
    let yld_per_period = yld / frequency as f64;

    let dsc = coupdaysnc_calc(settlement, maturity, frequency, basis);
    let e = days_in_coupon_period(settlement, maturity, frequency, basis);
    let a = coupdaybs_calc(settlement, maturity, frequency, basis);

    if e == 0.0 {
        return f64::NAN;
    }
    let dsc_frac = dsc / e;
    let n_int = n as i32;

    if n_int == 1 {
        let price = (redemption + coupon_payment) / (1.0 + dsc_frac * yld_per_period)
            - (coupon_payment * a) / e;
        return price;
    }

    // General case
    let mut price = redemption / (1.0 + yld_per_period).powf(n - 1.0 + dsc_frac);
    for k in 1..=n_int {
        price += coupon_payment / (1.0 + yld_per_period).powf(k as f64 - 1.0 + dsc_frac);
    }
    price -= (coupon_payment * a) / e;
    price
}

/// Validate common bond arguments.
pub(crate) fn validate_bond_args(
    settlement: f64,
    maturity: f64,
    frequency: i32,
    basis: i32,
) -> Result<(), CellValue> {
    if settlement >= maturity {
        return Err(CellValue::error_with_message(
            CellError::Num,
            "settlement must be before maturity",
        ));
    }
    if frequency != 1 && frequency != 2 && frequency != 4 {
        return Err(CellValue::error_with_message(
            CellError::Num,
            format!("frequency must be 1, 2, or 4, got {frequency}"),
        ));
    }
    if !(0..=4).contains(&basis) {
        return Err(CellValue::error_with_message(
            CellError::Num,
            format!("basis must be 0..4, got {basis}"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_yearfrac_basis1_multi_year() {
        // From 2019-01-01 to 2021-01-01 = 731 actual days
        // Years 2019, 2020, 2021: 365, 366, 365 = 1096 / 3 = 365.333...
        // YEARFRAC = 731 / 365.333... = 2.0
        let start = ymd_to_serial(2019, 1, 1);
        let end = ymd_to_serial(2021, 1, 1);
        let yf = year_frac(start, end, 1);
        assert!(
            (yf - 2.0).abs() < 0.01,
            "YEARFRAC(2019-01-01, 2021-01-01, 1) = {}, expected ~2.0",
            yf
        );
    }

    #[test]
    fn test_yearfrac_basis0_feb28_adjustment() {
        // Feb 28 (non-leap year) to Mar 31: should be 30/360 with Feb adjusted to 30
        // sd=28 (last of Feb) -> sd=30, ed=31 -> ed=30 (since sd>=30)
        // Days = 0*360 + 1*30 + 0 = 30, YEARFRAC = 30/360
        let start = ymd_to_serial(2023, 2, 28); // non-leap year
        let end = ymd_to_serial(2023, 3, 31);
        let yf = year_frac(start, end, 0);
        assert!(
            (yf - 30.0 / 360.0).abs() < 0.001,
            "YEARFRAC(Feb28, Mar31, 0) = {}, expected {}",
            yf,
            30.0 / 360.0
        );
    }

    #[test]
    fn test_yearfrac_basis0_feb29_leap_adjustment() {
        // Feb 29 (leap year) to Mar 31: last day of Feb -> sd=30
        let start = ymd_to_serial(2024, 2, 29); // leap year
        let end = ymd_to_serial(2024, 3, 31);
        let yf = year_frac(start, end, 0);
        // sd=29 (last of Feb 2024) -> sd=30, ed=31 -> ed=30 (sd>=30)
        // Days = 0*360 + 1*30 + 0 = 30
        assert!(
            (yf - 30.0 / 360.0).abs() < 0.001,
            "YEARFRAC(Feb29-2024, Mar31, 0) = {}, expected {}",
            yf,
            30.0 / 360.0
        );
    }
}
