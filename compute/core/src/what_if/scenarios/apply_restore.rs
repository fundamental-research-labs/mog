use crate::mirror::CellMirror;
use crate::snapshot::{
    ScenarioActiveState, ScenarioApplyResult, ScenarioCreateInput, ScenarioOriginalCellValue,
    ScenarioRestoreResult, ScenarioValidationError,
};
use cell_types::{CellId, SheetId};
use value_types::CellValue;

use super::query::get_by_id;
use super::types::{
    SESSION_DOCUMENT_ID, ScenarioApplyPlan, ScenarioBaseline, ScenarioBaselineCell,
    ScenarioRestorePlan, ScenarioSessionState,
};
use super::validation::{scenario_error, validate_scenario_input};
use crate::storage::YrsStorage;

// =============================================================================
// Apply / Restore Planning
// =============================================================================

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
