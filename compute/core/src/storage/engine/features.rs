//! Feature methods (filters, sorting, slicers, sparklines, grouping, subtotals) for YrsComputeEngine.

use super::YrsComputeEngine;
use super::mutation::{EngineMutation, MutationOutput};
use super::services::advanced_filter as advanced_filter_svc;
use super::services::features as svc;
use super::services::filters as filter_svc;
use crate::snapshot::{Axis, ChangeKind, GroupingChange, MutationResult};
use crate::storage::cells::data_ops as cell_ops;
use crate::storage::sheet::{filters, grouping, sparklines};
use crate::storage::workbook::slicers;
use crate::table::types::{Slicer, SlicerCache, TableColumn};
use bridge_core as bridge;
use cell_types::{SheetId, SheetPos};
use domain_types::domain::slicer::{StoredSlicer, StoredSlicerUpdate};
use value_types::{CellValue, ComputeError};

fn sparkline_change_positions(result: &MutationResult) -> Vec<(u32, u32)> {
    let mut positions = Vec::new();
    for change in &result.sparkline_changes {
        let Some(position) = change.position.as_ref() else {
            continue;
        };
        let key = (position.row, position.col);
        if !positions.contains(&key) {
            positions.push(key);
        }
    }
    positions
}

// ---------------------------------------------------------------------------
// SubtotalsCellAccessor adapter
// ---------------------------------------------------------------------------

/// Adapter that implements [`grouping::SubtotalsCellAccessor`] by delegating to
/// the engine's storage and structural helpers.
///
/// We cannot implement the trait directly on `YrsComputeEngine` because
/// `create_subtotals`/`remove_subtotals` need `&mut dyn SubtotalsCellAccessor`
/// while also borrowing `doc` and `sheets` immutably.  A thin wrapper that
/// captures the necessary references avoids the borrow-conflict.
struct EngineSubtotalAccessor<'a> {
    engine: &'a mut YrsComputeEngine,
}

impl<'a> grouping::SubtotalsCellAccessor for EngineSubtotalAccessor<'a> {
    fn get_cell_value(&self, sheet_id: &SheetId, row: u32, col: u32) -> String {
        self.engine
            .mirror
            .get_cell_value_at(sheet_id, SheetPos::new(row, col))
            .map(|v| format!("{}", v))
            .unwrap_or_default()
    }

    fn set_cell_value(&mut self, sheet_id: &SheetId, row: u32, col: u32, value: &str) {
        if let Some(grid) = self.engine.stores.grid_indexes.get_mut(sheet_id) {
            let cell_id = grid.ensure_cell_id(row, col);
            let _ = self
                .engine
                .set_cell(sheet_id, cell_id, row, col, value.into());
        }
    }

    fn insert_rows(&mut self, sheet_id: &SheetId, start_row: u32, count: u32) {
        use formula_types::StructureChange;
        let change = StructureChange::InsertRows {
            at: start_row,
            count,
            new_row_ids: Vec::new(),
        };
        let _ = self.engine.structure_change(sheet_id, &change);
    }

    fn delete_rows(&mut self, sheet_id: &SheetId, start_row: u32, count: u32) {
        use formula_types::StructureChange;
        let change = StructureChange::DeleteRows {
            at: start_row,
            count,
            deleted_cell_ids: Vec::new(),
        };
        let _ = self.engine.structure_change(sheet_id, &change);
    }

    fn get_cell_raw_value(&self, sheet_id: &SheetId, row: u32, col: u32) -> String {
        // Try to get formula first (raw value for SUBTOTAL detection)
        if let Some(grid) = self.engine.grid_index(sheet_id)
            && let Some(cell_id) = grid.cell_id_at(row, col)
            && let Some(f) = self.engine.compute().get_formula(&cell_id)
        {
            return f.to_string();
        }
        // Fall back to computed value
        self.engine
            .mirror
            .get_cell_value_at(sheet_id, SheetPos::new(row, col))
            .map(|v| format!("{}", v))
            .unwrap_or_default()
    }
}

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
        // Filter creation can register the filter range on existing rows
        // (ghost-cell identity allocation). Row visibility for those rows
        // is unchanged at this step, but the viewport buffer must observe
        // the new filter shape (header arrows, criteria, etc.) — emit a
        // full viewport rebuild via the same path used by
        // `produce_cf_viewport_patches`. filter viewport R5.
        let result =
            filter_svc::create_filter(&mut self.stores, &mut self.mirror, sheet_id, config)?;
        let patches = self.produce_cf_viewport_patches(sheet_id);
        Ok((patches, result))
    }

    #[bridge::write(scope = "sheet")]
    pub fn delete_filter(
        &mut self,
        sheet_id: &SheetId,
        filter_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let mut result =
            filter_svc::delete_filter(&mut self.stores, &mut self.mirror, sheet_id, filter_id)?;
        let mut recalc = self.stores.compute.full_recalc(&mut self.mirror)?;
        self.prepare_recalc_for_flush(&mut recalc);
        result.recalc = recalc;
        self.mutation.pending_recalc = None;
        Ok((self.produce_full_viewport_patches(sheet_id), result))
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_column_filter(
        &mut self,
        sheet_id: &SheetId,
        filter_id: &str,
        header_col: u32,
        criteria: filters::ColumnFilter,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = filter_svc::set_column_filter(
            &mut self.stores,
            &mut self.mirror,
            sheet_id,
            filter_id,
            header_col,
            criteria,
        )?;
        let mut result = result;
        let mut recalc = self.stores.compute.full_recalc(&mut self.mirror)?;
        self.prepare_recalc_for_flush(&mut recalc);
        result.recalc = recalc;
        self.mutation.pending_recalc = None;
        Ok((self.produce_full_viewport_patches(sheet_id), result))
    }

    #[bridge::write(scope = "sheet")]
    pub fn clear_column_filter(
        &mut self,
        sheet_id: &SheetId,
        filter_id: &str,
        header_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = filter_svc::clear_column_filter(
            &mut self.stores,
            &mut self.mirror,
            sheet_id,
            filter_id,
            header_col,
        )?;
        let mut result = result;
        let mut recalc = self.stores.compute.full_recalc(&mut self.mirror)?;
        self.prepare_recalc_for_flush(&mut recalc);
        result.recalc = recalc;
        self.mutation.pending_recalc = None;
        Ok((self.produce_full_viewport_patches(sheet_id), result))
    }

    #[bridge::write(scope = "sheet")]
    pub fn clear_all_column_filters(
        &mut self,
        sheet_id: &SheetId,
        filter_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = filter_svc::clear_all_column_filters(
            &mut self.stores,
            &mut self.mirror,
            sheet_id,
            filter_id,
        )?;
        let mut result = result;
        let mut recalc = self.stores.compute.full_recalc(&mut self.mirror)?;
        self.prepare_recalc_for_flush(&mut recalc);
        result.recalc = recalc;
        self.mutation.pending_recalc = None;
        Ok((self.produce_full_viewport_patches(sheet_id), result))
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_filters_in_sheet(&self, sheet_id: &SheetId) -> Vec<filters::FilterState> {
        filter_svc::get_filters_in_sheet(&self.stores, &self.mirror, sheet_id)
    }

    /// Apply an Excel Advanced Filter from raw user-visible range strings.
    #[bridge::write(scope = "sheet")]
    pub fn apply_advanced_filter(
        &mut self,
        sheet_id: &SheetId,
        request: filters::AdvancedFilterRequest,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let mode = request.mode;
        let mut result = advanced_filter_svc::apply_advanced_filter(
            &mut self.stores,
            &mut self.mirror,
            &mut self.mutation,
            sheet_id,
            request,
        )?;
        match mode {
            filters::AdvancedFilterMode::InPlace => {
                let mut recalc = self.stores.compute.full_recalc(&mut self.mirror)?;
                self.prepare_recalc_for_flush(&mut recalc);
                result.recalc = recalc;
                self.mutation.pending_recalc = None;
                Ok((self.produce_full_viewport_patches(sheet_id), result))
            }
            filters::AdvancedFilterMode::CopyTo => {
                self.prepare_recalc_for_flush(&mut result.recalc);
                Ok((self.flush_viewport_patches(), result))
            }
        }
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
        let mut result =
            filter_svc::apply_filter(&mut self.stores, &mut self.mirror, sheet_id, filter_id)?;

        // Recalculate so SUBTOTAL/AGGREGATE formulas pick up the new hidden-row
        // state immediately (they read `mirror.is_row_hidden()` during eval).
        let mut recalc = self.stores.compute.full_recalc(&mut self.mirror)?;
        // Run the standard post-recalc enrichment (CF cache refresh,
        // display text, validation) so the rebuild below reads a
        // consistent CF cache state for any cells whose visibility flipped.
        self.prepare_recalc_for_flush(&mut recalc);
        // Discard the incremental recalc patch — the full viewport rebuild
        // below subsumes it and includes hidden-row layout state.
        result.recalc = recalc;
        self.mutation.pending_recalc = None;
        let patches = self.produce_cf_viewport_patches(sheet_id);
        Ok((patches, result))
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
        filter_svc::get_unique_column_values(
            &self.stores,
            &self.mirror,
            sheet_id,
            filter_id,
            header_col,
        )
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
        rule: filters::DynamicFilterRule,
    ) -> Option<(f64, f64)> {
        let now_serial = crate::eval::clock::get_current_serial_timestamp();
        let now_date = value_types::serial_to_date(now_serial)?;
        let table_rule = filters::convert_dynamic_rule(&rule);
        compute_table::compute_date_range_serial(&table_rule, now_date, chrono::Weekday::Sun)
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
        match self.apply_mutation(super::mutation::EngineMutation::SortRange {
            sheet_id: *sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            options,
        })? {
            super::mutation::MutationOutput::Recalc(r) => {
                // Always use the incremental mutation-result path so that the
                // per-viewport blobs are in serialize_mutation_result_for_viewport
                // format — the format TS's BinaryMutationReader expects.  The
                // old cf_overlaps branch called produce_cf_viewport_patches which
                // emitted serialize_viewport_binary blobs (full-viewport format);
                // applyMultiViewportPatches blindly passed those to
                // BinaryMutationReader, producing garbage reads and leaving the
                // viewport stale.  For absolute-threshold CF rules ("> 70" etc.)
                // all sorted cells appear in recalc.changed_cells, so the
                // incremental path covers them correctly.
                Ok((self.flush_viewport_patches(), r))
            }
            _ => Ok((
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
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
        match self.apply_mutation(super::mutation::EngineMutation::AutoFill {
            sheet_id: *sheet_id,
            request,
        })? {
            super::mutation::MutationOutput::Recalc(r) => Ok((self.flush_viewport_patches(), r)),
            _ => Ok((
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
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
        match self.apply_mutation(super::mutation::EngineMutation::FlashFill {
            sheet_id: *sheet_id,
            request,
        })? {
            super::mutation::MutationOutput::Recalc(r) => Ok((self.flush_viewport_patches(), r)),
            _ => Ok((
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
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
        let cross_sheet = source_sheet_id != target_sheet_id;
        let target_sheet = *target_sheet_id;
        match self.apply_mutation(super::mutation::EngineMutation::CopyRange {
            source_sheet_id: *source_sheet_id,
            src_start_row,
            src_start_col,
            src_end_row,
            src_end_col,
            target_sheet_id: target_sheet,
            target_row,
            target_col,
            copy_type,
            skip_blanks,
            transpose,
        })? {
            super::mutation::MutationOutput::Recalc(r) => {
                let mut patches = self.flush_viewport_patches();
                if cross_sheet {
                    let target_full = self.produce_full_viewport_patches(&target_sheet);
                    patches = compute_wire::mutation::concat_multi_viewport_patches(&[
                        patches,
                        target_full,
                    ]);
                }
                Ok((patches, r))
            }
            _ => Ok((
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
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
        svc::group_rows(&mut self.stores, sheet_id, start_row, end_row).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Ungroup (remove) the innermost row group containing the range.
    #[bridge::write(scope = "sheet")]
    pub fn ungroup_rows(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        end_row: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = svc::ungroup_rows(&mut self.stores, sheet_id, start_row, end_row)?;
        let patches = self.produce_full_viewport_patches(sheet_id);
        Ok((patches, result))
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
        svc::group_columns(&mut self.stores, sheet_id, start_col, end_col).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Ungroup (remove) the innermost column group containing the range.
    #[bridge::write(scope = "sheet")]
    pub fn ungroup_columns(
        &mut self,
        sheet_id: &SheetId,
        start_col: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = svc::ungroup_columns(&mut self.stores, sheet_id, start_col, end_col)?;
        let patches = self.produce_full_viewport_patches(sheet_id);
        Ok((patches, result))
    }

    /// Set the collapsed state of a specific group by ID.
    #[bridge::write(scope = "sheet")]
    pub fn set_group_collapsed(
        &mut self,
        sheet_id: &SheetId,
        group_id: &str,
        collapsed: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = svc::set_group_collapsed(&mut self.stores, sheet_id, group_id, collapsed)?;
        let patches = self.produce_full_viewport_patches(sheet_id);
        Ok((patches, result))
    }

    /// Toggle the collapsed state of a group. Returns the new state via `MutationResult.data`.
    #[bridge::write(scope = "sheet")]
    pub fn toggle_group_collapsed(
        &mut self,
        sheet_id: &SheetId,
        group_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = svc::toggle_group_collapsed(&mut self.stores, sheet_id, group_id)?;
        let patches = self.produce_full_viewport_patches(sheet_id);
        Ok((patches, result))
    }

    /// Expand all groups on both axes.
    #[bridge::write(scope = "sheet")]
    pub fn expand_all_groups(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = svc::expand_all_groups(&mut self.stores, sheet_id)?;
        let patches = self.produce_full_viewport_patches(sheet_id);
        Ok((patches, result))
    }

    /// Collapse all groups on both axes.
    #[bridge::write(scope = "sheet")]
    pub fn collapse_all_groups(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = svc::collapse_all_groups(&mut self.stores, sheet_id)?;
        let patches = self.produce_full_viewport_patches(sheet_id);
        Ok((patches, result))
    }

    /// Get the full grouping configuration for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_sheet_grouping_config(&self, sheet_id: &SheetId) -> grouping::SheetGroupingConfig {
        svc::get_sheet_grouping_config(&self.stores, sheet_id)
    }

    /// Get all groups for a given axis (row or column) in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_groups(&self, sheet_id: &SheetId, axis: &str) -> Vec<grouping::GroupDefinition> {
        svc::get_groups(&self.stores, sheet_id, axis)
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
        svc::create_slicer(&self.stores, sheet_id, config).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Delete a slicer by ID.
    #[bridge::write(scope = "sheet")]
    pub fn delete_slicer(
        &self,
        _sheet_id: &SheetId,
        slicer_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        svc::delete_slicer(&self.stores, slicer_id).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Update a slicer's configuration with a partial update.
    #[bridge::write(scope = "sheet")]
    pub fn update_slicer_config(
        &self,
        _sheet_id: &SheetId,
        slicer_id: &str,
        update: StoredSlicerUpdate,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        svc::update_slicer_config(&self.stores, slicer_id, &update).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Get all slicers for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_all_slicers(&self, sheet_id: &SheetId) -> Vec<StoredSlicer> {
        svc::get_all_slicers(&self.stores, sheet_id)
    }

    /// Get all slicers across all sheets in the workbook.
    #[bridge::read(scope = "workbook")]
    pub fn get_all_slicers_workbook(&self) -> Vec<StoredSlicer> {
        svc::get_all_slicers_workbook(&self.stores)
    }

    /// Get a slicer's current state.
    #[bridge::read(scope = "sheet")]
    pub fn get_slicer_state(&self, _sheet_id: &SheetId, slicer_id: &str) -> Option<StoredSlicer> {
        svc::get_slicer_state(&self.stores, slicer_id)
    }

    /// Toggle a slicer item selection.
    #[bridge::write(scope = "sheet")]
    pub fn toggle_slicer_item(
        &self,
        _sheet_id: &SheetId,
        slicer_id: &str,
        value: CellValue,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        svc::toggle_slicer_item(&self.stores, slicer_id, &value).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Clear all slicer selections (show all data).
    #[bridge::write(scope = "sheet")]
    pub fn clear_slicer_selection(
        &self,
        _sheet_id: &SheetId,
        slicer_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        svc::clear_slicer_selection(&self.stores, slicer_id).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    // -------------------------------------------------------------------
    // Slicer Helpers (from storage/slicers.rs)
    // -------------------------------------------------------------------

    /// Map a slicer invalidation reason to a cache invalidation event reason code.
    #[bridge::read(scope = "workbook")]
    pub fn map_slicer_invalidation_reason(
        &self,
        reason: &str,
    ) -> Result<slicers::CacheInvalidationEventReason, ComputeError> {
        svc::map_slicer_invalidation_reason(reason)
    }

    /// Map a slicer disconnection reason to a disconnection event reason code.
    #[bridge::read(scope = "workbook")]
    pub fn map_slicer_disconnection_reason(
        &self,
        reason: &str,
    ) -> Result<slicers::DisconnectionEventReason, ComputeError> {
        svc::map_slicer_disconnection_reason(reason)
    }

    /// Convert slicer cache items to UI-ready slicer items.
    #[bridge::read(scope = "workbook")]
    pub fn get_slicer_items_from_cache(&self, cache: SlicerCache) -> Vec<slicers::SlicerItem> {
        svc::get_slicer_items_from_cache(cache)
    }

    /// Check if a slicer's source column exists in a table's columns.
    #[bridge::read(scope = "workbook")]
    pub fn is_slicer_column_connected(
        &self,
        source_column_id: &str,
        table_columns: Vec<TableColumn>,
    ) -> bool {
        svc::is_slicer_column_connected(source_column_id, &table_columns)
    }

    /// Find indices of slicers connected to a specific table.
    #[bridge::read(scope = "workbook")]
    pub fn find_slicers_for_table(&self, slicer_list: Vec<Slicer>, table_id: &str) -> Vec<usize> {
        svc::find_slicers_for_table(&slicer_list, table_id)
    }

    /// Find indices of slicers that reference deleted tables.
    #[bridge::read(scope = "workbook")]
    pub fn find_disconnected_slicers(
        &self,
        slicer_list: Vec<Slicer>,
        existing_table_ids: Vec<String>,
    ) -> Vec<usize> {
        svc::find_disconnected_slicers(&slicer_list, &existing_table_ids)
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
        options: grouping::SubtotalOptions,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        match self.apply_mutation(EngineMutation::CreateSubtotals {
            sheet_id: *sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            options,
        })? {
            MutationOutput::Recalc(result) => Ok((
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                result,
            )),
            _ => Ok((
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
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
        let range = grouping::CellRange::new(start_row, start_col, end_row, end_col);
        let doc = self.stores.storage.doc().clone();
        let sheets_map = doc.get_or_insert_map("sheets");
        let mut accessor = EngineSubtotalAccessor { engine: self };
        grouping::remove_subtotals(&doc, &sheets_map, &mut accessor, sheet_id, &range);
        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
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
        let range = grouping::CellRange::new(start_row, start_col, end_row, end_col);
        let doc = self.stores.storage.doc().clone();
        let sheets_map = doc.get_or_insert_map("sheets");
        let accessor = EngineSubtotalAccessor { engine: self };
        let count = grouping::auto_outline(&doc, &sheets_map, &accessor, sheet_id, &range);
        let mut result = MutationResult::empty();
        result.grouping_changes.push(GroupingChange {
            sheet_id: sheet_id.to_uuid_string(),
            axis: Axis::Row,
            kind: ChangeKind::Set,
        });
        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            result.with_data(&count)?,
        ))
    }

    /// Get current subtotal configuration for a sheet (alias for get_sheet_grouping_config).
    #[bridge::read(scope = "sheet")]
    pub fn get_subtotal_config(&self, sheet_id: &SheetId) -> grouping::SheetGroupingConfig {
        svc::get_sheet_grouping_config(&self.stores, sheet_id)
    }

    // -------------------------------------------------------------------
    // Sparklines
    // -------------------------------------------------------------------

    #[bridge::write(scope = "sheet")]
    pub fn add_sparkline(
        &mut self,
        sheet_id: &SheetId,
        sparkline: sparklines::Sparkline,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = svc::add_sparkline(&self.stores, sheet_id, &sparkline)?;
        let positions = sparkline_change_positions(&result);
        let patches = if positions.is_empty() {
            compute_wire::mutation::serialize_multi_viewport_patches(&[])
        } else {
            self.produce_sparkline_viewport_patches(sheet_id, &positions)
        };
        Ok((patches, result))
    }

    #[bridge::write(scope = "sheet")]
    pub fn update_sparkline(
        &mut self,
        sheet_id: &SheetId,
        sparkline_id: &str,
        updates: sparklines::SparklineUpdate,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = svc::update_sparkline(&self.stores, sheet_id, sparkline_id, &updates)?;
        let positions = sparkline_change_positions(&result);
        let patches = if positions.is_empty() {
            compute_wire::mutation::serialize_multi_viewport_patches(&[])
        } else {
            self.produce_sparkline_viewport_patches(sheet_id, &positions)
        };
        Ok((patches, result))
    }

    #[bridge::write(scope = "sheet")]
    pub fn delete_sparkline(
        &mut self,
        sheet_id: &SheetId,
        sparkline_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = svc::delete_sparkline(&self.stores, sheet_id, sparkline_id)?;
        let positions = sparkline_change_positions(&result);
        let patches = if positions.is_empty() {
            compute_wire::mutation::serialize_multi_viewport_patches(&[])
        } else {
            self.produce_sparkline_viewport_patches(sheet_id, &positions)
        };
        Ok((patches, result))
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_sparklines_in_sheet(&self, sheet_id: &SheetId) -> Vec<sparklines::Sparkline> {
        svc::get_sparklines_in_sheet(&self.stores, sheet_id)
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
        let sid = *sheet_id;
        match self.apply_mutation(super::mutation::EngineMutation::RemoveDuplicates {
            sheet_id: sid,
            start_row,
            start_col,
            end_row,
            end_col,
            columns,
            has_headers,
        })? {
            super::mutation::MutationOutput::Recalc(r) => {
                // Discard the pending incremental recalc — the full
                // viewport rebuild subsumes it and captures the layout
                // collapse correctly.
                self.mutation.pending_recalc = None;
                Ok((self.produce_full_viewport_patches(&sid), r))
            }
            _ => Ok((
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
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
        let mut result = svc::text_to_columns(
            &mut self.stores,
            &mut self.mirror,
            &mut self.mutation,
            *sheet_id,
            start_row,
            end_row,
            source_col,
            dest_row,
            dest_col,
            options,
        )?;
        // R5: seed `pending_recalc` so `flush_viewport_patches` has changes to
        // serialize. The kernel-side `forceRefreshAllViewports` band-aid that
        // used to mask this gap was removed in recalc idempotency.
        self.prepare_recalc_for_flush(&mut result.recalc);
        Ok((self.flush_viewport_patches(), result))
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
        // Build the nested JSON options that the existing service function expects
        let mut delimiters = serde_json::json!({
            "tab": delimiter == "tab",
            "comma": delimiter == "comma",
            "semicolon": delimiter == "semicolon",
            "space": delimiter == "space",
        });
        if delimiter == "custom"
            && let Some(ref cd) = custom_delimiter
        {
            delimiters["other"] = serde_json::Value::String(cd.clone());
        }

        let tq = match text_qualifier {
            "'" | "singleQuote" => "singleQuote",
            "none" => "none",
            _ => "doubleQuote",
        };

        let options = serde_json::json!({
            "splitType": "Delimited",
            "delimiters": delimiters,
            "treatConsecutiveAsOne": treat_consecutive_as_one,
            "textQualifier": tq,
        });

        let mut result = svc::text_to_columns(
            &mut self.stores,
            &mut self.mirror,
            &mut self.mutation,
            *sheet_id,
            start_row,
            end_row,
            source_col,
            dest_row,
            dest_col,
            options,
        )?;
        // R5: seed `pending_recalc` so `flush_viewport_patches` has changes to
        // serialize. Same fix as `text_to_columns`.
        self.prepare_recalc_for_flush(&mut result.recalc);
        Ok((self.flush_viewport_patches(), result))
    }

    // -------------------------------------------------------------------
    // Filters — additional query/mutation methods
    // -------------------------------------------------------------------

    /// Get a single filter by ID.
    #[bridge::read(scope = "sheet")]
    pub fn get_filter(&self, sheet_id: &SheetId, filter_id: &str) -> Option<filters::FilterState> {
        filter_svc::get_filter(&self.stores, sheet_id, filter_id)
    }

    /// Get the count of filters in a sheet.
    /// Skipped for napi: usize is not supported by napi-rs FFI.
    #[bridge::read(scope = "sheet")]
    #[bridge::skip(napi)]
    pub fn get_filter_count(&self, sheet_id: &SheetId) -> usize {
        filter_svc::get_filter_count(&self.stores, sheet_id)
    }

    /// Get the filter associated with a table by table ID.
    #[bridge::read(scope = "sheet")]
    pub fn get_table_filter(
        &self,
        sheet_id: &SheetId,
        table_id: &str,
    ) -> Option<filters::FilterState> {
        filter_svc::get_table_filter(&self.stores, sheet_id, table_id)
    }

    /// Get all active filters (those with non-empty column_filters) in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_active_filters(&self, sheet_id: &SheetId) -> Vec<filters::FilterState> {
        filter_svc::get_active_filters(&self.stores, sheet_id)
    }

    /// Get count of active column filters across all filters in a sheet.
    /// Skipped for napi: usize is not supported by napi-rs FFI.
    #[bridge::read(scope = "sheet")]
    #[bridge::skip(napi)]
    pub fn get_active_filter_count(&self, sheet_id: &SheetId) -> usize {
        filter_svc::get_active_filter_count(&self.stores, sheet_id)
    }

    /// Set the sort state for a filter.
    #[bridge::write(scope = "sheet")]
    pub fn set_filter_sort_state(
        &mut self,
        sheet_id: &SheetId,
        filter_id: &str,
        sort_state: Option<filters::FilterSortState>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        filter_svc::set_filter_sort_state(&mut self.stores, sheet_id, filter_id, sort_state).map(
            |r| {
                (
                    compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                    r,
                )
            },
        )
    }

    /// Get the sort state for a filter.
    #[bridge::read(scope = "sheet")]
    pub fn get_filter_sort_state(
        &self,
        sheet_id: &SheetId,
        filter_id: &str,
    ) -> Option<filters::FilterSortState> {
        filter_svc::get_filter_sort_state(&self.stores, sheet_id, filter_id)
    }

    /// Clear all filters in a sheet.
    #[bridge::write(scope = "sheet")]
    pub fn clear_all_filters(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        filter_svc::clear_all_filters(&mut self.stores, sheet_id).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Get filtered record count (visible vs total) for a filter.
    #[bridge::read(scope = "sheet")]
    pub fn get_filtered_record_count(
        &self,
        sheet_id: &SheetId,
        filter_id: &str,
    ) -> Option<filters::FilterRecordCount> {
        filter_svc::get_filtered_record_count(&self.stores, &self.mirror, sheet_id, filter_id)
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
    ) -> Option<sparklines::Sparkline> {
        svc::get_sparkline(&self.stores, sheet_id, sparkline_id)
    }

    /// Get sparkline at a specific cell (O(1) lookup via cell index).
    #[bridge::read(scope = "cell")]
    pub fn get_sparkline_at_cell(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<sparklines::Sparkline> {
        svc::get_sparkline_at_cell(&self.stores, sheet_id, row, col)
    }

    /// Add a sparkline group.
    #[bridge::write(scope = "sheet")]
    pub fn add_sparkline_group(
        &mut self,
        sheet_id: &SheetId,
        group: sparklines::SparklineGroup,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = svc::add_sparkline_group(&mut self.stores, sheet_id, &group)?;
        let positions = sparkline_change_positions(&result);
        let patches = if positions.is_empty() {
            compute_wire::mutation::serialize_multi_viewport_patches(&[])
        } else {
            self.produce_sparkline_viewport_patches(sheet_id, &positions)
        };
        Ok((patches, result))
    }

    /// Get a sparkline group by ID.
    #[bridge::read(scope = "sheet")]
    pub fn get_sparkline_group(
        &self,
        sheet_id: &SheetId,
        group_id: &str,
    ) -> Option<sparklines::SparklineGroup> {
        svc::get_sparkline_group(&self.stores, sheet_id, group_id)
    }

    /// Get all sparkline groups in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_sparkline_groups_in_sheet(
        &self,
        sheet_id: &SheetId,
    ) -> Vec<sparklines::SparklineGroup> {
        svc::get_sparkline_groups_in_sheet(&self.stores, sheet_id)
    }

    /// Delete a sparkline group. If delete_sparklines is true, member sparklines are also deleted.
    #[bridge::write(scope = "sheet")]
    pub fn delete_sparkline_group(
        &mut self,
        sheet_id: &SheetId,
        group_id: &str,
        delete_sparklines: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result =
            svc::delete_sparkline_group(&mut self.stores, sheet_id, group_id, delete_sparklines)?;
        let positions = if delete_sparklines {
            sparkline_change_positions(&result)
        } else {
            Vec::new()
        };
        let patches = if positions.is_empty() {
            compute_wire::mutation::serialize_multi_viewport_patches(&[])
        } else {
            self.produce_sparkline_viewport_patches(sheet_id, &positions)
        };
        Ok((patches, result))
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
        svc::clear_sparklines_in_range(
            &mut self.stores,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
        )
        .map(|result| {
            let positions = sparkline_change_positions(&result);
            let patches = if positions.is_empty() {
                compute_wire::mutation::serialize_multi_viewport_patches(&[])
            } else {
                self.produce_sparkline_viewport_patches(sheet_id, &positions)
            };
            (patches, result)
        })
    }

    /// Clear all sparklines and groups for a sheet.
    #[bridge::write(scope = "sheet")]
    pub fn clear_sparklines_for_sheet(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = svc::clear_sparklines_for_sheet(&mut self.stores, sheet_id)?;
        let positions = sparkline_change_positions(&result);
        let patches = if positions.is_empty() {
            compute_wire::mutation::serialize_multi_viewport_patches(&[])
        } else {
            self.produce_sparkline_viewport_patches(sheet_id, &positions)
        };
        Ok((patches, result))
    }

    /// Check if a cell has a sparkline (O(1) via cell index).
    #[bridge::read(scope = "cell")]
    pub fn has_sparkline(&self, sheet_id: &SheetId, row: u32, col: u32) -> bool {
        svc::has_sparkline(&self.stores, sheet_id, row, col)
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
    ) -> Option<grouping::GroupDefinition> {
        svc::get_group_in_sheet(&self.stores, sheet_id, group_id)
    }

    /// Get row outline levels for a range.
    #[bridge::read(scope = "sheet")]
    pub fn get_row_outline_levels(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        end_row: u32,
    ) -> Vec<grouping::OutlineLevel> {
        svc::get_row_outline_levels(&self.stores, sheet_id, start_row, end_row)
    }

    /// Get column outline levels for a range.
    #[bridge::read(scope = "sheet")]
    pub fn get_column_outline_levels(
        &self,
        sheet_id: &SheetId,
        start_col: u32,
        end_col: u32,
    ) -> Vec<grouping::OutlineLevel> {
        svc::get_column_outline_levels(&self.stores, sheet_id, start_col, end_col)
    }

    /// Get the maximum outline level for an axis.
    #[bridge::read(scope = "sheet")]
    pub fn get_max_outline_level(&self, sheet_id: &SheetId, axis: &str) -> u32 {
        svc::get_max_outline_level(&self.stores, sheet_id, axis)
    }

    /// Get outline gutter dimensions (width, height) based on max outline levels.
    #[bridge::read(scope = "sheet")]
    pub fn get_outline_gutter_dimensions(
        &self,
        sheet_id: &SheetId,
        level_width: u32,
        level_height: u32,
    ) -> Result<serde_json::Value, ComputeError> {
        svc::get_outline_gutter_dimensions(&self.stores, sheet_id, level_width, level_height)
    }

    /// Get outline level buttons for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_outline_level_buttons(
        &self,
        sheet_id: &SheetId,
    ) -> Vec<grouping::OutlineLevelButton> {
        svc::get_outline_level_buttons(&self.stores, sheet_id)
    }

    /// Get outline render data for a viewport.
    #[bridge::read(scope = "sheet")]
    pub fn get_outline_render_data(
        &self,
        sheet_id: &SheetId,
        viewport: grouping::Viewport,
    ) -> grouping::OutlineRenderData {
        svc::get_outline_render_data(&self.stores, sheet_id, &viewport)
    }

    /// Get outline symbols for a viewport.
    #[bridge::read(scope = "sheet")]
    pub fn get_outline_symbols(
        &self,
        sheet_id: &SheetId,
        viewport: grouping::Viewport,
    ) -> Vec<grouping::OutlineSymbol> {
        svc::get_outline_symbols(&self.stores, sheet_id, &viewport)
    }

    /// Check whether outlines should be rendered for a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn should_render_outlines(&self, sheet_id: &SheetId) -> bool {
        svc::should_render_outlines(&self.stores, sheet_id)
    }

    /// Get rows affected by a group (excludes summary row).
    #[bridge::read(scope = "sheet")]
    pub fn get_affected_rows_by_group(&self, sheet_id: &SheetId, group_id: &str) -> Vec<u32> {
        svc::get_affected_rows_by_group(&self.stores, sheet_id, group_id)
    }

    /// Get columns affected by a group (excludes summary column).
    #[bridge::read(scope = "sheet")]
    pub fn get_affected_columns_by_group(&self, sheet_id: &SheetId, group_id: &str) -> Vec<u32> {
        svc::get_affected_columns_by_group(&self.stores, sheet_id, group_id)
    }

    /// Check if a row is visible based on group collapse state.
    #[bridge::read(scope = "sheet")]
    pub fn is_row_visible_by_groups(&self, sheet_id: &SheetId, row: u32) -> bool {
        svc::is_row_visible_by_groups(&self.stores, sheet_id, row)
    }

    /// Check if a column is visible based on group collapse state.
    #[bridge::read(scope = "sheet")]
    pub fn is_column_visible_by_groups(&self, sheet_id: &SheetId, col: u32) -> bool {
        svc::is_column_visible_by_groups(&self.stores, sheet_id, col)
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
        let result = svc::set_level_collapsed(&mut self.stores, sheet_id, axis, level, collapsed)?;
        let patches = self.produce_full_viewport_patches(sheet_id);
        Ok((patches, result))
    }

    /// Update outline settings (summaryRowsBelow, summaryColumnsRight, etc.).
    #[bridge::write(scope = "sheet")]
    pub fn set_outline_settings(
        &mut self,
        sheet_id: &SheetId,
        settings: grouping::OutlineSettingsUpdate,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = svc::set_outline_settings(&mut self.stores, sheet_id, &settings)?;
        let patches = self.produce_full_viewport_patches(sheet_id);
        Ok((patches, result))
    }

    /// Clear row grouping in a range.
    #[bridge::write(scope = "sheet")]
    pub fn clear_row_grouping(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        end_row: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = svc::clear_row_grouping(&mut self.stores, sheet_id, start_row, end_row)?;
        let patches = self.produce_full_viewport_patches(sheet_id);
        Ok((patches, result))
    }

    /// Clear column grouping in a range.
    #[bridge::write(scope = "sheet")]
    pub fn clear_column_grouping(
        &mut self,
        sheet_id: &SheetId,
        start_col: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = svc::clear_column_grouping(&mut self.stores, sheet_id, start_col, end_col)?;
        let patches = self.produce_full_viewport_patches(sheet_id);
        Ok((patches, result))
    }

    /// Clear all grouping (rows and columns) for a sheet.
    #[bridge::write(scope = "sheet")]
    pub fn clear_all_grouping(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = svc::clear_all_grouping(&mut self.stores, sheet_id)?;
        let patches = self.produce_full_viewport_patches(sheet_id);
        Ok((patches, result))
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
        svc::check_sort_range_merges(
            &self.stores,
            *sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
        )
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
        svc::preview_text_to_columns(
            &self.stores,
            *sheet_id,
            source_start_row,
            source_end_row,
            source_col,
            &options,
            max_preview_rows,
        )
    }
}
