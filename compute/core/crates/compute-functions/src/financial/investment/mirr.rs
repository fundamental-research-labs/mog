use value_types::{CellError, CellValue};

use super::super::helpers::{err_val, num_or_err_msg, req_num};
use crate::PureFunction;
use crate::helpers::coercion::flatten_values;

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
