use crate::snapshot::Scenario;
use crate::storage::YrsStorage;
use yrs::Transact;

use super::storage::{get_scenarios_map, read_all_scenarios};
use super::types::MAX_SCENARIOS;

// =============================================================================
// Getters
// =============================================================================

/// Get all scenarios in the workbook.
pub fn get_all(storage: &YrsStorage) -> Vec<Scenario> {
    let txn = storage.doc().transact();
    let workbook = storage.workbook_map();

    match get_scenarios_map(workbook, &txn) {
        Some(scenarios_map) => read_all_scenarios(&scenarios_map, &txn),
        None => Vec::new(),
    }
}

/// Get a scenario by ID.
pub fn get_by_id(storage: &YrsStorage, scenario_id: &str) -> Option<Scenario> {
    get_all(storage).into_iter().find(|s| s.id == scenario_id)
}

/// Get the currently active scenario ID.
pub fn get_active_scenario_id(storage: &YrsStorage) -> Option<String> {
    let _ = storage;
    None
}

/// Get the currently active scenario.
pub fn get_active_scenario(storage: &YrsStorage) -> Option<Scenario> {
    let active_id = get_active_scenario_id(storage)?;
    get_by_id(storage, &active_id)
}

/// Get the number of scenarios in the workbook.
pub fn get_count(storage: &YrsStorage) -> usize {
    get_all(storage).len()
}

/// Check if the maximum number of scenarios has been reached.
pub fn is_at_limit(storage: &YrsStorage) -> bool {
    get_count(storage) >= MAX_SCENARIOS
}

/// Find a scenario by name (case-insensitive).
pub fn find_by_name(storage: &YrsStorage, name: &str) -> Option<Scenario> {
    let name_lower = name.to_lowercase();
    let name_trimmed = name_lower.trim();
    get_all(storage)
        .into_iter()
        .find(|s| s.name.to_lowercase().trim() == name_trimmed)
}
