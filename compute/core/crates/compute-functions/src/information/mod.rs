//! Information functions: ISERR, ISEVEN, ISODD, ISLOGICAL, ISNONTEXT,
//! ISBETWEEN, ISDATE, ISEMAIL, ISURL, ISREF, N, TYPE, ERROR.TYPE, INFO, SHEET, SHEETS
//!
//! Note: Some IS* functions (ISERROR, ISNA, ISBLANK, ISNUMBER, ISTEXT)
//! are already implemented in logical.rs. This module implements the
//! remaining information functions.

mod between;
mod context;
mod conversion;
mod predicates;
mod validation;

use crate::FunctionRegistry;

pub fn register(registry: &mut FunctionRegistry) {
    predicates::register_core_predicates(registry);
    between::register(registry);
    validation::register(registry);
    predicates::register_reference_predicate(registry);
    conversion::register(registry);
    context::register(registry);
}

#[cfg(test)]
mod tests;
