//! Table engine operations — stateless, no engine instance needed.
//!
//! Covers filtering, sorting, slicer management, structured references,
//! row visibility bitmaps, and built-in table styles.

// Re-export the types consumers need
pub use compute_core::CellValue;
pub use compute_core::table::types::{
    DynamicFilter, FilterCriteria, FilterDropdownData, RowVisibility, Slicer, SlicerCache,
    SlicerSortOrder, SortSpec, StructuredRef, Table, TableCellFormat, TableRange,
    TableStructureChange, TableStyleDef, TableTopBottomFilter,
};

use compute_core::bridge_pure::TableBridge;

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

/// Evaluate a column filter against column data, returning a per-row bitmap.
pub fn evaluate_column_filter(criteria: FilterCriteria, column_data: Vec<CellValue>) -> Vec<u8> {
    TableBridge::table_evaluate_column_filter(criteria, column_data)
}

/// Resolve a dynamic filter rule against column data.
pub fn resolve_dynamic_filter(
    filter: DynamicFilter,
    column_data: Vec<CellValue>,
) -> FilterCriteria {
    TableBridge::table_resolve_dynamic_filter(filter, column_data)
}

/// Evaluate a top/bottom filter directly.
pub fn evaluate_top_bottom(filter: TableTopBottomFilter, column_data: Vec<CellValue>) -> Vec<u8> {
    TableBridge::table_evaluate_top_bottom(filter, column_data)
}

/// Build filter dropdown data for a column.
pub fn build_filter_dropdown(
    column_data: Vec<CellValue>,
    current_filter: Option<FilterCriteria>,
    row_visibility: Option<Vec<u8>>,
) -> FilterDropdownData {
    TableBridge::table_build_filter_dropdown(column_data, current_filter, row_visibility)
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

/// Compute sort permutation for multi-column sort.
pub fn compute_sort_order(
    specs: Vec<SortSpec>,
    data: Vec<Vec<CellValue>>,
    total_rows: usize,
) -> Vec<usize> {
    TableBridge::table_compute_sort_order(specs, data, total_rows)
}

// ---------------------------------------------------------------------------
// Slicer
// ---------------------------------------------------------------------------

/// Build a slicer cache from slicer definition and column data.
pub fn build_slicer_cache(
    slicer: Slicer,
    column_data: Vec<CellValue>,
    row_visibility: Option<Vec<u8>>,
) -> SlicerCache {
    TableBridge::table_build_slicer_cache(slicer, column_data, row_visibility)
}

/// Toggle a value in a slicer's selected set.
pub fn toggle_slicer_value(slicer: Slicer, value: CellValue) -> Slicer {
    TableBridge::table_toggle_slicer_value(slicer, value)
}

/// Select specific values in a slicer.
pub fn select_slicer_values(slicer: Slicer, values: Vec<CellValue>) -> Slicer {
    TableBridge::table_select_slicer_values(slicer, values)
}

/// Clear all slicer selections (show all).
pub fn clear_slicer_selection(slicer: Slicer) -> Slicer {
    TableBridge::table_clear_slicer_selection(slicer)
}

/// Select all values in a slicer using the cache.
pub fn select_all_slicer_values(slicer: Slicer, cache: SlicerCache) -> Slicer {
    TableBridge::table_select_all_slicer_values(slicer, cache)
}

/// Set the sort order on a slicer.
pub fn set_slicer_sort_order(slicer: Slicer, order: SlicerSortOrder) -> Slicer {
    TableBridge::table_set_slicer_sort_order(slicer, order)
}

/// Convert a slicer to filter criteria.
pub fn slicer_to_filter_criteria(slicer: Slicer) -> FilterCriteria {
    TableBridge::table_slicer_to_filter_criteria(slicer)
}

// ---------------------------------------------------------------------------
// Structured References
// ---------------------------------------------------------------------------

/// Resolve a structured reference against table definitions.
pub fn resolve_structured_ref(
    sref: StructuredRef,
    tables: Vec<Table>,
    current_row: Option<u32>,
) -> Vec<TableRange> {
    TableBridge::table_resolve_structured_ref(sref, tables, current_row)
}

/// Adjust a structured reference after a structural change.
pub fn adjust_structured_ref(sref: StructuredRef, change: TableStructureChange) -> StructuredRef {
    TableBridge::table_adjust_structured_ref(sref, change)
}

/// Format a structured reference to display string.
pub fn format_structured_ref(sref: StructuredRef) -> String {
    TableBridge::table_format_structured_ref(sref)
}

/// Parse a structured reference string into a `StructuredRef`.
pub fn parse_structured_ref(input: &str) -> Option<StructuredRef> {
    TableBridge::table_parse_structured_ref(input)
}

// ---------------------------------------------------------------------------
// Row Visibility / Bitmaps
// ---------------------------------------------------------------------------

/// Compose multiple row bitmaps via intersection.
pub fn compose_bitmaps(bitmaps: Vec<Vec<u8>>) -> Vec<u8> {
    TableBridge::table_compose_bitmaps(bitmaps)
}

/// Create row visibility from a bitmap.
pub fn create_row_visibility(bitmap: Vec<u8>) -> RowVisibility {
    TableBridge::table_create_row_visibility(bitmap)
}

/// Create a fully-visible bitmap for `count` rows.
pub fn all_visible(count: usize) -> RowVisibility {
    TableBridge::table_all_visible(count)
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/// Resolve cell format for a table cell at (row, col).
pub fn resolve_cell_format(table: Table, row: u32, col: u32) -> Option<TableCellFormat> {
    TableBridge::table_resolve_cell_format(table, row, col)
}

/// Get all 67 built-in Excel table style definitions.
pub fn get_built_in_styles() -> Vec<TableStyleDef> {
    TableBridge::table_get_built_in_styles()
}
