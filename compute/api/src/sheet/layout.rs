//! Layout operations — row heights, column widths, visibility, frozen panes.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use domain_types::FrozenPanes;
use snapshot_types::MutationResult;

/// Sub-API for layout queries and mutations on a single sheet.
///
/// Obtained via [`Sheet::layout()`](super::Sheet::layout).
pub struct SheetLayout {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

impl SheetLayout {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    // -----------------------------------------------------------------
    // Row / column dimensions
    // -----------------------------------------------------------------

    /// Set the height of a row.
    pub fn set_row_height(&self, row: u32, height: f64) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.set_row_height(&sid, row, height).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Set the width of a column.
    pub fn set_col_width(&self, col: u32, width: f64) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.set_col_width(&sid, col, width).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Set the widths of multiple columns.
    pub fn set_col_widths(
        &self,
        widths: Vec<(u32, f64)>,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.set_col_widths(&sid, &widths).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Set the widths of multiple columns in OOXML character-width units.
    pub fn set_col_widths_chars(
        &self,
        widths: Vec<(u32, f64)>,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.set_col_widths_chars(&sid, &widths).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Get the height of a row (returns 0 for hidden rows, default for unset).
    pub fn get_row_height(&self, row: u32) -> Result<f64, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_row_height_query(&sid, row))
    }

    /// Get the width of a column (returns 0 for hidden cols, default for unset).
    pub fn get_col_width(&self, col: u32) -> Result<f64, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_col_width_query(&sid, col))
    }

    /// Get the default row height for this sheet.
    pub fn get_default_row_height(&self) -> Result<f64, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_default_row_height(&sid))
    }

    /// Get the default column width for this sheet.
    pub fn get_default_col_width(&self) -> Result<f64, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_default_col_width(&sid))
    }

    // -----------------------------------------------------------------
    // Row / column visibility
    // -----------------------------------------------------------------

    /// Hide the specified rows.
    pub fn hide_rows(&self, rows: Vec<u32>) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.hide_rows(&sid, &rows).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Unhide the specified rows.
    pub fn unhide_rows(&self, rows: Vec<u32>) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.unhide_rows(&sid, &rows).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Hide the specified columns.
    pub fn hide_columns(&self, cols: Vec<u32>) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.hide_columns(&sid, &cols).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Unhide the specified columns.
    pub fn unhide_columns(&self, cols: Vec<u32>) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.unhide_columns(&sid, &cols).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Get all hidden row indices for this sheet (sorted).
    pub fn get_hidden_rows(&self) -> Result<Vec<u32>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch.query_engine(move |e| e.get_hidden_rows(&sid))
    }

    /// Get row indices hidden by filters for this sheet (sorted).
    pub fn get_filter_hidden_rows(&self) -> Result<Vec<u32>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_filter_hidden_rows(&sid))
    }

    /// Get all hidden column indices for this sheet (sorted).
    pub fn get_hidden_columns(&self) -> Result<Vec<u32>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_hidden_columns(&sid))
    }

    /// Check if a specific row is hidden.
    pub fn is_row_hidden(&self, row: u32) -> Result<bool, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.is_row_hidden_query(&sid, row))
    }

    /// Check if a specific column is hidden.
    pub fn is_col_hidden(&self, col: u32) -> Result<bool, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.is_col_hidden_query(&sid, col))
    }

    // -----------------------------------------------------------------
    // Frozen panes
    // -----------------------------------------------------------------

    /// Set the frozen panes configuration (number of frozen rows and columns).
    pub fn set_frozen_panes(
        &self,
        rows: u32,
        cols: u32,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.set_frozen_panes(&sid, rows, cols).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Get the frozen panes configuration.
    pub fn get_frozen_panes(&self) -> Result<FrozenPanes, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_frozen_panes_query(&sid))
    }

    /// Freeze a number of rows, preserving the current column freeze.
    pub fn freeze_rows(&self, count: u32) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.freeze_rows(&sid, count).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Freeze a number of columns, preserving the current row freeze.
    pub fn freeze_columns(&self, count: u32) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.freeze_columns(&sid, count).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }
}
