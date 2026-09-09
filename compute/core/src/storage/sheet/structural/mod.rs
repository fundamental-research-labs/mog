//! Native row and column mutations shared by grid and cell storage.

#[cfg(test)]
mod tests;

use crate::identity::GridIndex;
use crate::mirror::CellMirror;
use cell_types::{CellId, ColId, RowId, SheetId};
use formula_types::StructureChange;
use value_types::ComputeError;

/// Mutate native axis order and share the resulting identities with cell storage.
/// Cells retain their identities when their physical positions change.
pub struct StructuralOps;

impl StructuralOps {
    /// Insert `count` rows at `at`, updating native cells and axis order.
    pub fn insert_rows(
        grid_index: &mut GridIndex,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        at: u32,
        count: u32,
    ) -> Result<Vec<RowId>, ComputeError> {
        let inserted_ids = grid_index.insert_rows(at, count);
        let change = StructureChange::InsertRows {
            at,
            count,
            new_row_ids: inserted_ids.clone(),
        };
        mirror.apply_structure_change_with_axes(
            sheet_id,
            &change,
            Some((grid_index.row_axis(), grid_index.col_axis())),
        );
        Ok(inserted_ids)
    }

    /// Delete `count` rows at `at`, updating native cells and axis order.
    pub fn delete_rows(
        grid_index: &mut GridIndex,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        at: u32,
        count: u32,
    ) -> Result<Vec<CellId>, ComputeError> {
        let deleted_cell_ids = grid_index.delete_rows(at, count);
        let change = StructureChange::DeleteRows {
            at,
            count,
            deleted_cell_ids: deleted_cell_ids.clone(),
        };
        mirror.apply_structure_change_with_axes(
            sheet_id,
            &change,
            Some((grid_index.row_axis(), grid_index.col_axis())),
        );
        Ok(deleted_cell_ids)
    }

    /// Insert `count` cols at `at`, updating native cells and axis order.
    pub fn insert_cols(
        grid_index: &mut GridIndex,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        at: u32,
        count: u32,
    ) -> Result<Vec<ColId>, ComputeError> {
        let inserted_ids = grid_index.insert_cols(at, count);
        let change = StructureChange::InsertCols {
            at,
            count,
            new_col_ids: inserted_ids.clone(),
        };
        mirror.apply_structure_change_with_axes(
            sheet_id,
            &change,
            Some((grid_index.row_axis(), grid_index.col_axis())),
        );
        Ok(inserted_ids)
    }

    /// Delete `count` cols at `at`, updating native cells and axis order.
    pub fn delete_cols(
        grid_index: &mut GridIndex,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        at: u32,
        count: u32,
    ) -> Result<Vec<CellId>, ComputeError> {
        let deleted_cell_ids = grid_index.delete_cols(at, count);
        let change = StructureChange::DeleteCols {
            at,
            count,
            deleted_cell_ids: deleted_cell_ids.clone(),
        };
        mirror.apply_structure_change_with_axes(
            sheet_id,
            &change,
            Some((grid_index.row_axis(), grid_index.col_axis())),
        );
        Ok(deleted_cell_ids)
    }
}
