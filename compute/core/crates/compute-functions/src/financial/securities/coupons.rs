//! Coupon schedule function wrappers.

use value_types::CellValue;

use super::super::date_context::canonical_date_arg_truncated;
use super::super::helpers::{
    arg_num, count_coupons_remaining, coupdaybs_calc, coupdaysnc_calc, days_in_coupon_period,
    err_val, next_coupon_date, num_or_err_msg, prev_coupon_date, req_num, validate_bond_args,
};
use crate::{FunctionContext, PureFunction};

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
        self.call_with_context(args, &FunctionContext::default())
    }
    fn call_with_context(&self, args: &[CellValue], context: &FunctionContext) -> CellValue {
        num_or_err_msg((|| {
            let settlement = canonical_date_arg_truncated(args, 0, context).map_err(err_val)?;
            let maturity = canonical_date_arg_truncated(args, 1, context).map_err(err_val)?;
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
        self.call_with_context(args, &FunctionContext::default())
    }
    fn call_with_context(&self, args: &[CellValue], context: &FunctionContext) -> CellValue {
        num_or_err_msg((|| {
            let settlement = canonical_date_arg_truncated(args, 0, context).map_err(err_val)?;
            let maturity = canonical_date_arg_truncated(args, 1, context).map_err(err_val)?;
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
        self.call_with_context(args, &FunctionContext::default())
    }
    fn call_with_context(&self, args: &[CellValue], context: &FunctionContext) -> CellValue {
        num_or_err_msg((|| {
            let settlement = canonical_date_arg_truncated(args, 0, context).map_err(err_val)?;
            let maturity = canonical_date_arg_truncated(args, 1, context).map_err(err_val)?;
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
        self.call_with_context(args, &FunctionContext::default())
    }
    fn call_with_context(&self, args: &[CellValue], context: &FunctionContext) -> CellValue {
        num_or_err_msg((|| {
            let settlement = canonical_date_arg_truncated(args, 0, context).map_err(err_val)?;
            let maturity = canonical_date_arg_truncated(args, 1, context).map_err(err_val)?;
            let frequency = req_num(args, 2).map_err(err_val)? as i32;
            let basis = arg_num(args, 3, 0.0).map_err(err_val)? as i32;
            validate_bond_args(settlement, maturity, frequency, basis)?;
            Ok(context
                .from_canonical_date_serial(next_coupon_date(settlement, maturity, frequency)))
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
        self.call_with_context(args, &FunctionContext::default())
    }
    fn call_with_context(&self, args: &[CellValue], context: &FunctionContext) -> CellValue {
        num_or_err_msg((|| {
            let settlement = canonical_date_arg_truncated(args, 0, context).map_err(err_val)?;
            let maturity = canonical_date_arg_truncated(args, 1, context).map_err(err_val)?;
            let frequency = req_num(args, 2).map_err(err_val)? as i32;
            let basis = arg_num(args, 3, 0.0).map_err(err_val)? as i32;
            validate_bond_args(settlement, maturity, frequency, basis)?;
            Ok(context
                .from_canonical_date_serial(prev_coupon_date(settlement, maturity, frequency)))
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
        self.call_with_context(args, &FunctionContext::default())
    }
    fn call_with_context(&self, args: &[CellValue], context: &FunctionContext) -> CellValue {
        num_or_err_msg((|| {
            let settlement = canonical_date_arg_truncated(args, 0, context).map_err(err_val)?;
            let maturity = canonical_date_arg_truncated(args, 1, context).map_err(err_val)?;
            let frequency = req_num(args, 2).map_err(err_val)? as i32;
            let basis = arg_num(args, 3, 0.0).map_err(err_val)? as i32;
            validate_bond_args(settlement, maturity, frequency, basis)?;
            Ok(count_coupons_remaining(settlement, maturity, frequency))
        })())
    }
}
