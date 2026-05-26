//! Special function dispatch — evaluation-aware functions that need direct
//! access to the evaluator or evaluation context.
//!
//! These are functions whose semantics cannot be expressed through the standard
//! `PureFunction::call()` interface because they require lazy argument evaluation,
//! filtered aggregation, or direct mirror/dense-column access.

pub(crate) mod borrowed_multi_criteria;
pub(crate) mod dense_aggregate;
pub(crate) mod getpivotdata;
pub(crate) mod subtotal;
pub(crate) mod sumproduct;
