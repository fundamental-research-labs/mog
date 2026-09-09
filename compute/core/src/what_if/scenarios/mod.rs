//! Ordered native scenarios for What-If Analysis.
//! Scenario definitions belong to the workbook; active application and restore
//! baselines belong to the engine session.

mod apply_restore;
mod crud;
mod query;
#[cfg(test)]
mod tests;
mod types;
mod validation;

pub(crate) use apply_restore::{active_state, prepare_apply, prepare_restore};
pub use crud::{create, remove, update};
pub use query::{find_by_name, get_all, get_by_id, get_count, is_at_limit};
pub(crate) use types::ScenarioSessionState;
pub use types::{
    MAX_CHANGING_CELLS_PER_SCENARIO, MAX_SCENARIO_COMMENT_LENGTH, MAX_SCENARIO_NAME_LENGTH,
    MAX_SCENARIOS,
};
#[cfg(test)]
pub(crate) use types::{
    ScenarioApplyPlan, ScenarioBaseline, ScenarioBaselineCell, ScenarioRestorePlan,
};
pub use validation::{
    validate_changing_cells, validate_scenario_comment, validate_scenario_input,
    validate_scenario_name, validate_values,
};
