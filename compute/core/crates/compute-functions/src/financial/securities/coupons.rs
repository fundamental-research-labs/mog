//! Coupon schedule function wrappers.

use value_types::CellValue;

use super::super::helpers::{
    arg_num, count_coupons_remaining, coupdaybs_calc, coupdaysnc_calc, days_in_coupon_period,
    err_val, next_coupon_date, num_or_err_msg, prev_coupon_date, req_num, validate_bond_args,
};
use crate::PureFunction;

pub(super) struct FnCoupdays;
impl PureFunction for FnCoupdays {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "COUPDAYS"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let frequency = req_num(args, 2).map_err(err_val)? as i32;
            let basis = arg_num(args, 3, 0.0).map_err(err_val)? as i32;
            validate_bond_args(settlement, maturity, frequency, basis)?;
            Ok(days_in_coupon_period(
                settlement, maturity, frequency, basis,
            ))
        })())
    }
}

pub(super) struct FnCoupdaybs;
impl PureFunction for FnCoupdaybs {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "COUPDAYBS"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let frequency = req_num(args, 2).map_err(err_val)? as i32;
            let basis = arg_num(args, 3, 0.0).map_err(err_val)? as i32;
            validate_bond_args(settlement, maturity, frequency, basis)?;
            Ok(coupdaybs_calc(settlement, maturity, frequency, basis))
        })())
    }
}

pub(super) struct FnCoupdaysnc;
impl PureFunction for FnCoupdaysnc {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "COUPDAYSNC"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let frequency = req_num(args, 2).map_err(err_val)? as i32;
            let basis = arg_num(args, 3, 0.0).map_err(err_val)? as i32;
            validate_bond_args(settlement, maturity, frequency, basis)?;
            Ok(coupdaysnc_calc(settlement, maturity, frequency, basis))
        })())
    }
}

pub(super) struct FnCoupncd;
impl PureFunction for FnCoupncd {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "COUPNCD"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let frequency = req_num(args, 2).map_err(err_val)? as i32;
            let basis = arg_num(args, 3, 0.0).map_err(err_val)? as i32;
            validate_bond_args(settlement, maturity, frequency, basis)?;
            Ok(next_coupon_date(settlement, maturity, frequency))
        })())
    }
}

pub(super) struct FnCouppcd;
impl PureFunction for FnCouppcd {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "COUPPCD"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let frequency = req_num(args, 2).map_err(err_val)? as i32;
            let basis = arg_num(args, 3, 0.0).map_err(err_val)? as i32;
            validate_bond_args(settlement, maturity, frequency, basis)?;
            Ok(prev_coupon_date(settlement, maturity, frequency))
        })())
    }
}

pub(super) struct FnCoupnum;
impl PureFunction for FnCoupnum {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "COUPNUM"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let settlement = req_num(args, 0).map_err(err_val)?;
            let maturity = req_num(args, 1).map_err(err_val)?;
            let frequency = req_num(args, 2).map_err(err_val)? as i32;
            let basis = arg_num(args, 3, 0.0).map_err(err_val)? as i32;
            validate_bond_args(settlement, maturity, frequency, basis)?;
            Ok(count_coupons_remaining(settlement, maturity, frequency))
        })())
    }
}
