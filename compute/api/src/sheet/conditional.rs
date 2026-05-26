//! SheetConditionalFormats — Conditional formatting rule CRUD.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use domain_types::{CFCellRange, ConditionalFormat};
use snapshot_types::MutationResult;

/// Conditional formatting operations for a single sheet.
///
/// Manages conditional format rules (color scales, data bars, icon sets,
/// cell-value rules, etc.) that dynamically style cells based on their values.
pub struct SheetConditionalFormats {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

impl SheetConditionalFormats {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    // -----------------------------------------------------------------
    // CRUD
    // -----------------------------------------------------------------

    /// Add a conditional format (with rules) to the sheet.
    ///
    /// The engine bridge accepts the canonical CF schema as `serde_json::Value`
    /// so it can normalize public-API rule-shape variants (`notContainsBlanks`,
    /// `cellValue` + text-operator promotion, etc.) before deserializing into
    /// the canonical [`ConditionalFormat`]. Callers that already hold a typed
    /// `ConditionalFormat` get free pass-through via `serde_json::to_value`.
    pub fn add_rule(&self, rule: ConditionalFormat) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let rule_json = serde_json::to_value(&rule).map_err(|e| {
            ComputeApiError::InvalidOperation(format!("failed to serialize ConditionalFormat: {e}"))
        })?;
        self.dispatch
            .call_engine(move |e| e.add_cf_rule(&sid, rule_json))
            .and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))
    }

    /// Update an existing conditional format by merging JSON updates.
    pub fn update_rule(
        &self,
        rule_id: &str,
        updates: serde_json::Value,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_id = rule_id.to_owned();
        self.dispatch
            .call_engine(move |e| e.update_cf_rule(&sid, &owned_id, updates))
            .and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))
    }

    /// Delete a conditional format by ID.
    pub fn delete_rule(&self, rule_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_id = rule_id.to_owned();
        self.dispatch
            .call_engine(move |e| e.delete_cf_rule(&sid, &owned_id))
            .and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))
    }

    /// Reorder conditional formats by providing the new order of format IDs.
    pub fn reorder_rules(&self, rule_ids: Vec<String>) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.reorder_cf_rules(&sid, rule_ids))
            .and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))
    }

    // -----------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------

    /// Get all conditional formats for the sheet.
    pub fn get_all_rules(&self) -> Result<Vec<ConditionalFormat>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_all_cf_rules(&sid))
    }

    /// Get conditional formats that apply to a specific cell.
    pub fn get_rules_for_cell(
        &self,
        row: u32,
        col: u32,
    ) -> Result<Vec<ConditionalFormat>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_cf_rules_for_cell(&sid, row, col))
    }

    /// Check if a cell has any conditional formatting rules applied.
    pub fn has_rules_for_cell(&self, row: u32, col: u32) -> Result<bool, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.has_cf_for_cell(&sid, row, col))
    }

    // -----------------------------------------------------------------
    // Range updates
    // -----------------------------------------------------------------

    /// Update the ranges of a conditional format.
    pub fn update_ranges(
        &self,
        format_id: &str,
        new_ranges: Vec<CFCellRange>,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_id = format_id.to_owned();
        self.dispatch
            .call_engine(move |e| {
                e.update_cf_ranges(&sid, &owned_id, &new_ranges)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Clear all conditional formats for the sheet.
    pub fn clear_all(&self) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.clear_cf_formats_for_sheet(&sid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }
}
