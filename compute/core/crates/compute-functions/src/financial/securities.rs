//! Securities & Bonds: ACCRINT, ACCRINTM, COUPDAYBS, COUPDAYS, COUPDAYSNC,
//! COUPNCD, COUPNUM, COUPPCD, DURATION, MDURATION, PRICE, YIELD

mod accrual;
mod coupons;
mod duration;
mod price_yield;

use self::accrual::{FnAccrint, FnAccrintm};
use self::coupons::{FnCoupdaybs, FnCoupdays, FnCoupdaysnc, FnCoupncd, FnCoupnum, FnCouppcd};
use self::duration::{FnDuration, FnMduration};
use self::price_yield::{FnPrice, FnYield};

use crate::FunctionRegistry;

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnAccrint));
    registry.register(Box::new(FnAccrintm));
    registry.register(Box::new(FnCoupdaybs));
    registry.register(Box::new(FnCoupdays));
    registry.register(Box::new(FnCoupdaysnc));
    registry.register(Box::new(FnCoupncd));
    registry.register(Box::new(FnCoupnum));
    registry.register(Box::new(FnCouppcd));
    registry.register(Box::new(FnDuration));
    registry.register(Box::new(FnMduration));
    registry.register(Box::new(FnPrice));
    registry.register(Box::new(FnYield));
}

#[cfg(test)]
mod tests;
