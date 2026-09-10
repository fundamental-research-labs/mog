//! Odd first/last coupon pricing and yields.
//!
//! The cash-flow equations and quasi-coupon definitions are documented at:
//! <https://support.microsoft.com/en-us/excel/functions/oddfprice-function>
//! <https://support.microsoft.com/en-us/excel/functions/oddlyield-function>

use value_types::date_serial::days_in_month;
use value_types::{CellError, CellValue};

use super::super::date_context::canonical_date_arg_truncated;
use super::super::helpers::{
    actual_days_between, add_months_to_serial, arg_num, coupon_period_months, days360_between,
    err_val, num_or_err_msg, req_num, serial_to_ymd, validate_bond_args, ymd_to_serial,
};
use crate::{FunctionContext, FunctionRegistry, PureFunction};

fn invalid(message: &str) -> CellValue {
    CellValue::error_with_message(CellError::Num, message)
}

fn date_arg(args: &[CellValue], index: usize, context: &FunctionContext) -> Result<f64, CellValue> {
    canonical_date_arg_truncated(args, index, context)
        .map_err(|error| CellValue::Error(error, None))
}

fn is_month_end(serial: f64) -> bool {
    let (year, month, day) = serial_to_ymd(serial);
    Some(day) == days_in_month(year, month)
}

fn shift_coupon(serial: f64, months: i32, month_end: bool) -> f64 {
    let shifted = add_months_to_serial(serial, months);
    if month_end {
        let (year, month, _) = serial_to_ymd(shifted);
        ymd_to_serial(year, month, days_in_month(year, month).unwrap_or(30))
    } else {
        shifted
    }
}

/// Coupon schedule anchored at its final regular payment. An end-of-month
/// anchor stays at month end through February and leap years.
fn coupon_span(start: f64, anchor: f64, frequency: i32) -> (f64, f64, usize) {
    let mut previous = anchor;
    let mut next = anchor;
    let mut count = 0;
    let month_end = is_month_end(anchor);
    while previous > start {
        next = previous;
        previous = shift_coupon(previous, -coupon_period_months(frequency), month_end);
        count += 1;
    }
    (previous, next, count)
}

fn days(start: f64, end: f64, basis: i32) -> f64 {
    if end <= start {
        return 0.0;
    }
    match basis {
        0 => {
            // Odd-coupon accrual adjusts the ending 31st before adjusting
            // a February starting date; keep that extra day in this case.
            let (_, month, _) = serial_to_ymd(start);
            let (_, _, end_day) = serial_to_ymd(end);
            let february_to_31st = month == 2 && is_month_end(start) && end_day == 31;
            days360_between(start, end, basis) + if february_to_31st { 1.0 } else { 0.0 }
        }
        4 => days360_between(start, end, basis),
        _ => actual_days_between(start, end),
    }
}

/// Long-first discount counts roll forward from settlement, with the
/// first-coupon month-end convention also applied to settlement itself.
fn whole_discount_periods(settlement: f64, first: f64, frequency: i32) -> f64 {
    let (_, month, day) = serial_to_ymd(first);
    let month_end = is_month_end(first) || (month != 2 && day > 28 && is_month_end(settlement));
    let start = shift_coupon(settlement, 0, month_end);
    let mut count = if start > settlement { 1.0 } else { 0.0 };
    let mut next = shift_coupon(start, coupon_period_months(frequency), month_end);
    while next < first {
        count += 1.0;
        next = shift_coupon(next, coupon_period_months(frequency), month_end);
    }
    count
}

fn regular_days(previous: f64, next: f64, frequency: i32, basis: i32) -> f64 {
    match basis {
        1 => actual_days_between(previous, next),
        3 => 365.0 / f64::from(frequency),
        _ => 360.0 / f64::from(frequency),
    }
}

/// A whole quasi-coupon in the last odd period counts both 30/360
/// endpoints as month ends, including a February endpoint.
fn last_period_days(start: f64, end: f64, basis: i32) -> f64 {
    if end <= start {
        return 0.0;
    }
    if basis != 0 {
        return days(start, end, basis);
    }
    let (sy, sm, mut sd) = serial_to_ymd(start);
    let (ey, em, mut ed) = serial_to_ymd(end);
    if sd == 31 || (sm == 2 && is_month_end(start)) {
        sd = 30;
    }
    if ed == 31 || (em == 2 && is_month_end(end)) {
        ed = 30;
    }
    f64::from((ey - sy) * 360 + (em - sm) * 30 + ed - sd)
}

struct Security {
    settlement: f64,
    maturity: f64,
    dated: f64,
    first_coupon: Option<f64>,
    rate: f64,
    price_or_yield: f64,
    redemption: f64,
    frequency: i32,
    basis: i32,
}

impl Security {
    fn from_args(
        args: &[CellValue],
        first: bool,
        yield_result: bool,
        context: &FunctionContext,
    ) -> Result<Self, CellValue> {
        let offset = usize::from(first);
        let security = Self {
            settlement: date_arg(args, 0, context)?,
            maturity: date_arg(args, 1, context)?,
            dated: date_arg(args, 2, context)?,
            first_coupon: if first {
                Some(date_arg(args, 3, context)?)
            } else {
                None
            },
            rate: req_num(args, 3 + offset).map_err(err_val)?,
            price_or_yield: req_num(args, 4 + offset).map_err(err_val)?,
            redemption: req_num(args, 5 + offset).map_err(err_val)?,
            frequency: req_num(args, 6 + offset).map_err(err_val)? as i32,
            basis: arg_num(args, 7 + offset, 0.0).map_err(err_val)? as i32,
        };
        validate_bond_args(
            security.settlement,
            security.maturity,
            security.frequency,
            security.basis,
        )?;
        if security.dated >= security.settlement {
            return Err(invalid("dated/last-interest date must precede settlement"));
        }
        if let Some(coupon) = security.first_coupon {
            if coupon <= security.settlement || coupon >= security.maturity {
                return Err(invalid(
                    "first coupon must follow settlement and precede maturity",
                ));
            }
            if !yield_result
                && coupon_span(coupon, security.maturity, security.frequency).0 != coupon
            {
                return Err(invalid(
                    "first coupon and maturity must follow the same regular coupon schedule",
                ));
            }
        }
        if security.rate < 0.0
            || security.redemption < 0.0
            || if yield_result {
                security.price_or_yield <= 0.0
            } else {
                security.price_or_yield < 0.0
            }
        {
            return Err(invalid(
                "rate and redemption must be nonnegative; price must be positive and yield nonnegative",
            ));
        }
        Ok(security)
    }

    fn coupon(&self) -> f64 {
        100.0 * self.rate / f64::from(self.frequency)
    }
}

/// One representation serves both pricing and its analytic yield derivative.
struct FirstCashFlows {
    flows: Vec<(f64, f64)>,
    accrued: f64,
    frequency: f64,
}

impl FirstCashFlows {
    fn new(bond: &Security) -> Self {
        let first = bond.first_coupon.expect("first-coupon security");
        let (previous, next, _) = coupon_span(bond.settlement, first, bond.frequency);
        let e = regular_days(previous, next, bond.frequency, bond.basis);
        let first_days = days(bond.dated, first, bond.basis);
        let regular_payments = coupon_span(first, bond.maturity, bond.frequency).2;
        let (first_coupon_units, accrued_units, discount_units) = if first_days < e {
            (
                first_days / e,
                days(bond.dated, bond.settlement, bond.basis) / e,
                days(bond.settlement, first, bond.basis) / e,
            )
        } else {
            let periods = coupon_span(bond.dated, first, bond.frequency).2;
            let mut units = 0.0;
            let mut accrued = 0.0;
            let mut end = first;
            for index in 0..periods {
                let start = shift_coupon(end, -coupon_period_months(bond.frequency), false);
                let normal = if bond.basis == 1 {
                    days(start, end, bond.basis)
                } else {
                    e
                };
                units += if index + 1 == periods {
                    days(bond.dated, end, bond.basis) / normal
                } else {
                    1.0
                };
                accrued +=
                    days(bond.dated.max(start), bond.settlement.min(end), bond.basis) / normal;
                end = start;
            }
            let remaining = if matches!(bond.basis, 2 | 3) {
                days(bond.settlement, next, bond.basis)
            } else {
                e - days(previous, bond.settlement, bond.basis)
            };
            (
                units,
                accrued,
                whole_discount_periods(bond.settlement, first, bond.frequency) + remaining / e,
            )
        };
        let coupon = bond.coupon();
        let mut flows = Vec::with_capacity(regular_payments + 2);
        flows.push((discount_units, coupon * first_coupon_units));
        for k in 1..=regular_payments {
            flows.push((discount_units + k as f64, coupon));
        }
        flows.push((discount_units + regular_payments as f64, bond.redemption));
        Self {
            flows,
            accrued: coupon * accrued_units,
            frequency: f64::from(bond.frequency),
        }
    }

    fn value_and_derivative(&self, yld: f64) -> (f64, f64) {
        let q = 1.0 + yld / self.frequency;
        let mut value = -self.accrued;
        let mut derivative = 0.0;
        for &(period, amount) in &self.flows {
            let present = amount / q.powf(period);
            value += present;
            derivative -= present * period / (self.frequency * q);
        }
        (value, derivative)
    }

    fn yield_for_price(&self, price: f64, guess: f64) -> Result<f64, CellValue> {
        let config = compute_solver::SolverConfig {
            objective: compute_solver::Objective::Target(0.0),
            x0: vec![guess.max(0.05)],
            bounds: vec![compute_solver::Bound::bounded(
                -self.frequency + 1e-12,
                1e10,
            )],
            ftol: 1e-10,
            xtol: 1e-12,
            max_evals: 1000,
            max_time_ms: 0,
            ..Default::default()
        };
        let solved = compute_solver::solve_root_nr(
            |yld| self.value_and_derivative(yld).0 - price,
            |yld| self.value_and_derivative(yld).1,
            &config,
            &[0.0, 0.01, 0.1, 0.5, 1.0],
        );
        if solved.converged {
            Ok(solved.x[0])
        } else {
            Err(invalid("odd first yield did not converge"))
        }
    }
}

fn last_coupon_value(bond: &Security, yield_result: bool) -> f64 {
    let count = coupon_span(bond.dated, bond.maturity, bond.frequency).2;
    let mut coupon_units = 0.0;
    let mut accrued_units = 0.0;
    let mut remaining_units = 0.0;
    let mut start = bond.dated;
    for index in 0..count {
        let end = shift_coupon(start, coupon_period_months(bond.frequency), false);
        let normal = last_period_days(start, end, bond.basis);
        let coupon_days = if index + 1 < count {
            normal
        } else {
            last_period_days(start, bond.maturity, bond.basis)
        };
        coupon_units += coupon_days / normal;
        accrued_units += if end < bond.settlement {
            coupon_days
        } else {
            days(start, bond.settlement.min(end), bond.basis)
        } / normal;
        remaining_units += days(
            start.max(bond.settlement),
            end.min(bond.maturity),
            bond.basis,
        ) / normal;
        start = end;
    }
    let redemption_cash = bond.redemption + coupon_units * bond.coupon();
    let accrued = accrued_units * bond.coupon();
    if yield_result {
        (redemption_cash / (bond.price_or_yield + accrued) - 1.0) * f64::from(bond.frequency)
            / remaining_units
    } else {
        redemption_cash / (1.0 + remaining_units * bond.price_or_yield / f64::from(bond.frequency))
            - accrued
    }
}

struct OddCouponFunction {
    name: &'static str,
    first: bool,
    yield_result: bool,
}

impl PureFunction for OddCouponFunction {
    fn name(&self) -> &'static str {
        self.name
    }
    fn min_args(&self) -> usize {
        if self.first { 8 } else { 7 }
    }
    fn max_args(&self) -> Option<usize> {
        Some(self.min_args() + 1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        self.call_with_context(args, &FunctionContext::default())
    }
    fn call_with_context(&self, args: &[CellValue], context: &FunctionContext) -> CellValue {
        num_or_err_msg((|| {
            let bond = Security::from_args(args, self.first, self.yield_result, context)?;
            let value = if self.first {
                let cash_flows = FirstCashFlows::new(&bond);
                if self.yield_result {
                    cash_flows.yield_for_price(bond.price_or_yield, bond.rate)?
                } else {
                    cash_flows.value_and_derivative(bond.price_or_yield).0
                }
            } else {
                last_coupon_value(&bond, self.yield_result)
            };
            if value.is_finite() {
                Ok(value)
            } else {
                Err(invalid("odd-coupon result is not finite"))
            }
        })())
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    for (name, first, yield_result) in [
        ("ODDFPRICE", true, false),
        ("ODDFYIELD", true, true),
        ("ODDLPRICE", false, false),
        ("ODDLYIELD", false, true),
    ] {
        registry.register(Box::new(OddCouponFunction {
            name,
            first,
            yield_result,
        }));
    }
}
