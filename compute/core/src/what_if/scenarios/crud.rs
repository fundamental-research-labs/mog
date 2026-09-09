use crate::snapshot::{
    Scenario, ScenarioCreateInput, ScenarioCreateResult, ScenarioRemoveResult, ScenarioUpdateInput,
    ScenarioUpdateResult, ScenarioValidationError,
};
use crate::storage::WorkbookStorage;

use super::query::{get_all, is_at_limit};
use super::types::MAX_SCENARIOS;
use super::validation::validate_scenario_input;

/// Generate a unique scenario ID.
fn generate_scenario_id(id_alloc: &cell_types::IdAllocator) -> String {
    cell_types::CellId::from_raw(id_alloc.next_u128()).to_uuid_string()
}

/// Current timestamp in milliseconds (epoch).
fn now_millis() -> f64 {
    crate::storage::infra::time::now_millis() as f64
}

// =============================================================================
// Create / Update / Delete
// =============================================================================

/// Create a new scenario.
///
/// Returns `ScenarioCreateResult` with the new scenario ID on success, or
/// validation errors on failure.
pub fn create(
    storage: &mut WorkbookStorage,
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

    storage.metadata.scenarios.push(scenario);

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
    storage: &mut WorkbookStorage,
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

    storage.metadata.scenarios[index] = updated_scenario;

    ScenarioUpdateResult {
        success: true,
        errors: None,
    }
}

/// Delete a scenario.
///
/// Returns a structured result so bridge/kernel callers can distinguish success
/// from not-found instead of treating every mutation as successful.
pub fn remove(storage: &mut WorkbookStorage, scenario_id: &str) -> ScenarioRemoveResult {
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

    storage.metadata.scenarios.remove(index);

    ScenarioRemoveResult {
        success: true,
        scenario_id: Some(scenario_id.to_string()),
        errors: None,
    }
}
