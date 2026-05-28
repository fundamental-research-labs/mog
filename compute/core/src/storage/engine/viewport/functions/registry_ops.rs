use cell_types::SheetId;
use compute_wire::ViewportBounds;
use value_types::ComputeError;

use super::super::service::{ViewportRegistration, ViewportService};
use crate::snapshot::MutationResult;

pub(in crate::storage::engine::viewport) fn viewport_key_for_sheet(sheet_id: &SheetId) -> String {
    format!("__sheet_{}", sheet_id.to_uuid_string())
}

// ---------------------------------------------------------------------------
// Registry operations
// ---------------------------------------------------------------------------

/// Register a named viewport with explicit bounds.
///
/// If a viewport with this ID already exists, it is replaced.
pub(in crate::storage::engine::viewport) fn register_viewport(
    viewport: &ViewportService,
    viewport_id: &str,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    viewport.registered_viewports_mut().insert(
        viewport_id.to_string(),
        ViewportRegistration {
            sheet_id: *sheet_id,
            bounds: ViewportBounds {
                start_row,
                start_col,
                end_row,
                end_col,
            },
            palette_len: 0,
        },
    );
    Ok(MutationResult::empty())
}

/// Update the bounds of an already-registered viewport.
///
/// No-op if the viewport ID is not found.
pub(in crate::storage::engine::viewport) fn update_viewport_bounds(
    viewport: &ViewportService,
    viewport_id: &str,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    if let Some(reg) = viewport.registered_viewports_mut().get_mut(viewport_id) {
        reg.bounds = ViewportBounds {
            start_row,
            start_col,
            end_row,
            end_col,
        };
    }
    Ok(MutationResult::empty())
}

/// Unregister a viewport by ID.
///
/// No-op if the viewport ID is not found.
pub(in crate::storage::engine::viewport) fn unregister_viewport(
    viewport: &ViewportService,
    viewport_id: &str,
) -> Result<MutationResult, ComputeError> {
    viewport.registered_viewports_mut().remove(viewport_id);
    Ok(MutationResult::empty())
}

/// Get all registered viewports.
///
/// Returns a list of `(viewport_id, sheet_id_hex, start_row, start_col, end_row, end_col)`.
pub(in crate::storage::engine::viewport) fn get_registered_viewports(
    viewport: &ViewportService,
) -> Vec<(String, String, u32, u32, u32, u32)> {
    viewport
        .registered_viewports()
        .iter()
        .map(|(id, reg)| {
            (
                id.clone(),
                reg.sheet_id.to_uuid_string(),
                reg.bounds.start_row,
                reg.bounds.start_col,
                reg.bounds.end_row,
                reg.bounds.end_col,
            )
        })
        .collect()
}

/// Reset (unregister) all viewports for a given sheet.
pub(in crate::storage::engine::viewport) fn reset_sheet_viewports(
    viewport: &ViewportService,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    viewport
        .registered_viewports_mut()
        .retain(|_, reg| reg.sheet_id != *sheet_id);
    Ok(MutationResult::empty())
}

/// Reset viewport state for a sheet (removes all viewports for this sheet).
pub(in crate::storage::engine::viewport) fn reset_viewport_state(
    viewport: &ViewportService,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    viewport
        .registered_viewports_mut()
        .retain(|_, reg| reg.sheet_id != *sheet_id);
    Ok(MutationResult::empty())
}
