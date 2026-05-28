use super::shared;
use crate::engine_types::SerializedFloatingObjectGroup;
use crate::snapshot::MutationResult;
use crate::storage::engine::YrsComputeEngine;
use crate::storage::engine::services;
use bridge_core as bridge;
use cell_types::SheetId;
use value_types::ComputeError;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "objects_groups",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    #[bridge::write(scope = "sheet")]
    pub fn set_floating_object_group(
        &mut self,
        sheet_id: &SheetId,
        group_id: &str,
        json: serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::set_floating_object_group(&mut self.stores, sheet_id, group_id, json)
            .map(shared::with_empty_patches)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_floating_object_group(
        &self,
        sheet_id: &SheetId,
        group_id: &str,
    ) -> Result<Option<serde_json::Value>, ComputeError> {
        services::objects::get_floating_object_group(&self.stores, sheet_id, group_id)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_floating_object_groups_in_sheet(
        &self,
        sheet_id: &SheetId,
    ) -> Result<Vec<(String, serde_json::Value)>, ComputeError> {
        services::objects::get_floating_object_groups_in_sheet(&self.stores, sheet_id)
    }

    #[bridge::write(scope = "sheet")]
    pub fn delete_floating_object_group(
        &mut self,
        sheet_id: &SheetId,
        group_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::delete_floating_object_group(&mut self.stores, sheet_id, group_id)
            .map(shared::with_empty_patches)
    }

    // -------------------------------------------------------------------
    #[bridge::write(scope = "sheet")]
    pub fn create_floating_object_group(
        &mut self,
        sheet_id: &SheetId,
        config: &serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::create_floating_object_group(&mut self.stores, sheet_id, config)
            .map(shared::with_empty_patches)
    }

    /// Update a floating object group by merging partial JSON updates.
    #[bridge::write(scope = "sheet")]
    pub fn update_floating_object_group(
        &mut self,
        sheet_id: &SheetId,
        group_id: &str,
        updates: &serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::update_floating_object_group(
            &mut self.stores,
            sheet_id,
            group_id,
            updates,
        )
        .map(shared::with_empty_patches)
    }

    /// Get a single floating object group by ID as a typed struct.
    #[bridge::read(scope = "sheet")]
    pub fn get_floating_object_group_typed(
        &self,
        sheet_id: &SheetId,
        group_id: &str,
    ) -> Option<SerializedFloatingObjectGroup> {
        services::objects::get_floating_object_group_typed(&self.stores, sheet_id, group_id)
    }

    /// Get all floating object groups in a sheet as typed structs.
    #[bridge::read(scope = "sheet")]
    pub fn get_all_floating_object_groups_typed(
        &self,
        sheet_id: &SheetId,
    ) -> Vec<SerializedFloatingObjectGroup> {
        services::objects::get_all_floating_object_groups_typed(&self.stores, sheet_id)
    }

    // -------------------------------------------------------------------
}
