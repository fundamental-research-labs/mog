use super::super::ComputeEngine;
use super::super::mutation::{EngineMutation, MutationOutput};
use super::super::services;
use crate::snapshot::MutationResult;
use cell_types::{CellId, SheetId};
use value_types::ComputeError;

impl ComputeEngine {
    /// Resolve or allocate a native cell identity without a string/JSON round trip.
    /// Uses the same untracked identity lifetime as `get_or_create_cell_id`.
    pub fn ensure_cell_id_at(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Result<CellId, ComputeError> {
        self.without_history(|engine| {
            services::structural::ensure_cell_id_at(
                &mut engine.stores,
                &mut engine.cell_store,
                sheet_id,
                row,
                col,
            )
        })
    }

    pub(super) fn apply_get_or_create_cell_id(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Result<MutationResult, ComputeError> {
        services::structural::get_or_create_cell_id(
            &mut self.stores,
            &mut self.cell_store,
            sheet_id,
            row,
            col,
        )
    }

    pub(super) fn apply_update_cell_position(
        &mut self,
        sheet_id: &SheetId,
        cell_id_hex: &str,
        new_row: u32,
        new_col: u32,
    ) -> Result<MutationResult, ComputeError> {
        services::structural::update_cell_position(
            &mut self.stores,
            &mut self.cell_store,
            sheet_id,
            cell_id_hex,
            new_row,
            new_col,
        )
    }

    pub(super) fn apply_relocate_cells(
        &mut self,
        source_sheet_id: &SheetId,
        src_start_row: u32,
        src_start_col: u32,
        src_end_row: u32,
        src_end_col: u32,
        target_sheet_id: &SheetId,
        target_row: u32,
        target_col: u32,
    ) -> Result<MutationResult, ComputeError> {
        match self.apply_mutation(EngineMutation::RelocateCells {
            source_sheet_id: *source_sheet_id,
            src_start_row,
            src_start_col,
            src_end_row,
            src_end_col,
            target_sheet_id: *target_sheet_id,
            target_row,
            target_col,
        })? {
            MutationOutput::Recalc(result) => {
                // A relocated pivot's output cells live in the cell store's
                // `col_data` (written only by `materialize_all_pivots`), not in
                // the grid index, so the cell-relocation patches don't cover
                // them. Re-materialize here: this clears each pivot's stale
                // rendered region and re-draws at its (now updated) anchor.
                let pivots_moved = !result.pivot_changes.is_empty();
                if pivots_moved {
                    self.materialize_all_pivots();
                }
                Ok(result)
            }
            _ => Ok(MutationResult::empty()),
        }
    }
}
