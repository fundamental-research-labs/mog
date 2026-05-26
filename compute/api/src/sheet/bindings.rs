//! SheetBindings — External data binding CRUD operations.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use compute_core::engine_types::bindings::{
    CreateBindingInput, SheetDataBinding, UpdateBindingFields,
};
use snapshot_types::MutationResult;

/// External data binding operations for a single sheet.
///
/// Manages bindings that connect sheet ranges to external data sources
/// (databases, APIs, etc.) through connection definitions.
pub struct SheetBindings {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

impl SheetBindings {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    /// Create a new data binding on the sheet.
    pub fn create_binding(
        &self,
        binding: CreateBindingInput,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.create_binding(&sid, binding).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Update an existing data binding by ID.
    pub fn update_binding(
        &self,
        binding_id: &str,
        updates: UpdateBindingFields,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_id = binding_id.to_owned();
        self.dispatch
            .call_engine(move |e| e.update_binding(&sid, &owned_id, updates).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Remove a data binding by ID.
    pub fn remove_binding(&self, binding_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_id = binding_id.to_owned();
        self.dispatch
            .call_engine(move |e| e.remove_binding(&sid, &owned_id).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Get all data bindings on the sheet.
    pub fn get_all_bindings(&self) -> Result<Vec<SheetDataBinding>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_all_bindings(&sid))
    }

    /// Get a specific data binding by ID.
    pub fn get_binding(
        &self,
        binding_id: &str,
    ) -> Result<Option<SheetDataBinding>, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_id = binding_id.to_owned();
        self.dispatch
            .query_engine(move |e| e.get_binding(&sid, &owned_id))
    }
}
