//! Tests for ComputeEngine.
//!
//! Split into focused submodules for navigability.

mod helpers;
mod test_advanced_filter;
mod test_annotations;
mod test_binary_patches;
mod test_bootstrap_hydration;
mod test_border_patches;
mod test_bulk_position;
mod test_cell_input_value;
mod test_comments;
mod test_copy_range;
mod test_copy_range_format_contracts;
mod test_core;
mod test_cross_sheet_regressions;
mod test_data_bounds;
mod test_deferred_xlsx_import;
mod test_displayed_format_projection;
mod test_floating_object_invalid_targets;
mod test_formatting;
mod test_formula_format_inheritance;
mod test_imported_autofilter_metadata;
mod test_merge_mutations;
mod test_named_range_refers_to;
mod test_native_floating_storage;
mod test_native_history;
mod test_native_history_translation;
mod test_native_history_ui_formats;
mod test_native_range_storage;
mod test_old_value;
mod test_outline_visibility;
mod test_pivot_materialization;
mod test_properties;
mod test_queries;
mod test_range_sort;
mod test_range_structural;
mod test_rebuild;
mod test_shapes;
mod test_sheet_introduce_unification;
mod test_sheet_lifecycle_runtime_hint;
mod test_sheet_metadata;
mod test_slicers;
mod test_sort_filter;
mod test_sparklines;
mod test_structural_deferred_formula_graph;
mod test_structural_viewport;
mod test_subtotals;
mod test_table_filter_lifecycle;
mod test_undo_redo_atomic_ops;
mod test_undo_redo_bulk_position;
mod test_undo_redo_core;
mod test_undo_redo_merges;
mod test_undo_redo_non_undoable_state;
mod test_undo_redo_result_payloads;
mod test_undo_redo_sort;
mod test_versioning_admission;
mod test_viewport;
mod test_workbook_settings;
mod test_xlsx_col_style_ranges;
mod test_xlsx_export;
mod test_xlsx_export_charts;
mod test_xlsx_export_comments;
mod test_xlsx_export_form_controls;
mod test_xlsx_export_imported_pivots;
mod test_xlsx_export_print;
mod test_xlsx_export_protection;
mod test_xlsx_export_sheet_inventory;
mod test_xlsx_export_tables;
mod test_xlsx_export_validations;
mod test_xlsx_export_vc03;
mod test_xlsx_export_view_state;

mod test_date_system_evaluation;
mod test_formula_result_modes;

mod test_subtotal_reference_filtering;

mod test_complex_aggregate_ranges;

mod test_rich_error_values;

mod test_legacy_reference_intersection;

mod test_lambda_callable_bindings;

mod test_index_reference_bounds;
mod test_native_history_structure;

mod test_native_history_cse;
