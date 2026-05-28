//! Accrued interest function wrappers.

use value_types::{CellError, CellValue};

use super::super::helpers::{
    actual_days_between, arg_num, days_in_year_by_basis, days360_between, err_val, num_or_err_msg,
    req_num, serial_to_ymd,
};
use crate::PureFunction;

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
