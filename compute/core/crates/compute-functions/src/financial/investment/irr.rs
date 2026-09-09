use value_types::{CellError, CellValue};

use super::super::helpers::num_or_err_msg;
use super::dated_cash_flows::solve_financial_root;
use crate::PureFunction;
use crate::helpers::coercion::flatten_values;

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
            if !guess.is_finite() || guess <= -1.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("IRR: guess must be > -1, got {guess}"),
                ));
            }

            // Sign validation above guarantees a positive scale. Do not clamp
            // it to 1: tiny cash flows must remain scale-invariant.
            let scale = cash_flows.iter().map(|v| v.abs()).fold(0.0_f64, f64::max);

            let npv_at = |rate: f64| -> f64 {
                if rate <= -1.0 {
                    return f64::NAN;
                }
                let mut npv = 0.0;
                for (i, &cf) in cash_flows.iter().enumerate() {
                    let discount = (1.0 + rate).powi(i as i32);
                    if !discount.is_finite() || discount == 0.0 {
                        return f64::NAN;
                    }
                    npv += (cf / scale) / discount;
                }
                if npv.is_finite() { npv } else { f64::NAN }
            };
            let dnpv_at = |rate: f64| -> f64 {
                if rate <= -1.0 {
                    return f64::NAN;
                }
                let mut d = 0.0;
                for (i, &cf) in cash_flows.iter().enumerate() {
                    if i > 0 {
                        let discount = (1.0 + rate).powi(i as i32);
                        if !discount.is_finite() || discount == 0.0 {
                            return f64::NAN;
                        }
                        d -= (i as f64) * (cf / scale) / discount / (1.0 + rate);
                    }
                }
                if d.is_finite() { d } else { f64::NAN }
            };

            let result = solve_financial_root(npv_at, dnpv_at, guess, 20, 1e-12, 1e-7);
            match result {
                Some(rate) => Ok(rate),
                None => Err(CellValue::error_with_message(
                    CellError::Num,
                    "IRR: failed to converge — check that cash flows have both positive and negative values",
                )),
            }
        })())
    }
}
