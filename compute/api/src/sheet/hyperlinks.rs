//! SheetHyperlinks — Hyperlink operations (stub).
//!
//! The engine does not have standalone hyperlink methods — hyperlinks are
//! stored as cell properties and managed through the cell format system.
//! This module is a placeholder for future dedicated hyperlink operations.

use crate::dispatch::Dispatch;
use cell_types::SheetId;

/// Hyperlink operations for a single sheet (stub).
///
/// Hyperlinks are currently managed as cell properties through the format
/// system. Dedicated hyperlink CRUD methods may be added to the engine
/// in the future.
pub struct SheetHyperlinks {
    #[allow(dead_code)]
    dispatch: Dispatch,
    #[allow(dead_code)]
    sheet_id: SheetId,
}

impl SheetHyperlinks {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    // TODO: Add hyperlink-specific methods when engine support lands:
    // - set_hyperlink(addr, url, display_text) -> Result<MutationResult, ComputeApiError>
    // - get_hyperlink(addr) -> Result<Option<Hyperlink>, ComputeApiError>
    // - remove_hyperlink(addr) -> Result<MutationResult, ComputeApiError>
    // - get_all_hyperlinks() -> Result<Vec<Hyperlink>, ComputeApiError>
}
