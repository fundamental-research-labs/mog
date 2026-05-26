//! WorkbookScenarios — What-if scenario analysis operations.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use snapshot_types::{MutationResult, Scenario, ScenarioCreateInput, ScenarioUpdateInput};

/// What-if scenario analysis for the workbook.
pub struct WorkbookScenarios {
    dispatch: Dispatch,
}

impl WorkbookScenarios {
    pub(crate) fn new(dispatch: Dispatch) -> Self {
        Self { dispatch }
    }

    /// Create a new scenario.
    pub fn create_scenario(
        &self,
        input: ScenarioCreateInput,
    ) -> Result<MutationResult, ComputeApiError> {
        self.dispatch
            .call_engine(move |e| e.create_scenario(input).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Update an existing scenario by ID.
    pub fn update_scenario(
        &self,
        scenario_id: &str,
        input: ScenarioUpdateInput,
    ) -> Result<MutationResult, ComputeApiError> {
        let owned_id = scenario_id.to_owned();
        self.dispatch
            .call_engine(move |e| e.update_scenario(&owned_id, input).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Remove a scenario by ID.
    pub fn remove_scenario(&self, scenario_id: &str) -> Result<MutationResult, ComputeApiError> {
        let owned_id = scenario_id.to_owned();
        self.dispatch
            .call_engine(move |e| e.remove_scenario(&owned_id).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Get all scenarios in the workbook.
    pub fn get_all_scenarios(&self) -> Result<Vec<Scenario>, ComputeApiError> {
        self.dispatch.query_engine(|e| e.get_all_scenarios())
    }

    /// Set the active scenario (pass `None` to clear).
    pub fn set_active_scenario(
        &self,
        scenario_id: Option<&str>,
    ) -> Result<MutationResult, ComputeApiError> {
        let owned_id = scenario_id.map(|s| s.to_owned());
        self.dispatch
            .call_engine(move |e| e.set_active_scenario(owned_id).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }
}
