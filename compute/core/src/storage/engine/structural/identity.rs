use super::super::YrsComputeEngine;
use super::super::mutation::{EngineMutation, MutationOutput};
use super::super::services;
use crate::snapshot::MutationResult;
use cell_types::SheetId;
use compute_wire::mutation::{concat_multi_viewport_patches, serialize_multi_viewport_patches};
use value_types::ComputeError;

impl YrsComputeEngine {
    pub(super) fn apply_get_or_create_cell_id(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::structural::get_or_create_cell_id(&mut self.stores, sheet_id, row, col)
            .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    pub(super) fn apply_update_cell_position(
        &mut self,
        sheet_id: &SheetId,
        cell_id_hex: &str,
        new_row: u32,
        new_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::structural::update_cell_position(
            &mut self.stores,
            &mut self.mirror,
            sheet_id,
            cell_id_hex,
            new_row,
            new_col,
        )
        .map(|r| (serialize_multi_viewport_patches(&[]), r))
    }

    pub(super) fn apply_relocate_cells_yrs(
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
                // Flush incremental recalc patches (clears for source +
                // writes for targets, both produced by
                // `mutation_relocate_cells`).
                let mut patches = self.flush_viewport_patches();
                // Cross-sheet: incremental patches only cover the sheet
                // the recalc touched. Rebuild the *other* sheet's
                // viewport binary so vacated source cells (cross-sheet
                // case) and freshly-written target cells (each from
                // their own sheet's perspective) are both up-to-date.
                if source_sheet_id != target_sheet_id {
                    let source_full = self.produce_full_viewport_patches(source_sheet_id);
                    let target_full = self.produce_full_viewport_patches(target_sheet_id);
                    patches = concat_multi_viewport_patches(&[patches, source_full, target_full]);
                }
                Ok((patches, result))
            }
            _ => Ok((
                serialize_multi_viewport_patches(&[]),
                MutationResult::empty(),
            )),
        }
    }
}
