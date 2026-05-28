//! Scenario CRUD operations for What-If Analysis.
//!
//! Scenarios allow users to save sets of input values and switch between them
//! to compare different outcomes. This module implements CRUD operations that
//! work with the Yrs storage layer.
//!
//! Port of `spreadsheet-model/src/scenarios.ts`.
//!
//! ## Yrs Storage Layout
//!
//! Scenarios are stored in the workbook-level `scenarios` map:
//! ```text
//! workbook: Y.Map
//!   +-- scenarios: Y.Map
//!       +-- items: Y.Array<Y.Map>           (structured Scenario maps)
//!   +-- ...
//! ```
//!
//! Each scenario is stored as a structured Y.Map inside a Yrs Array.
//! Array fields (changing_cells, values) use a JSON bridge string inside the
//! map because Yrs `Any` values don't support deeply nested structures
//! natively. The Array preserves insertion order.

mod apply_restore;
mod crud;
mod query;
mod storage;
#[cfg(test)]
mod tests;
mod types;
mod validation;

pub(crate) use apply_restore::{active_state, prepare_apply, prepare_restore};
pub use crud::{create, remove, set_active_scenario_id, update};
pub use query::{
    find_by_name, get_active_scenario, get_active_scenario_id, get_all, get_by_id, get_count,
    is_at_limit,
};
pub use types::{
    MAX_CHANGING_CELLS_PER_SCENARIO, MAX_SCENARIO_COMMENT_LENGTH, MAX_SCENARIO_NAME_LENGTH,
    MAX_SCENARIOS,
};
pub(crate) use types::{
    ScenarioApplyPlan, ScenarioBaseline, ScenarioBaselineCell, ScenarioRestorePlan,
    ScenarioSessionState,
};
pub use validation::{
    validate_changing_cells, validate_scenario_comment, validate_scenario_input,
    validate_scenario_name, validate_values,
};
