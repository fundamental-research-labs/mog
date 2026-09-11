//! SheetHyperlinks — Hyperlink operations.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use snapshot_types::MutationResult;

/// Hyperlink operations for a single sheet.
pub struct SheetHyperlinks {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

impl SheetHyperlinks {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    /// Set a hyperlink URL on the cell at `(row, col)`.
    pub fn set(&self, row: u32, col: u32, url: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let owned = url.to_owned();
        self.dispatch
            .call_engine(move |e| e.set_hyperlink(&sid, row, col, &owned))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Read the hyperlink URL at `(row, col)`, if any.
    pub fn get(&self, row: u32, col: u32) -> Result<Option<String>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_hyperlink(&sid, row, col))
    }
}
