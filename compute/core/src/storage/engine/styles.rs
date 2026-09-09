//! Custom cell style bridge methods for ComputeEngine.

use bridge_core as bridge;
use compute_wire::mutation::serialize_multi_viewport_patches;
use domain_types::domain::cell_style::CellStyleDef;
use value_types::ComputeError;

use super::ComputeEngine;
use super::services;
use crate::snapshot::MutationResult;

#[bridge::api(
    service = "ComputeEngine",
    key = "doc_id",
    group = "styles",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl ComputeEngine {
    /// Get all custom cell styles.
    #[bridge::read]
    pub fn get_all_custom_cell_styles(&self) -> Vec<CellStyleDef> {
        services::styles::get_all_custom_cell_styles(&self.stores)
    }

    /// Create a custom cell style.
    #[bridge::write]
    pub fn create_custom_cell_style(
        &mut self,
        style: CellStyleDef,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            let result = services::styles::create_custom_cell_style(&mut engine.stores, style)?;
            Ok((serialize_multi_viewport_patches(&[]), result))
        })
    }

    /// Update a custom cell style.
    #[bridge::write]
    pub fn update_custom_cell_style(
        &mut self,
        id: String,
        style: CellStyleDef,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            let result =
                services::styles::update_custom_cell_style(&mut engine.stores, &id, style)?;
            Ok((serialize_multi_viewport_patches(&[]), result))
        })
    }

    /// Delete a custom cell style by ID.
    #[bridge::write]
    pub fn delete_custom_cell_style(
        &mut self,
        id: String,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.with_history(|engine| {
            let result = services::styles::delete_custom_cell_style(&mut engine.stores, &id)?;
            Ok((serialize_multi_viewport_patches(&[]), result))
        })
    }
}
