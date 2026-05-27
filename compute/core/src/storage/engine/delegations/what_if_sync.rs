#![allow(unused_imports, unused_variables)]
use crate::identity::GridIndex;
use crate::snapshot::{
    CellEdit, ChangeKind, MutationResult, NamedRangeChange, PageBreakChange, PrintAreaChange,
    PrintSettingsChange, PrintTitlesChange, RecalcResult, Scenario, ScenarioCreateInput,
    ScenarioUpdateInput, ScrollPositionChange, SheetChange, SheetChangeField,
    SheetLifecycleRuntimeHint, SheetSettingsChange, SheetSnapshot,
};
use crate::storage::engine::YrsComputeEngine;
use crate::storage::engine::mutation::{EngineMutation, MutationOutput};
use crate::storage::engine::mutation_coordinator::SheetLifecycleHistoryHint;
use crate::storage::engine::{mutation, services};
use crate::storage::sheet::bindings;
use crate::storage::sheet::{
    order, print, properties, protection, settings, split_view, view, visibility,
};
use crate::storage::workbook::named_ranges;
use crate::what_if::scenarios;
use cell_types::{CellId, SheetId};
use compute_collab as sync;
use compute_document::hex::id_to_hex;
use compute_formats;
use compute_wire::mutation::serialize_multi_viewport_patches;
use domain_types::domain::print::PageBreaks;
use domain_types::domain::sheet::{
    PrintRange, PrintTitles, SheetProtectionOptions, SheetSettings, SplitViewConfig,
};
use formula_types::{IdentityFormula, NamedRangeDef};
use value_types::ComputeError;

pub(in crate::storage::engine) fn solve(
    engine: &YrsComputeEngine,
    params: &crate::solver::SolverParams,
) -> crate::solver::SolverResult {
    engine
        .stores
        .compute
        .solve(&engine.mirror, params)
        .unwrap_or_else(|_e| crate::solver::SolverResult {
            converged: false,
            solution: vec![],
            objective_value: f64::NAN,
            evaluations: 0,
            iterations: 0,
            elapsed_ms: 0,
            termination: crate::solver::TerminationReason::NumericalError,
            message: "Compute error".to_string(),
            dual_values: None,
        })
}

pub(in crate::storage::engine) fn goal_seek(
    engine: &YrsComputeEngine,
    params: &crate::solver::GoalSeekParams,
) -> crate::solver::GoalSeekResult {
    engine
        .stores
        .compute
        .goal_seek(&engine.mirror, params)
        .unwrap_or_else(|_e| crate::solver::GoalSeekResult {
            found: false,
            solution_value: None,
            achieved_value: None,
            iterations: 0,
            error: Some(crate::solver::GoalSeekError::NonNumeric),
            error_message: Some("Compute error".to_string()),
        })
}

pub(in crate::storage::engine) fn data_table(
    engine: &YrsComputeEngine,
    params: &crate::data_table::DataTableParams,
) -> crate::data_table::DataTableResult {
    engine
        .stores
        .compute
        .data_table(&engine.mirror, params)
        .unwrap_or_else(|_e| crate::data_table::DataTableResult {
            results: vec![],
            cell_count: 0,
            cancelled: false,
        })
}

pub(in crate::storage::engine) fn create_data_table(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    input: &crate::data_table::CreateDataTableInput,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    if &input.sheet_id != sheet_id {
        return Err(ComputeError::InvalidInput {
            message: "create_data_table sheet_id parameter does not match input.sheet_id"
                .to_string(),
        });
    }
    let expected_range = crate::range_manager::stringify_range(&crate::range_manager::A1RangeRef {
        start: crate::range_manager::A1CellRef {
            row: start_row,
            col: start_col,
            row_absolute: false,
            col_absolute: false,
        },
        end: crate::range_manager::A1CellRef {
            row: end_row,
            col: end_col,
            row_absolute: false,
            col_absolute: false,
        },
        sheet_name: None,
    });
    if input.table_range != expected_range {
        return Err(ComputeError::InvalidInput {
            message: "create_data_table range scope does not match input.table_range".to_string(),
        });
    }
    match engine.apply_mutation(mutation::EngineMutation::CreateDataTable {
        input: input.clone(),
    })? {
        mutation::MutationOutput::Plain(result) | mutation::MutationOutput::Recalc(result) => {
            Ok((engine.flush_viewport_patches(), result))
        }
        _ => Err(ComputeError::Eval {
            message: "Unexpected output from CreateDataTable".to_string(),
        }),
    }
}

pub(in crate::storage::engine) fn sync_full_state(engine: &YrsComputeEngine) -> Vec<u8> {
    sync::encode_full_state(engine.stores.storage.doc())
}
