//! Native filter definitions, metadata bindings, and evaluation.
mod bindings;
mod bridge;
mod copy;
mod crud;
pub(crate) use copy::remap_for_copy;
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
    delete_stale_filter_metadata_bindings_for_source_key, get_filter_metadata_binding,
    get_filter_metadata_bindings_in_sheet, upsert_filter_metadata_binding,
};
pub use bridge::{
    convert_dynamic_rule, date_group_items_supported, date_group_items_supported_in_date_system,
    dynamic_filter_rule_from_ooxml_type, values_filter_to_column_filter,
};
pub use crud::{
    clear_all_column_filters, clear_all_filters, clear_column_filter, create_filter, delete_filter,
    get_active_filter_count, get_active_filters, get_filter, get_filter_count,
    get_filter_sort_state, get_filters_in_sheet, get_table_filter, set_column_filter,
    set_filter_sort_state, upsert_filter_state,
};
pub use evaluation::{
    evaluate_filter, evaluate_filter_state_with_date_system, evaluate_filter_with_date_system,
    get_filtered_record_count, get_filtered_record_count_with_date_system, get_unique_values,
};

#[allow(dead_code)]
pub type CellRange = crate::PositionRange;
