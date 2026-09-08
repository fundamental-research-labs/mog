//! SheetProtection — Sheet-level protection operations.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use compute_core::engine_types::queries::SheetProtectionConfig;
use snapshot_types::MutationResult;

/// Sheet-level protection operations.
///
/// Controls whether a sheet is protected (preventing edits to locked cells)
/// and manages the optional password hash.
pub struct SheetProtection {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

impl SheetProtection {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    /// Protect the sheet with an optional password hash.
    pub fn protect(
        &self,
        password_hash: Option<String>,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.protect_sheet(&sid, password_hash).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Unprotect the sheet. Validates the password hash if the sheet is password-protected.
    pub fn unprotect(
        &self,
        password_hash: Option<String>,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.unprotect_sheet(&sid, password_hash).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Check if the sheet is currently protected.
    pub fn is_protected(&self) -> Result<bool, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.is_sheet_protected(&sid))
    }

    /// Get the full protection configuration (protected flag + password hash).
    pub fn get_config(&self) -> Result<SheetProtectionConfig, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_sheet_protection_config(&sid))
    }
}
