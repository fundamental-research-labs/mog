//! WorkbookProtection — Workbook-level protection (stub).
//!
//! TODO: Workbook-level protection is not fully implemented in the engine yet.
//! Sheet-level protection is available via `SheetProtection`.
//! This module is a placeholder for future workbook protection operations
//! (e.g., protect structure, protect windows).

use crate::dispatch::Dispatch;

/// Workbook-level protection operations (stub).
///
/// Workbook protection (protect structure/windows) is not yet implemented
/// in the engine. Use `Sheet::protection()` for sheet-level protection.
pub struct WorkbookProtection {
    #[allow(dead_code)]
    dispatch: Dispatch,
}

impl WorkbookProtection {
    pub(crate) fn new(dispatch: Dispatch) -> Self {
        Self { dispatch }
    }

    // TODO: Add workbook-level protection methods when engine support lands:
    // - protect_workbook(password: Option<&str>) -> Result<MutationResult, ComputeApiError>
    // - unprotect_workbook() -> Result<MutationResult, ComputeApiError>
    // - is_workbook_protected() -> Result<bool, ComputeApiError>
}
