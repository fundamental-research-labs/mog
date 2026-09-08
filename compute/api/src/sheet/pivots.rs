//! Sheet-scoped PivotTable operations.
//!
//! The Office.js host uses this facade for persisted PivotTable lifecycle
//! operations.  Computation and rendering stay in `YrsComputeEngine`: the
//! facade does not keep a second pivot map or calculate a synthetic result.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use crate::pure::pivot::{PivotExpansionState, PivotTableConfig, PivotTableResult};
use cell_types::SheetId;
use serde_json::Value;
use snapshot_types::MutationResult;

/// Pivot table operations for a single output sheet.
pub struct SheetPivots {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

impl SheetPivots {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    /// Get one persisted PivotTable by its stable ID.
    pub fn get(&self, pivot_id: &str) -> Result<Option<PivotTableConfig>, ComputeApiError> {
        let sid = self.sheet_id;
        let id = pivot_id.to_string();
        self.dispatch
            .query_engine(move |engine| engine.pivot_get(&sid, &id))
    }

    /// Get every persisted PivotTable whose containing/output sheet is this
    /// sheet.  The engine remains the source of truth for ordering and data.
    pub fn get_all(&self) -> Result<Vec<PivotTableConfig>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |engine| engine.pivot_get_all(&sid))
    }

    /// Create a PivotTable from the engine's canonical JSON configuration.
    ///
    /// `config` is validated by the engine before any state is changed.  The
    /// returned mutation carries the newly allocated stable PivotTable ID in
    /// its `data` field as a serialized [`PivotTableConfig`].
    pub fn create(&self, config: &Value) -> Result<MutationResult, ComputeApiError> {
        let config = config.clone();
        self.dispatch
            .call_engine(move |engine| engine.pivot_create(config).map(|(_, result)| result))
            .and_then(|result| result.map_err(ComputeApiError::from))
    }

    /// Create a PivotTable and return its canonical persisted configuration.
    ///
    /// This convenience is useful to object-model adapters that need the
    /// generated ID to bind the newly-created proxy in the same batch.
    pub fn create_config(&self, config: &Value) -> Result<PivotTableConfig, ComputeApiError> {
        let mutation = self.create(config)?;
        mutation.extract_data::<PivotTableConfig>().ok_or_else(|| {
            ComputeApiError::InvalidOperation(
                "pivot_create returned no PivotTableConfig".to_string(),
            )
        })
    }

    /// Replace a persisted PivotTable configuration.
    pub fn update(
        &self,
        pivot_id: &str,
        config: PivotTableConfig,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let id = pivot_id.to_string();
        self.dispatch
            .call_engine(move |engine| {
                engine
                    .pivot_update(&sid, &id, config)
                    .map(|(_, result)| result)
            })
            .and_then(|result| result.map_err(ComputeApiError::from))
    }

    /// Delete a persisted PivotTable and clear its production materialization.
    pub fn delete(&self, pivot_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let id = pivot_id.to_string();
        self.dispatch
            .call_engine(move |engine| engine.pivot_delete(&sid, &id).map(|(_, result)| result))
            .and_then(|result| result.map_err(ComputeApiError::from))
    }

    /// Compute and materialize one PivotTable using its current source range.
    ///
    /// This is the operation used by `PivotTable.refresh()`; it writes through
    /// the engine mirror and updates the persisted rendered bounds.
    pub fn materialize(
        &self,
        pivot_id: &str,
        expansion_state: Option<PivotExpansionState>,
    ) -> Result<PivotTableResult, ComputeApiError> {
        let sid = self.sheet_id;
        let id = pivot_id.to_string();
        self.dispatch
            .call_engine(move |engine| engine.pivot_materialize(&sid, &id, expansion_state))
            .and_then(|result| result.map_err(ComputeApiError::from))
    }

    /// Refresh and return the ordinary mutation envelope used by host
    /// dispatchers.  The embedded result is still produced by the same real
    /// materializer; this method only adds viewport patches to the envelope.
    pub fn refresh(
        &self,
        pivot_id: &str,
        expansion_state: Option<PivotExpansionState>,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let id = pivot_id.to_string();
        self.dispatch
            .call_engine(move |engine| {
                engine
                    .pivot_materialize_mutation(&sid, &id, expansion_state)
                    .map(|(_, result)| result)
            })
            .and_then(|result| result.map_err(ComputeApiError::from))
    }
}
