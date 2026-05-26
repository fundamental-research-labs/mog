//! Solver and data-table methods on ComputeCore.
//!
//! - `solve()` — unified solver API (routes to `solver::solve()`)
//! - `goal_seek()` — convenience wrapper for 1-variable root finding
//! - `data_table()` — parametric formula evaluation

use super::*;

use std::cell::RefCell;

use cell_types::CellId;
use rustc_hash::FxHashSet;
use value_types::{CellError, CellValue, ComputeError};

impl ComputeCore {
    // -----------------------------------------------------------------------
    // Solver: unified API
    // -----------------------------------------------------------------------

    /// Run the unified solver. Routes to local root finding or returns
    /// `RequiresPython` for multi-variable problems.
    pub fn solve(
        &self,
        mirror: &CellMirror,
        params: &crate::solver::SolverParams,
    ) -> Result<crate::solver::SolverResult, ComputeError> {
        // For root finding, we need the objective cell's AST and the first variable's cell
        let objective_cell_id = params.objective_cell;

        let ast = self
            .ast_cache
            .get(&objective_cell_id)
            .ok_or_else(|| ComputeError::Eval {
                message: "Objective cell has no formula".to_string(),
            })?
            .ast
            .clone();

        let sheet_id = compute_graph::PositionResolver::resolve(mirror, &objective_cell_id)
            .map(|p| p.sheet)
            .ok_or_else(|| ComputeError::Eval {
                message: format!(
                    "Objective cell not found: {}",
                    objective_cell_id.to_uuid_string()
                ),
            })?;

        // Build evaluator closure for all variables (multi-variable path)
        let variable_ids: Vec<CellId> = params.variables.iter().map(|v| v.cell_id).collect();

        let ast_cache_ref = &self.ast_cache;
        let eval_cache = RefCell::new(FxHashMap::default());
        let evaluating = RefCell::new(FxHashSet::default());

        let evaluate = move |x: &[f64]| -> f64 {
            let mut overrides = FxHashMap::default();
            for (cell_id, &xi) in variable_ids.iter().zip(x.iter()) {
                overrides.insert(*cell_id, CellValue::number(xi));
            }
            eval_cache.borrow_mut().clear();
            let ctx = crate::eval_bridge::OverrideContext::with_formula_text_provider(
                mirror,
                objective_cell_id,
                sheet_id,
                &overrides,
                ast_cache_ref,
                &eval_cache,
                &evaluating,
                self.formula_text_provider(),
            );
            match crate::eval::sync_block_on(crate::eval::Evaluator::evaluate(&ast, &ctx, &ctx)) {
                Ok(val) => val.coerce_to_number().unwrap_or(f64::NAN),
                Err(_) => f64::NAN,
            }
        };

        Ok(crate::solver::solve(params, evaluate))
    }

    // -----------------------------------------------------------------------
    // Goal Seek: convenience API
    // -----------------------------------------------------------------------

    /// Run Goal Seek: find the input value that makes a formula achieve a target value.
    ///
    /// This is a read-only operation. The formula cell's AST is evaluated with
    /// temporary overrides applied to the input cell. The CellMirror is not modified.
    pub fn goal_seek(
        &self,
        mirror: &CellMirror,
        params: &crate::solver::GoalSeekParams,
    ) -> Result<crate::solver::GoalSeekResult, ComputeError> {
        let formula_cell_id = CellId::from_uuid_str(&params.formula_cell)?;
        let input_cell_id = CellId::from_uuid_str(&params.input_cell)?;

        // Get AST for formula cell
        let ast = self
            .ast_cache
            .get(&formula_cell_id)
            .ok_or_else(|| ComputeError::Eval {
                message: "Formula cell has no formula".to_string(),
            })?
            .ast
            .clone();

        // Find sheet for formula cell
        let sheet_id = compute_graph::PositionResolver::resolve(mirror, &formula_cell_id)
            .map(|p| p.sheet)
            .ok_or_else(|| ComputeError::Eval {
                message: format!("Cell not found: {}", formula_cell_id.to_uuid_string()),
            })?;

        // Create evaluator closure: takes f64 input, returns f64 output
        let ast_cache_ref = &self.ast_cache;
        let eval_cache = RefCell::new(FxHashMap::default());
        let evaluating = RefCell::new(FxHashSet::default());

        let evaluate = |input_value: f64| -> f64 {
            let mut overrides = FxHashMap::default();
            overrides.insert(input_cell_id, CellValue::number(input_value));
            eval_cache.borrow_mut().clear();
            let ctx = crate::eval_bridge::OverrideContext::with_formula_text_provider(
                mirror,
                formula_cell_id,
                sheet_id,
                &overrides,
                ast_cache_ref,
                &eval_cache,
                &evaluating,
                self.formula_text_provider(),
            );
            match crate::eval::sync_block_on(crate::eval::Evaluator::evaluate(&ast, &ctx, &ctx)) {
                Ok(val) => val.coerce_to_number().unwrap_or(f64::NAN),
                Err(_) => f64::NAN,
            }
        };

        let max_iterations = params.max_iterations.unwrap_or(100);
        let precision = params.precision.unwrap_or(1e-6);
        let max_change = params.max_change.unwrap_or(0.001);

        let config = compute_solver::SolverConfig {
            objective: compute_solver::Objective::Target(params.target),
            x0: vec![params.initial_guess],
            max_evals: max_iterations,
            ftol: precision,
            max_time_ms: 0,
            root_finding_step_limit: max_change,
            ..Default::default()
        };

        let result = compute_solver::solve_root(|x: &[f64]| evaluate(x[0]), &config);

        Ok(crate::solver::from_crate_result_to_goal_seek(result))
    }

    // -----------------------------------------------------------------------
    // Data Table
    // -----------------------------------------------------------------------

    /// Calculate a data table: evaluate formula with each combination of input values.
    ///
    /// This is a read-only operation. The formula cell's AST is evaluated with
    /// temporary overrides applied to the input cells. The CellMirror is not modified.
    pub fn data_table(
        &self,
        mirror: &CellMirror,
        params: &crate::data_table::DataTableParams,
    ) -> Result<crate::data_table::DataTableResult, ComputeError> {
        let formula_cell_id = CellId::from_uuid_str(&params.formula_cell)?;

        // Parse optional input cell IDs
        let row_input = params
            .row_input_cell
            .as_ref()
            .map(|s| CellId::from_uuid_str(s))
            .transpose()?;
        let col_input = params
            .col_input_cell
            .as_ref()
            .map(|s| CellId::from_uuid_str(s))
            .transpose()?;

        // Get AST for formula cell
        let ast = self
            .ast_cache
            .get(&formula_cell_id)
            .ok_or_else(|| ComputeError::Eval {
                message: "Formula cell has no formula".to_string(),
            })?
            .ast
            .clone();

        // Find sheet for formula cell
        let sheet_id = compute_graph::PositionResolver::resolve(mirror, &formula_cell_id)
            .map(|p| p.sheet)
            .ok_or_else(|| ComputeError::Eval {
                message: format!("Cell not found: {}", formula_cell_id.to_uuid_string()),
            })?;

        // Create evaluator closure using OverrideContext
        let ast_cache_ref = &self.ast_cache;
        let eval_cache = RefCell::new(FxHashMap::default());
        let evaluating = RefCell::new(FxHashSet::default());

        let evaluate = |overrides: &FxHashMap<CellId, CellValue>| -> CellValue {
            eval_cache.borrow_mut().clear();
            let ctx = crate::eval_bridge::OverrideContext::with_formula_text_provider(
                mirror,
                formula_cell_id,
                sheet_id,
                overrides,
                ast_cache_ref,
                &eval_cache,
                &evaluating,
                self.formula_text_provider(),
            );
            match crate::eval::sync_block_on(crate::eval::Evaluator::evaluate(&ast, &ctx, &ctx)) {
                Ok(v) => v,
                Err(_) => CellValue::Error(CellError::Value, None),
            }
        };

        Ok(crate::data_table::calculate_data_table(
            row_input,
            col_input,
            &params.row_values,
            &params.col_values,
            evaluate,
        ))
    }
}
