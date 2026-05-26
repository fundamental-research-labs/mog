//! SheetSlicers — Slicer CRUD and interaction operations.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use domain_types::StoredSlicer;
use snapshot_types::MutationResult;
use value_types::CellValue;

/// Slicer operations for a single sheet.
///
/// Manages interactive filter controls (slicers) that are visually
/// associated with a sheet and can filter tables or pivot tables.
pub struct SheetSlicers {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

impl SheetSlicers {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    /// Create a slicer on the sheet.
    pub fn create_slicer(&self, config: StoredSlicer) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.create_slicer(&sid, config).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Delete a slicer by ID.
    pub fn delete_slicer(&self, slicer_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_id = slicer_id.to_owned();
        self.dispatch
            .call_engine(move |e| e.delete_slicer(&sid, &owned_id).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Get all slicers on the sheet.
    pub fn get_all_slicers(&self) -> Result<Vec<StoredSlicer>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch.query_engine(move |e| e.get_all_slicers(&sid))
    }

    /// Get a specific slicer's state by ID.
    pub fn get_slicer_state(
        &self,
        slicer_id: &str,
    ) -> Result<Option<StoredSlicer>, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_id = slicer_id.to_owned();
        self.dispatch
            .query_engine(move |e| e.get_slicer_state(&sid, &owned_id))
    }

    /// Toggle a slicer item selection by value.
    pub fn toggle_slicer_item(
        &self,
        slicer_id: &str,
        value: CellValue,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_id = slicer_id.to_owned();
        self.dispatch
            .call_engine(move |e| e.toggle_slicer_item(&sid, &owned_id, value).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Clear all selections on a slicer (show all items).
    pub fn clear_slicer_selection(
        &self,
        slicer_id: &str,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_id = slicer_id.to_owned();
        self.dispatch
            .call_engine(move |e| e.clear_slicer_selection(&sid, &owned_id).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }
}
