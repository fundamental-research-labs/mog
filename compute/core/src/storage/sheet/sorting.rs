//! Sorting module — port of `spreadsheet-model/src/sorting.ts`.
//!
//! Stream A1: Sort System (Cell Identity Model)
//!
//! Implements range sorting by planning row position changes within a range,
//! preserving Cell Identity. CellIds stay with their data; production callers
//! apply movement through `GridIndex::sort_rows`.

mod compare;
mod planner;
mod types;
mod validation;

#[cfg(test)]
mod planner_tests;
#[cfg(test)]
mod test_helpers;
#[cfg(test)]
mod validation_tests;

#[allow(unused_imports)]
pub(crate) use compare::{
    compare_by_color, compare_by_custom_list, compare_cell_values, get_type_priority,
    natural_compare,
};
pub use planner::compute_sorted_row_order_by_columns_with_scope;
#[allow(unused_imports)]
pub(crate) use types::{
    CellRange, SortColumnCriterion, SortConfig, SortCriterion, SortMode, SortResult,
};
pub use validation::check_sort_range_merges;
