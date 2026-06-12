//! Filter CRUD operations and evaluation bridge on Yrs storage.
//!
//! Port of `spreadsheet-model/src/filters.ts` (spreadsheet-model elimination).
//!
//! ## Yrs Storage Layout
//!
//! Each sheet has a `filters` map storing filter state as structured Y.Maps keyed by filter ID.
//! ```text
//! sheets: Y.Map<SheetId, Y.Map>
//!   +-- {sheetId}: Y.Map
//!       +-- filters: Y.Map
//!           +-- {filterId}: Y.Map (structured StoredFilterState fields)
//! ```
//!
//! ## Cell Identity Model
//!
//! Filter ranges are defined by CellId corner references, NOT position-based
//! ranges. This ensures filters survive row/col insert/delete operations.
//!
//! Bridge pattern:
//!   FilterState (CellId-based) -> Resolve Positions -> Evaluate -> hideRows/unhideRows
//!
//! ## Separation of Concerns
//!
//! - This module: STORAGE of filter state (CRUD in Yrs) + evaluation bridge
//! - `table/filter.rs`: Pure filter EVALUATION (bitmap computation on CellValue columns)
//!
//! We do NOT duplicate the evaluation logic from `table/filter.rs`. Instead, the
//! `evaluate_filter` method here resolves CellId positions and delegates column-level
//! evaluation to the table filter engine where possible.

// Keep this file as the compatibility facade for `storage::sheet::filters`.
// New implementation logic belongs in the focused submodules below.
mod bindings;
mod bridge;
mod codec;
mod crud;
mod evaluation;

#[cfg(test)]
mod tests;

pub use domain_types::domain::filter::{
    AdvancedFilterCriteriaRange, AdvancedFilterMode, AdvancedFilterRequest, AdvancedFilterResult,
    AdvancedFilterState, ColumnFilter, DynamicFilterRule, FilterButtonMetadata, FilterCapability,
    FilterCondition, FilterEvaluationResult, FilterHeaderInfo, FilterHeaderRange,
    FilterHeaderSourceType, FilterKind, FilterLogic, FilterMetadataBinding,
    FilterMetadataOwnerPath, FilterMetadataSourceKey, FilterOperator, FilterRecordCount,
    FilterShellMetadata, FilterSortState, FilterState, ImportFilterUnsupportedReason,
    LosslessCriterionDescriptor, SortBy, SortOrder, TopBottomBy, TopBottomDirection,
};

pub use bindings::{
    clear_filter_metadata_bindings, delete_filter_metadata_binding,
    delete_filter_metadata_binding_in_txn, delete_filter_metadata_binding_with_origin,
    delete_stale_filter_metadata_bindings_for_source_key_with_origin, get_filter_metadata_binding,
    get_filter_metadata_bindings_in_sheet, upsert_filter_metadata_binding,
    upsert_filter_metadata_binding_with_origin, upsert_import_filter_metadata_binding,
};
pub use bridge::convert_dynamic_rule;
pub use codec::write_filter_state_to_ymap;
pub use crud::{
    clear_all_column_filters, clear_all_filters, clear_column_filter, create_filter,
    create_filter_in_txn, delete_filter, delete_filter_in_txn, get_active_filter_count,
    get_active_filters, get_filter, get_filter_count, get_filter_sort_state, get_filters_in_sheet,
    get_table_filter, set_column_filter, set_filter_sort_state, upsert_filter_state,
    upsert_filter_state_with_origin, upsert_import_filter_state,
};
pub use evaluation::{evaluate_filter, get_filtered_record_count, get_unique_values};

#[allow(dead_code)]
pub type CellRange = crate::PositionRange;
