use crate::mirror::CellMirror;
use crate::storage::engine::stores::EngineStores;

// -------------------------------------------------------------------
// What-If Analysis
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn solve(
    stores: &EngineStores,
    mirror: &CellMirror,
    params: &crate::solver::SolverParams,
) -> crate::solver::SolverResult {
    stores
        .compute
        .solve(mirror, params)
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
    stores: &EngineStores,
    mirror: &CellMirror,
    params: &crate::solver::GoalSeekParams,
) -> crate::solver::GoalSeekResult {
    stores
        .compute
        .goal_seek(mirror, params)
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
    stores: &EngineStores,
    mirror: &CellMirror,
    params: &crate::data_table::DataTableParams,
) -> crate::data_table::DataTableResult {
    stores
        .compute
        .data_table(mirror, params)
        .unwrap_or_else(|_e| crate::data_table::DataTableResult {
            results: vec![],
            cell_count: 0,
            cancelled: false,
        })
}

pub(in crate::storage::engine) fn sync_full_state(stores: &EngineStores) -> Vec<u8> {
    compute_collab::encode_full_state(stores.storage.doc())
}
