use crate::snapshot::{
    Scenario, ScenarioCreateInput, ScenarioCreateResult, ScenarioRemoveResult, ScenarioUpdateInput,
    ScenarioUpdateResult, ScenarioValidationError,
};
use crate::storage::YrsStorage;
use value_types::ComputeError;
use yrs::{Array, Map, Transact};

use super::query::{get_all, is_at_limit};
use super::storage::{
    get_or_create_items_array, get_or_create_scenarios_map, remove_legacy_active_scenario_id,
    scenario_yrs,
};
use super::types::MAX_SCENARIOS;
use super::validation::validate_scenario_input;

/// Generate a unique scenario ID.
fn generate_scenario_id(id_alloc: &cell_types::IdAllocator) -> String {
    cell_types::CellId::from_raw(id_alloc.next_u128()).to_uuid_string()
}

/// Current timestamp in milliseconds (epoch).
fn now_millis() -> f64 {
    crate::storage::infra::yrs_helpers::now_millis() as f64
}

// =============================================================================
// Create / Update / Delete
// =============================================================================

/// Create a new scenario.
///
/// Returns `ScenarioCreateResult` with the new scenario ID on success, or
/// validation errors on failure.
pub fn create(
    storage: &YrsStorage,
    input: ScenarioCreateInput,
    id_alloc: &cell_types::IdAllocator,
) -> ScenarioCreateResult {
    // Check limit
    if is_at_limit(storage) {
        return ScenarioCreateResult {
            success: false,
            scenario_id: None,
            errors: Some(vec![ScenarioValidationError {
                field: "general".to_string(),
                message: format!("Maximum of {} scenarios allowed", MAX_SCENARIOS),
            }]),
        };
    }

    // Validate input
    let existing_scenarios = get_all(storage);
    let errors = validate_scenario_input(&input, &existing_scenarios, None);
    if !errors.is_empty() {
        return ScenarioCreateResult {
            success: false,
            scenario_id: None,
            errors: Some(errors),
        };
    }

    // Build the scenario
    // `now_millis()` returns SystemTime millis since UNIX epoch — always finite.
    let now = value_types::FiniteF64::must(now_millis());
    let scenario = Scenario {
        id: generate_scenario_id(id_alloc),
        name: input.name.trim().to_string(),
        comment: input.comment,
        changing_cells: input.changing_cells,
        values: input.values,
        created_by: input.created_by,
        created_at: now,
        modified_at: Some(now),
    };

    let scenario_id = scenario.id.clone();

    // Store as structured Y.Map (new path)
    let workbook = storage.workbook_map();
    let mut txn = storage.doc().transact_mut();
    let scenarios_map = get_or_create_scenarios_map(workbook, &mut txn);
    remove_legacy_active_scenario_id(&scenarios_map, &mut txn);
    let items_arr = get_or_create_items_array(&scenarios_map, &mut txn);
    let prelim: yrs::MapPrelim = scenario_yrs::to_yrs_prelim(&scenario).into_iter().collect();
    items_arr.push_back(&mut txn, prelim);

    ScenarioCreateResult {
        success: true,
        scenario_id: Some(scenario_id),
        errors: None,
    }
}

/// Update an existing scenario.
///
/// Returns `ScenarioUpdateResult` with success or validation errors.
pub fn update(
    storage: &YrsStorage,
    scenario_id: &str,
    updates: ScenarioUpdateInput,
) -> ScenarioUpdateResult {
    let scenarios = get_all(storage);
    let index = match scenarios.iter().position(|s| s.id == scenario_id) {
        Some(idx) => idx,
        None => {
            return ScenarioUpdateResult {
                success: false,
                errors: Some(vec![ScenarioValidationError {
                    field: "general".to_string(),
                    message: "Scenario not found".to_string(),
                }]),
            };
        }
    };

    let existing = &scenarios[index];

    // Build merged input for validation
    let merged = ScenarioCreateInput {
        name: updates
            .name
            .clone()
            .unwrap_or_else(|| existing.name.clone()),
        comment: updates
            .comment
            .clone()
            .unwrap_or_else(|| existing.comment.clone()),
        changing_cells: updates
            .changing_cells
            .clone()
            .unwrap_or_else(|| existing.changing_cells.clone()),
        values: updates
            .values
            .clone()
            .unwrap_or_else(|| existing.values.clone()),
        created_by: existing.created_by.clone(),
    };

    // Validate
    let errors = validate_scenario_input(&merged, &scenarios, Some(scenario_id));
    if !errors.is_empty() {
        return ScenarioUpdateResult {
            success: false,
            errors: Some(errors),
        };
    }

    // Build the updated scenario
    let now = value_types::FiniteF64::must(now_millis());
    let updated_scenario = Scenario {
        id: existing.id.clone(),
        name: merged.name.trim().to_string(),
        comment: merged.comment,
        changing_cells: merged.changing_cells,
        values: merged.values,
        created_by: existing.created_by.clone(),
        created_at: existing.created_at,
        modified_at: Some(now),
    };

    // Replace in Yrs array as structured Y.Map
    let workbook = storage.workbook_map();
    let mut txn = storage.doc().transact_mut();
    let scenarios_map = get_or_create_scenarios_map(workbook, &mut txn);
    remove_legacy_active_scenario_id(&scenarios_map, &mut txn);
    let items_arr = get_or_create_items_array(&scenarios_map, &mut txn);
    items_arr.remove(&mut txn, index as u32);
    let prelim: yrs::MapPrelim = scenario_yrs::to_yrs_prelim(&updated_scenario)
        .into_iter()
        .collect();
    items_arr.insert(&mut txn, index as u32, prelim);

    ScenarioUpdateResult {
        success: true,
        errors: None,
    }
}

/// Delete a scenario.
///
/// Returns a structured result so bridge/kernel callers can distinguish success
/// from not-found instead of treating every mutation as successful.
pub fn remove(storage: &YrsStorage, scenario_id: &str) -> ScenarioRemoveResult {
    let scenarios = get_all(storage);
    let index = match scenarios.iter().position(|s| s.id == scenario_id) {
        Some(idx) => idx,
        None => {
            return ScenarioRemoveResult {
                success: false,
                scenario_id: None,
                errors: Some(vec![ScenarioValidationError {
                    field: "scenarioId".to_string(),
                    message: "Scenario not found".to_string(),
                }]),
            };
        }
    };

    let workbook = storage.workbook_map();
    let mut txn = storage.doc().transact_mut();
    let scenarios_map = get_or_create_scenarios_map(workbook, &mut txn);
    let items_arr = get_or_create_items_array(&scenarios_map, &mut txn);
    items_arr.remove(&mut txn, index as u32);
    remove_legacy_active_scenario_id(&scenarios_map, &mut txn);

    ScenarioRemoveResult {
        success: true,
        scenario_id: Some(scenario_id.to_string()),
        errors: None,
    }
}

// =============================================================================
// Active Scenario Management
// =============================================================================

/// Reject legacy direct active-scenario writes.
pub fn set_active_scenario_id(
    storage: &YrsStorage,
    scenario_id: Option<&str>,
) -> Result<(), ComputeError> {
    let _ = storage;
    let _ = scenario_id;
    Err(ComputeError::InvalidInput {
        message: "SCENARIO_ACTIVE_STATE_READ_ONLY: scenario active state is session-scoped; use Rust-owned apply/restore".to_string(),
    })
}
