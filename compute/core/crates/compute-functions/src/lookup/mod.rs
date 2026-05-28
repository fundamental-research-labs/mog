//! Lookup & Reference functions: XLOOKUP, XMATCH, CHOOSE, LOOKUP,
//! ADDRESS, AREAS, and array-returning markers (FILTER, SORT, UNIQUE, SEQUENCE).

#[cfg(feature = "__internal")]
pub mod helpers;
#[cfg(not(feature = "__internal"))]
pub(crate) mod helpers;

mod classic;
mod dynamic_arrays;
mod index_match;
mod manipulation;
mod misc;
mod modern;
mod reference;
mod stack;

use crate::FunctionRegistry;

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

pub fn register(registry: &mut FunctionRegistry) {
    classic::register(registry);
    dynamic_arrays::register(registry);
    index_match::register(registry);
    manipulation::register(registry);
    misc::register(registry);
    modern::register(registry);
    reference::register(registry);
    stack::register(registry);
}

#[cfg(test)]
mod tests;
