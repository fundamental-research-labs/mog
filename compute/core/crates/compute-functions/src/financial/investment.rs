//! Investment Analysis: NPV, IRR, XNPV, XIRR, MIRR

mod dated_cash_flows;
mod irr;
mod mirr;
mod npv;
mod xirr;
mod xnpv;

use self::irr::FnIrr;
use self::mirr::FnMirr;
use self::npv::FnNpv;
use self::xirr::FnXirr;
use self::xnpv::FnXnpv;
use crate::FunctionRegistry;

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnNpv));
    registry.register(Box::new(FnIrr));
    registry.register(Box::new(FnXnpv));
    registry.register(Box::new(FnXirr));
    registry.register(Box::new(FnMirr));
}

#[cfg(test)]
mod tests;
