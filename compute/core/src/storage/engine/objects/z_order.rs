use super::shared;
use crate::engine_types::ZOrderEntry;
use crate::snapshot::MutationResult;
use crate::storage::engine::YrsComputeEngine;
use crate::storage::engine::services;
use bridge_core as bridge;
use cell_types::SheetId;
use domain_types::domain::floating_object::FloatingObject;
use value_types::ComputeError;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "objects_z_order",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    #[bridge::write(scope = "sheet")]
    pub fn bring_floating_object_to_front(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::bring_floating_object_to_front(&mut self.stores, sheet_id, object_id)
            .map(shared::with_empty_patches)
    }

    /// Send a floating object to the back (lowest z-order).
    #[bridge::write(scope = "sheet")]
    pub fn send_floating_object_to_back(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::send_floating_object_to_back(&mut self.stores, sheet_id, object_id)
            .map(shared::with_empty_patches)
    }

    /// Bring a floating object one step forward in z-order.
    #[bridge::write(scope = "sheet")]
    pub fn bring_floating_object_forward(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::bring_floating_object_forward(&mut self.stores, sheet_id, object_id)
            .map(shared::with_empty_patches)
    }

    /// Send a floating object one step backward in z-order.
    #[bridge::write(scope = "sheet")]
    pub fn send_floating_object_backward(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::send_floating_object_backward(&mut self.stores, sheet_id, object_id)
            .map(shared::with_empty_patches)
    }

    /// Get all floating objects sorted by z-order (back to front).
    #[bridge::read(scope = "sheet")]
    pub fn get_floating_objects_in_z_order(&self, sheet_id: &SheetId) -> Vec<FloatingObject> {
        services::objects::get_floating_objects_in_z_order(&self.stores, sheet_id)
    }

    /// Get the maximum z-index among all floating objects in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_floating_object_max_z_index(&self, sheet_id: &SheetId) -> i32 {
        services::objects::get_floating_object_max_z_index(&self.stores, sheet_id)
    }

    /// Get the minimum z-index among all floating objects in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_floating_object_min_z_index(&self, sheet_id: &SheetId) -> i32 {
        services::objects::get_floating_object_min_z_index(&self.stores, sheet_id)
    }

    // -------------------------------------------------------------------
    #[bridge::read(scope = "sheet")]
    pub fn get_max_z_index_all(&self, sheet_id: &SheetId) -> i32 {
        services::objects::get_max_z_index_all(&self.stores, sheet_id)
    }

    /// Get the minimum z-index across ALL charts and floating objects in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_min_z_index_all(&self, sheet_id: &SheetId) -> i32 {
        services::objects::get_min_z_index_all(&self.stores, sheet_id)
    }

    /// Get all charts and floating objects interleaved by z-order (ascending, back to front).
    #[bridge::read(scope = "sheet")]
    pub fn get_all_in_z_order(&self, sheet_id: &SheetId) -> Vec<ZOrderEntry> {
        services::objects::get_all_in_z_order(&self.stores, sheet_id)
    }

    // -------------------------------------------------------------------
    // Hyperlinks
}
