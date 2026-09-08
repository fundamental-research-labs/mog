//! SheetPivots — Pivot table operations (stub).
//!
//! Pivot tables are managed through the stateless pure API (`compute_api::pure`),
//! not through sheet-level state. This module is a placeholder for any future
//! sheet-scoped pivot operations.

use crate::dispatch::Dispatch;
use cell_types::SheetId;

/// Pivot table operations for a single sheet (stub).
///
/// Pivot table computation and configuration are handled through the
/// stateless pure API. Sheet-level pivot CRUD may be added in the future
/// if pivots gain per-sheet storage in the engine.
pub struct SheetPivots {
    #[allow(dead_code)]
    dispatch: Dispatch,
    #[allow(dead_code)]
    sheet_id: SheetId,
}

impl SheetPivots {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    // TODO: Add sheet-level pivot methods if engine storage is added:
    // - create_pivot_table(config) -> Result<MutationResult, ComputeApiError>
    // - refresh_pivot_table(pivot_id) -> Result<MutationResult, ComputeApiError>
    // - delete_pivot_table(pivot_id) -> Result<MutationResult, ComputeApiError>
    // - get_pivot_tables() -> Result<Vec<PivotTable>, ComputeApiError>
}
