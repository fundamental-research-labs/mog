use value_types::{CellError, CellValue, KahanSum};

use super::super::helpers::{err_val, num_or_err_msg, req_num};
use super::dated_cash_flows::collect_value_date_pairs_with_context;
use crate::helpers::coercion::flatten_values;
use crate::{FunctionContext, PureFunction};

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
        self.call_with_context(args, &FunctionContext::default())
    }
    fn call_with_context(&self, args: &[CellValue], context: &FunctionContext) -> CellValue {
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
                collect_value_date_pairs_with_context(&flat_vals, &flat_dates, context)
                    .map_err(err_val)?;
            if values.is_empty() {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "XNPV: no valid value/date pairs",
                ));
            }
            let has_pos = values.iter().any(|&value| value > 0.0);
            let has_neg = values.iter().any(|&value| value < 0.0);
            if !has_pos || !has_neg {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "XNPV: cash flows must have both positive and negative values",
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

            let mut npv = KahanSum::new();
            for i in 0..values.len() {
                let years = (dates[i] - base_date) / 365.0;
                let denom = (1.0 + rate).powf(years);
                if denom == 0.0 || !denom.is_finite() {
                    return Err(CellValue::error_with_message(
                        CellError::Num,
                        "XNPV: discount factor overflow",
                    ));
                }
                npv.add(values[i] / denom);
            }
            let npv = npv.total();
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
