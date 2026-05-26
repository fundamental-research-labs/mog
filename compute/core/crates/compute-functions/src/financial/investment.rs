//! Investment Analysis: NPV, IRR, XNPV, XIRR, MIRR

use value_types::{CellError, CellValue, KahanSum};

use super::helpers::{err_val, num_or_err_msg, req_num};
use crate::helpers::coercion::flatten_values;
use crate::{FunctionRegistry, PureFunction};

/// Iterate two flattened ranges in lockstep, collecting (value, date) pairs.
/// Matches Excel behaviour:
///  - Errors in either position propagate immediately.
///  - Empty (Null) value cells are treated as 0 when the date is valid.
///  - Text entries are coerced to numbers (including date-like text → serial).
///    If coercion fails, the pair is skipped.
///  - Boolean entries in either position cause the pair to be skipped.
///  - If the date is Null/Boolean the pair is skipped regardless.
fn collect_value_date_pairs(
    flat_vals: &[CellValue],
    flat_dates: &[CellValue],
) -> Result<(Vec<f64>, Vec<f64>), CellError> {
    let len = flat_vals.len().max(flat_dates.len());
    let mut values = Vec::with_capacity(len);
    let mut dates = Vec::with_capacity(len);
    for i in 0..len {
        let v = flat_vals.get(i).unwrap_or(&CellValue::Null);
        let d = flat_dates.get(i).unwrap_or(&CellValue::Null);
        // Errors propagate immediately
        if let CellValue::Error(e, _) = v {
            return Err(*e);
        }
        if let CellValue::Error(e, _) = d {
            return Err(*e);
        }
        // Date: Number → use it, Text → coerce (e.g. "4/1/2025" → serial), else → skip pair
        let date_val = match d {
            CellValue::Number(n) => n.get(),
            CellValue::Text(_) => match d.coerce_to_number() {
                Ok(n) => n,
                Err(_) => continue,
            },
            _ => continue,
        };
        // Value: Number → use it, Null → treat as 0, Text → coerce (e.g. "500" → 500.0), else → skip pair
        let cash_flow = match v {
            CellValue::Number(n) => n.get(),
            CellValue::Null => 0.0,
            CellValue::Text(_) => match v.coerce_to_number() {
                Ok(n) => n,
                Err(_) => continue,
            },
            _ => continue,
        };
        values.push(cash_flow);
        dates.push(date_val);
    }
    Ok((values, dates))
}

// ===========================================================================
// NPV
// ===========================================================================

pub(super) struct FnNpv;
impl PureFunction for FnNpv {
    fn name(&self) -> &'static str {
        "NPV"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let rate = req_num(args, 0).map_err(err_val)?;
            let mut npv: f64 = 0.0;
            let cash_args = &args[1..];
            let flat = flatten_values(cash_args);
            let mut period = 1;
            for v in &flat {
                match v {
                    CellValue::Error(e, _) => return Err(CellValue::Error(*e, None)),
                    CellValue::Number(n) => {
                        npv += n.get() / (1.0 + rate).powi(period);
                        period += 1;
                    }
                    _ => {}
                }
            }
            if !npv.is_finite() {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "NPV: result is not finite",
                ));
            }
            Ok(npv)
        })())
    }
}

// ===========================================================================
// IRR
// ===========================================================================

pub(super) struct FnIrr;
impl PureFunction for FnIrr {
    fn name(&self) -> &'static str {
        "IRR"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let flat = flatten_values(&[args[0].clone()]);
            let mut cash_flows = Vec::new();
            for v in &flat {
                match v {
                    CellValue::Error(e, _) => return Err(CellValue::Error(*e, None)),
                    CellValue::Number(n) => cash_flows.push(n.get()),
                    _ => {}
                }
            }
            if cash_flows.len() < 2 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "IRR: need at least 2 cash flows",
                ));
            }
            let has_pos = cash_flows.iter().any(|&x| x > 0.0);
            let has_neg = cash_flows.iter().any(|&x| x < 0.0);
            if !has_pos || !has_neg {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "IRR: cash flows must have both positive and negative values",
                ));
            }

            let guess = if args.len() >= 2 {
                match args[1].coerce_to_number() {
                    Ok(g) => g,
                    Err(e) => return Err(CellValue::Error(e, None)),
                }
            } else {
                0.1
            };

            let scale = cash_flows
                .iter()
                .map(|v| v.abs())
                .fold(0.0_f64, f64::max)
                .max(1.0);

            let npv_at = |rate: f64| -> f64 {
                if rate <= -1.0 {
                    return f64::NAN;
                }
                let mut npv = 0.0;
                for (i, &cf) in cash_flows.iter().enumerate() {
                    npv += cf / (1.0 + rate).powi(i as i32);
                }
                npv
            };
            let dnpv_at = |rate: f64| -> f64 {
                if rate <= -1.0 {
                    return f64::NAN;
                }
                let mut d = 0.0;
                for (i, &cf) in cash_flows.iter().enumerate() {
                    if i > 0 {
                        d -= (i as f64) * cf / ((1.0 + rate).powi(i as i32) * (1.0 + rate));
                    }
                }
                d
            };

            let config = compute_solver::SolverConfig {
                objective: compute_solver::Objective::Target(0.0),
                x0: vec![guess],
                bounds: vec![compute_solver::Bound::bounded(-0.99, 1e6)],
                ftol: 1e-10 * scale,
                xtol: 1e-14,
                max_evals: 500,
                max_time_ms: 0,
                ..Default::default()
            };

            let result = compute_solver::solve_root_nr(
                npv_at,
                dnpv_at,
                &config,
                &[0.0, 0.5, -0.5, -0.9, 1.0],
            );
            if result.converged {
                Ok(result.x[0])
            } else {
                Err(CellValue::error_with_message(
                    CellError::Num,
                    "IRR: failed to converge — check that cash flows have both positive and negative values",
                ))
            }
        })())
    }
}

// ===========================================================================
// XNPV
// ===========================================================================

pub(super) struct FnXnpv;
impl PureFunction for FnXnpv {
    fn name(&self) -> &'static str {
        "XNPV"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let rate = req_num(args, 0).map_err(err_val)?;
            if rate <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("XNPV: rate must be > 0, got {rate}"),
                ));
            }

            let flat_vals = flatten_values(&[args[1].clone()]);
            let flat_dates = flatten_values(&[args[2].clone()]);
            let (values, dates) =
                collect_value_date_pairs(&flat_vals, &flat_dates).map_err(err_val)?;
            if values.is_empty() {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "XNPV: no valid value/date pairs",
                ));
            }

            let base_date = dates[0];
            if base_date < 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "XNPV: base date must be >= 0",
                ));
            }
            for &d in &dates {
                if d < 0.0 || d < base_date {
                    return Err(CellValue::error_with_message(
                        CellError::Num,
                        format!("XNPV: all dates must be >= base date ({base_date}), got {d}"),
                    ));
                }
            }

            let mut npv: f64 = 0.0;
            for i in 0..values.len() {
                let years = (dates[i] - base_date) / 365.0;
                let denom = (1.0 + rate).powf(years);
                if denom == 0.0 || !denom.is_finite() {
                    return Err(CellValue::error_with_message(
                        CellError::Num,
                        "XNPV: discount factor overflow",
                    ));
                }
                npv += values[i] / denom;
            }
            if !npv.is_finite() {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "XNPV: result is not finite",
                ));
            }
            Ok(npv)
        })())
    }
}

// ===========================================================================
// XIRR
// ===========================================================================

pub(super) struct FnXirr;
impl PureFunction for FnXirr {
    fn name(&self) -> &'static str {
        "XIRR"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let flat_vals = flatten_values(&[args[0].clone()]);
            let flat_dates = flatten_values(&[args[1].clone()]);
            let (values, dates) =
                collect_value_date_pairs(&flat_vals, &flat_dates).map_err(err_val)?;
            if values.len() < 2 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "XIRR: need at least 2 value/date pairs",
                ));
            }
            let has_pos = values.iter().any(|&x| x > 0.0);
            let has_neg = values.iter().any(|&x| x < 0.0);
            if !has_pos || !has_neg {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "XIRR: cash flows must have both positive and negative values",
                ));
            }

            let guess = if args.len() >= 3 {
                match args[2].coerce_to_number() {
                    Ok(g) => g,
                    Err(e) => return Err(CellValue::Error(e, None)),
                }
            } else {
                0.1
            };

            let base_date = dates[0];

            // Helper: compute XNPV at a given rate
            let xnpv = |rate: f64| -> f64 {
                let base = 1.0 + rate;
                if base <= 0.0 {
                    return f64::NAN;
                }
                let mut acc = KahanSum::new();
                for i in 0..values.len() {
                    let y = (dates[i] - base_date) / 365.0;
                    let discount = base.powf(y);
                    if discount == 0.0 || !discount.is_finite() {
                        return f64::NAN;
                    }
                    acc.add(values[i] / discount);
                }
                acc.total()
            };

            // Helper: compute XNPV derivative at a given rate
            let xnpv_deriv = |rate: f64| -> f64 {
                let base = 1.0 + rate;
                if base <= 0.0 {
                    return f64::NAN;
                }
                let mut acc = KahanSum::new();
                for i in 0..values.len() {
                    let y = (dates[i] - base_date) / 365.0;
                    let discount = base.powf(y);
                    if discount != 0.0 && discount.is_finite() {
                        acc.add(-(y * values[i] / (discount * base)));
                    }
                }
                acc.total()
            };
            let scale = values
                .iter()
                .map(|v| v.abs())
                .fold(0.0_f64, f64::max)
                .max(1.0);

            let config = compute_solver::SolverConfig {
                objective: compute_solver::Objective::Target(0.0),
                x0: vec![guess],
                bounds: vec![compute_solver::Bound::lower(-1.0 + 1e-10)],
                ftol: 1e-10 * scale,
                xtol: 1e-14,
                max_evals: 2000,
                max_time_ms: 0,
                ..Default::default()
            };

            let extra_guesses: &[f64] = &[
                0.0, 0.01, 0.05, 0.1, 0.15, 0.2, 0.25, 0.5, -0.1, -0.3, -0.5, -0.7, -0.9, -0.95,
                -0.99, 1.0, 2.0, 5.0, 10.0,
            ];

            let result = compute_solver::solve_root_nr(xnpv, xnpv_deriv, &config, extra_guesses);

            if result.converged {
                Ok(result.x[0])
            } else {
                Err(CellValue::error_with_message(
                    CellError::Num,
                    "XIRR: failed to converge — check that cash flows have both positive and negative values",
                ))
            }
        })())
    }
}

// ===========================================================================
// MIRR
// ===========================================================================

pub(super) struct FnMirr;
impl PureFunction for FnMirr {
    fn name(&self) -> &'static str {
        "MIRR"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let flat_vals = flatten_values(&[args[0].clone()]);
            let mut values = Vec::new();
            for v in &flat_vals {
                match v {
                    CellValue::Error(e, _) => return Err(CellValue::Error(*e, None)),
                    CellValue::Number(n) => values.push(n.get()),
                    _ => {}
                }
            }
            let finance_rate = req_num(args, 1).map_err(err_val)?;
            let reinvest_rate = req_num(args, 2).map_err(err_val)?;

            if values.len() < 2 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "MIRR: need at least 2 cash flows",
                ));
            }
            let has_pos = values.iter().any(|&x| x > 0.0);
            let has_neg = values.iter().any(|&x| x < 0.0);
            if !has_pos || !has_neg {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "MIRR: cash flows must have both positive and negative values",
                ));
            }

            let n = values.len();
            let mut pv_neg: f64 = 0.0;
            let mut fv_pos: f64 = 0.0;
            for (i, &val) in values.iter().enumerate() {
                if val < 0.0 {
                    pv_neg += val / (1.0 + finance_rate).powi(i as i32);
                } else {
                    fv_pos += val * (1.0 + reinvest_rate).powi((n - 1 - i) as i32);
                }
            }
            if pv_neg >= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "MIRR: present value of negative cash flows is non-negative",
                ));
            }
            let ratio = fv_pos / -pv_neg;
            if ratio <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "MIRR: fv/pv ratio is non-positive",
                ));
            }
            Ok(ratio.powf(1.0 / (n - 1) as f64) - 1.0)
        })())
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnNpv));
    registry.register(Box::new(FnIrr));
    registry.register(Box::new(FnXnpv));
    registry.register(Box::new(FnXirr));
    registry.register(Box::new(FnMirr));
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
    fn ymd(y: i32, m: i32, d: i32) -> f64 {
        crate::helpers::date_serial::ymd_to_serial(y, m, d)
    }

    // ====================================================================
    // XIRR — exact known answers
    // ====================================================================

    /// Excel benchmark: returns 0.373362535.
    #[test]
    fn xirr_excel_benchmark() {
        let vals = CellValue::from_rows(vec![vec![
            num(-10000.0),
            num(2750.0),
            num(4250.0),
            num(3250.0),
            num(2750.0),
        ]]);
        let dates = CellValue::from_rows(vec![vec![
            num(ymd(2008, 1, 1)),
            num(ymd(2008, 3, 1)),
            num(ymd(2008, 10, 30)),
            num(ymd(2009, 2, 15)),
            num(ymd(2009, 4, 1)),
        ]]);
        let r = FnXirr.call(&[vals, dates]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    (n.get() - 0.373362535).abs() < 1e-6,
                    "XIRR = {}, expected ~0.373362535",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    /// Invest -1000, receive +1100 after exactly 365 days → ~10%.
    #[test]
    fn xirr_exact_10_percent() {
        let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(1100.0)]]);
        let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
        let r = FnXirr.call(&[vals, dates]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    (n.get() - 0.1).abs() < 0.001,
                    "XIRR = {}, expected ~0.10",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    /// Break-even: invest -1000, receive +1000 → 0%.
    #[test]
    fn xirr_break_even() {
        let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(1000.0)]]);
        let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
        let r = FnXirr.call(&[vals, dates]);
        match &r {
            CellValue::Number(n) => {
                assert!(n.get().abs() < 1e-6, "XIRR = {}, expected ~0.0", n.get());
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    // ====================================================================
    // XIRR — numerical stress: extreme rates
    // ====================================================================

    /// Near-total loss: invest -1000, receive +10 → ~-99%.
    #[test]
    fn xirr_near_total_loss() {
        let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(10.0)]]);
        let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
        let r = FnXirr.call(&[vals, dates]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    (n.get() - (-0.99)).abs() < 0.01,
                    "XIRR = {}, expected ~-0.99",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    /// Very high return: -100 → +1000 in one year → 900%.
    #[test]
    fn xirr_high_return_900_percent() {
        let vals = CellValue::from_rows(vec![vec![num(-100.0), num(1000.0)]]);
        let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
        let r = FnXirr.call(&[vals, dates]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    (n.get() - 9.0).abs() < 0.01,
                    "XIRR = {}, expected ~9.0",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    /// 1-day holding period: 0.1% gain → annualized ~44%.
    #[test]
    fn xirr_one_day_holding() {
        let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(1001.0)]]);
        let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 6, 15)), num(ymd(2023, 6, 16))]]);
        let r = FnXirr.call(&[vals, dates]);
        match &r {
            CellValue::Number(n) => {
                // 1.001^365 - 1 ≈ 0.4402
                assert!(
                    n.get() > 0.3 && n.get().is_finite(),
                    "XIRR = {}, expected high annualized rate",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    /// Short intervals: cash flows days apart → very high annualized rate.
    #[test]
    fn xirr_short_intervals() {
        let vals = CellValue::from_rows(vec![vec![
            num(-10000.0),
            num(3000.0),
            num(4000.0),
            num(4000.0),
        ]]);
        let dates = CellValue::from_rows(vec![vec![
            num(ymd(2023, 6, 1)),
            num(ymd(2023, 6, 3)),
            num(ymd(2023, 6, 5)),
            num(ymd(2023, 6, 10)),
        ]]);
        let r = FnXirr.call(&[vals, dates]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    n.get() > 10.0 && n.get().is_finite(),
                    "XIRR = {}, expected very high annualized rate",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    /// Long time span: 20-year investment. -1000 → +4000. r ≈ 7.18%.
    #[test]
    fn xirr_20_year_span() {
        let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(4000.0)]]);
        let dates = CellValue::from_rows(vec![vec![num(ymd(2000, 1, 1)), num(ymd(2020, 1, 1))]]);
        let r = FnXirr.call(&[vals, dates]);
        match &r {
            CellValue::Number(n) => {
                // 4^(1/20)-1 ≈ 0.07177
                assert!(
                    (n.get() - 0.07177).abs() < 0.005,
                    "XIRR = {}, expected ~0.07177",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    // ====================================================================
    // XIRR — scale & volume
    // ====================================================================

    /// Large magnitudes (millions) should not overflow.
    #[test]
    fn xirr_large_magnitudes() {
        let vals = CellValue::from_rows(vec![vec![
            num(-5_000_000.0),
            num(1_500_000.0),
            num(2_000_000.0),
            num(2_500_000.0),
        ]]);
        let dates = CellValue::from_rows(vec![vec![
            num(ymd(2020, 1, 1)),
            num(ymd(2020, 7, 1)),
            num(ymd(2021, 1, 1)),
            num(ymd(2021, 7, 1)),
        ]]);
        let r = FnXirr.call(&[vals, dates]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    n.get() > 0.0 && n.get().is_finite(),
                    "XIRR = {}, expected positive finite",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    /// Tiny fractional amounts — precision near zero (scale-invariant).
    #[test]
    fn xirr_tiny_amounts() {
        let vals = CellValue::from_rows(vec![vec![num(-0.001), num(0.0011)]]);
        let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
        let r = FnXirr.call(&[vals, dates]);
        match &r {
            CellValue::Number(n) => {
                // Same ratio as -1000/1100 → ~10%
                assert!(
                    (n.get() - 0.1).abs() < 0.01,
                    "XIRR = {}, expected ~0.10 (scale-invariant)",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    /// Monthly cash flows for 12 months.
    #[test]
    fn xirr_monthly_12() {
        let mut v = vec![num(-12000.0)];
        let mut d = vec![num(ymd(2023, 1, 1))];
        for m in 2..=13i32 {
            v.push(num(1100.0));
            let year = if m > 12 { 2024 } else { 2023 };
            let month = if m > 12 { m - 12 } else { m };
            d.push(num(ymd(year, month, 1)));
        }
        let vals = CellValue::from_rows(vec![v]);
        let dates = CellValue::from_rows(vec![d]);
        let r = FnXirr.call(&[vals, dates]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    n.get() > 0.05 && n.get() < 0.30,
                    "XIRR = {}, expected in [0.05, 0.30]",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    /// 60 monthly payments (5-year loan).
    #[test]
    fn xirr_60_months() {
        let mut v = vec![num(50000.0)]; // receive loan
        let mut d = vec![num(ymd(2020, 1, 1))];
        for i in 1..=60i32 {
            v.push(num(-1000.0));
            let year = 2020 + i / 12;
            let month = (i % 12) + 1;
            d.push(num(ymd(year, month, 1)));
        }
        let vals = CellValue::from_rows(vec![v]);
        let dates = CellValue::from_rows(vec![d]);
        let r = FnXirr.call(&[vals, dates]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    n.get() > 0.0 && n.get() < 0.20,
                    "XIRR = {}, expected modest positive rate",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    // ====================================================================
    // XIRR — convergence robustness
    // ====================================================================

    /// Different guesses should converge to the same root.
    #[test]
    fn xirr_guess_independence() {
        let vals = CellValue::from_rows(vec![vec![
            num(-10000.0),
            num(3000.0),
            num(4000.0),
            num(5000.0),
        ]]);
        let dates = CellValue::from_rows(vec![vec![
            num(ymd(2023, 1, 1)),
            num(ymd(2023, 6, 1)),
            num(ymd(2023, 12, 1)),
            num(ymd(2024, 6, 1)),
        ]]);
        let guesses = [0.01, 0.1, 0.5, 1.0, 5.0];
        let mut results = Vec::new();
        for &g in &guesses {
            let r = FnXirr.call(&[vals.clone(), dates.clone(), num(g)]);
            match r {
                CellValue::Number(n) => results.push(n.get()),
                other => panic!("XIRR(guess={}) = {:?}", g, other),
            }
        }
        for i in 1..results.len() {
            assert!(
                (results[i] - results[0]).abs() < 1e-6,
                "guess {} → {}, but guess {} → {} — diverged!",
                guesses[i],
                results[i],
                guesses[0],
                results[0]
            );
        }
    }

    /// Bad guess near the -1 singularity should still converge.
    #[test]
    fn xirr_bad_guess_near_singularity() {
        let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(1100.0)]]);
        let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
        let r = FnXirr.call(&[vals, dates, num(-0.99)]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    (n.get() - 0.1).abs() < 0.01,
                    "XIRR(guess=-0.99) = {}, expected ~0.10",
                    n.get()
                );
            }
            _ => panic!("Expected convergence despite bad guess, got {:?}", r),
        }
    }

    /// Self-consistency: XNPV(XIRR_rate, values, dates) ≈ 0.
    #[test]
    fn xirr_self_consistency_with_xnpv() {
        let vals_inner = vec![
            num(-50000.0),
            num(10000.0),
            num(15000.0),
            num(18000.0),
            num(12000.0),
        ];
        let dates_inner = vec![
            num(ymd(2020, 3, 15)),
            num(ymd(2020, 9, 1)),
            num(ymd(2021, 2, 15)),
            num(ymd(2021, 11, 30)),
            num(ymd(2022, 6, 1)),
        ];
        let vals = CellValue::from_rows(vec![vals_inner.clone()]);
        let dates = CellValue::from_rows(vec![dates_inner.clone()]);

        let rate = match FnXirr.call(&[vals.clone(), dates.clone()]) {
            CellValue::Number(n) => n.get(),
            other => panic!("XIRR = {:?}", other),
        };

        let npv = FnXnpv.call(&[num(rate), vals, dates]);
        match &npv {
            CellValue::Number(n) => {
                assert!(
                    n.get().abs() < 0.01,
                    "XNPV(rate={}) = {}, expected ~0",
                    rate,
                    n.get()
                );
            }
            _ => panic!("XNPV = {:?}", npv),
        }
    }

    /// Alternating signs — stress test for multiple-root scenarios.
    #[test]
    fn xirr_alternating_signs() {
        let vals = CellValue::from_rows(vec![vec![
            num(-1000.0),
            num(3000.0),
            num(-3500.0),
            num(2000.0),
        ]]);
        let dates = CellValue::from_rows(vec![vec![
            num(ymd(2023, 1, 1)),
            num(ymd(2023, 4, 1)),
            num(ymd(2023, 7, 1)),
            num(ymd(2023, 10, 1)),
        ]]);
        let r = FnXirr.call(&[vals.clone(), dates.clone()]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    n.get().is_finite(),
                    "XIRR should be finite, got {}",
                    n.get()
                );
            }
            // Multiple-root case: #NUM! is also acceptable
            CellValue::Error(CellError::Num, None) => {}
            other => panic!("Expected number or #NUM!, got {:?}", other),
        }
    }

    // ====================================================================
    // XIRR — error cases
    // ====================================================================

    #[test]
    fn xirr_error_all_positive() {
        let vals = CellValue::from_rows(vec![vec![num(1000.0), num(2000.0)]]);
        let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
        assert_eq!(FnXirr.call(&[vals, dates]), err(CellError::Num));
    }

    #[test]
    fn xirr_error_all_negative() {
        let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(-2000.0)]]);
        let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
        assert_eq!(FnXirr.call(&[vals, dates]), err(CellError::Num));
    }

    #[test]
    fn xirr_error_mismatched_lengths() {
        let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(1100.0)]]);
        let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1))]]);
        assert_eq!(FnXirr.call(&[vals, dates]), err(CellError::Num));
    }

    #[test]
    fn xirr_error_single_value() {
        let vals = CellValue::from_rows(vec![vec![num(-1000.0)]]);
        let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1))]]);
        assert_eq!(FnXirr.call(&[vals, dates]), err(CellError::Num));
    }

    // ====================================================================
    // XIRR / XNPV — empty-cell (Null) handling
    // ====================================================================

    /// Empty value cells with valid dates should be treated as zero cash flow.
    /// Before the fix, independent iteration caused a length mismatch → #NUM!.
    #[test]
    fn xirr_empty_value_cells_treated_as_zero() {
        // Invest -1000, receive +1100 after 1 year, then 4 more years of empty cells.
        // The zeros don't affect the result, so XIRR should still be ~10%.
        let vals = CellValue::from_rows(vec![vec![
            num(-1000.0),
            num(1100.0),
            CellValue::Null,
            CellValue::Null,
            CellValue::Null,
            CellValue::Null,
        ]]);
        let dates = CellValue::from_rows(vec![vec![
            num(ymd(2023, 1, 1)),
            num(ymd(2024, 1, 1)),
            num(ymd(2025, 1, 1)),
            num(ymd(2026, 1, 1)),
            num(ymd(2027, 1, 1)),
            num(ymd(2028, 1, 1)),
        ]]);
        let r = FnXirr.call(&[vals, dates]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    (n.get() - 0.1).abs() < 0.001,
                    "XIRR = {}, expected ~0.10",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    /// XNPV should also handle empty value cells as zero.
    #[test]
    fn xnpv_empty_value_cells_treated_as_zero() {
        // XNPV(10%, [-1000, 500, null, null], [d1, d2, d3, d4]) should equal
        // XNPV(10%, [-1000, 500, 0, 0], [d1, d2, d3, d4])
        let rate = num(0.1);
        let vals_with_nulls = CellValue::from_rows(vec![vec![
            num(-1000.0),
            num(500.0),
            CellValue::Null,
            CellValue::Null,
        ]]);
        let vals_with_zeros =
            CellValue::from_rows(vec![vec![num(-1000.0), num(500.0), num(0.0), num(0.0)]]);
        let dates = CellValue::from_rows(vec![vec![
            num(ymd(2023, 1, 1)),
            num(ymd(2024, 1, 1)),
            num(ymd(2025, 1, 1)),
            num(ymd(2026, 1, 1)),
        ]]);
        let r_nulls = FnXnpv.call(&[rate.clone(), vals_with_nulls, dates.clone()]);
        let r_zeros = FnXnpv.call(&[rate, vals_with_zeros, dates]);
        match (&r_nulls, &r_zeros) {
            (CellValue::Number(a), CellValue::Number(b)) => {
                assert!(
                    (a.get() - b.get()).abs() < 1e-10,
                    "XNPV with nulls ({}) should equal XNPV with zeros ({})",
                    a.get(),
                    b.get()
                );
            }
            _ => panic!("Expected numbers, got {:?} and {:?}", r_nulls, r_zeros),
        }
    }

    /// If both value and date are empty, the pair should be skipped entirely.
    #[test]
    fn xirr_both_empty_pair_skipped() {
        let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(1100.0), CellValue::Null]]);
        let dates = CellValue::from_rows(vec![vec![
            num(ymd(2023, 1, 1)),
            num(ymd(2024, 1, 1)),
            CellValue::Null,
        ]]);
        let r = FnXirr.call(&[vals, dates]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    (n.get() - 0.1).abs() < 0.001,
                    "XIRR = {}, expected ~0.10",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    /// Non-numeric text in value position should cause the pair to be skipped.
    #[test]
    fn xirr_text_in_values_skipped() {
        let vals = CellValue::from_rows(vec![vec![
            num(-1000.0),
            CellValue::Text("N/A".into()),
            num(1100.0),
        ]]);
        let dates = CellValue::from_rows(vec![vec![
            num(ymd(2023, 1, 1)),
            num(ymd(2023, 7, 1)),
            num(ymd(2024, 1, 1)),
        ]]);
        let r = FnXirr.call(&[vals, dates]);
        match &r {
            CellValue::Number(n) => {
                assert!(
                    (n.get() - 0.1).abs() < 0.001,
                    "XIRR = {}, expected ~0.10 (text pair skipped)",
                    n.get()
                );
            }
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    // ====================================================================
    // XIRR / XNPV — text-date coercion
    // ====================================================================

    /// Text date in first position should be coerced to a serial number.
    /// "1/1/2023" → ymd(2023,1,1), so result should match all-numeric dates.
    #[test]
    fn xirr_text_date_coerced() {
        let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(1100.0)]]);
        // First date is text, second is numeric
        let dates_text = CellValue::from_rows(vec![vec![
            CellValue::Text("1/1/2023".into()),
            num(ymd(2024, 1, 1)),
        ]]);
        let dates_numeric =
            CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
        let r_text = FnXirr.call(&[vals.clone(), dates_text]);
        let r_num = FnXirr.call(&[vals, dates_numeric]);
        match (&r_text, &r_num) {
            (CellValue::Number(a), CellValue::Number(b)) => {
                assert!(
                    (a.get() - b.get()).abs() < 1e-10,
                    "XIRR with text date ({}) should equal XIRR with numeric date ({})",
                    a.get(),
                    b.get()
                );
            }
            _ => panic!("Expected numbers, got {:?} and {:?}", r_text, r_num),
        }
    }

    /// Numeric text in value position should be coerced (e.g. "1100" → 1100.0).
    #[test]
    fn xirr_text_number_in_value_coerced() {
        let vals_text =
            CellValue::from_rows(vec![vec![num(-1000.0), CellValue::Text("1100".into())]]);
        let vals_num = CellValue::from_rows(vec![vec![num(-1000.0), num(1100.0)]]);
        let dates = CellValue::from_rows(vec![vec![num(ymd(2023, 1, 1)), num(ymd(2024, 1, 1))]]);
        let r_text = FnXirr.call(&[vals_text, dates.clone()]);
        let r_num = FnXirr.call(&[vals_num, dates]);
        match (&r_text, &r_num) {
            (CellValue::Number(a), CellValue::Number(b)) => {
                assert!(
                    (a.get() - b.get()).abs() < 1e-10,
                    "XIRR with text value ({}) should equal XIRR with numeric value ({})",
                    a.get(),
                    b.get()
                );
            }
            _ => panic!("Expected numbers, got {:?} and {:?}", r_text, r_num),
        }
    }

    /// XNPV should coerce text dates the same way (shared collect_value_date_pairs).
    #[test]
    fn xnpv_text_date_coerced() {
        let rate = num(0.1);
        let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(500.0), num(600.0)]]);
        let dates_text = CellValue::from_rows(vec![vec![
            CellValue::Text("1/1/2023".into()),
            num(ymd(2023, 7, 1)),
            num(ymd(2024, 1, 1)),
        ]]);
        let dates_numeric = CellValue::from_rows(vec![vec![
            num(ymd(2023, 1, 1)),
            num(ymd(2023, 7, 1)),
            num(ymd(2024, 1, 1)),
        ]]);
        let r_text = FnXnpv.call(&[rate.clone(), vals.clone(), dates_text]);
        let r_num = FnXnpv.call(&[rate, vals, dates_numeric]);
        match (&r_text, &r_num) {
            (CellValue::Number(a), CellValue::Number(b)) => {
                assert!(
                    (a.get() - b.get()).abs() < 1e-10,
                    "XNPV with text date ({}) should equal XNPV with numeric date ({})",
                    a.get(),
                    b.get()
                );
            }
            _ => panic!("Expected numbers, got {:?} and {:?}", r_text, r_num),
        }
    }

    /// Unparseable text date among enough valid pairs: bad pair skipped, rest computed.
    #[test]
    fn xirr_unparseable_text_date_skipped() {
        // 3 valid pairs + 1 bad text date pair → bad pair skipped, result from 3 valid pairs
        let vals = CellValue::from_rows(vec![vec![num(-1000.0), num(0.0), num(500.0), num(600.0)]]);
        let dates_with_bad = CellValue::from_rows(vec![vec![
            num(ymd(2023, 1, 1)),
            CellValue::Text("hello".into()),
            num(ymd(2023, 7, 1)),
            num(ymd(2024, 1, 1)),
        ]]);
        let dates_without_bad = CellValue::from_rows(vec![vec![
            num(ymd(2023, 1, 1)),
            num(ymd(2023, 7, 1)),
            num(ymd(2024, 1, 1)),
        ]]);
        let vals_without_bad =
            CellValue::from_rows(vec![vec![num(-1000.0), num(500.0), num(600.0)]]);
        let r_bad = FnXirr.call(&[vals, dates_with_bad]);
        let r_clean = FnXirr.call(&[vals_without_bad, dates_without_bad]);
        match (&r_bad, &r_clean) {
            (CellValue::Number(a), CellValue::Number(b)) => {
                assert!(
                    (a.get() - b.get()).abs() < 1e-10,
                    "XIRR with bad text date ({}) should equal XIRR without it ({})",
                    a.get(),
                    b.get()
                );
            }
            _ => panic!("Expected numbers, got {:?} and {:?}", r_bad, r_clean),
        }
    }
}
