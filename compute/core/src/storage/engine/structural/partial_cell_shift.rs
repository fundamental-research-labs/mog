use super::super::ComputeEngine;
use super::super::services;
use crate::cells::CellStore;
use crate::snapshot::{MutationResult, RecalcResult};
use cell_types::{CellId, SheetId};
use formula_types::StructureChange;
use value_types::ComputeError;

impl ComputeEngine {
    pub(super) fn apply_insert_cells_with_shift(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        row_count: u32,
        col_count: u32,
        shift_right: bool,
    ) -> Result<MutationResult, ComputeError> {
        if row_count == 0 || col_count == 0 {
            return Ok(MutationResult::empty());
        }

        self.ensure_partial_cell_shift_supported(sheet_id, "insert_cells_with_shift")?;
        let updates = self.collect_insert_cell_shift_updates(
            sheet_id,
            row,
            col,
            row_count,
            col_count,
            shift_right,
        )?;
        self.apply_partial_insert_shift(sheet_id, updates)
    }

    pub(super) fn apply_delete_cells_with_shift(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        row_count: u32,
        col_count: u32,
        shift_left: bool,
    ) -> Result<MutationResult, ComputeError> {
        if row_count == 0 || col_count == 0 {
            return Ok(MutationResult::empty());
        }

        self.ensure_partial_cell_shift_supported(sheet_id, "delete_cells_with_shift")?;
        let (deleted_cell_ids, updates) = self
            .collect_delete_cell_shift_plan(sheet_id, row, col, row_count, col_count, shift_left)?;
        self.apply_partial_delete_shift(sheet_id, deleted_cell_ids, updates)
    }

    fn ensure_partial_cell_shift_supported(
        &self,
        sheet_id: &SheetId,
        operation: &str,
    ) -> Result<(), ComputeError> {
        if self
            .cell_store
            .get_sheet(sheet_id)
            .is_some_and(|s| !s.range_views_is_empty())
        {
            return Err(ComputeError::RangeGuardViolation {
                sheet_id: sheet_id.to_uuid_string(),
                operation: operation.to_string(),
            });
        }
        Ok(())
    }

    fn collect_insert_cell_shift_updates(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        row_count: u32,
        col_count: u32,
        shift_right: bool,
    ) -> Result<Vec<(CellId, u32, u32)>, ComputeError> {
        let grid =
            self.stores
                .grid_indexes
                .get(sheet_id)
                .ok_or_else(|| ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                })?;

        let mut updates = Vec::new();
        if shift_right {
            let row_end = row.saturating_add(row_count).min(grid.row_count());
            let col_limit = grid.col_count();
            if col >= col_limit {
                return Ok(updates);
            }
            for r in row..row_end {
                for c in (col..col_limit).rev() {
                    if let Some(cell_id) = self
                        .cell_store
                        .resolve_cell_id(sheet_id, cell_types::SheetPos::new(r, c))
                    {
                        updates.push((cell_id, r, c.saturating_add(col_count)));
                    }
                }
            }
        } else {
            let col_end = col.saturating_add(col_count).min(grid.col_count());
            let row_limit = grid.row_count();
            if row >= row_limit {
                return Ok(updates);
            }
            for c in col..col_end {
                for r in (row..row_limit).rev() {
                    if let Some(cell_id) = self
                        .cell_store
                        .resolve_cell_id(sheet_id, cell_types::SheetPos::new(r, c))
                    {
                        updates.push((cell_id, r.saturating_add(row_count), c));
                    }
                }
            }
        }
        Ok(updates)
    }

    fn collect_delete_cell_shift_plan(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        row_count: u32,
        col_count: u32,
        shift_left: bool,
    ) -> Result<(Vec<CellId>, Vec<(CellId, u32, u32)>), ComputeError> {
        let grid =
            self.stores
                .grid_indexes
                .get(sheet_id)
                .ok_or_else(|| ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                })?;

        let mut deleted_cell_ids = Vec::new();
        let mut updates = Vec::new();

        if shift_left {
            let row_end = row.saturating_add(row_count).min(grid.row_count());
            let delete_end = col.saturating_add(col_count).min(grid.col_count());
            let col_limit = grid.col_count();
            if col >= col_limit {
                return Ok((deleted_cell_ids, updates));
            }
            for r in row..row_end {
                for c in col..delete_end {
                    if let Some(cell_id) = self
                        .cell_store
                        .resolve_cell_id(sheet_id, cell_types::SheetPos::new(r, c))
                    {
                        deleted_cell_ids.push(cell_id);
                    }
                }
                for c in delete_end..col_limit {
                    if let Some(cell_id) = self
                        .cell_store
                        .resolve_cell_id(sheet_id, cell_types::SheetPos::new(r, c))
                    {
                        updates.push((cell_id, r, c.saturating_sub(col_count)));
                    }
                }
            }
        } else {
            let col_end = col.saturating_add(col_count).min(grid.col_count());
            let delete_end = row.saturating_add(row_count).min(grid.row_count());
            let row_limit = grid.row_count();
            if row >= row_limit {
                return Ok((deleted_cell_ids, updates));
            }
            for c in col..col_end {
                for r in row..delete_end {
                    if let Some(cell_id) = self
                        .cell_store
                        .resolve_cell_id(sheet_id, cell_types::SheetPos::new(r, c))
                    {
                        deleted_cell_ids.push(cell_id);
                    }
                }
                for r in delete_end..row_limit {
                    if let Some(cell_id) = self
                        .cell_store
                        .resolve_cell_id(sheet_id, cell_types::SheetPos::new(r, c))
                    {
                        updates.push((cell_id, r.saturating_sub(row_count), c));
                    }
                }
            }
        }

        Ok((deleted_cell_ids, updates))
    }

    fn apply_partial_insert_shift(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(CellId, u32, u32)>,
    ) -> Result<MutationResult, ComputeError> {
        let positions = self.partial_shift_positions(sheet_id, &[], &updates);
        let mut recalc = self.apply_partial_cell_remap(sheet_id, updates)?;
        services::cell_editing::append_position_changes(
            &self.stores,
            &self.cell_store,
            &mut recalc,
            positions,
        );
        self.finish_structure_change(sheet_id, recalc, None)
    }

    fn apply_partial_delete_shift(
        &mut self,
        sheet_id: &SheetId,
        deleted_cell_ids: Vec<CellId>,
        updates: Vec<(CellId, u32, u32)>,
    ) -> Result<MutationResult, ComputeError> {
        let positions = self.partial_shift_positions(sheet_id, &deleted_cell_ids, &updates);
        let mut recalc =
            self.apply_partial_cell_delete_and_remap(sheet_id, deleted_cell_ids, updates)?;
        services::cell_editing::append_position_changes(
            &self.stores,
            &self.cell_store,
            &mut recalc,
            positions,
        );
        self.finish_structure_change(sheet_id, recalc, None)
    }

    fn partial_shift_positions(
        &self,
        sheet_id: &SheetId,
        deleted: &[CellId],
        updates: &[(CellId, u32, u32)],
    ) -> Vec<(SheetId, u32, u32)> {
        let before = deleted
            .iter()
            .chain(updates.iter().map(|(id, _, _)| id))
            .filter_map(|id| self.cell_store.resolve_position(id))
            .map(|pos| (*sheet_id, pos.row(), pos.col()));
        before
            .chain(updates.iter().map(|(_, row, col)| (*sheet_id, *row, *col)))
            .collect()
    }

    fn apply_partial_cell_remap(
        &mut self,
        sheet_id: &SheetId,
        updates: Vec<(CellId, u32, u32)>,
    ) -> Result<RecalcResult, ComputeError> {
        if updates.is_empty() {
            return Ok(RecalcResult::empty());
        }

        let change = StructureChange::RemapPositions { updates };

        let apply_result = services::structural::apply_structure_change(
            &mut self.stores,
            &mut self.cell_store,
            sheet_id,
            &change,
        );

        apply_result
    }

    fn apply_partial_cell_delete_and_remap(
        &mut self,
        sheet_id: &SheetId,
        deleted_cell_ids: Vec<CellId>,
        updates: Vec<(CellId, u32, u32)>,
    ) -> Result<RecalcResult, ComputeError> {
        if deleted_cell_ids.is_empty() && updates.is_empty() {
            return Ok(RecalcResult::empty());
        }

        let clear_result = if deleted_cell_ids.is_empty() {
            Ok(())
        } else {
            Self::clear_cells_for_partial_structural_delete(
                &mut self.stores,
                &mut self.cell_store,
                sheet_id,
                &deleted_cell_ids,
            )
        };

        let recalc_result = match clear_result {
            Err(err) => Err(err),
            Ok(()) if updates.is_empty() => self
                .stores
                .compute
                .structure_change(&mut self.cell_store, None),
            Ok(()) => {
                let change = StructureChange::RemapPositions { updates };
                let recalc = services::structural::apply_structure_change(
                    &mut self.stores,
                    &mut self.cell_store,
                    sheet_id,
                    &change,
                )?;
                Ok(recalc)
            }
        };

        recalc_result
    }

    fn clear_cells_for_partial_structural_delete(
        stores: &mut super::super::stores::EngineStores,
        cell_store: &mut CellStore,
        sheet_id: &SheetId,
        cell_ids: &[CellId],
    ) -> Result<(), ComputeError> {
        let mut captured: rustc_hash::FxHashSet<_> = cell_ids.iter().copied().collect();
        // Clearing a CSE member also clears its anchor formula.
        for id in cell_ids {
            if let Some(pos) = cell_store.resolve_position(id)
                && let Some((anchor, _)) =
                    cell_store.cse_anchor_covering(sheet_id, pos.row(), pos.col())
            {
                captured.insert(anchor);
            }
        }
        for id in &captured {
            if let Some(pos) = cell_store.resolve_position(id) {
                super::super::history::cells::capture_cell(
                    stores,
                    cell_store,
                    *sheet_id,
                    *id,
                    pos.row(),
                    pos.col(),
                );
            }
        }
        stores.compute.clear_cells(cell_store, cell_ids)?;
        crate::storage::infra::cell_iter::clear_metadata_for_cell_ids(
            &mut stores.storage,
            *sheet_id,
            cell_ids,
        );
        for id in captured {
            // Expanded CSE anchors retain their position but lose formula metadata.
            stores.storage.clear_cell_metadata(id);
        }
        for cell_id in cell_ids {
            cell_store.remove_cell(cell_id);
        }
        Ok(())
    }
}
