use super::shared;
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
    group = "objects",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    #[bridge::write(scope = "sheet")]
    pub fn create_chart(
        &mut self,
        sheet_id: &SheetId,
        config: &serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::create_chart(&mut self.stores, sheet_id, config)
            .map(shared::with_empty_patches)
    }

    /// Update a chart's config fields as individual Y.Map keys on the floating object.
    #[bridge::write(scope = "sheet")]
    pub fn update_chart(
        &mut self,
        sheet_id: &SheetId,
        chart_id: &str,
        updates: &serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::update_chart(&mut self.stores, sheet_id, chart_id, updates)
            .map(shared::with_empty_patches)
    }

    /// Delete a chart by removing the floating object. Returns `floating_object_changes` with `Removed` kind.
    #[bridge::write(scope = "sheet")]
    pub fn delete_chart(
        &mut self,
        sheet_id: &SheetId,
        chart_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::delete_chart(&mut self.stores, sheet_id, chart_id)
            .map(shared::with_empty_patches)
    }

    /// Get a single chart by ID. Reads from floating objects filtered by type=="chart".
    #[bridge::read(scope = "sheet")]
    pub fn get_chart(&self, sheet_id: &SheetId, chart_id: &str) -> Option<FloatingObject> {
        services::objects::get_chart(&self.stores, sheet_id, chart_id)
    }

    /// Get all charts in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_all_charts(&self, sheet_id: &SheetId) -> Vec<FloatingObject> {
        services::objects::get_all_charts(&self.stores, sheet_id)
    }

    /// Bring a chart to the front (highest z-order). Delegates to floating object z-order.
    #[bridge::write(scope = "sheet")]
    pub fn bring_chart_to_front(
        &mut self,
        sheet_id: &SheetId,
        chart_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::bring_chart_to_front(&mut self.stores, sheet_id, chart_id)
            .map(shared::with_empty_patches)
    }

    /// Send a chart to the back (lowest z-order). Delegates to floating object z-order.
    #[bridge::write(scope = "sheet")]
    pub fn send_chart_to_back(
        &mut self,
        sheet_id: &SheetId,
        chart_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::send_chart_to_back(&mut self.stores, sheet_id, chart_id)
            .map(shared::with_empty_patches)
    }

    /// Bring a chart one step forward in z-order. Delegates to floating object z-order.
    #[bridge::write(scope = "sheet")]
    pub fn bring_chart_forward(
        &mut self,
        sheet_id: &SheetId,
        chart_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::bring_chart_forward(&mut self.stores, sheet_id, chart_id)
            .map(shared::with_empty_patches)
    }

    /// Send a chart one step backward in z-order. Delegates to floating object z-order.
    #[bridge::write(scope = "sheet")]
    pub fn send_chart_backward(
        &mut self,
        sheet_id: &SheetId,
        chart_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::send_chart_backward(&mut self.stores, sheet_id, chart_id)
            .map(shared::with_empty_patches)
    }

    /// Get all charts sorted by z-order (back to front).
    #[bridge::read(scope = "sheet")]
    pub fn get_charts_in_z_order(&self, sheet_id: &SheetId) -> Vec<FloatingObject> {
        services::objects::get_charts_in_z_order(&self.stores, sheet_id)
    }

    /// Link a chart to a table by setting its source table ID.
    #[bridge::write(scope = "sheet")]
    pub fn link_chart_to_table(
        &mut self,
        sheet_id: &SheetId,
        chart_id: &str,
        table_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::link_chart_to_table(&mut self.stores, sheet_id, chart_id, table_id)
            .map(shared::with_empty_patches)
    }

    /// Unlink a chart from its table.
    #[bridge::write(scope = "sheet")]
    pub fn unlink_chart_from_table(
        &mut self,
        sheet_id: &SheetId,
        chart_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::unlink_chart_from_table(&mut self.stores, sheet_id, chart_id)
            .map(shared::with_empty_patches)
    }

    /// Check whether a chart is linked to any table.
    #[bridge::read(scope = "sheet")]
    pub fn is_chart_linked_to_table(&self, sheet_id: &SheetId, chart_id: &str) -> bool {
        services::objects::is_chart_linked_to_table(&self.stores, sheet_id, chart_id)
    }

    /// Get all charts linked to a specific table.
    #[bridge::read(scope = "sheet")]
    pub fn get_charts_linked_to_table(
        &self,
        sheet_id: &SheetId,
        table_id: &str,
    ) -> Vec<FloatingObject> {
        services::objects::get_charts_linked_to_table(&self.stores, sheet_id, table_id)
    }

    /// Get the maximum z-index among all charts in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_max_z_index(&self, sheet_id: &SheetId) -> i32 {
        services::objects::get_max_z_index(&self.stores, sheet_id)
    }

    /// Get the minimum z-index among all charts in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_min_z_index(&self, sheet_id: &SheetId) -> i32 {
        services::objects::get_min_z_index(&self.stores, sheet_id)
    }
}
