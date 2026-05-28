//! Feature methods (filters, sorting, slicers, sparklines, grouping, subtotals) for YrsComputeEngine.

use super::YrsComputeEngine;
use crate::snapshot::MutationResult;
use crate::storage::cells::data_ops as cell_ops;
use crate::storage::sheet::{
    filters as sheet_filters, grouping as sheet_grouping, sparklines as sheet_sparklines,
};
use crate::storage::workbook::slicers as workbook_slicers;
use crate::table::types::{Slicer, SlicerCache, TableColumn};
use bridge_core as bridge;
use cell_types::SheetId;
use domain_types::domain::slicer::{StoredSlicer, StoredSlicerUpdate};
use value_types::{CellValue, ComputeError};

mod filters;
mod grouping;
mod range_ops;
mod slicers;
mod sparklines;
mod text_to_columns;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "features",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    // -------------------------------------------------------------------
    // Filters
    // -------------------------------------------------------------------

    #[bridge::write(scope = "sheet")]
    pub fn create_filter(
        &mut self,
        sheet_id: &SheetId,
        config: serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        filters::create_filter(self, sheet_id, config)
    }

    #[bridge::write(scope = "sheet")]
    pub fn delete_filter(
        &mut self,
        sheet_id: &SheetId,
        filter_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        filters::delete_filter(self, sheet_id, filter_id)
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_column_filter(
        &mut self,
        sheet_id: &SheetId,
        filter_id: &str,
        header_col: u32,
        criteria: sheet_filters::ColumnFilter,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        filters::set_column_filter(self, sheet_id, filter_id, header_col, criteria)
    }

    #[bridge::write(scope = "sheet")]
    pub fn clear_column_filter(
        &mut self,
        sheet_id: &SheetId,
        filter_id: &str,
        header_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        filters::clear_column_filter(self, sheet_id, filter_id, header_col)
    }

    #[bridge::write(scope = "sheet")]
    pub fn clear_all_column_filters(
        &mut self,
        sheet_id: &SheetId,
        filter_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        filters::clear_all_column_filters(self, sheet_id, filter_id)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_filters_in_sheet(&self, sheet_id: &SheetId) -> Vec<sheet_filters::FilterState> {
        filters::get_filters_in_sheet(self, sheet_id)
    }

    /// Apply an Excel Advanced Filter from raw user-visible range strings.
    #[bridge::write(scope = "sheet")]
    pub fn apply_advanced_filter(
        &mut self,
        sheet_id: &SheetId,
        request: sheet_filters::AdvancedFilterRequest,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        filters::apply_advanced_filter(self, sheet_id, request)
    }

    /// Evaluate a filter and atomically hide/unhide rows.
    /// Eliminates 5+ IPC round-trips from the TS domain module.
    ///
    /// After updating row visibility, triggers a full recalculation so that
    /// SUBTOTAL(101-111) and AGGREGATE formulas immediately reflect the new
    /// hidden-row state without requiring a separate `calculate()` call.
    ///
    /// Row-visibility patches (filter viewport R5.1): `apply_filter` mutates Yrs
    /// `hiddenRows` and the layout index but the incremental
    /// `serialize_mutation_result` wire format only carries cell-value
    /// patches, not row dimensions. Returning empty patches forced the TS
    /// kernel to call `forceRefreshAllViewports()` after every filter
    /// op. Now we rebuild the full viewport binary on the affected sheet
    /// (same pattern T8/sort_range used for CF-overlap rebuilds), which
    /// re-renders against the up-to-date hidden-row state.
    #[bridge::write(scope = "sheet")]
    pub fn apply_filter(
        &mut self,
        sheet_id: &SheetId,
        filter_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        filters::apply_filter(self, sheet_id, filter_id)
    }

    /// Get unique values in a filter column for populating the filter dropdown.
    /// Returns deduplicated, sorted cell values as JSON.
    #[bridge::read(scope = "sheet")]
    pub fn get_unique_column_values(
        &self,
        sheet_id: &SheetId,
        filter_id: &str,
        header_col: u32,
    ) -> Vec<CellValue> {
        filters::get_unique_column_values(self, sheet_id, filter_id, header_col)
    }

    /// Resolve a dynamic date filter rule to an inclusive Excel-serial range
    /// `[start, end]` based on the engine's current injected time.
    ///
    /// Returns `None` for non-date rules (`aboveAverage` / `belowAverage`),
    /// for which there is no static range — those rules need column data
    /// to compute a threshold and must be applied via
    /// `set_column_filter` as a `dynamic` criterion.
    ///
    /// Date cells are stored as Excel serial numbers, so the kernel uses
    /// this to construct a `between` condition filter that compares against
    /// cell values directly.  Single source of truth: the same date math
    /// runs in `evaluate_column_filter` for native filter evaluation.
    #[bridge::read(scope = "workbook")]
    pub fn compute_dynamic_filter_serial_range(
        &self,
        rule: sheet_filters::DynamicFilterRule,
    ) -> Option<(f64, f64)> {
        filters::compute_dynamic_filter_serial_range(self, rule)
    }

    // -------------------------------------------------------------------
    // Sorting
    // -------------------------------------------------------------------

    /// Sort a range of cells. Updates yrs Doc, grid_indexes, mirror, and compute.
    ///
    /// Changed from `#[bridge::read(scope = "range")]` to `#[bridge::write(scope = "range")]` because sorting
    /// mutates the yrs Doc (reorders cell positions) and must update all stores.
    ///
    /// **CF natively re-evaluated.** When the sort range overlaps a CF format
    /// on the same sheet, top-N / above-average / data-bar / color-scale rules
    /// produce different colors for cells outside the changed-cells set
    /// (e.g. a top-N rule re-ranks across the entire CF range). The
    /// incremental viewport-patch path only emits CF colors for cells in
    /// `recalc.changed_cells`, so we instead rebuild the full viewport
    /// binary on a CF-overlap sort. This obsoletes the kernel-side
    /// `forceRefreshAllViewports` workaround that used to follow every sort.
    #[bridge::write(scope = "range")]
    pub fn sort_range(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        options: super::mutation::BridgeSortOptions,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        range_ops::sort_range(
            self, sheet_id, start_row, start_col, end_row, end_col, options,
        )
    }

    // -------------------------------------------------------------------
    // Autofill
    // -------------------------------------------------------------------

    /// Fill a target range from a source range using detected patterns,
    /// series generation, and formula reference adjustment.
    ///
    /// Delegates to the `compute-fill` crate for pure computation, then
    /// applies the resulting updates to all five stores.
    #[bridge::write(scope = "sheet")]
    pub fn auto_fill(
        &mut self,
        sheet_id: &SheetId,
        request: crate::engine_types::fill::BridgeAutoFillRequest,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        range_ops::auto_fill(self, sheet_id, request)
    }

    /// Flash Fill — infer a text transformation from user-provided examples
    /// and apply it to the remaining rows.
    ///
    /// `source_range` is the column of input values; `target_range` is the
    /// column where some cells contain examples and empty cells will be filled.
    #[bridge::write(scope = "sheet")]
    pub fn flash_fill(
        &mut self,
        sheet_id: &SheetId,
        request: crate::engine_types::fill::BridgeFlashFillRequest,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        range_ops::flash_fill(self, sheet_id, request)
    }

    // -------------------------------------------------------------------
    // Copy Range
    // -------------------------------------------------------------------

    /// Copy cells from a source range to a target position.
    ///
    /// Supports value-only, formula-only (with ref adjustment), format-only,
    /// or all. Optional `skip_blanks` and `transpose` flags.
    ///
    /// Maps to OfficeJS `Range.copyFrom()`.
    ///
    /// Cross-sheet patches (filter viewport R5.3 generalization): when the source
    /// and target sheets differ, the incremental flush only carries
    /// patches for the *source* sheet's viewport (where the recalc was
    /// driven). Rebuild the target sheet's viewport binary too so the
    /// kernel's `copyRangeToSheet` no longer needs the band-aid
    /// `forceRefreshAllViewports`.
    #[bridge::write(scope = "sheet")]
    #[allow(clippy::too_many_arguments)]
    pub fn copy_range(
        &mut self,
        source_sheet_id: &SheetId,
        src_start_row: u32,
        src_start_col: u32,
        src_end_row: u32,
        src_end_col: u32,
        target_sheet_id: &SheetId,
        target_row: u32,
        target_col: u32,
        copy_type: domain_types::domain::copy::CopyType,
        skip_blanks: bool,
        transpose: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        range_ops::copy_range(
            self,
            source_sheet_id,
            src_start_row,
            src_start_col,
            src_end_row,
            src_end_col,
            target_sheet_id,
            target_row,
            target_col,
            copy_type,
            skip_blanks,
            transpose,
        )
    }

    // -------------------------------------------------------------------
    // Grouping
    // -------------------------------------------------------------------

    /// Group a range of rows, creating a new outline group.
    /// Returns the created group definition as JSON via `MutationResult.data`.
    #[bridge::write(scope = "sheet")]
    pub fn group_rows(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        end_row: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        grouping::group_rows(self, sheet_id, start_row, end_row)
    }

    /// Ungroup (remove) the innermost row group containing the range.
    #[bridge::write(scope = "sheet")]
    pub fn ungroup_rows(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        end_row: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        grouping::ungroup_rows(self, sheet_id, start_row, end_row)
    }

    /// Group a range of columns, creating a new outline group.
    /// Returns the created group definition as JSON via `MutationResult.data`.
    #[bridge::write(scope = "sheet")]
    pub fn group_columns(
        &mut self,
        sheet_id: &SheetId,
        start_col: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        grouping::group_columns(self, sheet_id, start_col, end_col)
    }

    /// Ungroup (remove) the innermost column group containing the range.
    #[bridge::write(scope = "sheet")]
    pub fn ungroup_columns(
        &mut self,
        sheet_id: &SheetId,
        start_col: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        grouping::ungroup_columns(self, sheet_id, start_col, end_col)
    }

    /// Set the collapsed state of a specific group by ID.
    #[bridge::write(scope = "sheet")]
    pub fn set_group_collapsed(
        &mut self,
        sheet_id: &SheetId,
        group_id: &str,
        collapsed: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        grouping::set_group_collapsed(self, sheet_id, group_id, collapsed)
    }

    /// Toggle the collapsed state of a group. Returns the new state via `MutationResult.data`.
    #[bridge::write(scope = "sheet")]
    pub fn toggle_group_collapsed(
        &mut self,
        sheet_id: &SheetId,
        group_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        grouping::toggle_group_collapsed(self, sheet_id, group_id)
    }

    /// Expand all groups on both axes.
    #[bridge::write(scope = "sheet")]
    pub fn expand_all_groups(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        grouping::expand_all_groups(self, sheet_id)
    }

    /// Collapse all groups on both axes.
    #[bridge::write(scope = "sheet")]
    pub fn collapse_all_groups(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        grouping::collapse_all_groups(self, sheet_id)
    }

    /// Get the full grouping configuration for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_sheet_grouping_config(
        &self,
        sheet_id: &SheetId,
    ) -> sheet_grouping::SheetGroupingConfig {
        grouping::get_sheet_grouping_config(self, sheet_id)
    }

    /// Get all groups for a given axis (row or column) in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_groups(
        &self,
        sheet_id: &SheetId,
        axis: &str,
    ) -> Vec<sheet_grouping::GroupDefinition> {
        grouping::get_groups(self, sheet_id, axis)
    }

    // -------------------------------------------------------------------
    // Slicers (G5)
    // -------------------------------------------------------------------

    /// Create a new slicer from a typed config.
    /// Returns the created slicer as JSON.
    #[bridge::write(scope = "sheet")]
    pub fn create_slicer(
        &self,
        sheet_id: &SheetId,
        config: StoredSlicer,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        slicers::create_slicer(self, sheet_id, config)
    }

    /// Delete a slicer by ID.
    #[bridge::write(scope = "sheet")]
    pub fn delete_slicer(
        &self,
        _sheet_id: &SheetId,
        slicer_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        slicers::delete_slicer(self, _sheet_id, slicer_id)
    }

    /// Update a slicer's configuration with a partial update.
    #[bridge::write(scope = "sheet")]
    pub fn update_slicer_config(
        &self,
        _sheet_id: &SheetId,
        slicer_id: &str,
        update: StoredSlicerUpdate,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        slicers::update_slicer_config(self, _sheet_id, slicer_id, update)
    }

    /// Get all slicers for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_all_slicers(&self, sheet_id: &SheetId) -> Vec<StoredSlicer> {
        slicers::get_all_slicers(self, sheet_id)
    }

    /// Get all slicers across all sheets in the workbook.
    #[bridge::read(scope = "workbook")]
    pub fn get_all_slicers_workbook(&self) -> Vec<StoredSlicer> {
        slicers::get_all_slicers_workbook(self)
    }

    /// Get a slicer's current state.
    #[bridge::read(scope = "sheet")]
    pub fn get_slicer_state(&self, _sheet_id: &SheetId, slicer_id: &str) -> Option<StoredSlicer> {
        slicers::get_slicer_state(self, _sheet_id, slicer_id)
    }

    /// Toggle a slicer item selection.
    #[bridge::write(scope = "sheet")]
    pub fn toggle_slicer_item(
        &self,
        _sheet_id: &SheetId,
        slicer_id: &str,
        value: CellValue,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        slicers::toggle_slicer_item(self, _sheet_id, slicer_id, value)
    }

    /// Clear all slicer selections (show all data).
    #[bridge::write(scope = "sheet")]
    pub fn clear_slicer_selection(
        &self,
        _sheet_id: &SheetId,
        slicer_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        slicers::clear_slicer_selection(self, _sheet_id, slicer_id)
    }

    // -------------------------------------------------------------------
    // Slicer Helpers (from storage/slicers.rs)
    // -------------------------------------------------------------------

    /// Map a slicer invalidation reason to a cache invalidation event reason code.
    #[bridge::read(scope = "workbook")]
    pub fn map_slicer_invalidation_reason(
        &self,
        reason: &str,
    ) -> Result<domain_types::domain::slicer::CacheInvalidationEventReason, ComputeError> {
        slicers::map_slicer_invalidation_reason(self, reason)
    }

    /// Map a slicer disconnection reason to a disconnection event reason code.
    #[bridge::read(scope = "workbook")]
    pub fn map_slicer_disconnection_reason(
        &self,
        reason: &str,
    ) -> Result<domain_types::domain::slicer::DisconnectionEventReason, ComputeError> {
        slicers::map_slicer_disconnection_reason(self, reason)
    }

    /// Convert slicer cache items to UI-ready slicer items.
    #[bridge::read(scope = "workbook")]
    pub fn get_slicer_items_from_cache(
        &self,
        cache: SlicerCache,
    ) -> Vec<domain_types::domain::slicer::SlicerItem> {
        slicers::get_slicer_items_from_cache(self, cache)
    }

    /// Check if a slicer's source column exists in a table's columns.
    #[bridge::read(scope = "workbook")]
    pub fn is_slicer_column_connected(
        &self,
        source_column_id: &str,
        table_columns: Vec<TableColumn>,
    ) -> bool {
        slicers::is_slicer_column_connected(self, source_column_id, table_columns)
    }

    /// Find indices of slicers connected to a specific table.
    #[bridge::read(scope = "workbook")]
    pub fn find_slicers_for_table(&self, slicer_list: Vec<Slicer>, table_id: &str) -> Vec<usize> {
        slicers::find_slicers_for_table(self, slicer_list, table_id)
    }

    /// Find indices of slicers that reference deleted tables.
    #[bridge::read(scope = "workbook")]
    pub fn find_disconnected_slicers(
        &self,
        slicer_list: Vec<Slicer>,
        existing_table_ids: Vec<String>,
    ) -> Vec<usize> {
        slicers::find_disconnected_slicers(self, slicer_list, existing_table_ids)
    }

    // -------------------------------------------------------------------
    // Subtotals (G6)
    // -------------------------------------------------------------------

    /// Create subtotal rows and groups for a data range.
    /// The options should contain: group_by_column, subtotal_columns, function,
    /// summary_below_data, replace_existing, has_headers.
    /// Routes through `apply_mutation()` for proper recalc + viewport patches.
    /// Returns the `SubtotalResult` via `MutationResult.data`.
    #[bridge::write(scope = "range")]
    pub fn create_subtotals(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        options: sheet_grouping::SubtotalOptions,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        grouping::create_subtotals(
            self, sheet_id, start_row, start_col, end_row, end_col, options,
        )
    }

    /// Remove subtotal rows and associated groups from a range.
    #[bridge::write(scope = "range")]
    pub fn remove_subtotals(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        grouping::remove_subtotals(self, sheet_id, start_row, start_col, end_row, end_col)
    }

    /// Automatically detect formula patterns and create outline groups.
    /// Returns the number of groups created via `MutationResult.data`.
    #[bridge::write(scope = "range")]
    pub fn auto_outline(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        grouping::auto_outline(self, sheet_id, start_row, start_col, end_row, end_col)
    }

    /// Get current subtotal configuration for a sheet (alias for get_sheet_grouping_config).
    #[bridge::read(scope = "sheet")]
    pub fn get_subtotal_config(&self, sheet_id: &SheetId) -> sheet_grouping::SheetGroupingConfig {
        grouping::get_subtotal_config(self, sheet_id)
    }

    // -------------------------------------------------------------------
    // Sparklines
    // -------------------------------------------------------------------

    #[bridge::write(scope = "sheet")]
    pub fn add_sparkline(
        &mut self,
        sheet_id: &SheetId,
        sparkline: sheet_sparklines::Sparkline,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sparklines::add_sparkline(self, sheet_id, sparkline)
    }

    #[bridge::write(scope = "sheet")]
    pub fn update_sparkline(
        &mut self,
        sheet_id: &SheetId,
        sparkline_id: &str,
        updates: sheet_sparklines::SparklineUpdate,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sparklines::update_sparkline(self, sheet_id, sparkline_id, updates)
    }

    #[bridge::write(scope = "sheet")]
    pub fn delete_sparkline(
        &mut self,
        sheet_id: &SheetId,
        sparkline_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sparklines::delete_sparkline(self, sheet_id, sparkline_id)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_sparklines_in_sheet(&self, sheet_id: &SheetId) -> Vec<sheet_sparklines::Sparkline> {
        sparklines::get_sparklines_in_sheet(self, sheet_id)
    }

    // -------------------------------------------------------------------
    // Cell Operations
    // -------------------------------------------------------------------

    /// Remove duplicate rows from a range.
    ///
    /// filter viewport R5.3 generalization: the underlying mutation collapses
    /// rows by overwriting the dedupe range and clearing the trailing
    /// rows; the recalc captures cell-value changes at the dedupe
    /// boundary but doesn't carry the layout shift across the rest of
    /// the viewport. Rebuild the full viewport binary so the kernel's
    /// `removeDuplicates` no longer needs `forceRefreshAllViewports`.
    #[bridge::write(scope = "range")]
    #[allow(clippy::too_many_arguments)]
    pub fn remove_duplicates(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        columns: Vec<u32>,
        has_headers: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        range_ops::remove_duplicates(
            self,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            columns,
            has_headers,
        )
    }

    #[bridge::write(scope = "sheet")]
    #[allow(clippy::too_many_arguments)]
    pub fn text_to_columns(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        end_row: u32,
        source_col: u32,
        dest_row: u32,
        dest_col: u32,
        options: serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        text_to_columns::text_to_columns(
            self, sheet_id, start_row, end_row, source_col, dest_row, dest_col, options,
        )
    }

    /// Simplified text-to-columns that accepts the contract format directly.
    ///
    /// Maps the simple delimiter name ('comma', 'tab', 'semicolon', 'space', 'custom')
    /// and text qualifier ('"', "'", 'none') to the internal bridge format, then
    /// delegates to the existing `text_to_columns` implementation.
    #[bridge::write(scope = "sheet")]
    #[allow(clippy::too_many_arguments)]
    pub fn text_to_columns_simple(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        end_row: u32,
        source_col: u32,
        dest_row: u32,
        dest_col: u32,
        delimiter: &str,
        custom_delimiter: Option<String>,
        treat_consecutive_as_one: bool,
        text_qualifier: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        text_to_columns::text_to_columns_simple(
            self,
            sheet_id,
            start_row,
            end_row,
            source_col,
            dest_row,
            dest_col,
            delimiter,
            custom_delimiter,
            treat_consecutive_as_one,
            text_qualifier,
        )
    }

    // -------------------------------------------------------------------
    // Filters — additional query/mutation methods
    // -------------------------------------------------------------------

    /// Get a single filter by ID.
    #[bridge::read(scope = "sheet")]
    pub fn get_filter(
        &self,
        sheet_id: &SheetId,
        filter_id: &str,
    ) -> Option<sheet_filters::FilterState> {
        filters::get_filter(self, sheet_id, filter_id)
    }

    /// Get the count of filters in a sheet.
    /// Skipped for napi: usize is not supported by napi-rs FFI.
    #[bridge::read(scope = "sheet")]
    #[bridge::skip(napi)]
    pub fn get_filter_count(&self, sheet_id: &SheetId) -> usize {
        filters::get_filter_count(self, sheet_id)
    }

    /// Get the filter associated with a table by table ID.
    #[bridge::read(scope = "sheet")]
    pub fn get_table_filter(
        &self,
        sheet_id: &SheetId,
        table_id: &str,
    ) -> Option<sheet_filters::FilterState> {
        filters::get_table_filter(self, sheet_id, table_id)
    }

    /// Get all active filters (those with non-empty column_filters) in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_active_filters(&self, sheet_id: &SheetId) -> Vec<sheet_filters::FilterState> {
        filters::get_active_filters(self, sheet_id)
    }

    /// Get count of active column filters across all filters in a sheet.
    /// Skipped for napi: usize is not supported by napi-rs FFI.
    #[bridge::read(scope = "sheet")]
    #[bridge::skip(napi)]
    pub fn get_active_filter_count(&self, sheet_id: &SheetId) -> usize {
        filters::get_active_filter_count(self, sheet_id)
    }

    /// Set the sort state for a filter.
    #[bridge::write(scope = "sheet")]
    pub fn set_filter_sort_state(
        &mut self,
        sheet_id: &SheetId,
        filter_id: &str,
        sort_state: Option<sheet_filters::FilterSortState>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        filters::set_filter_sort_state(self, sheet_id, filter_id, sort_state)
    }

    /// Get the sort state for a filter.
    #[bridge::read(scope = "sheet")]
    pub fn get_filter_sort_state(
        &self,
        sheet_id: &SheetId,
        filter_id: &str,
    ) -> Option<sheet_filters::FilterSortState> {
        filters::get_filter_sort_state(self, sheet_id, filter_id)
    }

    /// Clear all filters in a sheet.
    #[bridge::write(scope = "sheet")]
    pub fn clear_all_filters(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        filters::clear_all_filters(self, sheet_id)
    }

    /// Get filtered record count (visible vs total) for a filter.
    #[bridge::read(scope = "sheet")]
    pub fn get_filtered_record_count(
        &self,
        sheet_id: &SheetId,
        filter_id: &str,
    ) -> Option<sheet_filters::FilterRecordCount> {
        filters::get_filtered_record_count(self, sheet_id, filter_id)
    }

    // -------------------------------------------------------------------
    // Sparklines — additional query/mutation methods
    // -------------------------------------------------------------------

    /// Get a sparkline by ID.
    #[bridge::read(scope = "sheet")]
    pub fn get_sparkline(
        &self,
        sheet_id: &SheetId,
        sparkline_id: &str,
    ) -> Option<sheet_sparklines::Sparkline> {
        sparklines::get_sparkline(self, sheet_id, sparkline_id)
    }

    /// Get sparkline at a specific cell (O(1) lookup via cell index).
    #[bridge::read(scope = "cell")]
    pub fn get_sparkline_at_cell(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<sheet_sparklines::Sparkline> {
        sparklines::get_sparkline_at_cell(self, sheet_id, row, col)
    }

    /// Add a sparkline group.
    #[bridge::write(scope = "sheet")]
    pub fn add_sparkline_group(
        &mut self,
        sheet_id: &SheetId,
        group: sheet_sparklines::SparklineGroup,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sparklines::add_sparkline_group(self, sheet_id, group)
    }

    /// Get a sparkline group by ID.
    #[bridge::read(scope = "sheet")]
    pub fn get_sparkline_group(
        &self,
        sheet_id: &SheetId,
        group_id: &str,
    ) -> Option<sheet_sparklines::SparklineGroup> {
        sparklines::get_sparkline_group(self, sheet_id, group_id)
    }

    /// Get all sparkline groups in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_sparkline_groups_in_sheet(
        &self,
        sheet_id: &SheetId,
    ) -> Vec<sheet_sparklines::SparklineGroup> {
        sparklines::get_sparkline_groups_in_sheet(self, sheet_id)
    }

    /// Delete a sparkline group. If delete_sparklines is true, member sparklines are also deleted.
    #[bridge::write(scope = "sheet")]
    pub fn delete_sparkline_group(
        &mut self,
        sheet_id: &SheetId,
        group_id: &str,
        delete_sparklines: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sparklines::delete_sparkline_group(self, sheet_id, group_id, delete_sparklines)
    }

    /// Clear sparklines in a range.
    #[bridge::write(scope = "range")]
    pub fn clear_sparklines_in_range(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sparklines::clear_sparklines_in_range(
            self, sheet_id, start_row, start_col, end_row, end_col,
        )
    }

    /// Clear all sparklines and groups for a sheet.
    #[bridge::write(scope = "sheet")]
    pub fn clear_sparklines_for_sheet(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        sparklines::clear_sparklines_for_sheet(self, sheet_id)
    }

    /// Check if a cell has a sparkline (O(1) via cell index).
    #[bridge::read(scope = "cell")]
    pub fn has_sparkline(&self, sheet_id: &SheetId, row: u32, col: u32) -> bool {
        sparklines::has_sparkline(self, sheet_id, row, col)
    }

    // -------------------------------------------------------------------
    // Grouping — additional query/mutation methods
    // -------------------------------------------------------------------

    /// Get a group by ID within a single sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_group_in_sheet(
        &self,
        sheet_id: &SheetId,
        group_id: &str,
    ) -> Option<sheet_grouping::GroupDefinition> {
        grouping::get_group_in_sheet(self, sheet_id, group_id)
    }

    /// Get row outline levels for a range.
    #[bridge::read(scope = "sheet")]
    pub fn get_row_outline_levels(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        end_row: u32,
    ) -> Vec<sheet_grouping::OutlineLevel> {
        grouping::get_row_outline_levels(self, sheet_id, start_row, end_row)
    }

    /// Get column outline levels for a range.
    #[bridge::read(scope = "sheet")]
    pub fn get_column_outline_levels(
        &self,
        sheet_id: &SheetId,
        start_col: u32,
        end_col: u32,
    ) -> Vec<sheet_grouping::OutlineLevel> {
        grouping::get_column_outline_levels(self, sheet_id, start_col, end_col)
    }

    /// Get the maximum outline level for an axis.
    #[bridge::read(scope = "sheet")]
    pub fn get_max_outline_level(&self, sheet_id: &SheetId, axis: &str) -> u32 {
        grouping::get_max_outline_level(self, sheet_id, axis)
    }

    /// Get outline gutter dimensions (width, height) based on max outline levels.
    #[bridge::read(scope = "sheet")]
    pub fn get_outline_gutter_dimensions(
        &self,
        sheet_id: &SheetId,
        level_width: u32,
        level_height: u32,
    ) -> Result<serde_json::Value, ComputeError> {
        grouping::get_outline_gutter_dimensions(self, sheet_id, level_width, level_height)
    }

    /// Get outline level buttons for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_outline_level_buttons(
        &self,
        sheet_id: &SheetId,
    ) -> Vec<sheet_grouping::OutlineLevelButton> {
        grouping::get_outline_level_buttons(self, sheet_id)
    }

    /// Get outline render data for a viewport.
    #[bridge::read(scope = "sheet")]
    pub fn get_outline_render_data(
        &self,
        sheet_id: &SheetId,
        viewport: sheet_grouping::Viewport,
    ) -> sheet_grouping::OutlineRenderData {
        grouping::get_outline_render_data(self, sheet_id, viewport)
    }

    /// Get outline symbols for a viewport.
    #[bridge::read(scope = "sheet")]
    pub fn get_outline_symbols(
        &self,
        sheet_id: &SheetId,
        viewport: sheet_grouping::Viewport,
    ) -> Vec<sheet_grouping::OutlineSymbol> {
        grouping::get_outline_symbols(self, sheet_id, viewport)
    }

    /// Check whether outlines should be rendered for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn should_render_outlines(&self, sheet_id: &SheetId) -> bool {
        grouping::should_render_outlines(self, sheet_id)
    }

    /// Get rows affected by a group (excludes summary row).
    #[bridge::read(scope = "sheet")]
    pub fn get_affected_rows_by_group(&self, sheet_id: &SheetId, group_id: &str) -> Vec<u32> {
        grouping::get_affected_rows_by_group(self, sheet_id, group_id)
    }

    /// Get columns affected by a group (excludes summary column).
    #[bridge::read(scope = "sheet")]
    pub fn get_affected_columns_by_group(&self, sheet_id: &SheetId, group_id: &str) -> Vec<u32> {
        grouping::get_affected_columns_by_group(self, sheet_id, group_id)
    }

    /// Check if a row is visible based on group collapse state.
    #[bridge::read(scope = "sheet")]
    pub fn is_row_visible_by_groups(&self, sheet_id: &SheetId, row: u32) -> bool {
        grouping::is_row_visible_by_groups(self, sheet_id, row)
    }

    /// Check if a column is visible based on group collapse state.
    #[bridge::read(scope = "sheet")]
    pub fn is_column_visible_by_groups(&self, sheet_id: &SheetId, col: u32) -> bool {
        grouping::is_column_visible_by_groups(self, sheet_id, col)
    }

    /// Set level-based collapse state for all groups at or above a level.
    #[bridge::write(scope = "sheet")]
    pub fn set_level_collapsed(
        &mut self,
        sheet_id: &SheetId,
        axis: &str,
        level: u32,
        collapsed: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        grouping::set_level_collapsed(self, sheet_id, axis, level, collapsed)
    }

    /// Update outline settings (summaryRowsBelow, summaryColumnsRight, etc.).
    #[bridge::write(scope = "sheet")]
    pub fn set_outline_settings(
        &mut self,
        sheet_id: &SheetId,
        settings: sheet_grouping::OutlineSettingsUpdate,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        grouping::set_outline_settings(self, sheet_id, settings)
    }

    /// Clear row grouping in a range.
    #[bridge::write(scope = "sheet")]
    pub fn clear_row_grouping(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        end_row: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        grouping::clear_row_grouping(self, sheet_id, start_row, end_row)
    }

    /// Clear column grouping in a range.
    #[bridge::write(scope = "sheet")]
    pub fn clear_column_grouping(
        &mut self,
        sheet_id: &SheetId,
        start_col: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        grouping::clear_column_grouping(self, sheet_id, start_col, end_col)
    }

    /// Clear all grouping (rows and columns) for a sheet.
    #[bridge::write(scope = "sheet")]
    pub fn clear_all_grouping(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        grouping::clear_all_grouping(self, sheet_id)
    }

    // -------------------------------------------------------------------
    // Sorting — additional validation method
    // -------------------------------------------------------------------

    /// Check if a sort range contains merged cells (which would block sorting).
    /// Returns JSON with `hasMerges` (bool) and optional `message` (string).
    #[bridge::read(scope = "range")]
    pub fn check_sort_range_merges(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> serde_json::Value {
        range_ops::check_sort_range_merges(self, sheet_id, start_row, start_col, end_row, end_col)
    }

    // -------------------------------------------------------------------
    // Text to Columns
    // -------------------------------------------------------------------

    /// Preview text to columns split without applying changes.
    #[bridge::read(scope = "sheet")]
    pub fn preview_text_to_columns(
        &self,
        sheet_id: &SheetId,
        source_start_row: u32,
        source_end_row: u32,
        source_col: u32,
        options: cell_ops::TextToColumnsOptions,
        max_preview_rows: u32,
    ) -> Vec<Vec<String>> {
        text_to_columns::preview_text_to_columns(
            self,
            sheet_id,
            source_start_row,
            source_end_row,
            source_col,
            options,
            max_preview_rows,
        )
    }
}
