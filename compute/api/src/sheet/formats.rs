//! Cell formatting operations — get/set/clear formats, range formatting, row/col formats.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::{CellId, SheetId};
use domain_types::CellFormat;
use snapshot_types::MutationResult;

/// Sub-API for formatting operations on a single sheet.
///
/// Obtained via [`Sheet::formats()`](super::Sheet::formats).
pub struct SheetFormats {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

/// Parse a hex-encoded u128 string (from `id_to_hex`) back to a `CellId`.
fn cell_id_from_hex(hex: &str) -> Option<CellId> {
    u128::from_str_radix(hex, 16).ok().map(CellId::from_raw)
}

impl SheetFormats {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    // -----------------------------------------------------------------
    // Per-cell format (position-based)
    // -----------------------------------------------------------------

    /// Get the effective cell format at a position.
    ///
    /// Merges default, column, row, and cell-level formats. If no cell exists
    /// at the position, a null CellId is used and only inherited format layers
    /// are returned.
    pub fn get_cell_format(&self, row: u32, col: u32) -> Result<CellFormat, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch.query_engine(move |e| {
            // Look up the CellId via the engine's public query method.
            let cell_id = e
                .get_cell_id_at(&sid, row, col)
                .and_then(|hex| cell_id_from_hex(&hex))
                .unwrap_or_else(|| CellId::from_raw(0));
            e.get_cell_format(&sid, &cell_id, row, col)
        })
    }

    /// Set the format for a cell at a position.
    ///
    /// If no cell exists at the position yet, one is created via `get_or_create_cell_id`.
    pub fn set_cell_format(
        &self,
        row: u32,
        col: u32,
        format: CellFormat,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| {
                // Ensure the cell exists (creates a marker cell if needed).
                let mr = e.get_or_create_cell_id(&sid, row, col).map(|(_, r)| r)?;
                // The CellId hex is stored in mr.data; parse it back.
                let cell_id = mr
                    .data
                    .as_ref()
                    .and_then(|d| d.as_str())
                    .and_then(cell_id_from_hex)
                    .ok_or_else(|| value_types::ComputeError::Eval {
                        message: "Failed to parse CellId from get_or_create_cell_id".to_string(),
                    })?;
                e.set_cell_format(&sid, &cell_id, &format).map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Clear the cell-level format at a position (reverts to inherited format).
    pub fn clear_cell_format(&self, row: u32, col: u32) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| {
                let mr = e.get_or_create_cell_id(&sid, row, col).map(|(_, r)| r)?;
                let cell_id = mr
                    .data
                    .as_ref()
                    .and_then(|d| d.as_str())
                    .and_then(cell_id_from_hex)
                    .ok_or_else(|| value_types::ComputeError::Eval {
                        message: "Failed to parse CellId from get_or_create_cell_id".to_string(),
                    })?;
                e.clear_cell_format(&sid, &cell_id).map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    // -----------------------------------------------------------------
    // Range-based formatting
    // -----------------------------------------------------------------

    /// Toggle a boolean format property for all cells in the given ranges.
    ///
    /// Reads the effective format at (`active_row`, `active_col`) to determine
    /// the toggle direction. For example: if bold is currently true at the
    /// active cell, sets bold=false for all cells in the supplied ranges.
    ///
    /// `property` must be one of: `"bold"`, `"italic"`, `"strikethrough"`,
    /// `"wrapText"`, `"underline"`.
    pub fn toggle_format_property(
        &self,
        ranges: Vec<(u32, u32, u32, u32)>,
        property: String,
        active_row: u32,
        active_col: u32,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| {
                e.toggle_format_property(&sid, &ranges, &property, active_row, active_col)
            })
            .and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))
    }

    /// Set a format for all cells in the given ranges.
    ///
    /// Used for non-toggle format operations (e.g., set number format, set alignment).
    pub fn set_format_for_ranges(
        &self,
        ranges: Vec<(u32, u32, u32, u32)>,
        format: CellFormat,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.set_format_for_ranges(&sid, &ranges, &format))
            .and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))
    }

    /// Clear formatting for all cells in the given ranges.
    pub fn clear_format_for_ranges(
        &self,
        ranges: Vec<(u32, u32, u32, u32)>,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.clear_format_for_ranges(&sid, &ranges))
            .and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))
    }

    // -----------------------------------------------------------------
    // Row / column format
    // -----------------------------------------------------------------

    /// Set format for an entire row.
    pub fn set_row_format(
        &self,
        row: u32,
        format: CellFormat,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.set_row_format(&sid, row, format).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Set format for an entire column.
    pub fn set_col_format(
        &self,
        col: u32,
        format: CellFormat,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.set_col_format(&sid, col, format).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Clear format for an entire column.
    pub fn clear_col_format(&self, col: u32) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.clear_col_format(&sid, col).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Set format for a sparse whole-column range.
    pub fn set_col_format_range(
        &self,
        start_col: u32,
        end_col: u32,
        format: CellFormat,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| {
                e.set_col_format_range(&sid, start_col, end_col, format)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }
}
