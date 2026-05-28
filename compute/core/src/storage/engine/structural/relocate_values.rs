use super::super::YrsComputeEngine;
use super::super::services;
use crate::snapshot::{MutationResult, RecalcResult};
use cell_types::SheetId;
use compute_wire::mutation::serialize_multi_viewport_patches;
use value_types::{CellValue, ComputeError};

impl YrsComputeEngine {
    pub(super) fn apply_relocate_cells_values(
        &mut self,
        sheet_id: &SheetId,
        src_start_row: u32,
        src_start_col: u32,
        src_end_row: u32,
        src_end_col: u32,
        target_row: u32,
        target_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Range guard: reject if the sheet is Range-backed. Relocating cells
        // on a Range-backed sheet would mint random CellIds via ensure_cell_id,
        // corrupting the virtual CellId scheme.
        if self
            .mirror
            .get_sheet(sheet_id)
            .is_some_and(|s| !s.range_views_is_empty())
        {
            return Err(ComputeError::RangeGuardViolation {
                sheet_id: sheet_id.to_uuid_string(),
                operation: "relocate_cells".to_string(),
            });
        }

        // 1. Collect source cell values as typed CellValues. Errors and arrays
        //    survive verbatim — `collect_relocate_values` used to render via
        //    `cell_value_to_input_string` and lose them; now it keeps them typed
        //    and we hand them off to `import_values` (lossless entry point).
        let cells_to_move = services::structural::collect_relocate_values(
            &self.mirror,
            sheet_id,
            src_start_row,
            src_start_col,
            src_end_row,
            src_end_col,
        );

        // 2. Clear source cells.
        let mut last_result = (
            serialize_multi_viewport_patches(&[]),
            MutationResult::from_recalc(RecalcResult::empty()),
        );
        for row in src_start_row..=src_end_row {
            for col in src_start_col..=src_end_col {
                let grid = self.stores.grid_indexes.get_mut(sheet_id).ok_or_else(|| {
                    ComputeError::SheetNotFound {
                        sheet_id: sheet_id.to_uuid_string(),
                    }
                })?;
                let cell_id = grid.ensure_cell_id(row, col);
                last_result = self.set_cell(
                    sheet_id,
                    cell_id,
                    row,
                    col,
                    super::super::mutation::CellInput::Clear,
                )?;
            }
        }

        // 3. Write typed values to target positions via the lossless import path.
        //    Skip Null entries — those came from empty source cells.
        let updates: Vec<(u32, u32, CellValue, Option<String>)> = cells_to_move
            .into_iter()
            .filter(|(_, _, v)| !matches!(v, CellValue::Null))
            .map(|(dr, dc, value)| (target_row + dr, target_col + dc, value, None))
            .collect();

        if !updates.is_empty() {
            last_result = self.import_values(sheet_id, updates)?;
        }

        Ok(last_result)
    }
}
