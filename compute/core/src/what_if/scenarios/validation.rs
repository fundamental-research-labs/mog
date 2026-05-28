use std::collections::HashSet;

use crate::snapshot::{Scenario, ScenarioCreateInput, ScenarioValidationError};
use value_types::CellValue;

use super::types::{
    MAX_CHANGING_CELLS_PER_SCENARIO, MAX_SCENARIO_COMMENT_LENGTH, MAX_SCENARIO_NAME_LENGTH,
};

// =============================================================================
// Validation Helpers
// =============================================================================

/// Validate scenario name.
pub fn validate_scenario_name(name: &str) -> Vec<ScenarioValidationError> {
    let mut errors = Vec::new();

    if name.trim().is_empty() {
        errors.push(ScenarioValidationError {
            field: "name".to_string(),
            message: "Scenario name is required".to_string(),
        });
    } else if name.len() > MAX_SCENARIO_NAME_LENGTH {
        errors.push(ScenarioValidationError {
            field: "name".to_string(),
            message: format!(
                "Scenario name cannot exceed {} characters",
                MAX_SCENARIO_NAME_LENGTH
            ),
        });
    }

    errors
}

/// Validate scenario comment.
pub fn validate_scenario_comment(comment: &str) -> Vec<ScenarioValidationError> {
    let mut errors = Vec::new();

    if comment.len() > MAX_SCENARIO_COMMENT_LENGTH {
        errors.push(ScenarioValidationError {
            field: "comment".to_string(),
            message: format!(
                "Scenario comment cannot exceed {} characters",
                MAX_SCENARIO_COMMENT_LENGTH
            ),
        });
    }

    errors
}

/// Validate changing cells.
pub fn validate_changing_cells(changing_cells: &[String]) -> Vec<ScenarioValidationError> {
    let mut errors = Vec::new();

    if changing_cells.is_empty() {
        errors.push(ScenarioValidationError {
            field: "changingCells".to_string(),
            message: "At least one changing cell is required".to_string(),
        });
    } else if changing_cells.len() > MAX_CHANGING_CELLS_PER_SCENARIO {
        errors.push(ScenarioValidationError {
            field: "changingCells".to_string(),
            message: format!(
                "Cannot exceed {} changing cells per scenario",
                MAX_CHANGING_CELLS_PER_SCENARIO
            ),
        });
    }

    // Check for duplicates
    let mut seen = HashSet::new();
    for cell_id in changing_cells {
        if !seen.insert(cell_id) {
            errors.push(ScenarioValidationError {
                field: "changingCells".to_string(),
                message: "Duplicate changing cells are not allowed".to_string(),
            });
            break;
        }
    }

    errors
}

/// Validate that values array matches changing cells.
pub fn validate_values(
    changing_cells: &[String],
    values: &[CellValue],
) -> Vec<ScenarioValidationError> {
    let mut errors = Vec::new();

    if values.len() != changing_cells.len() {
        errors.push(ScenarioValidationError {
            field: "values".to_string(),
            message: "Number of values must match number of changing cells".to_string(),
        });
    }

    errors
}

/// Validate entire scenario input.
///
/// `existing_scenarios` is used for duplicate name checking.
/// `exclude_scenario_id` excludes a specific scenario from the duplicate check (for updates).
pub fn validate_scenario_input(
    input: &ScenarioCreateInput,
    existing_scenarios: &[Scenario],
    exclude_scenario_id: Option<&str>,
) -> Vec<ScenarioValidationError> {
    let mut errors = Vec::new();

    errors.extend(validate_scenario_name(&input.name));
    errors.extend(validate_scenario_comment(&input.comment));
    errors.extend(validate_changing_cells(&input.changing_cells));
    errors.extend(validate_values(&input.changing_cells, &input.values));

    // Check for duplicate name (case-insensitive)
    let name_lower = input.name.to_lowercase().trim().to_string();
    let duplicate = existing_scenarios.iter().find(|s| {
        Some(s.id.as_str()) != exclude_scenario_id && s.name.to_lowercase().trim() == name_lower
    });
    if duplicate.is_some() {
        errors.push(ScenarioValidationError {
            field: "name".to_string(),
            message: "A scenario with this name already exists".to_string(),
        });
    }

    errors
}

pub(super) fn scenario_error(field: &str, message: impl Into<String>) -> ScenarioValidationError {
    ScenarioValidationError {
        field: field.to_string(),
        message: message.into(),
    }
}
