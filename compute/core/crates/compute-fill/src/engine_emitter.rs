use crate::engine_lanes::LanePlans;
use crate::engine_policy::FillPolicy;
use crate::engine_targets::TargetCell;
use crate::formula_adjust::calculate_adjusted_positions;
use crate::helpers::map_target_to_source;
use crate::types::*;

pub(crate) struct EmissionState {
    pub(crate) updates: Vec<FillUpdate>,
    pub(crate) warnings: Vec<FillWarning>,
    pub(crate) filled_cell_count: u32,
}

impl EmissionState {
    pub(crate) fn new(warnings: Vec<FillWarning>) -> Self {
        Self {
            updates: Vec::new(),
            warnings,
            filled_cell_count: 0,
        }
    }

    pub(crate) fn sort_updates(&mut self) {
        self.updates.sort_by_key(|update| match update {
            FillUpdate::Value { row, col, .. }
            | FillUpdate::Formula { row, col, .. }
            | FillUpdate::Format { row, col, .. }
            | FillUpdate::Clear { row, col } => (*row, *col),
        });
    }
}

pub(crate) fn emit_target(
    input: &FillInput,
    policy: &FillPolicy,
    lanes: &mut LanePlans,
    target: TargetCell,
    state: &mut EmissionState,
) {
    let (src_row, src_col) = map_target_to_source(
        target.row,
        target.col,
        &input.request.source_range,
        input.request.direction,
    );

    let Some(source_cell) = input
        .source_cells
        .iter()
        .find(|cell| cell.row == src_row && cell.col == src_col)
    else {
        return;
    };

    if let Some(formula) = &source_cell.formula {
        emit_formula(source_cell, formula, target, policy, state);
    } else if policy.include_values {
        let lane = if lanes.is_vertical {
            target.col
        } else {
            target.row
        };
        let value = lanes
            .next_value(lane)
            .unwrap_or_else(|| source_cell.value.clone());
        state.updates.push(FillUpdate::Value {
            row: target.row,
            col: target.col,
            value,
        });
        state.filled_cell_count += 1;
    }

    if policy.include_formats
        && let Some(format) = &source_cell.format
    {
        state.updates.push(FillUpdate::Format {
            row: target.row,
            col: target.col,
            format: format.clone(),
        });
    }
}

fn emit_formula(
    source_cell: &SourceCell,
    formula: &formula_types::IdentityFormula,
    target: TargetCell,
    policy: &FillPolicy,
    state: &mut EmissionState,
) {
    if !policy.include_formulas {
        return;
    }

    let adjusted_refs = calculate_adjusted_positions(
        formula,
        (source_cell.row, source_cell.col),
        (target.row, target.col),
        &source_cell.ref_positions,
    );

    for adjusted_ref in &adjusted_refs {
        if adjusted_ref.out_of_bounds {
            state.warnings.push(FillWarning {
                row: target.row,
                col: target.col,
                kind: FillWarningKind::FormulaRefOutOfBounds {
                    ref_index: adjusted_ref.ref_index,
                },
            });
        }
    }

    state.updates.push(FillUpdate::Formula {
        row: target.row,
        col: target.col,
        source_formula: formula.clone(),
        adjusted_refs,
    });
    state.filled_cell_count += 1;
}
