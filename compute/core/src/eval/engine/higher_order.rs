//! Higher-order array functions — MAP, REDUCE, SCAN, MAKEARRAY, BYROW, BYCOL.
//!
//! All six functions share the same pattern: evaluate array + lambda arguments,
//! activate the `LambdaExprCache` for constant sub-expression caching during
//! iteration, then invoke the lambda per-element/row/col and collect results.

use std::sync::Arc;

use rustc_hash::FxHashMap;

use crate::eval::cache::lambda_cache::{LambdaExprCache, collect_cacheable_nodes};
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::eval_value::EvalValue;

use compute_parser::ASTNode;
use value_types::{CellArray, CellError, CellValue, ComputeError};

use super::evaluator::Evaluator;

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    // -----------------------------------------------------------------------
    // MAP function
    // -----------------------------------------------------------------------

    /// Evaluate MAP(array, lambda) -- apply lambda to each element.
    ///
    /// MAP is a special form because its last argument is a LAMBDA that must be
    /// evaluated to produce an EvalValue::Lambda, then invoked per-element.
    /// Supports 1-3 array arguments with matching lambda arity.
    ///
    /// Returns a dynamic array with the same dimensions as the input.
    pub(in crate::eval) async fn eval_map(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        // MAP(array1, lambda) or MAP(array1, array2, lambda) etc.
        // Minimum 2 args, last arg is always the lambda.
        if args.len() < 2 {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        let num_arrays = args.len() - 1;

        // Evaluate all array arguments
        let mut arrays: Vec<Arc<CellArray>> = Vec::with_capacity(num_arrays);
        for arg in &args[..num_arrays] {
            let val = self.eval_node_cv(arg).await?;
            if let CellValue::Error(e, _) = val {
                return Ok(CellValue::Error(e, None));
            }
            let arr = match val {
                CellValue::Array(arr) => arr,
                scalar => Arc::new(CellArray::new(vec![scalar], 1)),
            };
            arrays.push(arr);
        }

        // Evaluate the lambda argument (keep as EvalValue to preserve Lambda variant)
        let lambda_val = self.eval_node(args.last().unwrap()).await?;
        if let EvalValue::Cell(CellValue::Error(e, None)) = &lambda_val {
            return Ok(CellValue::Error(*e, None));
        }

        // All arrays must have the same dimensions
        let num_rows = arrays[0].rows();
        let num_cols = arrays[0].cols();
        for arr in &arrays[1..] {
            if arr.rows() != num_rows || arr.cols() != num_cols {
                return Ok(CellValue::Error(CellError::Value, None));
            }
        }

        // Activate lambda expression cache for constant sub-expressions
        let saved_cache = self.lambda_expr_cache.take();
        if let EvalValue::Lambda { params, body, .. } = &lambda_val
            && let Some(body_node) = body.as_any().downcast_ref::<compute_parser::ASTNode>()
        {
            let cacheable = collect_cacheable_nodes(body_node, params);
            if !cacheable.is_empty() {
                self.lambda_expr_cache = Some(LambdaExprCache {
                    cacheable,
                    values: FxHashMap::default(),
                });
            }
        }

        // Apply lambda to each element
        let result = async {
            let mut result_data = Vec::with_capacity(num_rows * num_cols);
            for r in 0..num_rows {
                for c in 0..num_cols {
                    let mut lambda_args = Vec::with_capacity(num_arrays);
                    for arr in &arrays {
                        lambda_args.push(arr.get(r, c).cloned().unwrap_or(CellValue::Null));
                    }
                    let val = self.invoke_lambda(&lambda_val, &lambda_args).await?;
                    result_data.push(val);
                }
            }
            Ok(CellValue::array(result_data, num_cols))
        }
        .await;

        // Restore previous cache (handles nested lambdas) — always reached
        self.lambda_expr_cache = saved_cache;

        result
    }

    // -----------------------------------------------------------------------
    // REDUCE function
    // -----------------------------------------------------------------------

    /// Evaluate REDUCE(initial_value, array, lambda) -- fold array with lambda.
    ///
    /// The lambda receives (accumulator, current_element) and returns the new
    /// accumulator. Returns the final accumulator value (scalar).
    pub(in crate::eval) async fn eval_reduce(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 3 {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        // Evaluate initial value
        let mut accumulator = self.eval_node_cv(&args[0]).await?;
        if let CellValue::Error(e, _) = accumulator {
            return Ok(CellValue::Error(e, None));
        }

        // Evaluate array
        let array_val = self.eval_node_cv(&args[1]).await?;
        if let CellValue::Error(e, _) = array_val {
            return Ok(CellValue::Error(e, None));
        }

        // Evaluate lambda (keep as EvalValue)
        let lambda_val = self.eval_node(&args[2]).await?;
        if let EvalValue::Cell(CellValue::Error(e, None)) = &lambda_val {
            return Ok(CellValue::Error(*e, None));
        }

        // Flatten array to iterate over elements
        let elements: Vec<CellValue> = match array_val {
            CellValue::Array(arr) => Arc::unwrap_or_clone(arr).into_data(),
            scalar => vec![scalar],
        };

        // Activate lambda expression cache for constant sub-expressions
        let saved_cache = self.lambda_expr_cache.take();
        if let EvalValue::Lambda { params, body, .. } = &lambda_val
            && let Some(body_node) = body.as_any().downcast_ref::<compute_parser::ASTNode>()
        {
            let cacheable = collect_cacheable_nodes(body_node, params);
            if !cacheable.is_empty() {
                self.lambda_expr_cache = Some(LambdaExprCache {
                    cacheable,
                    values: FxHashMap::default(),
                });
            }
        }

        // Fold: lambda(accumulator, element) for each element
        let result = async {
            for elem in &elements {
                accumulator = self
                    .invoke_lambda(&lambda_val, &[accumulator, elem.clone()])
                    .await?;
                if let CellValue::Error(..) = accumulator {
                    return Ok(accumulator);
                }
            }
            Ok(accumulator)
        }
        .await;

        // Restore previous cache (handles nested lambdas) — always reached
        self.lambda_expr_cache = saved_cache;

        result
    }

    // -----------------------------------------------------------------------
    // SCAN function
    // -----------------------------------------------------------------------

    /// Evaluate SCAN(initial_value, array, lambda) -- running fold.
    ///
    /// Like REDUCE, but returns an array of all intermediate accumulator values.
    /// The lambda receives (accumulator, current_element) and returns the new
    /// accumulator. Each result is collected into the output array.
    pub(in crate::eval) async fn eval_scan(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 3 {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        // Evaluate initial value
        let mut accumulator = self.eval_node_cv(&args[0]).await?;
        if let CellValue::Error(e, _) = accumulator {
            return Ok(CellValue::Error(e, None));
        }

        // Evaluate array
        let array_val = self.eval_node_cv(&args[1]).await?;
        if let CellValue::Error(e, _) = array_val {
            return Ok(CellValue::Error(e, None));
        }

        // Evaluate lambda (keep as EvalValue)
        let lambda_val = self.eval_node(&args[2]).await?;
        if let EvalValue::Cell(CellValue::Error(e, None)) = &lambda_val {
            return Ok(CellValue::Error(*e, None));
        }

        // Preserve original array shape for output
        let (num_scan_cols, elements): (usize, Vec<CellValue>) = match array_val {
            CellValue::Array(arr) => {
                let cols = arr.cols();
                let elems = Arc::unwrap_or_clone(arr).into_data();
                (cols, elems)
            }
            scalar => (1, vec![scalar]),
        };

        // Activate lambda expression cache for constant sub-expressions
        let saved_cache = self.lambda_expr_cache.take();
        if let EvalValue::Lambda { params, body, .. } = &lambda_val
            && let Some(body_node) = body.as_any().downcast_ref::<compute_parser::ASTNode>()
        {
            let cacheable = collect_cacheable_nodes(body_node, params);
            if !cacheable.is_empty() {
                self.lambda_expr_cache = Some(LambdaExprCache {
                    cacheable,
                    values: FxHashMap::default(),
                });
            }
        }

        // Scan: lambda(accumulator, element) for each element, collecting results.
        // Errors are placed in the output array and propagated through the
        // accumulator so subsequent iterations see them (like Excel).
        let result = async {
            let mut results = Vec::with_capacity(elements.len());
            for elem in &elements {
                accumulator = self
                    .invoke_lambda(&lambda_val, &[accumulator, elem.clone()])
                    .await?;
                // CellValue::Error is a normal result — push it into the array
                // and let it propagate through the accumulator.
                results.push(accumulator.clone());
            }
            Ok(CellValue::array(results, num_scan_cols))
        }
        .await;

        // Restore previous cache (handles nested lambdas) — always reached
        self.lambda_expr_cache = saved_cache;

        result
    }

    // -----------------------------------------------------------------------
    // MAKEARRAY function
    // -----------------------------------------------------------------------

    /// Evaluate MAKEARRAY(rows, cols, lambda) -- create array by calling lambda(row, col).
    ///
    /// The lambda receives 1-based (row_index, col_index) and returns the cell value.
    pub(in crate::eval) async fn eval_makearray(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 3 {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        let rows_val = self.eval_node_cv(&args[0]).await?;
        let cols_val = self.eval_node_cv(&args[1]).await?;
        let lambda_val = self.eval_node(&args[2]).await?;

        if let CellValue::Error(e, _) = rows_val {
            return Ok(CellValue::Error(e, None));
        }
        if let CellValue::Error(e, _) = cols_val {
            return Ok(CellValue::Error(e, None));
        }
        if let EvalValue::Cell(CellValue::Error(e, None)) = &lambda_val {
            return Ok(CellValue::Error(*e, None));
        }

        let num_rows_f = match rows_val.coerce_to_number() {
            Ok(n) if n >= 1.0 => n,
            _ => return Ok(CellValue::Error(CellError::Value, None)),
        };
        let num_cols_f = match cols_val.coerce_to_number() {
            Ok(n) if n >= 1.0 => n,
            _ => return Ok(CellValue::Error(CellError::Value, None)),
        };
        let num_rows = num_rows_f as usize;
        let num_cols = num_cols_f as usize;

        // Guard against absurd dimensions (e.g. MAKEARRAY(1000000,1000000,...))
        const MAX_ARRAY_CELLS: usize = 1_048_576;
        if num_rows
            .checked_mul(num_cols)
            .is_none_or(|t| t > MAX_ARRAY_CELLS)
        {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        // Activate lambda expression cache for constant sub-expressions
        let saved_cache = self.lambda_expr_cache.take();
        if let EvalValue::Lambda { params, body, .. } = &lambda_val
            && let Some(body_node) = body.as_any().downcast_ref::<compute_parser::ASTNode>()
        {
            let cacheable = collect_cacheable_nodes(body_node, params);
            if !cacheable.is_empty() {
                self.lambda_expr_cache = Some(LambdaExprCache {
                    cacheable,
                    values: FxHashMap::default(),
                });
            }
        }

        let result = async {
            let mut result_data = Vec::with_capacity(num_rows * num_cols);
            for r in 1..=num_rows {
                for c in 1..=num_cols {
                    let val = self
                        .invoke_lambda(
                            &lambda_val,
                            &[CellValue::number(r as f64), CellValue::number(c as f64)],
                        )
                        .await?;
                    result_data.push(val);
                }
            }
            Ok(CellValue::array(result_data, num_cols))
        }
        .await;

        // Restore previous cache (handles nested lambdas) — always reached
        self.lambda_expr_cache = saved_cache;

        result
    }

    // -----------------------------------------------------------------------
    // BYROW function
    // -----------------------------------------------------------------------

    /// Evaluate BYROW(array, lambda) -- apply lambda to each row of the array.
    ///
    /// The lambda receives a 1-row array and should return a scalar.
    /// Returns a single-column array of results.
    pub(in crate::eval) async fn eval_byrow(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 2 {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        let array_val = self.eval_node_cv(&args[0]).await?;
        if let CellValue::Error(e, _) = array_val {
            return Ok(CellValue::Error(e, None));
        }
        let lambda_val = self.eval_node(&args[1]).await?;
        if let EvalValue::Cell(CellValue::Error(e, None)) = &lambda_val {
            return Ok(CellValue::Error(*e, None));
        }

        let arr = match array_val {
            CellValue::Array(arr) => arr,
            scalar => Arc::new(CellArray::new(vec![scalar], 1)),
        };

        // Activate lambda expression cache for constant sub-expressions
        let saved_cache = self.lambda_expr_cache.take();
        if let EvalValue::Lambda { params, body, .. } = &lambda_val
            && let Some(body_node) = body.as_any().downcast_ref::<compute_parser::ASTNode>()
        {
            let cacheable = collect_cacheable_nodes(body_node, params);
            if !cacheable.is_empty() {
                self.lambda_expr_cache = Some(LambdaExprCache {
                    cacheable,
                    values: FxHashMap::default(),
                });
            }
        }

        let result = async {
            let mut result_data = Vec::with_capacity(arr.rows());
            for row in arr.rows_iter() {
                let row_array = CellValue::row_array(row.to_vec());
                let val = self.invoke_lambda(&lambda_val, &[row_array]).await?;
                // Unwrap 1×1 array to scalar — BYROW expects the lambda to return a scalar per row.
                // Without this, a single-column input like {1;2;3} produces nested {{10};{20};{30}}
                // because each 1-element row becomes a 1×1 array that broadcasting preserves.
                let val = match val {
                    CellValue::Array(ref arr) if arr.rows() == 1 && arr.cols() == 1 => {
                        arr.get(0, 0).cloned().unwrap_or(CellValue::Null)
                    }
                    other => other,
                };
                result_data.push(val);
            }
            Ok(CellValue::column_array(result_data))
        }
        .await;

        // Restore previous cache (handles nested lambdas) — always reached
        self.lambda_expr_cache = saved_cache;

        result
    }

    // -----------------------------------------------------------------------
    // BYCOL function
    // -----------------------------------------------------------------------

    /// Evaluate BYCOL(array, lambda) -- apply lambda to each column of the array.
    ///
    /// The lambda receives a single-column array and should return a scalar.
    /// Returns a single-row array of results.
    pub(in crate::eval) async fn eval_bycol(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 2 {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        let array_val = self.eval_node_cv(&args[0]).await?;
        if let CellValue::Error(e, _) = array_val {
            return Ok(CellValue::Error(e, None));
        }
        let lambda_val = self.eval_node(&args[1]).await?;
        if let EvalValue::Cell(CellValue::Error(e, None)) = &lambda_val {
            return Ok(CellValue::Error(*e, None));
        }

        let arr = match array_val {
            CellValue::Array(arr) => arr,
            scalar => Arc::new(CellArray::new(vec![scalar], 1)),
        };

        let num_cols = arr.cols();

        // Activate lambda expression cache for constant sub-expressions
        let saved_cache = self.lambda_expr_cache.take();
        if let EvalValue::Lambda { params, body, .. } = &lambda_val
            && let Some(body_node) = body.as_any().downcast_ref::<compute_parser::ASTNode>()
        {
            let cacheable = collect_cacheable_nodes(body_node, params);
            if !cacheable.is_empty() {
                self.lambda_expr_cache = Some(LambdaExprCache {
                    cacheable,
                    values: FxHashMap::default(),
                });
            }
        }

        let result = async {
            let mut result_cols = Vec::with_capacity(num_cols);
            for c in 0..num_cols {
                // Extract column c as a column vector
                let col_data: Vec<CellValue> = arr.col_iter(c).cloned().collect();
                let col_val = CellValue::column_array(col_data);
                let val = self.invoke_lambda(&lambda_val, &[col_val]).await?;
                // Unwrap 1×1 array to scalar — BYCOL expects the lambda to return a scalar per column.
                let val = match val {
                    CellValue::Array(ref arr) if arr.rows() == 1 && arr.cols() == 1 => {
                        arr.get(0, 0).cloned().unwrap_or(CellValue::Null)
                    }
                    other => other,
                };
                result_cols.push(val);
            }
            Ok(CellValue::row_array(result_cols))
        }
        .await;

        // Restore previous cache (handles nested lambdas) — always reached
        self.lambda_expr_cache = saved_cache;

        result
    }
}
