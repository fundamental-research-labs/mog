//! Filter and auto-filter operations for a sheet.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use domain_types::filter::{AdvancedFilterRequest, ColumnFilter, FilterState};
use snapshot_types::MutationResult;
use value_types::CellValue;

/// Sub-API for filter operations on a single sheet.
pub struct SheetFilters {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

impl SheetFilters {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    // -----------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------

    /// Get all filters in this sheet.
    pub fn get_all(&self) -> Result<Vec<FilterState>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_filters_in_sheet(&sid))
    }

    /// Get unique values in a filter column (for populating the filter dropdown).
    pub fn get_unique_column_values(
        &self,
        filter_id: &str,
        header_col: u32,
    ) -> Result<Vec<CellValue>, ComputeApiError> {
        let sid = self.sheet_id;
        let fid = filter_id.to_string();
        self.dispatch
            .query_engine(move |e| e.get_unique_column_values(&sid, &fid, header_col))
    }

    // -----------------------------------------------------------------
    // Mutations
    // -----------------------------------------------------------------

    /// Create a new filter from a JSON configuration.
    ///
    /// The config should contain `headerStartCellId`, `headerEndCellId`,
    /// `dataEndCellId`, `filterType`, and optionally `tableId`.
    pub fn create(&self, config: serde_json::Value) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.create_filter(&sid, config).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Delete a filter by ID.
    pub fn delete(&self, filter_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let fid = filter_id.to_string();
        self.dispatch
            .call_engine(move |e| e.delete_filter(&sid, &fid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Set filter criteria for a specific column.
    pub fn set_column_filter(
        &self,
        filter_id: &str,
        header_col: u32,
        criteria: ColumnFilter,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let fid = filter_id.to_string();
        self.dispatch
            .call_engine(move |e| {
                e.set_column_filter(&sid, &fid, header_col, criteria)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Clear filter criteria for a specific column.
    pub fn clear_column_filter(
        &self,
        filter_id: &str,
        header_col: u32,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let fid = filter_id.to_string();
        self.dispatch
            .call_engine(move |e| {
                e.clear_column_filter(&sid, &fid, header_col)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Clear all column filters for a filter.
    pub fn clear_all_column_filters(
        &self,
        filter_id: &str,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let fid = filter_id.to_string();
        self.dispatch
            .call_engine(move |e| e.clear_all_column_filters(&sid, &fid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Evaluate a filter and atomically hide/unhide rows.
    pub fn apply(&self, filter_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let fid = filter_id.to_string();
        self.dispatch
            .call_engine(move |e| e.apply_filter(&sid, &fid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Apply an Excel Advanced Filter from raw user-visible range strings.
    pub fn apply_advanced(
        &self,
        request: AdvancedFilterRequest,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.apply_advanced_filter(&sid, request).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }
}
