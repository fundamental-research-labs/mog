//! SheetSparklines — Sparkline CRUD operations.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use domain_types::sparkline::{Sparkline, SparklineUpdate};
use snapshot_types::MutationResult;

/// Sparkline operations for a single sheet.
///
/// Manages inline mini-charts (line, column, win/loss) that render
/// inside individual cells.
pub struct SheetSparklines {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

impl SheetSparklines {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    /// Add a sparkline to the sheet.
    pub fn add_sparkline(&self, sparkline: Sparkline) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.add_sparkline(&sid, sparkline).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Update an existing sparkline by ID.
    pub fn update_sparkline(
        &self,
        sparkline_id: &str,
        updates: SparklineUpdate,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_id = sparkline_id.to_owned();
        self.dispatch
            .call_engine(move |e| e.update_sparkline(&sid, &owned_id, updates).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Delete a sparkline by ID.
    pub fn delete_sparkline(&self, sparkline_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_id = sparkline_id.to_owned();
        self.dispatch
            .call_engine(move |e| e.delete_sparkline(&sid, &owned_id).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Get all sparklines in the sheet.
    pub fn get_all_sparklines(&self) -> Result<Vec<Sparkline>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_sparklines_in_sheet(&sid))
    }
}
