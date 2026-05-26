//! Chart CRUD operations for a sheet.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use domain_types::domain::floating_object::FloatingObject;
use snapshot_types::MutationResult;

/// Sub-API for chart operations on a single sheet.
pub struct SheetCharts {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

impl SheetCharts {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    // -----------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------

    /// Get a single chart by ID.
    pub fn get(&self, chart_id: &str) -> Result<Option<FloatingObject>, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = chart_id.to_string();
        self.dispatch.query_engine(move |e| e.get_chart(&sid, &cid))
    }

    /// Get all charts in this sheet.
    pub fn get_all(&self) -> Result<Vec<FloatingObject>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch.query_engine(move |e| e.get_all_charts(&sid))
    }

    /// Get all charts sorted by z-order (back to front).
    pub fn get_in_z_order(&self) -> Result<Vec<FloatingObject>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_charts_in_z_order(&sid))
    }

    /// Get all charts linked to a specific table.
    pub fn get_linked_to_table(
        &self,
        table_id: &str,
    ) -> Result<Vec<FloatingObject>, ComputeApiError> {
        let sid = self.sheet_id;
        let tid = table_id.to_string();
        self.dispatch
            .query_engine(move |e| e.get_charts_linked_to_table(&sid, &tid))
    }

    /// Check whether a chart is linked to any table.
    pub fn is_linked_to_table(&self, chart_id: &str) -> Result<bool, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = chart_id.to_string();
        self.dispatch
            .query_engine(move |e| e.is_chart_linked_to_table(&sid, &cid))
    }

    /// Get the maximum z-index among all charts in the sheet.
    pub fn get_max_z_index(&self) -> Result<i32, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch.query_engine(move |e| e.get_max_z_index(&sid))
    }

    /// Get the minimum z-index among all charts in the sheet.
    pub fn get_min_z_index(&self) -> Result<i32, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch.query_engine(move |e| e.get_min_z_index(&sid))
    }

    // -----------------------------------------------------------------
    // Mutations
    // -----------------------------------------------------------------

    /// Create a new chart from a JSON configuration.
    pub fn create(&self, config: &serde_json::Value) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cfg = config.clone();
        self.dispatch
            .call_engine(move |e| e.create_chart(&sid, &cfg).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Update a chart with partial JSON updates.
    pub fn update(
        &self,
        chart_id: &str,
        updates: &serde_json::Value,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = chart_id.to_string();
        let upd = updates.clone();
        self.dispatch
            .call_engine(move |e| e.update_chart(&sid, &cid, &upd).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Delete a chart by ID.
    pub fn delete(&self, chart_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = chart_id.to_string();
        self.dispatch
            .call_engine(move |e| e.delete_chart(&sid, &cid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Bring a chart to the front (highest z-order).
    pub fn bring_to_front(&self, chart_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = chart_id.to_string();
        self.dispatch
            .call_engine(move |e| e.bring_chart_to_front(&sid, &cid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Send a chart to the back (lowest z-order).
    pub fn send_to_back(&self, chart_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = chart_id.to_string();
        self.dispatch
            .call_engine(move |e| e.send_chart_to_back(&sid, &cid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Bring a chart one step forward in z-order.
    pub fn bring_forward(&self, chart_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = chart_id.to_string();
        self.dispatch
            .call_engine(move |e| e.bring_chart_forward(&sid, &cid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Send a chart one step backward in z-order.
    pub fn send_backward(&self, chart_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = chart_id.to_string();
        self.dispatch
            .call_engine(move |e| e.send_chart_backward(&sid, &cid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Link a chart to a table by setting its source table ID.
    pub fn link_to_table(
        &self,
        chart_id: &str,
        table_id: &str,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = chart_id.to_string();
        let tid = table_id.to_string();
        self.dispatch
            .call_engine(move |e| e.link_chart_to_table(&sid, &cid, &tid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Unlink a chart from its table.
    pub fn unlink_from_table(&self, chart_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = chart_id.to_string();
        self.dispatch
            .call_engine(move |e| e.unlink_chart_from_table(&sid, &cid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }
}
