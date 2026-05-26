//! Structural operations — insert/delete rows/cols, merges, cell relocation.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use formula_types::StructureChange;
use snapshot_types::MutationResult;

/// Sub-API for structural mutations on a single sheet.
///
/// Obtained via [`Sheet::structure()`](super::Sheet::structure).
pub struct SheetStructure {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

impl SheetStructure {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    // -----------------------------------------------------------------
    // Row / column insertion and deletion
    // -----------------------------------------------------------------

    /// Insert rows at the given 0-based position.
    pub fn insert_rows(&self, at: u32, count: u32) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let change = StructureChange::InsertRows {
            at,
            count,
            new_row_ids: Vec::new(),
        };
        self.dispatch
            .call_engine(move |e| e.structure_change(&sid, &change))
            .and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))
    }

    /// Delete rows starting at the given 0-based position.
    pub fn delete_rows(&self, at: u32, count: u32) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let change = StructureChange::DeleteRows {
            at,
            count,
            deleted_cell_ids: Vec::new(),
        };
        self.dispatch
            .call_engine(move |e| e.structure_change(&sid, &change))
            .and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))
    }

    /// Insert columns at the given 0-based position.
    pub fn insert_columns(&self, at: u32, count: u32) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let change = StructureChange::InsertCols {
            at,
            count,
            new_col_ids: Vec::new(),
        };
        self.dispatch
            .call_engine(move |e| e.structure_change(&sid, &change))
            .and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))
    }

    /// Delete columns starting at the given 0-based position.
    pub fn delete_columns(&self, at: u32, count: u32) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let change = StructureChange::DeleteCols {
            at,
            count,
            deleted_cell_ids: Vec::new(),
        };
        self.dispatch
            .call_engine(move |e| e.structure_change(&sid, &change))
            .and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))
    }

    /// Raw `structure_change` for callers that already have a `StructureChange`.
    pub fn structure_change(
        &self,
        change: StructureChange,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.structure_change(&sid, &change))
            .and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))
    }

    // -----------------------------------------------------------------
    // Merge operations
    // -----------------------------------------------------------------

    /// Merge a rectangular range of cells.
    pub fn merge_range(
        &self,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| {
                e.merge_range(&sid, start_row, start_col, end_row, end_col)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Unmerge cells in a range.
    pub fn unmerge_range(
        &self,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| {
                e.unmerge_range(&sid, start_row, start_col, end_row, end_col)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Merge across: creates one merge per row in the range.
    pub fn merge_across(
        &self,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| {
                e.merge_across(&sid, start_row, start_col, end_row, end_col)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Merge and center: unmerge overlapping, then create a single merge.
    pub fn merge_and_center(
        &self,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| {
                e.merge_and_center(&sid, start_row, start_col, end_row, end_col)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Clear all merged regions for this sheet.
    pub fn clear_all_merges(&self) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.clear_all_merges(&sid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Check whether merging a range would cause data loss.
    ///
    /// Returns `(has_data_loss, affected_cell_count)`.
    pub fn check_merge_data_loss(
        &self,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(bool, u32), ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch.query_engine(move |e| {
            e.check_merge_data_loss(&sid, start_row, start_col, end_row, end_col)
        })
    }

    /// Check if the cell at (row, col) is the origin of a merge.
    pub fn is_merge_origin(&self, row: u32, col: u32) -> Result<bool, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.is_merge_origin(&sid, row, col))
    }

    // -----------------------------------------------------------------
    // Cell relocation and shifting
    // -----------------------------------------------------------------

    /// Move cell values from a source range to a target position (value-only move).
    ///
    /// Copies computed values to the target, clears the source. Does NOT move
    /// formulas or update formula references.
    pub fn relocate_cells(
        &self,
        src_start_row: u32,
        src_start_col: u32,
        src_end_row: u32,
        src_end_col: u32,
        target_row: u32,
        target_col: u32,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| {
                e.relocate_cells(
                    &sid,
                    src_start_row,
                    src_start_col,
                    src_end_row,
                    src_end_col,
                    target_row,
                    target_col,
                )
            })
            .and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))
    }

    /// Insert cells with shift (right or down) in a sub-range.
    ///
    /// When `shift_right` is true, shifts cells to the right; otherwise shifts down.
    pub fn insert_cells_with_shift(
        &self,
        row: u32,
        col: u32,
        row_count: u32,
        col_count: u32,
        shift_right: bool,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| {
                e.insert_cells_with_shift(&sid, row, col, row_count, col_count, shift_right)
            })
            .and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))
    }

    /// Delete cells with shift (left or up) in a sub-range.
    ///
    /// When `shift_left` is true, shifts cells to the left; otherwise shifts up.
    pub fn delete_cells_with_shift(
        &self,
        row: u32,
        col: u32,
        row_count: u32,
        col_count: u32,
        shift_left: bool,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| {
                e.delete_cells_with_shift(&sid, row, col, row_count, col_count, shift_left)
            })
            .and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))
    }

    /// Remove duplicate rows in a range.
    ///
    /// `columns` specifies which column indices to compare for duplicates.
    /// When `has_headers` is true, the first row is treated as a header row.
    pub fn remove_duplicates(
        &self,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        columns: Vec<u32>,
        has_headers: bool,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| {
                e.remove_duplicates(
                    &sid,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                    columns,
                    has_headers,
                )
                .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Split text in a column into multiple columns.
    ///
    /// `options` is a JSON object with keys like `"splitType"`, `"delimiters"`, etc.
    pub fn text_to_columns(
        &self,
        start_row: u32,
        end_row: u32,
        source_col: u32,
        dest_row: u32,
        dest_col: u32,
        options: serde_json::Value,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| {
                e.text_to_columns(
                    &sid, start_row, end_row, source_col, dest_row, dest_col, options,
                )
                .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }
}
