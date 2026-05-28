use value_types::{CellError, CellValue};

use super::super::helpers::{err_val, num_or_err_msg, req_num};
use crate::PureFunction;
use crate::helpers::coercion::flatten_values;

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
