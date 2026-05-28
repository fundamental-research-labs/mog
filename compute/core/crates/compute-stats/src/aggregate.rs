//! Analytical aggregation functions.
//!
//! 12 aggregate functions with configurable semantics.  E.g., `count` only
//! counts numbers, `average` returns `Null` for empty input.
//!
//! All value classification (blank detection, numeric detection) and key
//! generation delegates to the canonical [`super::values`] module.  No local
//! normalization logic exists in this module tree.
//!
//! Numerical accuracy:
//! - Summation uses Kahan compensated summation via [`super::values::kahan_sum`].
//! - Variance / standard deviation uses Welford's online algorithm.

mod counting;
mod input;
mod numeric;
mod statistical;

#[cfg(test)]
mod tests;

use value_types::CellValue;

use self::counting::{pivot_counta, pivot_countunique};
use self::numeric::{pivot_average, pivot_count, pivot_max, pivot_min, pivot_product, pivot_sum};
use self::statistical::{pivot_stdev, pivot_stdevp, pivot_var, pivot_varp};
use super::types::AggregateFunction;

/// Dispatch to the appropriate aggregate function.
#[must_use]
pub fn aggregate(func: AggregateFunction, values: &[CellValue]) -> CellValue {
    match func {
        AggregateFunction::Sum => pivot_sum(values),
        AggregateFunction::Count => pivot_count(values),
        AggregateFunction::CountA => pivot_counta(values),
        AggregateFunction::CountUnique => pivot_countunique(values),
        AggregateFunction::Average => pivot_average(values),
        AggregateFunction::Min => pivot_min(values),
        AggregateFunction::Max => pivot_max(values),
        AggregateFunction::Product => pivot_product(values),
        AggregateFunction::StdDev => pivot_stdev(values),
        AggregateFunction::StdDevP => pivot_stdevp(values),
        AggregateFunction::Var => pivot_var(values),
        AggregateFunction::VarP => pivot_varp(values),
        _ => CellValue::Null, // future variants
    }
}

/// Get all available aggregation function variants.
#[must_use]
pub fn get_aggregate_functions() -> &'static [AggregateFunction] {
    &[
        AggregateFunction::Sum,
        AggregateFunction::Count,
        AggregateFunction::CountA,
        AggregateFunction::CountUnique,
        AggregateFunction::Average,
        AggregateFunction::Min,
        AggregateFunction::Max,
        AggregateFunction::Product,
        AggregateFunction::StdDev,
        AggregateFunction::StdDevP,
        AggregateFunction::Var,
        AggregateFunction::VarP,
    ]
}
