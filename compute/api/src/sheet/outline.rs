//! SheetOutline — Row/column grouping, subtotals, and outline operations.

use crate::address::CellRange;
use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use domain_types::{GroupDefinition, SubtotalOptions};
use snapshot_types::MutationResult;

/// Row/column grouping, subtotals, and outline operations for a single sheet.
///
/// Manages hierarchical grouping of rows and columns (outline levels),
/// subtotal insertion, and automatic outline detection.
pub struct SheetOutline {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

impl SheetOutline {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    // -----------------------------------------------------------------
    // Row grouping
    // -----------------------------------------------------------------

    /// Group rows in the given range.
    pub fn group_rows(
        &self,
        start_row: u32,
        end_row: u32,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.group_rows(&sid, start_row, end_row).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Ungroup rows in the given range.
    pub fn ungroup_rows(
        &self,
        start_row: u32,
        end_row: u32,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.ungroup_rows(&sid, start_row, end_row).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    // -----------------------------------------------------------------
    // Column grouping
    // -----------------------------------------------------------------

    /// Group columns in the given range.
    pub fn group_columns(
        &self,
        start_col: u32,
        end_col: u32,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.group_columns(&sid, start_col, end_col).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Ungroup columns in the given range.
    pub fn ungroup_columns(
        &self,
        start_col: u32,
        end_col: u32,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.ungroup_columns(&sid, start_col, end_col).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    // -----------------------------------------------------------------
    // Collapse / expand
    // -----------------------------------------------------------------

    /// Set a group's collapsed state.
    pub fn set_group_collapsed(
        &self,
        group_id: &str,
        collapsed: bool,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_id = group_id.to_owned();
        self.dispatch
            .call_engine(move |e| {
                e.set_group_collapsed(&sid, &owned_id, collapsed)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Toggle a group's collapsed state.
    pub fn toggle_group_collapsed(
        &self,
        group_id: &str,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_id = group_id.to_owned();
        self.dispatch
            .call_engine(move |e| e.toggle_group_collapsed(&sid, &owned_id).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Expand all groups in the sheet.
    pub fn expand_all_groups(&self) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.expand_all_groups(&sid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Collapse all groups in the sheet.
    pub fn collapse_all_groups(&self) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.collapse_all_groups(&sid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    // -----------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------

    /// Get all groups for the given axis ("row" or "column").
    pub fn get_groups(&self, axis: &str) -> Result<Vec<GroupDefinition>, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_axis = axis.to_owned();
        self.dispatch
            .query_engine(move |e| e.get_groups(&sid, &owned_axis))
    }

    // -----------------------------------------------------------------
    // Subtotals
    // -----------------------------------------------------------------

    /// Create subtotals for a range.
    pub fn create_subtotals(
        &self,
        range: impl Into<CellRange>,
        options: SubtotalOptions,
    ) -> Result<MutationResult, ComputeApiError> {
        let (sr, sc, er, ec) = range.into().resolve()?;
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| {
                e.create_subtotals(&sid, sr, sc, er, ec, options)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Remove subtotals from a range.
    pub fn remove_subtotals(
        &self,
        range: impl Into<CellRange>,
    ) -> Result<MutationResult, ComputeApiError> {
        let (sr, sc, er, ec) = range.into().resolve()?;
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.remove_subtotals(&sid, sr, sc, er, ec).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Automatically detect formula patterns and create outline groups.
    pub fn auto_outline(
        &self,
        range: impl Into<CellRange>,
    ) -> Result<MutationResult, ComputeApiError> {
        let (sr, sc, er, ec) = range.into().resolve()?;
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.auto_outline(&sid, sr, sc, er, ec).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }
}
