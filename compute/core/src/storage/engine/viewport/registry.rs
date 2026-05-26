//! Viewport registration API for YrsComputeEngine.
//!
//! Viewports are first-class registered entities. Registration is decoupled
//! from data fetching — bounds are set explicitly, and binary viewport methods
//! read from the registry.

use crate::snapshot::MutationResult;
use crate::storage::engine::YrsComputeEngine;
use bridge_core as bridge;
use cell_types::SheetId;
use compute_wire::mutation::serialize_multi_viewport_patches;
use value_types::ComputeError;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "viewport_registry",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    /// Register a named viewport with explicit bounds.
    ///
    /// If a viewport with this ID already exists, it is replaced.
    //
    // `kind = "subscribe"` tags this method as `'lifecycle'` in the
    // generated bridge-method-kind manifest (subscription register, not a
    // workbook/sheet data mutation). Wire semantics are unchanged from
    // `bridge::write` — the runtime still goes through `core.mutate`.
    #[bridge::write(scope = "range", kind = "subscribe")]
    pub fn register_viewport(
        &mut self,
        viewport_id: &str,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = super::functions::register_viewport(
            &self.viewport,
            viewport_id,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
        )?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Update the bounds of an already-registered viewport.
    ///
    /// No-op if the viewport ID is not found.
    //
    // Scope = "workbook" because the sheet is looked up from the
    // registry by `viewport_id` — the bridge signature has no SheetId
    // for the macro to extract. R3 uses the coarse workbook check.
    #[bridge::write(scope = "workbook")]
    pub fn update_viewport_bounds(
        &mut self,
        viewport_id: &str,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = super::functions::update_viewport_bounds(
            &self.viewport,
            viewport_id,
            start_row,
            start_col,
            end_row,
            end_col,
        )?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Unregister a viewport by ID.
    ///
    /// No-op if the viewport ID is not found.
    //
    // `kind = "subscribe"` — see `register_viewport` above.
    #[bridge::write(scope = "workbook", kind = "subscribe")]
    pub fn unregister_viewport(
        &mut self,
        viewport_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = super::functions::unregister_viewport(&self.viewport, viewport_id)?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Get all registered viewports.
    ///
    /// Returns a list of `(viewport_id, sheet_id_hex, start_row, start_col, end_row, end_col)`.
    #[bridge::read(scope = "workbook")]
    pub fn get_registered_viewports(&self) -> Vec<(String, String, u32, u32, u32, u32)> {
        super::functions::get_registered_viewports(&self.viewport)
    }

    /// Reset (unregister) all viewports for a given sheet.
    ///
    /// This replaces the old `reset_viewport_state` for the new registry model.
    /// Removes all viewports whose `sheet_id` matches the given sheet.
    #[bridge::write(scope = "sheet")]
    pub fn reset_sheet_viewports(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = super::functions::reset_sheet_viewports(&self.viewport, sheet_id)?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }
}
