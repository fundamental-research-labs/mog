use value_types::{CellError, CellValue};

use super::super::helpers::{err_val, num_or_err_msg, req_num};
use super::dated_cash_flows::collect_value_date_pairs;
use crate::PureFunction;
use crate::helpers::coercion::flatten_values;

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
