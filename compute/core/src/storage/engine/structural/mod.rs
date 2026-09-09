//! Structural operations for ComputeEngine.
//!
//! Bridge-facing wrappers live here. Domain-specific orchestration for
//! structure changes, dimensions, merges, identity, relocation, and partial
//! cell shifts lives in private child modules.

mod dimensions;
mod identity;
mod merges;
mod partial_cell_shift;
mod relocate_values;
mod structure_change;

use super::ComputeEngine;
use crate::snapshot::MutationResult;
use bridge_core as bridge;
use cell_types::SheetId;
use formula_types::StructureChange;
use value_types::ComputeError;

#[bridge::api(
    service = "ComputeEngine",
    key = "doc_id",
    group = "structural",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl ComputeEngine {
    // -------------------------------------------------------------------
    // Structural changes
    // -------------------------------------------------------------------

    /// Insert/delete rows/cols with full three-phase update.
    #[bridge::skip(ts_bridge)]
    #[bridge::structural]
    pub fn structure_change(
        &mut self,
        sheet_id: &SheetId,
        change: &StructureChange,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| engine.apply_structure_change_bridge(sheet_id, change))
    }

    /// Move cell values from a source range to a target position (value-only move).
    /// Copies computed values to the target, clears the source. Does NOT move formulas
    /// or update formula refs.
    #[bridge::write]
    #[allow(clippy::too_many_arguments)]
    pub fn relocate_values(
        &mut self,
        sheet_id: &SheetId,
        src_start_row: u32,
        src_start_col: u32,
        src_end_row: u32,
        src_end_col: u32,
        target_row: u32,
        target_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            engine.apply_relocate_cells_values(
                sheet_id,
                src_start_row,
                src_start_col,
                src_end_row,
                src_end_col,
                target_row,
                target_col,
            )
        })
    }

    /// Insert cells with shift (right or down) in a sub-range.
    /// Extends the StructuralOps pattern for partial-range shifts.
    #[bridge::structural]
    pub fn insert_cells_with_shift(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        row_count: u32,
        col_count: u32,
        shift_right: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            engine.apply_insert_cells_with_shift(
                sheet_id,
                row,
                col,
                row_count,
                col_count,
                shift_right,
            )
        })
    }

    /// Delete cells with shift (left or up) in a sub-range.
    #[bridge::structural]
    pub fn delete_cells_with_shift(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        row_count: u32,
        col_count: u32,
        shift_left: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            engine
                .apply_delete_cells_with_shift(sheet_id, row, col, row_count, col_count, shift_left)
        })
    }

    // -------------------------------------------------------------------
    // Dimension operations
    // -------------------------------------------------------------------

    /// Set row height (in pixels from UI).
    #[bridge::write]
    pub fn set_row_height(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        height_px: f64,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| engine.apply_set_row_height(sheet_id, row, height_px))
    }

    /// Set column width (in pixels from UI).
    #[bridge::write]
    pub fn set_col_width(
        &mut self,
        sheet_id: &SheetId,
        col: u32,
        width_px: f64,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| engine.apply_set_col_width(sheet_id, col, width_px))
    }

    /// Set multiple column widths (in pixels from UI).
    #[bridge::write]
    pub fn set_col_widths(
        &mut self,
        sheet_id: &SheetId,
        widths: &[(u32, f64)],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| engine.apply_set_col_widths(sheet_id, widths))
    }

    /// Set column width in character-width units (OOXML-native).
    #[bridge::write]
    pub fn set_col_width_chars(
        &mut self,
        sheet_id: &SheetId,
        col: u32,
        width_chars: f64,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| engine.apply_set_col_width_chars(sheet_id, col, width_chars))
    }

    /// Set multiple column widths in character-width units (OOXML-native).
    #[bridge::write]
    pub fn set_col_widths_chars(
        &mut self,
        sheet_id: &SheetId,
        widths: &[(u32, f64)],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| engine.apply_set_col_widths_chars(sheet_id, widths))
    }

    /// Hide rows.
    #[bridge::write]
    pub fn hide_rows(
        &mut self,
        sheet_id: &SheetId,
        rows: &[u32],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| engine.apply_hide_rows(sheet_id, rows))
    }

    /// Unhide rows.
    #[bridge::write]
    pub fn unhide_rows(
        &mut self,
        sheet_id: &SheetId,
        rows: &[u32],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| engine.apply_unhide_rows(sheet_id, rows))
    }

    /// Hide columns.
    #[bridge::write]
    pub fn hide_columns(
        &mut self,
        sheet_id: &SheetId,
        cols: &[u32],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| engine.apply_hide_columns(sheet_id, cols))
    }

    /// Unhide columns.
    #[bridge::write]
    pub fn unhide_columns(
        &mut self,
        sheet_id: &SheetId,
        cols: &[u32],
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| engine.apply_unhide_columns(sheet_id, cols))
    }

    // -------------------------------------------------------------------
    // Merge operations
    // -------------------------------------------------------------------

    /// Merge a range of cells.
    #[bridge::write]
    pub fn merge_range(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            engine.apply_merge_range(sheet_id, start_row, start_col, end_row, end_col)
        })
    }

    /// Unmerge a range.
    #[bridge::write]
    pub fn unmerge_range(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            engine.apply_unmerge_range(sheet_id, start_row, start_col, end_row, end_col)
        })
    }

    /// Merge across: creates one merge per row in the range.
    #[bridge::write]
    pub fn merge_across(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            engine.apply_merge_across(sheet_id, start_row, start_col, end_row, end_col)
        })
    }

    /// Merge and center: unmerge overlapping, then create a single merge.
    #[bridge::write]
    pub fn merge_and_center(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            engine.apply_merge_and_center(sheet_id, start_row, start_col, end_row, end_col)
        })
    }

    /// Check whether merging a range would cause data loss.
    #[bridge::read]
    pub fn check_merge_data_loss(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> (bool, u32) {
        self.apply_check_merge_data_loss(sheet_id, start_row, start_col, end_row, end_col)
    }

    /// Check if the cell at (row, col) is the origin of a merge.
    #[bridge::read]
    pub fn is_merge_origin(&self, sheet_id: &SheetId, row: u32, col: u32) -> bool {
        self.apply_is_merge_origin(sheet_id, row, col)
    }

    /// Clear all merged regions for a sheet.
    #[bridge::write]
    pub fn clear_all_merges(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| engine.apply_clear_all_merges(sheet_id))
    }

    /// Validate merges and remove any whose CellIds can no longer be resolved.
    /// Returns a `MutationResult` with the removed count in `data`.
    #[bridge::write]
    pub fn validate_and_clean_merges(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| engine.apply_validate_and_clean_merges(sheet_id))
    }

    // -------------------------------------------------------------------
    // Cell identity and position mutations
    // -------------------------------------------------------------------

    /// Resolve a CellId at a position, allocating a stable identity if absent.
    /// Identity allocation leaves the authored value unchanged, including blanks.
    /// Returns the CellId hex string in `data`.
    #[bridge::write]
    pub fn get_or_create_cell_id(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.without_history(|engine| engine.apply_get_or_create_cell_id(sheet_id, row, col))
    }

    /// Move a stable cell identity to an available position in the native indexes.
    #[bridge::write]
    pub fn update_cell_position(
        &mut self,
        sheet_id: &SheetId,
        cell_id_hex: &str,
        new_row: u32,
        new_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.without_history(|engine| {
            engine.apply_update_cell_position(sheet_id, cell_id_hex, new_row, new_col)
        })
    }

    /// Relocate cells from a source range to a target position with CellId preservation.
    ///
    /// This is the architecturally correct implementation for cut-paste and
    /// drag-move operations. Unlike `relocate_cells` in the core engine methods
    /// (which does value-level copy), this preserves CellIds so that formulas
    /// referencing moved cells continue to resolve correctly.
    ///
    /// Handles same-sheet and cross-sheet moves, overlapping ranges, and
    /// clears target cells that are not part of the move.
    ///
    /// Routes through `apply_mutation()` for proper recalc + viewport patches.
    /// Returns a `MutationResult` with `RelocateResult` in `data`.
    ///
    /// Viewport patches (filter viewport R5.3): the relocation pipeline emits
    /// (a) clear-patches for source cells (via `clear_cells` inside
    /// `mutation_relocate_cells`), and (b) write-patches for every target
    /// position (via `set_cells_raw`). Previously this method returned
    /// empty patches because patches were stashed in
    /// `pending_recalc` but never flushed — same-sheet cut-paste in the
    /// kernel had to fall back to `executePaste` (creates new CellIds)
    /// or call `forceRefreshAllViewports` cross-sheet to mask the gap.
    /// Whenever the source and target sheets differ we additionally
    /// rebuild full viewport binaries on both sheets so the cross-sheet
    /// path no longer needs the kernel-side force-refresh.
    #[bridge::write]
    #[allow(clippy::too_many_arguments)]
    pub fn relocate_cells(
        &mut self,
        source_sheet_id: &SheetId,
        src_start_row: u32,
        src_start_col: u32,
        src_end_row: u32,
        src_end_col: u32,
        target_sheet_id: &SheetId,
        target_row: u32,
        target_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            engine.apply_relocate_cells(
                source_sheet_id,
                src_start_row,
                src_start_col,
                src_end_row,
                src_end_col,
                target_sheet_id,
                target_row,
                target_col,
            )
        })
    }
}
