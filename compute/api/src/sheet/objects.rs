//! Floating object CRUD, z-order, and group management for a sheet.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use compute_core::SerializedFloatingObjectGroup;
use compute_core::engine_types::floating_objects::{
    CreateShapeConfig, FlipAxis, MoveTarget, ResizeConfig, ShapeStyleUpdate,
};
use domain_types::FloatingObject;
use snapshot_types::MutationResult;

/// Sub-API for floating object operations on a single sheet.
pub struct SheetObjects {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

impl SheetObjects {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    // -----------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------

    /// Get a single floating object by ID.
    pub fn get(&self, object_id: &str) -> Result<Option<FloatingObject>, ComputeApiError> {
        let sid = self.sheet_id;
        let oid = object_id.to_string();
        self.dispatch
            .query_engine(move |e| e.get_floating_object_typed(&sid, &oid))
    }

    /// Get all floating objects in this sheet.
    pub fn get_all(&self) -> Result<Vec<FloatingObject>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_all_floating_objects_typed(&sid))
    }

    /// Get all floating objects sorted by z-order (back to front).
    pub fn get_in_z_order(&self) -> Result<Vec<FloatingObject>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_floating_objects_in_z_order(&sid))
    }

    /// Get the maximum z-index among floating objects in the sheet.
    pub fn get_max_z_index(&self) -> Result<i32, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_floating_object_max_z_index(&sid))
    }

    /// Get the minimum z-index among floating objects in the sheet.
    pub fn get_min_z_index(&self) -> Result<i32, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_floating_object_min_z_index(&sid))
    }

    /// Get a single floating object group by ID.
    pub fn get_group(
        &self,
        group_id: &str,
    ) -> Result<Option<SerializedFloatingObjectGroup>, ComputeApiError> {
        let sid = self.sheet_id;
        let gid = group_id.to_string();
        self.dispatch
            .query_engine(move |e| e.get_floating_object_group_typed(&sid, &gid))
    }

    /// Get all floating object groups in this sheet.
    pub fn get_all_groups(&self) -> Result<Vec<SerializedFloatingObjectGroup>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_all_floating_object_groups_typed(&sid))
    }

    // -----------------------------------------------------------------
    // Mutations
    // -----------------------------------------------------------------

    /// Create a new floating object from a JSON configuration.
    pub fn create(&self, config: &serde_json::Value) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cfg = config.clone();
        self.dispatch
            .call_engine(move |e| e.create_floating_object(&sid, &cfg).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Update a floating object with partial JSON updates.
    pub fn update(
        &self,
        object_id: &str,
        updates: &serde_json::Value,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let oid = object_id.to_string();
        let upd = updates.clone();
        self.dispatch
            .call_engine(move |e| e.update_floating_object(&sid, &oid, &upd).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Delete a floating object by ID.
    pub fn delete(&self, object_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let oid = object_id.to_string();
        self.dispatch
            .call_engine(move |e| e.delete_floating_object(&sid, &oid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Bring a floating object to the front (highest z-order).
    pub fn bring_to_front(&self, object_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let oid = object_id.to_string();
        self.dispatch
            .call_engine(move |e| e.bring_floating_object_to_front(&sid, &oid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Send a floating object to the back (lowest z-order).
    pub fn send_to_back(&self, object_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let oid = object_id.to_string();
        self.dispatch
            .call_engine(move |e| e.send_floating_object_to_back(&sid, &oid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Bring a floating object one step forward in z-order.
    pub fn bring_forward(&self, object_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let oid = object_id.to_string();
        self.dispatch
            .call_engine(move |e| e.bring_floating_object_forward(&sid, &oid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Send a floating object one step backward in z-order.
    pub fn send_backward(&self, object_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let oid = object_id.to_string();
        self.dispatch
            .call_engine(move |e| e.send_floating_object_backward(&sid, &oid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    // -----------------------------------------------------------------
    // Typed Shape Mutations
    // -----------------------------------------------------------------

    /// Create a shape from a typed config. Rust owns ID, z-index, timestamps, defaults.
    pub fn create_shape(
        &self,
        config: CreateShapeConfig,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.create_shape(&sid, config).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Move a floating object to a new position.
    pub fn move_object(
        &self,
        object_id: &str,
        target: MoveTarget,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let oid = object_id.to_string();
        self.dispatch
            .call_engine(move |e| {
                e.move_floating_object_typed(&sid, &oid, target)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Resize a floating object.
    pub fn resize_object(
        &self,
        object_id: &str,
        config: ResizeConfig,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let oid = object_id.to_string();
        self.dispatch
            .call_engine(move |e| {
                e.resize_floating_object_typed(&sid, &oid, config)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Rotate a floating object.
    pub fn rotate_object(
        &self,
        object_id: &str,
        rotation: f64,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let oid = object_id.to_string();
        self.dispatch
            .call_engine(move |e| {
                e.rotate_floating_object_typed(&sid, &oid, rotation)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Update shape-specific style properties.
    pub fn update_shape_style(
        &self,
        object_id: &str,
        style: ShapeStyleUpdate,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let oid = object_id.to_string();
        self.dispatch
            .call_engine(move |e| e.update_shape_style(&sid, &oid, style).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Flip a floating object horizontally or vertically.
    pub fn flip_object(
        &self,
        object_id: &str,
        axis: FlipAxis,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let oid = object_id.to_string();
        self.dispatch
            .call_engine(move |e| {
                e.flip_floating_object_typed(&sid, &oid, axis)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Duplicate a floating object with pixel offsets.
    pub fn duplicate_object(
        &self,
        object_id: &str,
        offset_x: f64,
        offset_y: f64,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let oid = object_id.to_string();
        self.dispatch
            .call_engine(move |e| {
                e.duplicate_floating_object_typed(&sid, &oid, offset_x, offset_y)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    // -----------------------------------------------------------------
    // Groups
    // -----------------------------------------------------------------

    /// Create a new floating object group from a JSON configuration.
    pub fn create_group(
        &self,
        config: &serde_json::Value,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cfg = config.clone();
        self.dispatch
            .call_engine(move |e| e.create_floating_object_group(&sid, &cfg).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Update a floating object group with partial JSON updates.
    pub fn update_group(
        &self,
        group_id: &str,
        updates: &serde_json::Value,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let gid = group_id.to_string();
        let upd = updates.clone();
        self.dispatch
            .call_engine(move |e| {
                e.update_floating_object_group(&sid, &gid, &upd)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Delete a floating object group by ID.
    pub fn delete_group(&self, group_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let gid = group_id.to_string();
        self.dispatch
            .call_engine(move |e| e.delete_floating_object_group(&sid, &gid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }
}
