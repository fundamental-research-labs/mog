use super::shared;
use crate::engine_types::floating_objects::{
    CreateShapeConfig, FlipAxis, MoveTarget, ResizeConfig, ShapeStyleUpdate,
};
use crate::snapshot::{FloatingObjectBounds, MutationResult};
use crate::storage::engine::YrsComputeEngine;
use crate::storage::engine::services;
use bridge_core as bridge;
use cell_types::SheetId;
use domain_types::domain::floating_object::FloatingObject;
use value_types::ComputeError;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "objects_floating",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    #[bridge::write(scope = "sheet")]
    pub fn set_floating_object(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
        json: serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::set_floating_object(&mut self.stores, sheet_id, object_id, json)
            .map(shared::with_empty_patches)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_floating_object(
        &self,
        sheet_id: &SheetId,
        object_id: &str,
    ) -> Result<Option<serde_json::Value>, ComputeError> {
        services::objects::get_floating_object(&self.stores, sheet_id, object_id)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_floating_objects_in_sheet(
        &self,
        sheet_id: &SheetId,
    ) -> Result<Vec<(String, serde_json::Value)>, ComputeError> {
        services::objects::get_floating_objects_in_sheet(&self.stores, sheet_id)
    }

    #[bridge::write(scope = "sheet")]
    pub fn delete_floating_object(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::delete_floating_object(&mut self.stores, sheet_id, object_id)
            .map(shared::with_empty_patches)
    }

    // -------------------------------------------------------------------
    // Floating Object Groups
    #[bridge::write(scope = "sheet")]
    pub fn create_floating_object(
        &mut self,
        sheet_id: &SheetId,
        config: &serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::create_floating_object(&mut self.stores, sheet_id, config)
            .map(shared::with_empty_patches)
    }

    /// Update a floating object by merging partial JSON updates.
    #[bridge::write(scope = "sheet")]
    pub fn update_floating_object(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
        updates: &serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::update_floating_object(&mut self.stores, sheet_id, object_id, updates)
            .map(shared::with_empty_patches)
    }

    /// Create a shape from a typed config. Rust owns ID gen, z-index, timestamps, defaults.
    #[bridge::write(scope = "sheet")]
    pub fn create_shape(
        &mut self,
        sheet_id: &SheetId,
        config: CreateShapeConfig,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::create_shape(&mut self.stores, sheet_id, config)
            .map(shared::with_empty_patches)
    }

    /// Move a floating object to a new position.
    #[bridge::write(scope = "sheet")]
    pub fn move_floating_object_typed(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
        target: MoveTarget,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::move_floating_object_typed(&mut self.stores, sheet_id, object_id, target)
            .map(shared::with_empty_patches)
    }

    /// Resize a floating object.
    #[bridge::write(scope = "sheet")]
    pub fn resize_floating_object_typed(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
        config: ResizeConfig,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::resize_floating_object_typed(
            &mut self.stores,
            sheet_id,
            object_id,
            config,
        )
        .map(shared::with_empty_patches)
    }

    /// Rotate a floating object to a given angle in degrees.
    #[bridge::write(scope = "sheet")]
    pub fn rotate_floating_object_typed(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
        rotation: f64,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::rotate_floating_object_typed(
            &mut self.stores,
            sheet_id,
            object_id,
            rotation,
        )
        .map(shared::with_empty_patches)
    }

    /// Update the style properties of a shape.
    #[bridge::write(scope = "sheet")]
    pub fn update_shape_style(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
        style: ShapeStyleUpdate,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::update_shape_style(&mut self.stores, sheet_id, object_id, style)
            .map(shared::with_empty_patches)
    }

    /// Flip a floating object along an axis.
    #[bridge::write(scope = "sheet")]
    pub fn flip_floating_object_typed(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
        axis: FlipAxis,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::flip_floating_object_typed(&mut self.stores, sheet_id, object_id, axis)
            .map(shared::with_empty_patches)
    }

    /// Duplicate a floating object with pixel offsets.
    #[bridge::write(scope = "sheet")]
    pub fn duplicate_floating_object_typed(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
        offset_x: f64,
        offset_y: f64,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::duplicate_floating_object_typed(
            &mut self.stores,
            sheet_id,
            object_id,
            offset_x,
            offset_y,
        )
        .map(shared::with_empty_patches)
    }

    /// Find all connectors in a sheet that reference a given shape via
    /// `startConnection.shapeId` or `endConnection.shapeId`.
    ///
    /// Returns a list of `(objectId, JSON)` pairs. Used by the TS connector
    /// re-routing coordination to discover which connectors need updating
    /// when a shape moves or resizes.
    #[bridge::read(scope = "sheet")]
    pub fn find_connectors_for_shape(
        &self,
        sheet_id: &SheetId,
        shape_id: &str,
    ) -> Vec<FloatingObject> {
        services::objects::find_connectors_for_shape(&self.stores, sheet_id, shape_id)
    }

    /// Get a single floating object by ID as a typed struct.
    #[bridge::read(scope = "sheet")]
    pub fn get_floating_object_typed(
        &self,
        sheet_id: &SheetId,
        object_id: &str,
    ) -> Option<FloatingObject> {
        services::objects::get_floating_object_typed(&self.stores, sheet_id, object_id)
    }

    /// Get all floating objects in a sheet as typed structs.
    #[bridge::read(scope = "sheet")]
    pub fn get_all_floating_objects_typed(&self, sheet_id: &SheetId) -> Vec<FloatingObject> {
        services::objects::get_all_floating_objects_typed(&self.stores, sheet_id)
    }

    /// Compute pixel bounds for ALL floating objects on a sheet in a single batch call.
    ///
    /// Returns a vec of `(object_id, bounds)` pairs. Objects whose bounds cannot be
    /// computed (e.g., missing layout) are omitted from the result.
    ///
    /// This avoids N individual IPC round-trips during sheet switches and full syncs.
    #[bridge::read(scope = "sheet")]
    pub fn compute_all_object_bounds(
        &self,
        sheet_id: &SheetId,
    ) -> Vec<(String, FloatingObjectBounds)> {
        services::objects::compute_all_object_bounds(&self.stores, sheet_id)
    }

    // -------------------------------------------------------------------
}
