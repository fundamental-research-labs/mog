//! WorkbookNames — Named range (defined name) CRUD operations.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use compute_core::bridge_types::named_ranges::{DefinedNameInput, NamedRangeUpdate};
use formula_types::NamedRangeDef;
use snapshot_types::MutationResult;

/// Named range management for the workbook.
pub struct WorkbookNames {
    dispatch: Dispatch,
}

impl WorkbookNames {
    pub(crate) fn new(dispatch: Dispatch) -> Self {
        Self { dispatch }
    }

    /// Create a new named range (defined name).
    ///
    /// Returns a `MutationResult` with the created `DefinedName` in `data`.
    pub fn create_named_range(
        &self,
        input: DefinedNameInput,
    ) -> Result<MutationResult, ComputeApiError> {
        self.dispatch
            .call_engine(move |e| e.create_named_range(input).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Update an existing named range by its unique ID.
    ///
    /// Returns a `MutationResult` with the updated `DefinedName` in `data`.
    pub fn update_named_range(
        &self,
        id: &str,
        updates: NamedRangeUpdate,
    ) -> Result<MutationResult, ComputeApiError> {
        let owned_id = id.to_owned();
        self.dispatch
            .call_engine(move |e| e.update_named_range(&owned_id, updates).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Remove a named range by its unique ID.
    pub fn remove_named_range_by_id(&self, id: &str) -> Result<MutationResult, ComputeApiError> {
        let owned_id = id.to_owned();
        self.dispatch
            .call_engine(move |e| e.remove_named_range_by_id(&owned_id).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Remove all named ranges in a scope (useful when deleting a sheet).
    ///
    /// Pass `None` to remove workbook-scoped names, or `Some(sheet_id)` for sheet-scoped.
    pub fn remove_named_ranges_by_scope(
        &self,
        scope: Option<String>,
    ) -> Result<MutationResult, ComputeApiError> {
        self.dispatch
            .call_engine(move |e| e.remove_named_ranges_by_scope(scope).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Add or update a named range definition in the compute engine.
    ///
    /// This is the lower-level API that directly sets a name→def mapping.
    pub fn set_named_range(
        &self,
        name: String,
        def: NamedRangeDef,
    ) -> Result<MutationResult, ComputeApiError> {
        self.dispatch
            .call_engine(move |e| e.set_named_range(name, def).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Remove a named range by name from the compute engine.
    pub fn remove_named_range(&self, name: &str) -> Result<MutationResult, ComputeApiError> {
        let owned_name = name.to_owned();
        self.dispatch
            .call_engine(move |e| e.remove_named_range(&owned_name).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }
}
