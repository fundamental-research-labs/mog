use crate::snapshot::Scenario;
use crate::storage::WorkbookStorage;

use super::types::MAX_SCENARIOS;

// =============================================================================
// Getters
// =============================================================================

/// Get all scenarios in the workbook.
pub fn get_all(storage: &WorkbookStorage) -> Vec<Scenario> {
    storage.metadata.scenarios.clone()
}

/// Get a scenario by ID.
pub fn get_by_id(storage: &WorkbookStorage, scenario_id: &str) -> Option<Scenario> {
    storage
        .metadata
        .scenarios
        .iter()
        .find(|s| s.id == scenario_id)
        .cloned()
}

/// Get the number of scenarios in the workbook.
pub fn get_count(storage: &WorkbookStorage) -> usize {
    storage.metadata.scenarios.len()
}

/// Check if the maximum number of scenarios has been reached.
pub fn is_at_limit(storage: &WorkbookStorage) -> bool {
    get_count(storage) >= MAX_SCENARIOS
}

/// Find a scenario by name (case-insensitive).
pub fn find_by_name(storage: &WorkbookStorage, name: &str) -> Option<Scenario> {
    let name_lower = name.to_lowercase();
    let name_trimmed = name_lower.trim();
    get_all(storage)
        .into_iter()
        .find(|s| s.name.to_lowercase().trim() == name_trimmed)
}
