//! Filter domain types.
//!
//! This module contains TWO sets of filter types:
//!
//! 1. **OOXML types** (`AutoFilter`, `FilterColumn`, `OoxmlFilterType`, etc.) - faithfully
//!    represent the ECMA-376 `<autoFilter>` XML element. Used by the XLSX parser for
//!    input/output. NOT stored in Yrs.
//!
//! 2. **Runtime types** (`FilterState`, `ColumnFilter`, `FilterKind`, etc.) - the canonical
//!    representation stored in Yrs and used by the compute engine. XLSX import transforms
//!    OOXML types into these; XLSX export reverses the transform.

use std::sync::atomic::AtomicU64;

mod advanced;
mod conversion;
mod ooxml;
mod ooxml_sort;
mod range_ref;
mod runtime;
mod table_sort_conversion;

pub use advanced::{
    AdvancedFilterCriteriaRange, AdvancedFilterMode, AdvancedFilterRequest, AdvancedFilterResult,
    AdvancedFilterState,
};
pub use conversion::{auto_filter_to_filter_state, filter_state_to_auto_filter};
pub use ooxml::{
    AutoFilter, CalendarType, DateGroupItem, DateTimeGrouping, FilterColumn, OoxmlFilterCondition,
    OoxmlFilterType,
};
pub use ooxml_sort::{SortCondition, SortConditionBy, SortMethod, SortState};
pub use runtime::{
    ColorPosition, ColumnFilter, DynamicFilterRule, FilterCondition, FilterEvaluationResult,
    FilterHeaderInfo, FilterKind, FilterLogic, FilterOperator, FilterRecordCount, FilterSortState,
    FilterState, SortBy, SortOrder, TopBottomBy, TopBottomDirection,
};

/// Monotonic counter for generating unique filter IDs.
/// Replaces `SystemTime::now()` which panics on `wasm32-unknown-unknown`.
static NEXT_FILTER_ID: AtomicU64 = AtomicU64::new(0);

#[cfg(test)]
mod tests;
