//! WorkbookProtection — Workbook-level protection operations.
//!
//! These methods are thin typed façades over the engine's structured
//! workbook-protection record.  In particular, callers must use these
//! operations instead of writing a flat workbook setting: sheet lifecycle
//! enforcement reads the structured `protection` map.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use snapshot_types::{MutationResult, WorkbookProtectionOptions};

/// Workbook-level protection operations.
pub struct WorkbookProtection {
    dispatch: Dispatch,
}

impl WorkbookProtection {
    pub(crate) fn new(dispatch: Dispatch) -> Self {
        Self { dispatch }
    }

    /// Protect workbook structure with an optional already-hashed password.
    ///
    /// Password hashing belongs at the host boundary.  The compute engine
    /// stores only the resulting hash and keeps structural enforcement tied to
    /// its structured protection map.
    pub fn protect_workbook(
        &self,
        password_hash: Option<String>,
    ) -> Result<MutationResult, ComputeApiError> {
        self.protect_workbook_with_options(password_hash, None)
    }

    /// Protect workbook structure with an optional password hash and options.
    pub fn protect_workbook_with_options(
        &self,
        password_hash: Option<String>,
        options: Option<WorkbookProtectionOptions>,
    ) -> Result<MutationResult, ComputeApiError> {
        self.dispatch
            .call_engine(move |e| {
                e.protect_workbook(password_hash, options)
                    .map(|(_, result)| result)
            })
            .and_then(|result| result.map_err(ComputeApiError::from))
    }

    /// Unprotect the workbook, validating an optional already-hashed password.
    ///
    /// The engine returns `MutationResult.data == false` when a supplied
    /// password does not match.  The Office.js adapter normalizes that result
    /// to its public error contract; this typed façade intentionally preserves
    /// the engine result so callers can inspect the outcome without a second
    /// state flag.
    pub fn unprotect_workbook(
        &self,
        password_hash: Option<String>,
    ) -> Result<MutationResult, ComputeApiError> {
        self.dispatch
            .call_engine(move |e| {
                e.unprotect_workbook(password_hash)
                    .map(|(_, result)| result)
            })
            .and_then(|result| result.map_err(ComputeApiError::from))
    }

    /// Return whether workbook structure protection is currently enabled.
    pub fn is_workbook_protected(&self) -> Result<bool, ComputeApiError> {
        self.dispatch.query_engine(|e| e.is_workbook_protected())
    }

    /// Return the persisted workbook protection options.
    pub fn get_workbook_protection_options(
        &self,
    ) -> Result<WorkbookProtectionOptions, ComputeApiError> {
        self.dispatch
            .query_engine(|e| e.get_workbook_protection_options())
    }

    /// Return whether the workbook protection record contains a password hash.
    pub fn has_workbook_protection_password(&self) -> Result<bool, ComputeApiError> {
        self.dispatch
            .query_engine(|e| e.has_workbook_protection_password())
    }
}
