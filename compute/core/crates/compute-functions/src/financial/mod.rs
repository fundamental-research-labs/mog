//! Financial functions: FV, FVSCHEDULE, NPER, PMT, PV, RATE,
//! CUMIPMT, CUMPRINC, IPMT, ISPMT, PPMT,
//! AMORDEGRC, AMORLINC, DB, DDB, SLN, SYD, VDB,
//! IRR, MIRR, NPV, XIRR, XNPV,
//! ACCRINT, ACCRINTM, COUPDAYBS, COUPDAYS, COUPDAYSNC, COUPNCD, COUPNUM, COUPPCD,
//! DURATION, MDURATION, PRICE, YIELD,
//! DISC, INTRATE, PRICEDISC, PRICEMAT, RECEIVED, YIELDDISC, YIELDMAT,
//! TBILLEQ, TBILLPRICE, TBILLYIELD,
//! DOLLARDE, DOLLARFR, EFFECT, NOMINAL, PDURATION, RRI,
//! EUROCONVERT

pub(crate) mod helpers;

mod conversion;
mod depreciation;
mod discount;
mod investment;
mod payment;
mod securities;
mod time_value;
mod treasury;

use crate::FunctionRegistry;

// ===========================================================================
// Registration
// ===========================================================================

pub fn register(registry: &mut FunctionRegistry) {
    time_value::register(registry);
    payment::register(registry);
    depreciation::register(registry);
    investment::register(registry);
    securities::register(registry);
    discount::register(registry);
    treasury::register(registry);
    conversion::register(registry);
}
