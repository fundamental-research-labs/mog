//! WorkbookStyles — persisted custom cell-style management.
//!
//! This facade deliberately delegates every operation to the production
//! compute engine.  Office.js and other adapters can therefore share the
//! engine's Yrs-backed style registry instead of keeping an in-memory style
//! catalog of their own.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use domain_types::domain::cell_style::CellStyleDef;
use snapshot_types::MutationResult;

/// Workbook-level custom cell-style management.
pub struct WorkbookStyles {
    dispatch: Dispatch,
}

impl WorkbookStyles {
    pub(crate) fn new(dispatch: Dispatch) -> Self {
        Self { dispatch }
    }

    /// Return all persisted custom cell styles in the engine's canonical
    /// name-sorted order.
    pub fn get_all_custom_cell_styles(&self) -> Result<Vec<CellStyleDef>, ComputeApiError> {
        self.dispatch
            .query_engine(|engine| engine.get_all_custom_cell_styles())
    }

    /// Create a persisted custom cell style.
    pub fn create_custom_cell_style(
        &self,
        style: CellStyleDef,
    ) -> Result<MutationResult, ComputeApiError> {
        self.dispatch
            .call_engine(move |engine| {
                engine
                    .create_custom_cell_style(style)
                    .map(|(_, result)| result)
            })
            .and_then(|result| result.map_err(ComputeApiError::from))
    }

    /// Replace a persisted custom cell style by its stable ID.
    pub fn update_custom_cell_style(
        &self,
        id: &str,
        style: CellStyleDef,
    ) -> Result<MutationResult, ComputeApiError> {
        let id = id.to_owned();
        self.dispatch
            .call_engine(move |engine| {
                engine
                    .update_custom_cell_style(id, style)
                    .map(|(_, result)| result)
            })
            .and_then(|result| result.map_err(ComputeApiError::from))
    }

    /// Delete a persisted custom cell style by its stable ID.
    pub fn delete_custom_cell_style(&self, id: &str) -> Result<MutationResult, ComputeApiError> {
        let id = id.to_owned();
        self.dispatch
            .call_engine(move |engine| {
                engine
                    .delete_custom_cell_style(id)
                    .map(|(_, result)| result)
            })
            .and_then(|result| result.map_err(ComputeApiError::from))
    }
}
