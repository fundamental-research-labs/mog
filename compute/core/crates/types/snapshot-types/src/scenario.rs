//! What-If Analysis scenario types.
//!
//! A [`Scenario`] is a saved set of input values for changing cells, used by
//! the What-If Analysis feature (Scenario Manager). Types here cover CRUD
//! operations and validation for scenarios.

use serde::{Deserialize, Serialize};

use value_types::{CellValue, FiniteF64};

/// A scenario represents a saved set of input values for changing cells.
///
/// Uses `CellId` references (UUID strings) for cell identity, ensuring stability
/// under row/column insertions and deletions.
///
/// Field names use camelCase serde renaming for IPC compatibility with the
/// TypeScript contracts (`@mog-sdk/spreadsheet-contracts/store`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    /// Unique scenario identifier (UUID).
    pub id: String,
    /// User-friendly name for the scenario.
    pub name: String,
    /// Optional description/comment about the scenario.
    #[serde(default)]
    pub comment: String,
    /// `CellId`s of the changing cells (UUID strings).
    pub changing_cells: Vec<String>,
    /// Values for each changing cell, in same order as `changing_cells`.
    pub values: Vec<CellValue>,
    /// User who created the scenario (optional for collaboration).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_by: Option<String>,
    /// Timestamp when the scenario was created (epoch millis).
    pub created_at: FiniteF64,
    /// Timestamp when the scenario was last modified (epoch millis).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<FiniteF64>,
}

/// Scenarios are equal if they have the same `id`, regardless of other fields.
/// This supports deduplication by identity in scenario lists.
impl PartialEq for Scenario {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

/// Input type for creating a new scenario.
/// Omits auto-generated fields (id, `created_at`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioCreateInput {
    /// User-friendly name for the scenario.
    pub name: String,
    /// Optional description/comment about the scenario.
    #[serde(default)]
    pub comment: String,
    /// `CellId`s of the changing cells (UUID strings).
    pub changing_cells: Vec<String>,
    /// Values for each changing cell, in same order as `changing_cells`.
    pub values: Vec<CellValue>,
    /// User who created the scenario (optional for collaboration).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_by: Option<String>,
}

/// Input type for updating an existing scenario.
/// All fields are optional; only provided fields are updated.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioUpdateInput {
    /// New name (if changing).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// New comment (if changing).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// New changing cells (if changing).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changing_cells: Option<Vec<String>>,
    /// New values (if changing).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub values: Option<Vec<CellValue>>,
}

/// Validation error for scenario operations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioValidationError {
    /// The field that failed validation.
    pub field: String,
    /// Human-readable error message.
    pub message: String,
}

/// Result of a scenario create operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioCreateResult {
    /// Whether the operation succeeded.
    pub success: bool,
    /// The ID of the newly created scenario (if successful).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scenario_id: Option<String>,
    /// Validation errors (if failed).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<ScenarioValidationError>>,
}

/// Result of a scenario update operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioUpdateResult {
    /// Whether the operation succeeded.
    pub success: bool,
    /// Validation errors (if failed).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<ScenarioValidationError>>,
}

/// Result of a scenario remove operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioRemoveResult {
    /// Whether the operation succeeded.
    pub success: bool,
    /// The ID of the removed scenario (if successful).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scenario_id: Option<String>,
    /// Validation errors (if failed).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<ScenarioValidationError>>,
}

/// Original cell content captured before a scenario was applied.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioOriginalCellValue {
    /// Sheet containing the cell.
    pub sheet_id: String,
    /// Stable cell identity.
    pub cell_id: String,
    /// Original displayed/computed value.
    pub value: CellValue,
    /// Original formula text, if the cell was a formula cell.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
}

/// Session-scoped state for the currently applied scenario.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioActiveState {
    /// Scenario whose values are currently applied in this engine session.
    pub scenario_id: String,
    /// Session baseline token used for restore.
    pub baseline_id: String,
    /// Document/session handle. This is not persisted in workbook storage.
    pub document_id: String,
    /// Whether the backing scenario definition still exists.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub definition_status: Option<String>,
    /// Whether the applied cells still match the baseline model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell_mutation_status: Option<String>,
}

/// Result of applying a scenario.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioApplyResult {
    /// Whether the operation succeeded.
    pub success: bool,
    /// Scenario that was requested.
    pub scenario_id: String,
    /// Session baseline token created or extended by this apply.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baseline_id: Option<String>,
    /// Document/session handle this baseline belongs to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_id: Option<String>,
    /// Number of existing cells updated with scenario values.
    pub cells_updated: u32,
    /// Changing CellIds that could not be resolved in the current workbook.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skipped_cells: Vec<String>,
    /// Original values captured in the Rust session baseline.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub original_values: Vec<ScenarioOriginalCellValue>,
    /// Validation errors (if failed).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<ScenarioValidationError>>,
}

/// Result of restoring a scenario baseline.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioRestoreResult {
    /// Whether the operation succeeded.
    pub success: bool,
    /// Restored baseline token.
    pub baseline_id: String,
    /// Scenario associated with the baseline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scenario_id: Option<String>,
    /// Number of cells restored.
    pub cells_restored: u32,
    /// Baseline CellIds that no longer resolve in the current workbook.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skipped_cells: Vec<String>,
    /// Validation errors (if failed).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<ScenarioValidationError>>,
}
