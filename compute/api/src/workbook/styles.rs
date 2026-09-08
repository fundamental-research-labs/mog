//! WorkbookStyles — Table style management (stub).
//!
//! Built-in table styles are exposed via `compute_core::table_get_built_in_styles()`
//! which is a pure function, not an engine method. Custom table style management
//! is not yet implemented.

use crate::dispatch::Dispatch;

/// Custom table style management (stub).
///
/// Built-in styles are available via `compute_api::pure` (stateless).
/// Custom style CRUD will be added here when engine support lands.
pub struct WorkbookStyles {
    #[allow(dead_code)]
    dispatch: Dispatch,
}

impl WorkbookStyles {
    pub(crate) fn new(dispatch: Dispatch) -> Self {
        Self { dispatch }
    }

    // TODO: Add custom table style methods when engine support lands:
    // - get_custom_styles() -> Result<Vec<TableStyle>, ComputeApiError>
    // - add_custom_style(style: TableStyle) -> Result<MutationResult, ComputeApiError>
    // - remove_custom_style(name: &str) -> Result<MutationResult, ComputeApiError>
}
