//! Filter Resolve — Convert data-dependent filter types to concrete form.
//!
//! TableTopBottomFilter and DynamicFilter depend on the actual column data:
//! - TopBottom needs to compute thresholds (top N items, top N%, top by sum)
//! - Dynamic needs to compute averages or resolve date ranges
//!
//! These functions resolve them to a concrete ValueFilter or ConditionFilter
//! that can then be evaluated row-by-row without further data access.
//!
//! Stateless. Pure.
//!
//! Ported from `table-engine/src/filter-resolve.ts`.
//!
//! **BUG FIX**: The TS code uses strict `>` and `<` for aboveAverage/belowAverage.
//! Excel uses `>=` and `<=`. This Rust port fixes this:
//! - aboveAverage -> `GreaterThanOrEqual` (NOT GreaterThan)
//! - belowAverage -> `LessThanOrEqual` (NOT LessThan)

mod average;
mod date_range;
mod top_bottom;

#[cfg(test)]
mod tests;

use average::resolve_average_filter;
use chrono::{NaiveDate, Weekday};
use date_range::resolve_date_range_filter_for_rule;

#[cfg(test)]
use average::resolve_average_filter as test_resolve_average_filter;
#[cfg(test)]
use date_range::{
    add_months as test_add_months, end_of_month as test_end_of_month, quarter as test_quarter,
    resolve_date_range_filter_for_rule as test_resolve_date_range_filter_for_rule,
    start_of_week as test_start_of_week, subtract_months as test_subtract_months,
};
#[cfg(test)]
use top_bottom::compute_top_bottom_cutoff as test_compute_top_bottom_cutoff;

use crate::types::{
    ConditionFilter, DynamicFilter, DynamicFilterRule, FilterCriteria, FilterLogic, FilterOperator,
};
use value_types::CellValue;

pub use date_range::{compute_date_range, compute_date_range_serial};
pub use top_bottom::evaluate_top_bottom_direct;

/// Resolve a DynamicFilter to a concrete FilterCriteria.
///
/// - aboveAverage / belowAverage: computes column average, returns ConditionFilter
/// - date rules (today, this week, etc.): computes date range, returns ConditionFilter with between
///
/// **BUG FIX**: aboveAverage uses `GreaterThanOrEqual` (not `GreaterThan`),
/// belowAverage uses `LessThanOrEqual` (not `LessThan`).
pub fn resolve_dynamic_filter(
    filter: &DynamicFilter,
    column_data: &[CellValue],
    now: Option<NaiveDate>,
    week_start_day: Weekday,
) -> FilterCriteria {
    match filter.rule {
        DynamicFilterRule::AboveAverage => FilterCriteria::Condition(resolve_average_filter(
            column_data,
            FilterOperator::GreaterThanOrEqual,
        )),
        DynamicFilterRule::BelowAverage => FilterCriteria::Condition(resolve_average_filter(
            column_data,
            FilterOperator::LessThanOrEqual,
        )),
        // All date rules require a `now` date
        _ => {
            let now_date = now.expect("Date-based dynamic filter requires a `now` date parameter");
            match resolve_date_range_filter_for_rule(&filter.rule, now_date, week_start_day) {
                Some(condition) => FilterCriteria::Condition(condition),
                None => {
                    // Invalid date construction (e.g. year overflow); return a filter that matches nothing.
                    FilterCriteria::Condition(ConditionFilter {
                        conditions: vec![],
                        logic: FilterLogic::And,
                    })
                }
            }
        }
    }
}
