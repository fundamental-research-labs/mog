//! SheetPivots — Pivot table create / update / materialize.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use domain_types::domain::pivot::PivotTableConfig;
use snapshot_types::MutationResult;

/// Pivot table operations for a single sheet.
pub struct SheetPivots {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

impl SheetPivots {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    /// Create a pivot table from a typed config (JSON-validated by the engine).
    pub fn create(&self, config: PivotTableConfig) -> Result<MutationResult, ComputeApiError> {
        let config_json = serde_json::to_value(&config).map_err(|e| {
            ComputeApiError::InvalidOperation(format!("failed to serialize PivotTableConfig: {e}"))
        })?;
        self.dispatch
            .call_engine(move |e| e.pivot_create(config_json))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Replace a pivot config and write its computed cells in one mutation.
    pub fn update_and_materialize(
        &self,
        pivot_id: &str,
        config: PivotTableConfig,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_id = pivot_id.to_owned();
        self.dispatch
            .call_engine(move |e| e.pivot_update_and_materialize(&sid, &owned_id, config, None))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Load one stored pivot config.
    pub fn get(&self, pivot_id: &str) -> Result<Option<PivotTableConfig>, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_id = pivot_id.to_owned();
        self.dispatch
            .query_engine(move |e| e.pivot_get(&sid, &owned_id))
    }

    /// Load every stored pivot config on this sheet.
    pub fn get_all(&self) -> Result<Vec<PivotTableConfig>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch.query_engine(move |e| e.pivot_get_all(&sid))
    }
}
