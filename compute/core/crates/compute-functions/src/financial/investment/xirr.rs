use value_types::{CellError, CellValue, KahanSum};

use super::super::helpers::{err_val, num_or_err_msg};
use super::dated_cash_flows::{collect_value_date_pairs, solve_financial_root};
use crate::PureFunction;
use crate::helpers::coercion::flatten_values;

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
            if !guess.is_finite() || guess <= -1.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("XIRR: guess must be > -1, got {guess}"),
                ));
            }

            let base_date = dates[0];
            // Sign validation above guarantees a positive scale. Do not clamp
            // it to 1: tiny cash flows must remain scale-invariant.
            let scale = values.iter().map(|v| v.abs()).fold(0.0_f64, f64::max);

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
                    acc.add((values[i] / scale) / discount);
                }
                let total = acc.total();
                if total.is_finite() { total } else { f64::NAN }
            };

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
                        acc.add(-y * (values[i] / scale) / discount / base);
                    } else {
                        return f64::NAN;
                    }
                }
                let total = acc.total();
                if total.is_finite() { total } else { f64::NAN }
            };
            let result = solve_financial_root(xnpv, xnpv_deriv, guess, 100, 1e-12, 1e-8);

            match result {
                Some(rate) => Ok(rate),
                None => Err(CellValue::error_with_message(
                    CellError::Num,
                    "XIRR: failed to converge — check that cash flows have both positive and negative values",
                )),
            }
        })())
    }
}
