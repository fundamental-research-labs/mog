//! Custom cell style bridge methods for YrsComputeEngine.

use bridge_core as bridge;
use compute_wire::mutation::serialize_multi_viewport_patches;
use domain_types::domain::cell_style::CellStyleDef;
use value_types::ComputeError;

use super::YrsComputeEngine;
use super::services;
use crate::snapshot::MutationResult;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "styles",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    /// Get all custom cell styles.
    #[bridge::read(scope = "workbook")]
    pub fn get_all_custom_cell_styles(&self) -> Vec<CellStyleDef> {
        services::styles::get_all_custom_cell_styles(&self.stores)
    }

    /// Create a custom cell style.
    #[bridge::write(scope = "workbook")]
    pub fn create_custom_cell_style(
        &mut self,
        style: CellStyleDef,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::styles::create_custom_cell_style(&mut self.stores, style)?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Update a custom cell style.
    #[bridge::write(scope = "workbook")]
    pub fn update_custom_cell_style(
        &mut self,
        id: String,
        style: CellStyleDef,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::styles::update_custom_cell_style(&mut self.stores, &id, style)?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Delete a custom cell style by ID.
    #[bridge::write(scope = "workbook")]
    pub fn delete_custom_cell_style(
        &mut self,
        id: String,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::styles::delete_custom_cell_style(&mut self.stores, &id)?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }
}
