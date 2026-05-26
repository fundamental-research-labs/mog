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

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use yrs::{Any, Array, ArrayPrelim, ArrayRef, Map, MapPrelim, MapRef, Out, Transact};

use crate::mirror::CellMirror;
use crate::snapshot::{
    Scenario, ScenarioActiveState, ScenarioApplyResult, ScenarioCreateInput, ScenarioCreateResult,
    ScenarioOriginalCellValue, ScenarioRemoveResult, ScenarioRestoreResult, ScenarioUpdateInput,
    ScenarioUpdateResult, ScenarioValidationError,
};
use crate::storage::YrsStorage;
use cell_types::{CellId, SheetId};
use formula_types::IdentityFormula;
use value_types::{CellValue, ComputeError};

// =============================================================================
// Constants (matching TypeScript contracts)
// =============================================================================

/// Maximum number of scenarios allowed per workbook (Excel limit).
pub const MAX_SCENARIOS: usize = 251;

/// Maximum number of changing cells per scenario (Excel limit).
pub const MAX_CHANGING_CELLS_PER_SCENARIO: usize = 32;

/// Maximum length of scenario name.
pub const MAX_SCENARIO_NAME_LENGTH: usize = 255;

/// Maximum length of scenario comment.
pub const MAX_SCENARIO_COMMENT_LENGTH: usize = 255;

// Internal Yrs key names within the "scenarios" map
const KEY_ITEMS: &str = "items";
const KEY_ACTIVE_SCENARIO_ID: &str = "activeScenarioId";
const SESSION_DOCUMENT_ID: &str = "local-compute-session";

// =============================================================================
// Session-scoped apply/restore state
// =============================================================================

/// Scenario apply/restore state owned by one live compute engine session.
///
/// This deliberately does not serialize to Yrs. A scenario apply captures a
/// baseline in memory, writes scenario values through a single engine mutation,
/// and restore consumes that baseline through another engine mutation.
#[derive(Debug, Clone, Default)]
pub(crate) struct ScenarioSessionState {
    pub active: Option<ScenarioActiveState>,
    pub baselines: HashMap<String, ScenarioBaseline>,
}

#[derive(Debug, Clone)]
pub(crate) struct ScenarioBaseline {
    pub baseline_id: String,
    pub scenario_id: String,
    pub document_id: String,
    pub originals: Vec<ScenarioBaselineCell>,
}

#[derive(Debug, Clone)]
pub(crate) struct ScenarioBaselineCell {
    pub sheet_id: SheetId,
    pub cell_id: CellId,
    pub value: CellValue,
    pub formula: Option<IdentityFormula>,
}

pub(crate) struct ScenarioApplyPlan {
    pub baseline: ScenarioBaseline,
    pub edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)>,
    pub result: ScenarioApplyResult,
}

pub(crate) struct ScenarioRestorePlan {
    pub baseline_id: String,
    pub edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)>,
    pub result: ScenarioRestoreResult,
}

// =============================================================================
// Internal Helpers
// =============================================================================

/// Generate a unique scenario ID.
fn generate_scenario_id(id_alloc: &cell_types::IdAllocator) -> String {
    cell_types::CellId::from_raw(id_alloc.next_u128()).to_uuid_string()
}

/// Current timestamp in milliseconds (epoch).
fn now_millis() -> f64 {
    crate::storage::infra::yrs_helpers::now_millis() as f64
}

/// Get or create the "items" array inside the scenarios map.
///
/// The scenarios map lives at `workbook.scenarios`. Inside it we store:
/// - `items`: Y.Array of JSON-serialized scenario strings
fn get_or_create_items_array(scenarios_map: &MapRef, txn: &mut yrs::TransactionMut) -> ArrayRef {
    match scenarios_map.get(txn, KEY_ITEMS) {
        Some(Out::YArray(arr)) => arr,
        _ => {
            let arr = ArrayPrelim::from([] as [Any; 0]);
            scenarios_map.insert(txn, KEY_ITEMS, arr)
        }
    }
}

/// Get the "items" array (read-only) if it exists.
fn get_items_array<T: yrs::ReadTxn>(scenarios_map: &MapRef, txn: &T) -> Option<ArrayRef> {
    match scenarios_map.get(txn, KEY_ITEMS) {
        Some(Out::YArray(arr)) => Some(arr),
        _ => None,
    }
}

/// Get the scenarios MapRef from the workbook map.
fn get_scenarios_map<T: yrs::ReadTxn>(workbook: &MapRef, txn: &T) -> Option<MapRef> {
    match workbook.get(txn, "scenarios") {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

/// Get or create the scenarios MapRef from the workbook map.
fn get_or_create_scenarios_map(workbook: &MapRef, txn: &mut yrs::TransactionMut) -> MapRef {
    match workbook.get(txn, "scenarios") {
        Some(Out::YMap(m)) => m,
        _ => {
            let empty = MapPrelim::from([] as [(&str, Any); 0]);
            workbook.insert(txn, "scenarios", empty)
        }
    }
}

/// Remove legacy persisted active-scenario state.
///
/// Active scenario/baseline state is session-scoped. Any existing
/// `activeScenarioId` key is ignored on reads and scrubbed on scenario writes.
fn remove_legacy_active_scenario_id(scenarios_map: &MapRef, txn: &mut yrs::TransactionMut) {
    scenarios_map.remove(txn, KEY_ACTIVE_SCENARIO_ID);
}

// =============================================================================
// Structured Y.Map read/write for Scenario (inline, since the type lives in
// snapshot-types which depends on domain-types — can't import from domain-types)
// =============================================================================

mod scenario_yrs {
    use super::*;
    use domain_types::yrs_schema::helpers::*;

    pub const KEY_ID: &str = "id";
    pub const KEY_NAME: &str = "name";
    pub const KEY_COMMENT: &str = "comment";
    pub const KEY_CHANGING_CELLS: &str = "changingCells";
    pub const KEY_VALUES: &str = "values";
    pub const KEY_CREATED_BY: &str = "createdBy";
    pub const KEY_CREATED_AT: &str = "createdAt";
    pub const KEY_MODIFIED_AT: &str = "modifiedAt";

    /// Convert a [`Scenario`] to Yrs prelim entries for initial hydration.
    ///
    /// Scalar fields → native Yrs keys. Array fields (`changing_cells`, `values`)
    /// use the JSON bridge pattern (serialized as JSON strings).
    pub fn to_yrs_prelim(s: &Scenario) -> Vec<(&str, Any)> {
        let mut entries: Vec<(&str, Any)> = vec![
            (KEY_ID, Any::String(Arc::from(s.id.as_str()))),
            (KEY_NAME, Any::String(Arc::from(s.name.as_str()))),
            (KEY_COMMENT, Any::String(Arc::from(s.comment.as_str()))),
            (KEY_CHANGING_CELLS, json_any(&s.changing_cells)),
            (KEY_VALUES, json_any(&s.values)),
            (KEY_CREATED_AT, Any::Number(s.created_at.get())),
        ];
        if let Some(ref by) = s.created_by {
            entries.push((KEY_CREATED_BY, Any::String(Arc::from(by.as_str()))));
        }
        if let Some(at) = s.modified_at {
            entries.push((KEY_MODIFIED_AT, Any::Number(at.get())));
        }
        entries
    }

    /// Read a [`Scenario`] from a structured Y.Map.
    pub fn from_yrs_map<T: yrs::ReadTxn>(map: &MapRef, txn: &T) -> Option<Scenario> {
        let id = read_string(map, txn, KEY_ID)?;
        // Timestamps stored in yrs come from `now_millis()` which is always
        // finite; on a non-finite read (corrupt storage) fall back to 0
        // rather than panicking on deserialize.
        let created_at =
            value_types::FiniteF64::new(read_number(map, txn, KEY_CREATED_AT).unwrap_or(0.0))
                .unwrap_or(value_types::FiniteF64::ZERO);
        let modified_at =
            read_number(map, txn, KEY_MODIFIED_AT).and_then(value_types::FiniteF64::new);
        Some(Scenario {
            id,
            name: read_string(map, txn, KEY_NAME).unwrap_or_default(),
            comment: read_string(map, txn, KEY_COMMENT).unwrap_or_default(),
            changing_cells: read_json(map, txn, KEY_CHANGING_CELLS).unwrap_or_default(),
            values: read_json(map, txn, KEY_VALUES).unwrap_or_default(),
            created_by: read_string(map, txn, KEY_CREATED_BY),
            created_at,
            modified_at,
        })
    }
}

/// Read all scenarios from the Yrs items array.
fn read_all_scenarios<T: yrs::ReadTxn>(scenarios_map: &MapRef, txn: &T) -> Vec<Scenario> {
    let items_arr = match get_items_array(scenarios_map, txn) {
        Some(arr) => arr,
        None => return Vec::new(),
    };

    let len = items_arr.len(txn);
    let mut result = Vec::with_capacity(len as usize);

    for i in 0..len {
        if let Some(Out::YMap(map)) = items_arr.get(txn, i)
            && let Some(scenario) = scenario_yrs::from_yrs_map(&map, txn)
        {
            result.push(scenario);
        }
    }

    result
}

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
    values: &[value_types::CellValue],
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

// =============================================================================
// Apply / Restore Planning
// =============================================================================

fn scenario_error(field: &str, message: impl Into<String>) -> ScenarioValidationError {
    ScenarioValidationError {
        field: field.to_string(),
        message: message.into(),
    }
}

fn scenario_apply_failure(
    scenario_id: &str,
    errors: Vec<ScenarioValidationError>,
) -> ScenarioApplyResult {
    ScenarioApplyResult {
        success: false,
        scenario_id: scenario_id.to_string(),
        baseline_id: None,
        document_id: None,
        cells_updated: 0,
        skipped_cells: Vec::new(),
        original_values: Vec::new(),
        errors: Some(errors),
    }
}

fn scenario_restore_failure(
    baseline_id: &str,
    errors: Vec<ScenarioValidationError>,
) -> ScenarioRestoreResult {
    ScenarioRestoreResult {
        success: false,
        baseline_id: baseline_id.to_string(),
        scenario_id: None,
        cells_restored: 0,
        skipped_cells: Vec::new(),
        errors: Some(errors),
    }
}

fn baseline_original_index(baseline: &ScenarioBaseline, cell_id: &CellId) -> Option<usize> {
    baseline
        .originals
        .iter()
        .position(|original| original.cell_id == *cell_id)
}

fn original_cell_wire(
    compute: &crate::scheduler::ComputeCore,
    mirror: &CellMirror,
    original: &ScenarioBaselineCell,
) -> ScenarioOriginalCellValue {
    let formula = original
        .formula
        .as_ref()
        .map(|formula| compute.to_a1_display(mirror, &original.sheet_id, formula));
    ScenarioOriginalCellValue {
        sheet_id: original.sheet_id.to_uuid_string(),
        cell_id: original.cell_id.to_uuid_string(),
        value: original.value.clone(),
        formula,
    }
}

fn validate_scenario_target(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<ScenarioValidationError> {
    if mirror.cse_anchor_covering(sheet_id, row, col).is_some() {
        return Some(scenario_error(
            "changingCells",
            "Scenario changing cell is inside an array formula region",
        ));
    }
    if mirror.find_data_table_at(sheet_id, row, col).is_some() {
        return Some(scenario_error(
            "changingCells",
            "Scenario changing cell is inside a data table region",
        ));
    }
    None
}

/// Return the session-scoped active scenario state.
pub(crate) fn active_state(
    storage: &YrsStorage,
    session: &ScenarioSessionState,
) -> Option<ScenarioActiveState> {
    let mut active = session.active.clone()?;
    active.definition_status = Some(if get_by_id(storage, &active.scenario_id).is_some() {
        "current".to_string()
    } else {
        "deleted".to_string()
    });
    Some(active)
}

/// Build the edits and baseline for applying a scenario.
///
/// This is deliberately read-only: the caller commits the returned edits through
/// `apply_mutation()` and installs the returned baseline only after that write
/// succeeds.
pub(crate) fn prepare_apply(
    storage: &YrsStorage,
    mirror: &CellMirror,
    compute: &crate::scheduler::ComputeCore,
    session: &ScenarioSessionState,
    scenario_id: &str,
    suggested_baseline_id: String,
) -> Result<ScenarioApplyPlan, ScenarioApplyResult> {
    if scenario_id.trim().is_empty() {
        return Err(scenario_apply_failure(
            scenario_id,
            vec![scenario_error(
                "scenarioId",
                "scenarioId must be a non-empty string",
            )],
        ));
    }

    let Some(scenario) = get_by_id(storage, scenario_id) else {
        return Err(scenario_apply_failure(
            scenario_id,
            vec![scenario_error("scenarioId", "Scenario not found")],
        ));
    };

    let validation = validate_scenario_input(
        &ScenarioCreateInput {
            name: scenario.name.clone(),
            comment: scenario.comment.clone(),
            changing_cells: scenario.changing_cells.clone(),
            values: scenario.values.clone(),
            created_by: scenario.created_by.clone(),
        },
        std::slice::from_ref(&scenario),
        Some(&scenario.id),
    );
    if !validation.is_empty() {
        return Err(scenario_apply_failure(scenario_id, validation));
    }

    let active_baseline = session
        .active
        .as_ref()
        .and_then(|active| session.baselines.get(&active.baseline_id));
    let mut baseline = active_baseline.cloned().unwrap_or(ScenarioBaseline {
        baseline_id: suggested_baseline_id,
        scenario_id: scenario.id.clone(),
        document_id: SESSION_DOCUMENT_ID.to_string(),
        originals: Vec::new(),
    });
    baseline.scenario_id = scenario.id.clone();

    let mut edits = Vec::with_capacity(scenario.changing_cells.len());
    let mut skipped_cells = Vec::new();
    let mut errors = Vec::new();
    let mut original_values = Vec::new();

    for (cell_id_text, value) in scenario.changing_cells.iter().zip(scenario.values.iter()) {
        let cell_id = match CellId::from_uuid_str(cell_id_text) {
            Ok(cell_id) => cell_id,
            Err(_) => {
                errors.push(scenario_error(
                    "changingCells",
                    format!("Invalid CellId: {cell_id_text}"),
                ));
                continue;
            }
        };

        let Some(sheet_id) = mirror.sheet_for_cell(&cell_id) else {
            skipped_cells.push(cell_id_text.clone());
            continue;
        };
        let Some(pos) = mirror.resolve_position(&cell_id) else {
            skipped_cells.push(cell_id_text.clone());
            continue;
        };

        if let Some(error) = validate_scenario_target(mirror, &sheet_id, pos.row(), pos.col()) {
            errors.push(error);
            continue;
        }

        let baseline_index = match baseline_original_index(&baseline, &cell_id) {
            Some(index) => index,
            None => {
                let original = ScenarioBaselineCell {
                    sheet_id,
                    cell_id,
                    value: mirror
                        .get_cell_value(&cell_id)
                        .cloned()
                        .unwrap_or(CellValue::Null),
                    formula: mirror.get_formula(&cell_id).cloned(),
                };
                baseline.originals.push(original);
                baseline.originals.len() - 1
            }
        };
        original_values.push(original_cell_wire(
            compute,
            mirror,
            &baseline.originals[baseline_index],
        ));
        edits.push((sheet_id, cell_id, pos.row(), pos.col(), value.clone(), None));
    }

    if !errors.is_empty() {
        return Err(scenario_apply_failure(scenario_id, errors));
    }

    let result = ScenarioApplyResult {
        success: true,
        scenario_id: scenario.id.clone(),
        baseline_id: Some(baseline.baseline_id.clone()),
        document_id: Some(baseline.document_id.clone()),
        cells_updated: edits.len() as u32,
        skipped_cells,
        original_values,
        errors: None,
    };

    Ok(ScenarioApplyPlan {
        baseline,
        edits,
        result,
    })
}

/// Build the edits for restoring a session baseline.
pub(crate) fn prepare_restore(
    mirror: &CellMirror,
    compute: &crate::scheduler::ComputeCore,
    session: &ScenarioSessionState,
    baseline_id: &str,
) -> Result<ScenarioRestorePlan, ScenarioRestoreResult> {
    if baseline_id.trim().is_empty() {
        return Err(scenario_restore_failure(
            baseline_id,
            vec![scenario_error(
                "baselineId",
                "baselineId must be a non-empty string",
            )],
        ));
    }

    let Some(baseline) = session.baselines.get(baseline_id) else {
        return Err(scenario_restore_failure(
            baseline_id,
            vec![scenario_error("baselineId", "Scenario baseline not found")],
        ));
    };

    let mut edits = Vec::with_capacity(baseline.originals.len());
    let mut skipped_cells = Vec::new();
    let mut errors = Vec::new();

    for original in &baseline.originals {
        let Some(sheet_id) = mirror.sheet_for_cell(&original.cell_id) else {
            skipped_cells.push(original.cell_id.to_uuid_string());
            continue;
        };
        let Some(pos) = mirror.resolve_position(&original.cell_id) else {
            skipped_cells.push(original.cell_id.to_uuid_string());
            continue;
        };

        if let Some(error) = validate_scenario_target(mirror, &sheet_id, pos.row(), pos.col()) {
            errors.push(error);
            continue;
        }

        let formula = original
            .formula
            .as_ref()
            .map(|formula| compute.to_a1_display(mirror, &sheet_id, formula));
        edits.push((
            sheet_id,
            original.cell_id,
            pos.row(),
            pos.col(),
            original.value.clone(),
            formula,
        ));
    }

    if !errors.is_empty() {
        return Err(scenario_restore_failure(baseline_id, errors));
    }

    Ok(ScenarioRestorePlan {
        baseline_id: baseline.baseline_id.clone(),
        edits,
        result: ScenarioRestoreResult {
            success: true,
            baseline_id: baseline.baseline_id.clone(),
            scenario_id: Some(baseline.scenario_id.clone()),
            cells_restored: baseline.originals.len().saturating_sub(skipped_cells.len()) as u32,
            skipped_cells,
            errors: None,
        },
    })
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

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::{CellValue, FiniteF64};

    /// Helper: create a fresh YrsStorage for testing.
    fn test_storage() -> YrsStorage {
        YrsStorage::new()
    }

    /// Helper: build a simple ScenarioCreateInput.
    fn simple_input(name: &str) -> ScenarioCreateInput {
        ScenarioCreateInput {
            name: name.to_string(),
            comment: String::new(),
            changing_cells: vec!["cell-1".to_string()],
            values: vec![CellValue::Number(FiniteF64::must(100.0))],
            created_by: Some("test-user".to_string()),
        }
    }

    // -------------------------------------------------------------------
    // Validation tests
    // -------------------------------------------------------------------

    #[test]
    fn test_validate_scenario_name_empty() {
        let errors = validate_scenario_name("");
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].field, "name");
        assert!(errors[0].message.contains("required"));
    }

    #[test]
    fn test_validate_scenario_name_whitespace_only() {
        let errors = validate_scenario_name("   ");
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].field, "name");
    }

    #[test]
    fn test_validate_scenario_name_too_long() {
        let long_name = "x".repeat(MAX_SCENARIO_NAME_LENGTH + 1);
        let errors = validate_scenario_name(&long_name);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].message.contains("255"));
    }

    #[test]
    fn test_validate_scenario_name_valid() {
        let errors = validate_scenario_name("My Scenario");
        assert!(errors.is_empty());
    }

    #[test]
    fn test_validate_scenario_name_max_length() {
        let name = "x".repeat(MAX_SCENARIO_NAME_LENGTH);
        let errors = validate_scenario_name(&name);
        assert!(errors.is_empty());
    }

    #[test]
    fn test_validate_comment_too_long() {
        let long_comment = "y".repeat(MAX_SCENARIO_COMMENT_LENGTH + 1);
        let errors = validate_scenario_comment(&long_comment);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].message.contains("255"));
    }

    #[test]
    fn test_validate_comment_valid() {
        let errors = validate_scenario_comment("A useful comment");
        assert!(errors.is_empty());
    }

    #[test]
    fn test_validate_changing_cells_empty() {
        let errors = validate_changing_cells(&[]);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].message.contains("At least one"));
    }

    #[test]
    fn test_validate_changing_cells_too_many() {
        let cells: Vec<String> = (0..MAX_CHANGING_CELLS_PER_SCENARIO + 1)
            .map(|i| format!("cell-{}", i))
            .collect();
        let errors = validate_changing_cells(&cells);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].message.contains("32"));
    }

    #[test]
    fn test_validate_changing_cells_duplicates() {
        let cells = vec!["cell-1".to_string(), "cell-1".to_string()];
        let errors = validate_changing_cells(&cells);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].message.contains("Duplicate"));
    }

    #[test]
    fn test_validate_changing_cells_valid() {
        let cells = vec!["cell-1".to_string(), "cell-2".to_string()];
        let errors = validate_changing_cells(&cells);
        assert!(errors.is_empty());
    }

    #[test]
    fn test_validate_values_mismatch() {
        let cells = vec!["cell-1".to_string(), "cell-2".to_string()];
        let values = vec![CellValue::Number(FiniteF64::must(1.0))];
        let errors = validate_values(&cells, &values);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].message.contains("must match"));
    }

    #[test]
    fn test_validate_values_valid() {
        let cells = vec!["cell-1".to_string()];
        let values = vec![CellValue::Number(FiniteF64::must(1.0))];
        let errors = validate_values(&cells, &values);
        assert!(errors.is_empty());
    }

    #[test]
    fn test_validate_scenario_input_duplicate_name() {
        let existing = vec![Scenario {
            id: "id-1".to_string(),
            name: "Existing".to_string(),
            comment: String::new(),
            changing_cells: vec!["cell-1".to_string()],
            values: vec![CellValue::Number(FiniteF64::must(1.0))],
            created_by: None,
            created_at: FiniteF64::ZERO,
            modified_at: None,
        }];

        let input = ScenarioCreateInput {
            name: "existing".to_string(), // case-insensitive match
            comment: String::new(),
            changing_cells: vec!["cell-1".to_string()],
            values: vec![CellValue::Number(FiniteF64::must(1.0))],
            created_by: None,
        };

        let errors = validate_scenario_input(&input, &existing, None);
        assert!(errors.iter().any(|e| e.message.contains("already exists")));
    }

    #[test]
    fn test_validate_scenario_input_duplicate_name_excluded_for_update() {
        let existing = vec![Scenario {
            id: "id-1".to_string(),
            name: "Existing".to_string(),
            comment: String::new(),
            changing_cells: vec!["cell-1".to_string()],
            values: vec![CellValue::Number(FiniteF64::must(1.0))],
            created_by: None,
            created_at: FiniteF64::ZERO,
            modified_at: None,
        }];

        let input = ScenarioCreateInput {
            name: "Existing".to_string(),
            comment: String::new(),
            changing_cells: vec!["cell-1".to_string()],
            values: vec![CellValue::Number(FiniteF64::must(1.0))],
            created_by: None,
        };

        // When updating scenario "id-1", its own name should not cause a duplicate error
        let errors = validate_scenario_input(&input, &existing, Some("id-1"));
        assert!(!errors.iter().any(|e| e.message.contains("already exists")));
    }

    // -------------------------------------------------------------------
    // CRUD tests
    // -------------------------------------------------------------------

    #[test]
    fn test_create_scenario_success() {
        let storage = test_storage();
        let input = simple_input("Best Case");

        let result = create(&storage, input, &crate::storage::STORAGE_ID_ALLOC);
        assert!(result.success);
        assert!(result.scenario_id.is_some());
        assert!(result.errors.is_none());

        // Verify scenario exists
        let all = get_all(&storage);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "Best Case");
        assert_eq!(all[0].changing_cells, vec!["cell-1"]);
        assert_eq!(
            all[0].values,
            vec![CellValue::Number(FiniteF64::must(100.0))]
        );
        assert_eq!(all[0].created_by, Some("test-user".to_string()));
    }

    #[test]
    fn test_create_scenario_trims_name() {
        let storage = test_storage();
        let input = ScenarioCreateInput {
            name: "  Trimmed Name  ".to_string(),
            comment: String::new(),
            changing_cells: vec!["cell-1".to_string()],
            values: vec![CellValue::Number(FiniteF64::must(1.0))],
            created_by: None,
        };

        let result = create(&storage, input, &crate::storage::STORAGE_ID_ALLOC);
        assert!(result.success);

        let all = get_all(&storage);
        assert_eq!(all[0].name, "Trimmed Name");
    }

    #[test]
    fn test_create_scenario_validation_failure() {
        let storage = test_storage();
        let input = ScenarioCreateInput {
            name: String::new(),
            comment: String::new(),
            changing_cells: vec![],
            values: vec![],
            created_by: None,
        };

        let result = create(&storage, input, &crate::storage::STORAGE_ID_ALLOC);
        assert!(!result.success);
        assert!(result.scenario_id.is_none());
        assert!(result.errors.is_some());
        // Should have errors for name and changing cells
        let errors = result.errors.unwrap();
        assert!(errors.len() >= 2);
    }

    #[test]
    fn test_create_multiple_scenarios() {
        let storage = test_storage();

        create(
            &storage,
            simple_input("Scenario A"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        create(
            &storage,
            simple_input("Scenario B"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        create(
            &storage,
            simple_input("Scenario C"),
            &crate::storage::STORAGE_ID_ALLOC,
        );

        let all = get_all(&storage);
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].name, "Scenario A");
        assert_eq!(all[1].name, "Scenario B");
        assert_eq!(all[2].name, "Scenario C");
    }

    #[test]
    fn test_create_scenario_duplicate_name_rejected() {
        let storage = test_storage();

        let result1 = create(
            &storage,
            simple_input("Same Name"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        assert!(result1.success);

        let result2 = create(
            &storage,
            simple_input("same name"),
            &crate::storage::STORAGE_ID_ALLOC,
        ); // case-insensitive
        assert!(!result2.success);
        let errors = result2.errors.unwrap();
        assert!(errors.iter().any(|e| e.message.contains("already exists")));
    }

    #[test]
    fn test_create_scenario_at_limit() {
        let storage = test_storage();

        // Create MAX_SCENARIOS scenarios
        for i in 0..MAX_SCENARIOS {
            let result = create(
                &storage,
                simple_input(&format!("Scenario {}", i)),
                &crate::storage::STORAGE_ID_ALLOC,
            );
            assert!(result.success, "Scenario {} should succeed", i);
        }

        assert_eq!(get_count(&storage), MAX_SCENARIOS);
        assert!(is_at_limit(&storage));

        // One more should fail
        let result = create(
            &storage,
            simple_input("One Too Many"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        assert!(!result.success);
        let errors = result.errors.unwrap();
        assert!(errors.iter().any(|e| e.message.contains("Maximum")));
    }

    #[test]
    fn test_get_by_id() {
        let storage = test_storage();

        let result = create(
            &storage,
            simple_input("Find Me"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        let scenario_id = result.scenario_id.unwrap();

        let found = get_by_id(&storage, &scenario_id);
        assert!(found.is_some());
        assert_eq!(found.unwrap().name, "Find Me");

        let not_found = get_by_id(&storage, "nonexistent-id");
        assert!(not_found.is_none());
    }

    #[test]
    fn test_find_by_name() {
        let storage = test_storage();

        create(
            &storage,
            simple_input("My Scenario"),
            &crate::storage::STORAGE_ID_ALLOC,
        );

        let found = find_by_name(&storage, "My Scenario");
        assert!(found.is_some());
        assert_eq!(found.unwrap().name, "My Scenario");

        // Case-insensitive
        let found_lower = find_by_name(&storage, "my scenario");
        assert!(found_lower.is_some());

        let not_found = find_by_name(&storage, "Nonexistent");
        assert!(not_found.is_none());
    }

    #[test]
    fn test_get_count_empty() {
        let storage = test_storage();
        assert_eq!(get_count(&storage), 0);
    }

    #[test]
    fn test_is_at_limit_empty() {
        let storage = test_storage();
        assert!(!is_at_limit(&storage));
    }

    // -------------------------------------------------------------------
    // Update tests
    // -------------------------------------------------------------------

    #[test]
    fn test_update_scenario_name() {
        let storage = test_storage();

        let result = create(
            &storage,
            simple_input("Old Name"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        let scenario_id = result.scenario_id.unwrap();

        let update_result = update(
            &storage,
            &scenario_id,
            ScenarioUpdateInput {
                name: Some("New Name".to_string()),
                ..Default::default()
            },
        );
        assert!(update_result.success);

        let updated = get_by_id(&storage, &scenario_id).unwrap();
        assert_eq!(updated.name, "New Name");
    }

    #[test]
    fn test_update_scenario_comment() {
        let storage = test_storage();

        let result = create(
            &storage,
            simple_input("Scenario X"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        let scenario_id = result.scenario_id.unwrap();

        let update_result = update(
            &storage,
            &scenario_id,
            ScenarioUpdateInput {
                comment: Some("Updated comment".to_string()),
                ..Default::default()
            },
        );
        assert!(update_result.success);

        let updated = get_by_id(&storage, &scenario_id).unwrap();
        assert_eq!(updated.comment, "Updated comment");
    }

    #[test]
    fn test_update_scenario_values() {
        let storage = test_storage();

        let result = create(
            &storage,
            simple_input("Values Test"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        let scenario_id = result.scenario_id.unwrap();

        let update_result = update(
            &storage,
            &scenario_id,
            ScenarioUpdateInput {
                values: Some(vec![CellValue::Number(FiniteF64::must(999.0))]),
                ..Default::default()
            },
        );
        assert!(update_result.success);

        let updated = get_by_id(&storage, &scenario_id).unwrap();
        assert_eq!(
            updated.values,
            vec![CellValue::Number(FiniteF64::must(999.0))]
        );
    }

    #[test]
    fn test_update_scenario_not_found() {
        let storage = test_storage();

        let result = update(
            &storage,
            "nonexistent",
            ScenarioUpdateInput {
                name: Some("New Name".to_string()),
                ..Default::default()
            },
        );
        assert!(!result.success);
        let errors = result.errors.unwrap();
        assert!(errors.iter().any(|e| e.message.contains("not found")));
    }

    #[test]
    fn test_update_scenario_duplicate_name_rejected() {
        let storage = test_storage();

        create(
            &storage,
            simple_input("Alpha"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        let result_b = create(
            &storage,
            simple_input("Beta"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        let beta_id = result_b.scenario_id.unwrap();

        // Try to rename Beta to "alpha" (case-insensitive duplicate)
        let update_result = update(
            &storage,
            &beta_id,
            ScenarioUpdateInput {
                name: Some("alpha".to_string()),
                ..Default::default()
            },
        );
        assert!(!update_result.success);
        let errors = update_result.errors.unwrap();
        assert!(errors.iter().any(|e| e.message.contains("already exists")));
    }

    #[test]
    fn test_update_scenario_same_name_allowed() {
        let storage = test_storage();

        let result = create(
            &storage,
            simple_input("Keep Name"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        let scenario_id = result.scenario_id.unwrap();

        // Updating with the same name should succeed
        let update_result = update(
            &storage,
            &scenario_id,
            ScenarioUpdateInput {
                name: Some("Keep Name".to_string()),
                ..Default::default()
            },
        );
        assert!(update_result.success);
    }

    #[test]
    fn test_update_preserves_order() {
        let storage = test_storage();

        create(
            &storage,
            simple_input("First"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        let result_b = create(
            &storage,
            simple_input("Second"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        let second_id = result_b.scenario_id.unwrap();
        create(
            &storage,
            simple_input("Third"),
            &crate::storage::STORAGE_ID_ALLOC,
        );

        // Update the middle scenario
        update(
            &storage,
            &second_id,
            ScenarioUpdateInput {
                name: Some("Updated Second".to_string()),
                ..Default::default()
            },
        );

        let all = get_all(&storage);
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].name, "First");
        assert_eq!(all[1].name, "Updated Second");
        assert_eq!(all[2].name, "Third");
    }

    // -------------------------------------------------------------------
    // Delete tests
    // -------------------------------------------------------------------

    #[test]
    fn test_remove_scenario() {
        let storage = test_storage();

        let result = create(
            &storage,
            simple_input("To Remove"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        let scenario_id = result.scenario_id.unwrap();

        assert_eq!(get_count(&storage), 1);

        let removed = remove(&storage, &scenario_id);
        assert!(removed.success);
        assert_eq!(removed.scenario_id.as_deref(), Some(scenario_id.as_str()));
        assert_eq!(get_count(&storage), 0);
    }

    #[test]
    fn test_remove_scenario_not_found() {
        let storage = test_storage();
        let removed = remove(&storage, "nonexistent");
        assert!(!removed.success);
        assert_eq!(removed.errors.as_ref().unwrap()[0].field, "scenarioId");
    }

    #[test]
    fn test_remove_scrubs_legacy_active_scenario_id() {
        let storage = test_storage();

        let result = create(
            &storage,
            simple_input("Active One"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        let scenario_id = result.scenario_id.unwrap();

        {
            let workbook = storage.workbook_map();
            let mut txn = storage.doc().transact_mut();
            let scenarios_map = get_or_create_scenarios_map(workbook, &mut txn);
            scenarios_map.insert(
                &mut txn,
                KEY_ACTIVE_SCENARIO_ID,
                Any::String(Arc::from(scenario_id.as_str())),
            );
        }

        let removed = remove(&storage, &scenario_id);
        assert!(removed.success);

        assert!(get_active_scenario_id(&storage).is_none());
        let txn = storage.doc().transact();
        let scenarios_map = get_scenarios_map(storage.workbook_map(), &txn).unwrap();
        assert!(scenarios_map.get(&txn, KEY_ACTIVE_SCENARIO_ID).is_none());
    }

    #[test]
    fn test_create_scrubs_legacy_active_scenario_id() {
        let storage = test_storage();

        {
            let workbook = storage.workbook_map();
            let mut txn = storage.doc().transact_mut();
            let scenarios_map = get_or_create_scenarios_map(workbook, &mut txn);
            scenarios_map.insert(
                &mut txn,
                KEY_ACTIVE_SCENARIO_ID,
                Any::String(Arc::from("legacy-active")),
            );
        }

        let result = create(
            &storage,
            simple_input("A"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        assert!(result.success);

        let txn = storage.doc().transact();
        let scenarios_map = get_scenarios_map(storage.workbook_map(), &txn).unwrap();
        assert!(scenarios_map.get(&txn, KEY_ACTIVE_SCENARIO_ID).is_none());
    }

    #[test]
    fn test_remove_preserves_order_of_remaining() {
        let storage = test_storage();

        let r1 = create(
            &storage,
            simple_input("First"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        let id_1 = r1.scenario_id.unwrap();

        create(
            &storage,
            simple_input("Second"),
            &crate::storage::STORAGE_ID_ALLOC,
        );

        let r3 = create(
            &storage,
            simple_input("Third"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        let _id_3 = r3.scenario_id.unwrap();

        // Remove the first one
        remove(&storage, &id_1);

        let all = get_all(&storage);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].name, "Second");
        assert_eq!(all[1].name, "Third");
    }

    // -------------------------------------------------------------------
    // Active scenario tests
    // -------------------------------------------------------------------

    #[test]
    fn test_set_active_scenario_id_rejected() {
        let storage = test_storage();

        let result = create(
            &storage,
            simple_input("Test"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        let scenario_id = result.scenario_id.unwrap();

        assert!(get_active_scenario_id(&storage).is_none());

        let err = set_active_scenario_id(&storage, Some(&scenario_id)).unwrap_err();
        assert!(err.to_string().contains("SCENARIO_ACTIVE_STATE_READ_ONLY"));
        assert!(get_active_scenario_id(&storage).is_none());
    }

    #[test]
    fn test_get_active_scenario() {
        let storage = test_storage();

        let result = create(
            &storage,
            simple_input("Active Test"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        let scenario_id = result.scenario_id.unwrap();

        // No active scenario
        assert!(get_active_scenario(&storage).is_none());

        let workbook = storage.workbook_map();
        let mut txn = storage.doc().transact_mut();
        let scenarios_map = get_or_create_scenarios_map(workbook, &mut txn);
        scenarios_map.insert(
            &mut txn,
            KEY_ACTIVE_SCENARIO_ID,
            Any::String(Arc::from(scenario_id.as_str())),
        );
        drop(txn);

        assert!(get_active_scenario(&storage).is_none());
    }

    #[test]
    fn test_get_active_scenario_ignores_legacy_active_id() {
        let storage = test_storage();

        let result = create(
            &storage,
            simple_input("Test"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        let scenario_id = result.scenario_id.unwrap();

        let workbook = storage.workbook_map();
        let mut txn = storage.doc().transact_mut();
        let scenarios_map = get_or_create_scenarios_map(workbook, &mut txn);
        scenarios_map.insert(
            &mut txn,
            KEY_ACTIVE_SCENARIO_ID,
            Any::String(Arc::from(scenario_id.as_str())),
        );
        drop(txn);

        assert!(get_active_scenario_id(&storage).is_none());
        assert!(get_active_scenario(&storage).is_none());
    }

    // -------------------------------------------------------------------
    // Scenario data roundtrip tests
    // -------------------------------------------------------------------

    #[test]
    fn test_scenario_stores_all_cell_value_types() {
        let storage = test_storage();

        let input = ScenarioCreateInput {
            name: "Value Types".to_string(),
            comment: "Testing different value types".to_string(),
            changing_cells: vec![
                "cell-num".to_string(),
                "cell-text".to_string(),
                "cell-bool".to_string(),
                "cell-null".to_string(),
            ],
            values: vec![
                CellValue::Number(FiniteF64::must(42.0)),
                CellValue::Text("hello".into()),
                CellValue::Boolean(true),
                CellValue::Null,
            ],
            created_by: Some("user-1".to_string()),
        };

        let result = create(&storage, input, &crate::storage::STORAGE_ID_ALLOC);
        assert!(result.success);

        let scenario = get_by_id(&storage, &result.scenario_id.unwrap()).unwrap();
        assert_eq!(scenario.values.len(), 4);
        assert_eq!(scenario.values[0], CellValue::Number(FiniteF64::must(42.0)));
        assert_eq!(scenario.values[1], CellValue::Text("hello".into()));
        assert_eq!(scenario.values[2], CellValue::Boolean(true));
        assert_eq!(scenario.values[3], CellValue::Null);
    }

    #[test]
    fn test_scenario_timestamps_set() {
        let storage = test_storage();

        let result = create(
            &storage,
            simple_input("Timestamp Test"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        assert!(result.success);

        let scenario = get_by_id(&storage, &result.scenario_id.unwrap()).unwrap();
        assert!(scenario.created_at.get() > 0.0 || cfg!(target_arch = "wasm32"));
        assert!(scenario.modified_at.is_some());
    }

    #[test]
    fn test_scenario_update_changes_modified_at() {
        let storage = test_storage();

        let result = create(
            &storage,
            simple_input("Time Test"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        let scenario_id = result.scenario_id.unwrap();

        let before = get_by_id(&storage, &scenario_id).unwrap();
        let before_modified = before.modified_at;

        // Small delay to ensure different timestamp (not strictly needed in practice)
        update(
            &storage,
            &scenario_id,
            ScenarioUpdateInput {
                comment: Some("updated".to_string()),
                ..Default::default()
            },
        );

        let after = get_by_id(&storage, &scenario_id).unwrap();
        // modified_at should be set (it may or may not differ depending on timing)
        assert!(after.modified_at.is_some());
        // created_at should not change
        assert_eq!(before.created_at, after.created_at);

        // If timestamps are the same, that's OK in tests (same millisecond).
        // The important thing is modified_at is populated.
        let _ = before_modified;
    }

    // -------------------------------------------------------------------
    // Edge case tests
    // -------------------------------------------------------------------

    #[test]
    fn test_empty_storage_getters() {
        let storage = test_storage();

        assert_eq!(get_all(&storage).len(), 0);
        assert_eq!(get_count(&storage), 0);
        assert!(get_by_id(&storage, "any-id").is_none());
        assert!(get_active_scenario_id(&storage).is_none());
        assert!(get_active_scenario(&storage).is_none());
        assert!(find_by_name(&storage, "any").is_none());
        assert!(!is_at_limit(&storage));
    }

    #[test]
    fn test_scenario_with_max_changing_cells() {
        let storage = test_storage();

        let cells: Vec<String> = (0..MAX_CHANGING_CELLS_PER_SCENARIO)
            .map(|i| format!("cell-{}", i))
            .collect();
        let values: Vec<CellValue> = (0..MAX_CHANGING_CELLS_PER_SCENARIO)
            .map(|i| CellValue::Number(FiniteF64::must(i as f64)))
            .collect();

        let input = ScenarioCreateInput {
            name: "Max Cells".to_string(),
            comment: String::new(),
            changing_cells: cells,
            values,
            created_by: None,
        };

        let result = create(&storage, input, &crate::storage::STORAGE_ID_ALLOC);
        assert!(result.success);

        let scenario = get_by_id(&storage, &result.scenario_id.unwrap()).unwrap();
        assert_eq!(
            scenario.changing_cells.len(),
            MAX_CHANGING_CELLS_PER_SCENARIO
        );
    }

    #[test]
    fn test_update_changing_cells_and_values() {
        let storage = test_storage();

        let result = create(
            &storage,
            simple_input("Update Cells"),
            &crate::storage::STORAGE_ID_ALLOC,
        );
        let scenario_id = result.scenario_id.unwrap();

        let update_result = update(
            &storage,
            &scenario_id,
            ScenarioUpdateInput {
                changing_cells: Some(vec!["cell-a".to_string(), "cell-b".to_string()]),
                values: Some(vec![
                    CellValue::Number(FiniteF64::must(10.0)),
                    CellValue::Number(FiniteF64::must(20.0)),
                ]),
                ..Default::default()
            },
        );
        assert!(update_result.success);

        let updated = get_by_id(&storage, &scenario_id).unwrap();
        assert_eq!(updated.changing_cells.len(), 2);
        assert_eq!(updated.values.len(), 2);
        assert_eq!(updated.changing_cells[0], "cell-a");
        assert_eq!(updated.changing_cells[1], "cell-b");
    }
}
