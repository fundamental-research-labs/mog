//! Evaluation primitives — functions that require AST/evaluator access.
//!
//! These ~41 functions cannot be implemented as `PureFunction` impls because they
//! need direct access to `&[ASTNode]` and/or `&mut Evaluator` for:
//! - Short-circuit evaluation (IF, IFS, IFERROR, IFNA)
//! - Range flattening (AND, OR)
//! - Variable scoping (LET, LAMBDA, MAP, REDUCE, SCAN, MAKEARRAY, BYROW, BYCOL)
//! - AST geometry inspection (ROW, COLUMN, ROWS, COLUMNS, ISFORMULA)
//! - Reference construction (OFFSET, INDIRECT)
//! - Tagged-value aggregation (SUM, AVERAGE, COUNT, COUNTA, MIN, MAX)
//! - Cell metadata inspection (SUBTOTAL, AGGREGATE)
//! - AST decomposition (SUMPRODUCT)
//! - Range-based lookup (VLOOKUP, HLOOKUP, INDEX, MATCH)
//! - Sorted-array functions (SMALL, LARGE, RANK, RANK.EQ, RANK.AVG)
//!
//! All other ~435 functions are pure functions in `functions/` that receive
//! pre-evaluated `&[CellValue]` via the `FunctionRegistry` fallthrough at the
//! end of the match statement.

use std::sync::Arc;

use super::super::GLOBAL_REGISTRY;
use super::evaluator::Evaluator;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::lookup::range_geometry::try_extract_single_col_range;
use crate::formula_text::FormulaTextLookup;

use super::super::{agg_average, agg_count, agg_counta, agg_countblank, agg_max, agg_min, agg_sum};

use super::operators::{broadcast_unary, eval_binary_op, eval_unary_op};
use crate::eval::eval_value::EvalValue;
use cell_types::col_to_letter;
use compute_parser::{ASTNode, BinOp, UnaryOp};
use compute_parser::{CellRefNode, RangeRef};
use formula_types::CellRef;
use value_types::{CellError, CellValue, ComputeError};

enum FormulaTextTarget {
    Local {
        sheet: cell_types::SheetId,
        row: u32,
        col: u32,
    },
    ExternalUnavailable,
    InvalidRef,
    Unsupported,
}

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    async fn eval_operator_function_alias(
        &mut self,
        upper: &str,
        args: &[ASTNode],
    ) -> Result<Option<CellValue>, ComputeError> {
        if let Some(op) = binary_operator_alias(upper) {
            if args.len() != 2 {
                return Ok(Some(CellValue::Error(CellError::Value, None)));
            }
            let left = self.eval_node_cv(&args[0]).await?;
            let right = self.eval_node_cv(&args[1]).await?;
            return Ok(Some(eval_binary_op(op, &left, &right)));
        }

        if let Some(op) = unary_operator_alias(upper) {
            if args.len() != 1 {
                return Ok(Some(CellValue::Error(CellError::Value, None)));
            }
            let value = self.eval_node_cv(&args[0]).await?;
            return Ok(Some(eval_unary_op(op, &value)));
        }

        Ok(None)
    }

    // -----------------------------------------------------------------------
    // Persistent-cache-aware sorted array helper
    // -----------------------------------------------------------------------

    /// Get a sorted (ascending) numeric array for `flat` values, preferring
    /// the persistent `WorkbookCache` when the range AST node can be resolved
    /// to a single-column range. Falls back to the thread-local sorted cache.
    ///
    /// Returns `Ok(Arc<Vec<f64>>)` on success, or `Err(CellError)` if the
    /// values contain an error cell.
    fn get_sorted_for_range(
        &self,
        range_ast: &ASTNode,
        flat: &[CellValue],
    ) -> Result<Arc<Vec<f64>>, CellError> {
        // Try persistent WorkbookCache first if we can extract range coordinates.
        if let Some((sheet, col, row_start, row_end)) =
            try_extract_single_col_range(range_ast, self.meta)
            && let Some(sorted) = self
                .meta
                .get_or_build_sorted_for_range(&sheet, col, row_start, row_end, flat)
        {
            return Ok(sorted);
        }

        // Fallback: thread-local sorted cache.
        compute_functions::helpers::sorted_cache::get_or_sort_asc(flat)
    }

    // -----------------------------------------------------------------------
    // Function dispatch
    // -----------------------------------------------------------------------

    pub(super) async fn eval_function(
        &mut self,
        name: &str,
        args: &[ASTNode],
    ) -> Result<EvalValue, ComputeError> {
        let upper = name.to_uppercase();
        #[cfg(feature = "profile")]
        let _fn_span =
            tracing::info_span!("fn_call", fn_name = upper.as_str(), arg_count = args.len())
                .entered();

        // LET and LAMBDA return EvalValue directly (they handle scope/lambda values).
        match upper.as_str() {
            "LET" => return self.eval_let(args).await,
            "LAMBDA" => return self.eval_lambda(args),
            _ => {}
        }

        // All other functions return CellValue, wrapped to EvalValue at the end.
        self.eval_function_cv(&upper, args)
            .await
            .map(EvalValue::from)
    }

    /// Inner dispatch for non-LET/LAMBDA functions. Returns CellValue directly.
    async fn eval_function_cv(
        &mut self,
        upper: &str,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if let Some(result) = self.eval_operator_function_alias(upper, args).await? {
            return Ok(result);
        }

        match upper {
            "ARRAYFORMULA" => {
                if args.len() != 1 {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                self.eval_node_cv(&args[0]).await
            }

            "FORMULATEXT" => self.eval_formulatext(args),

            // -- Aggregates --
            "SUM" => self.eval_aggregate(args, agg_sum).await,
            "AVERAGE" => self.eval_aggregate(args, agg_average).await,
            "COUNT" => self.eval_aggregate(args, agg_count).await,
            "COUNTA" => self.eval_aggregate(args, agg_counta).await,
            "COUNTBLANK" => self.eval_aggregate(args, agg_countblank).await,
            "MIN" => self.eval_aggregate(args, agg_min).await,
            "MAX" => self.eval_aggregate(args, agg_max).await,

            // -- Logical --
            "IF" => {
                if args.is_empty() || args.len() > 3 {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                let cond = self.eval_node_cv(&args[0]).await?;
                if let CellValue::Error(e, _) = cond {
                    return Ok(CellValue::Error(e, None));
                }

                // Array condition: element-wise IF (CSE / dynamic-array context)
                if let CellValue::Array(cond_arr) = cond {
                    let val_true = if args.len() > 1 {
                        if matches!(args[1], ASTNode::Omitted) {
                            CellValue::number(0.0)
                        } else {
                            self.eval_node_cv(&args[1]).await?
                        }
                    } else {
                        CellValue::Boolean(true)
                    };
                    let val_false = if args.len() > 2 {
                        if matches!(args[2], ASTNode::Omitted) {
                            CellValue::number(0.0)
                        } else {
                            self.eval_node_cv(&args[2]).await?
                        }
                    } else {
                        CellValue::Boolean(false)
                    };

                    let num_rows = cond_arr.rows();
                    let num_cols = cond_arr.cols();

                    let mut data = Vec::with_capacity(num_rows * num_cols);
                    for r in 0..num_rows {
                        for c in 0..num_cols {
                            let cond_elem = cond_arr.get(r, c).cloned().unwrap_or(CellValue::Null);

                            // Propagate errors from the condition element
                            if let CellValue::Error(e, _) = cond_elem {
                                data.push(CellValue::Error(e, None));
                                continue;
                            }

                            let b = cond_elem.coerce_to_bool().unwrap_or(false);

                            let source = if b { &val_true } else { &val_false };
                            match source {
                                CellValue::Array(src_arr) => {
                                    data.push(src_arr.get(r, c).cloned().unwrap_or(CellValue::Null))
                                }
                                other => data.push(other.clone()),
                            }
                        }
                    }

                    return Ok(CellValue::array(data, num_cols));
                }

                // Scalar condition: existing path
                let b = cond.coerce_to_bool().unwrap_or(false);
                if b {
                    if args.len() > 1 {
                        if matches!(args[1], ASTNode::Omitted) {
                            Ok(CellValue::number(0.0))
                        } else {
                            self.eval_node_cv(&args[1]).await
                        }
                    } else {
                        Ok(CellValue::Boolean(true))
                    }
                } else if args.len() > 2 {
                    if matches!(args[2], ASTNode::Omitted) {
                        Ok(CellValue::number(0.0))
                    } else {
                        self.eval_node_cv(&args[2]).await
                    }
                } else {
                    Ok(CellValue::Boolean(false))
                }
            }

            "AND" => {
                if args.is_empty() {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                let vals = self.eval_and_flatten(args).await?;
                // First pass: propagate errors
                for v in &vals {
                    if let CellValue::Error(e, _) = v {
                        return Ok(CellValue::Error(*e, None));
                    }
                }
                // Second pass: evaluate booleans/numbers, skip text and null
                let mut found_valid = false;
                for v in &vals {
                    match v {
                        CellValue::Text(_) | CellValue::Null => continue,
                        _ => {
                            found_valid = true;
                            match v.coerce_to_bool() {
                                Ok(false) => return Ok(CellValue::Boolean(false)),
                                Ok(true) => {}
                                Err(e) => return Ok(CellValue::Error(e, None)),
                            }
                        }
                    }
                }
                if !found_valid {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                Ok(CellValue::Boolean(true))
            }

            "OR" => {
                if args.is_empty() {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                let vals = self.eval_and_flatten(args).await?;
                // First pass: propagate errors
                for v in &vals {
                    if let CellValue::Error(e, _) = v {
                        return Ok(CellValue::Error(*e, None));
                    }
                }
                // Second pass: evaluate booleans/numbers, skip text and null
                let mut found_valid = false;
                for v in &vals {
                    match v {
                        CellValue::Text(_) | CellValue::Null => continue,
                        _ => {
                            found_valid = true;
                            match v.coerce_to_bool() {
                                Ok(true) => return Ok(CellValue::Boolean(true)),
                                Ok(false) => {}
                                Err(e) => return Ok(CellValue::Error(e, None)),
                            }
                        }
                    }
                }
                if !found_valid {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                Ok(CellValue::Boolean(false))
            }

            "NOT" => {
                if args.len() != 1 {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                let v = self.eval_node_cv(&args[0]).await?;
                if let CellValue::Error(e, _) = v {
                    return Ok(CellValue::Error(e, None));
                }
                Ok(broadcast_unary(v, |elem| {
                    if let CellValue::Error(e, _) = elem {
                        return CellValue::Error(*e, None);
                    }
                    match elem.coerce_to_bool() {
                        Ok(b) => CellValue::Boolean(!b),
                        Err(e) => CellValue::Error(e, None),
                    }
                }))
            }

            // -- Info / IS functions --
            "IFERROR" => {
                if args.len() != 2 {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                let v = self.eval_node_cv(&args[0]).await?;
                if v.is_error() {
                    self.eval_node_cv(&args[1]).await
                } else if let CellValue::Array(arr) = &v {
                    // Element-wise: replace error elements with the fallback value
                    if arr.iter().any(|el| el.is_error()) {
                        let fallback = self.eval_node_cv(&args[1]).await?;
                        let data: Vec<CellValue> = arr
                            .iter()
                            .map(|el| {
                                if el.is_error() {
                                    fallback.clone()
                                } else {
                                    el.clone()
                                }
                            })
                            .collect();
                        Ok(CellValue::array(data, arr.cols()))
                    } else {
                        Ok(v)
                    }
                } else {
                    Ok(v)
                }
            }
            "IFNA" => {
                if args.len() != 2 {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                let v = self.eval_node_cv(&args[0]).await?;
                if matches!(v, CellValue::Error(CellError::Na, _)) {
                    self.eval_node_cv(&args[1]).await
                } else if let CellValue::Array(arr) = &v {
                    // Element-wise: replace #N/A elements with the fallback value
                    if arr
                        .iter()
                        .any(|el| matches!(el, CellValue::Error(CellError::Na, _)))
                    {
                        let fallback = self.eval_node_cv(&args[1]).await?;
                        let data: Vec<CellValue> = arr
                            .iter()
                            .map(|el| {
                                if matches!(el, CellValue::Error(CellError::Na, _)) {
                                    fallback.clone()
                                } else {
                                    el.clone()
                                }
                            })
                            .collect();
                        Ok(CellValue::array(data, arr.cols()))
                    } else {
                        Ok(v)
                    }
                } else {
                    Ok(v)
                }
            }

            // -- CELL function: needs AST access for "row"/"col"/"address" --
            "CELL" => {
                if args.is_empty() {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                let info_type = self.eval_node_cv(&args[0]).await?;
                if let CellValue::Error(e, _) = info_type {
                    return Ok(CellValue::Error(e, None));
                }
                let info_str = match &info_type {
                    CellValue::Text(s) => s.to_lowercase(),
                    _ => return Ok(CellValue::Error(CellError::Value, None)),
                };

                match info_str.as_str() {
                    "row" | "col" | "address" => {
                        // These need the REFERENCE (not value) from the second argument
                        if args.len() < 2 {
                            return Ok(CellValue::Error(CellError::Na, None));
                        }
                        // Unwrap SheetRef if present (like ROW/COLUMN do)
                        let inner = match &args[1] {
                            ASTNode::SheetRef { inner, .. } => inner.as_ref(),
                            other => other,
                        };
                        let (row, col) = match inner {
                            ASTNode::CellReference(CellRefNode { reference, .. }) => {
                                match reference {
                                    CellRef::Positional { row, col, .. } => (*row, *col),
                                    CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                                        Some((_, r, c)) => (r, c),
                                        None => return Ok(CellValue::Error(CellError::Ref, None)),
                                    },
                                }
                            }
                            ASTNode::Range(RangeRef { start, .. }) => {
                                // For ranges, CELL returns info for the top-left cell
                                match start {
                                    CellRef::Positional { row, col, .. } => (*row, *col),
                                    CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                                        Some((_, r, c)) => (r, c),
                                        None => return Ok(CellValue::Error(CellError::Ref, None)),
                                    },
                                }
                            }
                            _ => return Ok(CellValue::Error(CellError::Value, None)),
                        };
                        // row/col are 0-based internally; Excel uses 1-based
                        match info_str.as_str() {
                            "row" => Ok(CellValue::number(row as f64 + 1.0)),
                            "col" => Ok(CellValue::number(col as f64 + 1.0)),
                            "address" => {
                                let col_letter = col_to_letter(col);
                                Ok(CellValue::Text(
                                    format!("${}${}", col_letter, row + 1).into(),
                                ))
                            }
                            _ => unreachable!(),
                        }
                    }
                    _ => {
                        // Fall through to FunctionRegistry for value-based info types
                        // ("type", "contents", etc.)
                        let mut evaluated_args = Vec::with_capacity(args.len());
                        for arg in args {
                            let v = self.eval_node_cv(arg).await?;
                            evaluated_args.push(v);
                        }
                        Ok(GLOBAL_REGISTRY.call("CELL", &evaluated_args))
                    }
                }
            }

            // -- Lookup --
            "INDEX" => self.eval_index(args).await,
            "MATCH" => self.eval_match(args).await,
            "VLOOKUP" => self.eval_vlookup(args).await,
            "HLOOKUP" => self.eval_hlookup(args).await,
            "XLOOKUP" => self.eval_xlookup(args).await,

            // === Lookup evaluator primitives ===
            "XMATCH" => self.eval_xmatch(args).await,

            // -- Reference special forms (need AST access for reference resolution) --
            "OFFSET" => self.eval_offset(args).await,
            "INDIRECT" => self.eval_indirect(args).await,

            // -- Row/Col info --
            "ROW" => {
                if args.is_empty() {
                    // ROW() — return the current cell's row (1-based)
                    let cell_id = self.meta.current_cell();
                    match self.meta.resolve_position(&cell_id) {
                        Some((_, row, _)) => Ok(CellValue::number(row as f64 + 1.0)),
                        None => Ok(CellValue::Error(CellError::Ref, None)),
                    }
                } else {
                    // Unwrap SheetRef if present to get the inner reference node
                    let inner = match &args[0] {
                        ASTNode::SheetRef { inner, .. } => inner.as_ref(),
                        other => other,
                    };
                    match inner {
                        ASTNode::CellReference(CellRefNode { reference, .. }) => match reference {
                            CellRef::Positional { row, .. } => {
                                Ok(CellValue::number(*row as f64 + 1.0))
                            }
                            CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                                Some((_, row, _)) => Ok(CellValue::number(row as f64 + 1.0)),
                                None => Ok(CellValue::Error(CellError::Ref, None)),
                            },
                        },
                        ASTNode::Range(RangeRef { start, end, .. }) => {
                            // Extract start/end rows from the range references
                            let start_row = match start {
                                CellRef::Positional { row, .. } => *row,
                                CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                                    Some((_, r, _)) => r,
                                    None => return Ok(CellValue::Error(CellError::Ref, None)),
                                },
                            };
                            let end_row = match end {
                                CellRef::Positional { row, .. } => *row,
                                CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                                    Some((_, r, _)) => r,
                                    None => return Ok(CellValue::Error(CellError::Ref, None)),
                                },
                            };
                            let min_row = start_row.min(end_row);
                            let max_row = start_row.max(end_row);
                            if min_row == max_row {
                                // Single-row range: return a scalar
                                Ok(CellValue::number(min_row as f64 + 1.0))
                            } else {
                                // Multi-row range: return a column array of row numbers
                                let data: Vec<CellValue> = (min_row..=max_row)
                                    .map(|r| CellValue::number(r as f64 + 1.0))
                                    .collect();
                                Ok(CellValue::column_array(data))
                            }
                        }
                        ASTNode::Error(e) => Ok(CellValue::Error(*e, None)),
                        _ => Ok(CellValue::Error(CellError::Value, None)),
                    }
                }
            }
            "COLUMN" => {
                if args.is_empty() {
                    // COLUMN() — return the current cell's column (1-based)
                    let cell_id = self.meta.current_cell();
                    match self.meta.resolve_position(&cell_id) {
                        Some((_, _, col)) => Ok(CellValue::number(col as f64 + 1.0)),
                        None => Ok(CellValue::Error(CellError::Ref, None)),
                    }
                } else {
                    // Unwrap SheetRef if present to get the inner reference node
                    let inner = match &args[0] {
                        ASTNode::SheetRef { inner, .. } => inner.as_ref(),
                        other => other,
                    };
                    match inner {
                        ASTNode::CellReference(CellRefNode { reference, .. }) => match reference {
                            CellRef::Positional { col, .. } => {
                                Ok(CellValue::number(*col as f64 + 1.0))
                            }
                            CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                                Some((_, _, col)) => Ok(CellValue::number(col as f64 + 1.0)),
                                None => Ok(CellValue::Error(CellError::Ref, None)),
                            },
                        },
                        ASTNode::Range(RangeRef { start, end, .. }) => {
                            // Extract start/end cols from the range references
                            let start_col = match start {
                                CellRef::Positional { col, .. } => *col,
                                CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                                    Some((_, _, c)) => c,
                                    None => return Ok(CellValue::Error(CellError::Ref, None)),
                                },
                            };
                            let end_col = match end {
                                CellRef::Positional { col, .. } => *col,
                                CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                                    Some((_, _, c)) => c,
                                    None => return Ok(CellValue::Error(CellError::Ref, None)),
                                },
                            };
                            let min_col = start_col.min(end_col);
                            let max_col = start_col.max(end_col);
                            if min_col == max_col {
                                // Single-col range: return a scalar
                                Ok(CellValue::number(min_col as f64 + 1.0))
                            } else {
                                // Multi-col range: return a row array of column numbers
                                let data: Vec<CellValue> = (min_col..=max_col)
                                    .map(|c| CellValue::number(c as f64 + 1.0))
                                    .collect();
                                Ok(CellValue::row_array(data))
                            }
                        }
                        ASTNode::Error(e) => Ok(CellValue::Error(*e, None)),
                        _ => Ok(CellValue::Error(CellError::Value, None)),
                    }
                }
            }
            "ROWS" => {
                if args.len() != 1 {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                // Try to extract row count from AST (range geometry) first
                let inner = match &args[0] {
                    ASTNode::SheetRef { inner, .. } => inner.as_ref(),
                    other => other,
                };
                match inner {
                    ASTNode::Range(RangeRef { start, end, .. }) => {
                        let start_row = match start {
                            CellRef::Positional { row, .. } => *row,
                            CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                                Some((_, r, _)) => r,
                                None => return Ok(CellValue::Error(CellError::Ref, None)),
                            },
                        };
                        let end_row = match end {
                            CellRef::Positional { row, .. } => *row,
                            CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                                Some((_, r, _)) => r,
                                None => return Ok(CellValue::Error(CellError::Ref, None)),
                            },
                        };
                        let count = (end_row as i64 - start_row as i64).unsigned_abs() + 1;
                        Ok(CellValue::number(count as f64))
                    }
                    ASTNode::CellReference(..) => Ok(CellValue::number(1.0)),
                    _ => {
                        // Fallback: evaluate and count array rows
                        let v = self.eval_node_cv(&args[0]).await?;
                        match v {
                            CellValue::Array(arr) => Ok(CellValue::number(arr.rows() as f64)),
                            _ => Ok(CellValue::number(1.0)),
                        }
                    }
                }
            }
            "COLUMNS" => {
                if args.len() != 1 {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                // Try to extract column count from AST (range geometry) first
                let inner = match &args[0] {
                    ASTNode::SheetRef { inner, .. } => inner.as_ref(),
                    other => other,
                };
                match inner {
                    ASTNode::Range(RangeRef { start, end, .. }) => {
                        let start_col = match start {
                            CellRef::Positional { col, .. } => *col,
                            CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                                Some((_, _, c)) => c,
                                None => return Ok(CellValue::Error(CellError::Ref, None)),
                            },
                        };
                        let end_col = match end {
                            CellRef::Positional { col, .. } => *col,
                            CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                                Some((_, _, c)) => c,
                                None => return Ok(CellValue::Error(CellError::Ref, None)),
                            },
                        };
                        let count = (end_col as i64 - start_col as i64).unsigned_abs() + 1;
                        Ok(CellValue::number(count as f64))
                    }
                    ASTNode::CellReference(..) => Ok(CellValue::number(1.0)),
                    _ => {
                        // Fallback: evaluate and count array columns
                        let v = self.eval_node_cv(&args[0]).await?;
                        match v {
                            CellValue::Array(arr) => Ok(CellValue::number(arr.cols() as f64)),
                            _ => Ok(CellValue::number(1.0)),
                        }
                    }
                }
            }

            // -- SHEETS (no-arg form: total sheet count) --
            "SHEETS" => {
                if args.is_empty() {
                    Ok(CellValue::number(self.meta.sheet_count() as f64))
                } else {
                    // SHEETS(ref) — count sheets in a 3-D reference. Not yet
                    // supported; propagate errors, otherwise return 1.
                    let v = self.eval_node_cv(&args[0]).await?;
                    if let CellValue::Error(e, _) = v {
                        Ok(CellValue::Error(e, None))
                    } else {
                        Ok(CellValue::number(1.0))
                    }
                }
            }

            // -- SINGLE (implicit intersection operator, _xlfn.SINGLE) --
            "SINGLE" => self.eval_single(args).await,

            // -- ANCHORARRAY (spill range operator, _xlfn.ANCHORARRAY / `#`) --
            "ANCHORARRAY" => self.eval_anchorarray(args).await,

            // -- Higher-order LAMBDA functions (special forms) --
            // These receive a LAMBDA as an argument and invoke it per-element.
            "MAP" => self.eval_map(args).await,
            "REDUCE" => self.eval_reduce(args).await,
            "SCAN" => self.eval_scan(args).await,
            "MAKEARRAY" => self.eval_makearray(args).await,
            "BYROW" => self.eval_byrow(args).await,
            "BYCOL" => self.eval_bycol(args).await,
            "ISOMITTED" => self.eval_isomitted(args).await,

            // -- Date/time (use injectable timestamp via EvalMetadata) --
            "NOW" => Ok(CellValue::number(self.meta.current_timestamp())),
            "TODAY" => Ok(CellValue::number(self.meta.current_timestamp().floor())),

            // -- Data Table pseudo-function --
            // TABLE() is a pseudo-function synthesized by the xlsx parser for Excel
            // Data Table (What-If) cells. It is NOT a user-callable function. Full
            // evaluation requires substituting input values and re-evaluating a
            // result formula for each cell in the table range, which is not yet
            // implemented. Return #CALC! immediately to avoid hanging or triggering
            // expensive dependency cascades. The arguments (cell references for
            // row/column input cells) are intentionally NOT evaluated.
            "TABLE" => Ok(CellValue::Error(CellError::Calc, None)),

            // -- SUBTOTAL: special handling to exclude nested SUBTOTAL/AGGREGATE cells --
            "SUBTOTAL" => self.eval_subtotal(args).await,

            // -- AGGREGATE: special handling to exclude nested SUBTOTAL/AGGREGATE cells --
            "AGGREGATE" => self.eval_aggregate_function(args).await,

            // -- IFS: inline handler for short-circuit evaluation --
            "IFS" => {
                if args.len() < 2 || !args.len().is_multiple_of(2) {
                    return Ok(CellValue::Error(CellError::Value, None));
                }

                // Evaluate all conditions up front to detect array mode.
                let mut conditions: Vec<CellValue> = Vec::new();
                let mut any_array = false;
                let mut array_len = 0usize;
                let mut array_cols = 1usize;

                for pair in args.chunks(2) {
                    let cond = self.eval_node_cv(&pair[0]).await?;
                    if let CellValue::Array(ref arr) = cond
                        && !any_array
                    {
                        any_array = true;
                        array_len = arr.len();
                        array_cols = arr.cols();
                    }
                    conditions.push(cond);
                }

                if !any_array {
                    // Scalar path (original behaviour)
                    for (pair_idx, pair) in args.chunks(2).enumerate() {
                        let cond = &conditions[pair_idx];
                        if let CellValue::Error(e, _) = cond {
                            return Ok(CellValue::Error(*e, None));
                        }
                        match cond.coerce_to_bool() {
                            Ok(true) => return self.eval_node_cv(&pair[1]).await,
                            Ok(false) => continue,
                            Err(e) => return Ok(CellValue::Error(e, None)),
                        }
                    }
                    Ok(CellValue::Error(CellError::Na, None))
                } else {
                    // Array path: evaluate element-wise across all pairs.
                    let mut results = vec![None; array_len];

                    for (pair_idx, pair) in args.chunks(2).enumerate() {
                        let cond = &conditions[pair_idx];

                        // If every element already has a result, short-circuit.
                        if results.iter().all(|r| r.is_some()) {
                            break;
                        }

                        // Lazily evaluate the value expression only when needed.
                        let mut value_evaluated = None;

                        #[allow(clippy::needless_range_loop)]
                        for i in 0..array_len {
                            if results[i].is_some() {
                                continue; // already matched by an earlier pair
                            }

                            let elem_cond = match cond {
                                CellValue::Array(arr) => {
                                    arr.data().get(i).cloned().unwrap_or(CellValue::Null)
                                }
                                CellValue::Error(e, _) => {
                                    results[i] = Some(CellValue::Error(*e, None));
                                    continue;
                                }
                                scalar => scalar.clone(),
                            };

                            if let CellValue::Error(e, _) = elem_cond {
                                results[i] = Some(CellValue::Error(e, None));
                                continue;
                            }

                            match elem_cond.coerce_to_bool() {
                                Ok(true) => {
                                    // Lazily evaluate the value expression.
                                    if value_evaluated.is_none() {
                                        value_evaluated = Some(self.eval_node_cv(&pair[1]).await?);
                                    }
                                    let val = value_evaluated.as_ref().unwrap();
                                    let elem_val = match val {
                                        CellValue::Array(arr) => {
                                            arr.data().get(i).cloned().unwrap_or(CellValue::Null)
                                        }
                                        scalar => scalar.clone(),
                                    };
                                    results[i] = Some(elem_val);
                                }
                                Ok(false) => continue,
                                Err(e) => {
                                    results[i] = Some(CellValue::Error(e, None));
                                }
                            }
                        }
                    }

                    // Fill any unmatched elements with #N/A.
                    let final_results: Vec<CellValue> = results
                        .into_iter()
                        .map(|r| r.unwrap_or(CellValue::Error(CellError::Na, None)))
                        .collect();

                    Ok(CellValue::array(final_results, array_cols))
                }
            }

            // -- ISFORMULA: needs AST access to inspect the referenced cell --
            "ISFORMULA" => {
                if args.len() != 1 {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                // Unwrap SheetRef if present
                let (sheet_override, inner) = match &args[0] {
                    ASTNode::SheetRef { sheet, inner, .. } => (Some(*sheet), inner.as_ref()),
                    other => (None, other),
                };
                match inner {
                    ASTNode::CellReference(CellRefNode { reference, .. }) => {
                        let (sheet, row, col) = match reference {
                            CellRef::Positional { sheet, row, col } => {
                                (sheet_override.unwrap_or(*sheet), *row, *col)
                            }
                            CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                                Some((s, r, c)) => (s, r, c),
                                None => return Ok(CellValue::Error(CellError::Ref, None)),
                            },
                        };
                        Ok(CellValue::Boolean(
                            self.meta.cell_has_formula(&sheet, row, col),
                        ))
                    }
                    _ => {
                        // ISFORMULA on a non-reference (literal, expression) => #VALUE!
                        Ok(CellValue::Error(CellError::Value, None))
                    }
                }
            }

            // === Percentile/Median evaluator primitives ===
            //
            // These functions sort the input array. By dispatching at the evaluator
            // level we can leverage the epoch-scoped sorted cache
            // (`get_or_sort_asc`) so that repeated calls on the same range
            // (e.g., PERCENTILE(A1:A1000, 0.25) and PERCENTILE(A1:A1000, 0.75))
            // share a single sort.

            // -- PERCENTILE family --
            "PERCENTILE" | "PERCENTILE.INC" => {
                if args.len() != 2 {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                let array_val = self.eval_node_cv(&args[0]).await?;
                let k_val = self.eval_node_cv(&args[1]).await?;
                if let CellValue::Error(e, _) = array_val {
                    return Ok(CellValue::Error(e, None));
                }
                if let CellValue::Error(e, _) = k_val {
                    return Ok(CellValue::Error(e, None));
                }
                let k = match k_val.coerce_to_number() {
                    Ok(k) if !(0.0..=1.0).contains(&k) => {
                        return Ok(CellValue::Error(CellError::Num, None));
                    }
                    Ok(k) => k,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                };
                let flat = compute_functions::helpers::coercion::flatten_values(&[array_val]);
                match self.get_sorted_for_range(&args[0], &flat) {
                    Ok(sorted) if sorted.is_empty() => Ok(CellValue::Error(CellError::Num, None)),
                    Ok(sorted) => Ok(CellValue::number(compute_functions::percentile_inc(
                        &sorted, k,
                    ))),
                    Err(e) => Ok(CellValue::Error(e, None)),
                }
            }

            "PERCENTILE.EXC" => {
                if args.len() != 2 {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                let array_val = self.eval_node_cv(&args[0]).await?;
                let k_val = self.eval_node_cv(&args[1]).await?;
                if let CellValue::Error(e, _) = array_val {
                    return Ok(CellValue::Error(e, None));
                }
                if let CellValue::Error(e, _) = k_val {
                    return Ok(CellValue::Error(e, None));
                }
                let k = match k_val.coerce_to_number() {
                    Ok(k) if k <= 0.0 || k >= 1.0 => {
                        return Ok(CellValue::Error(CellError::Num, None));
                    }
                    Ok(k) => k,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                };
                let flat = compute_functions::helpers::coercion::flatten_values(&[array_val]);
                match self.get_sorted_for_range(&args[0], &flat) {
                    Ok(sorted) if sorted.is_empty() => Ok(CellValue::Error(CellError::Num, None)),
                    Ok(sorted) => match compute_functions::percentile_exc(&sorted, k) {
                        Some(v) => Ok(CellValue::number(v)),
                        None => Ok(CellValue::Error(CellError::Num, None)),
                    },
                    Err(e) => Ok(CellValue::Error(e, None)),
                }
            }

            "QUARTILE" | "QUARTILE.INC" => {
                if args.len() != 2 {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                let array_val = self.eval_node_cv(&args[0]).await?;
                let quart_val = self.eval_node_cv(&args[1]).await?;
                if let CellValue::Error(e, _) = array_val {
                    return Ok(CellValue::Error(e, None));
                }
                if let CellValue::Error(e, _) = quart_val {
                    return Ok(CellValue::Error(e, None));
                }
                let quart = match quart_val.coerce_to_number() {
                    Ok(q) if !(0.0..=4.0).contains(&q) => {
                        return Ok(CellValue::Error(CellError::Num, None));
                    }
                    Ok(q) => q as i32,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                };
                let flat = compute_functions::helpers::coercion::flatten_values(&[array_val]);
                match self.get_sorted_for_range(&args[0], &flat) {
                    Ok(sorted) if sorted.is_empty() => Ok(CellValue::Error(CellError::Num, None)),
                    Ok(sorted) => Ok(CellValue::number(compute_functions::percentile_inc(
                        &sorted,
                        quart as f64 * 0.25,
                    ))),
                    Err(e) => Ok(CellValue::Error(e, None)),
                }
            }

            "QUARTILE.EXC" => {
                if args.len() != 2 {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                let array_val = self.eval_node_cv(&args[0]).await?;
                let quart_val = self.eval_node_cv(&args[1]).await?;
                if let CellValue::Error(e, _) = array_val {
                    return Ok(CellValue::Error(e, None));
                }
                if let CellValue::Error(e, _) = quart_val {
                    return Ok(CellValue::Error(e, None));
                }
                let quart = match quart_val.coerce_to_number() {
                    Ok(q) if !(1.0..=3.0).contains(&q) => {
                        return Ok(CellValue::Error(CellError::Num, None));
                    }
                    Ok(q) => q as i32,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                };
                let flat = compute_functions::helpers::coercion::flatten_values(&[array_val]);
                match self.get_sorted_for_range(&args[0], &flat) {
                    Ok(sorted) if sorted.is_empty() => Ok(CellValue::Error(CellError::Num, None)),
                    Ok(sorted) => {
                        match compute_functions::percentile_exc(&sorted, quart as f64 * 0.25) {
                            Some(v) => Ok(CellValue::number(v)),
                            None => Ok(CellValue::Error(CellError::Num, None)),
                        }
                    }
                    Err(e) => Ok(CellValue::Error(e, None)),
                }
            }

            // -- PERCENTRANK family --
            "PERCENTRANK" | "PERCENTRANK.INC" => {
                if args.len() < 2 || args.len() > 3 {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                let array_val = self.eval_node_cv(&args[0]).await?;
                let x_val = self.eval_node_cv(&args[1]).await?;
                if let CellValue::Error(e, _) = array_val {
                    return Ok(CellValue::Error(e, None));
                }
                if let CellValue::Error(e, _) = x_val {
                    return Ok(CellValue::Error(e, None));
                }
                let x = match x_val.coerce_to_number() {
                    Ok(v) => v,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                };
                let significance = if args.len() > 2 {
                    let sig_val = self.eval_node_cv(&args[2]).await?;
                    if let CellValue::Error(e, _) = sig_val {
                        return Ok(CellValue::Error(e, None));
                    }
                    match sig_val.coerce_to_number() {
                        Ok(s) if s < 1.0 => return Ok(CellValue::Error(CellError::Num, None)),
                        Ok(s) => s as u32,
                        Err(e) => return Ok(CellValue::Error(e, None)),
                    }
                } else {
                    3
                };
                let flat = compute_functions::helpers::coercion::flatten_values(&[array_val]);
                match self.get_sorted_for_range(&args[0], &flat) {
                    Ok(sorted) if sorted.is_empty() => Ok(CellValue::Error(CellError::Num, None)),
                    Ok(sorted) => {
                        if x < sorted[0] || x > sorted[sorted.len() - 1] {
                            return Ok(CellValue::Error(CellError::Na, None));
                        }
                        let n = sorted.len();
                        if n == 1 {
                            return Ok(CellValue::number(0.0));
                        }
                        let pos = sorted.partition_point(|&v| v < x);
                        let rank = if pos < n && (sorted[pos] - x).abs() < 1e-15 {
                            pos as f64 / (n - 1) as f64
                        } else if pos > 0 && pos < n {
                            let i = pos - 1;
                            (i as f64 + (x - sorted[i]) / (sorted[i + 1] - sorted[i]))
                                / (n - 1) as f64
                        } else {
                            0.0
                        };
                        let factor = 10f64.powi(significance as i32);
                        Ok(CellValue::number((rank * factor).floor() / factor))
                    }
                    Err(e) => Ok(CellValue::Error(e, None)),
                }
            }

            "PERCENTRANK.EXC" => {
                if args.len() < 2 || args.len() > 3 {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                let array_val = self.eval_node_cv(&args[0]).await?;
                let x_val = self.eval_node_cv(&args[1]).await?;
                if let CellValue::Error(e, _) = array_val {
                    return Ok(CellValue::Error(e, None));
                }
                if let CellValue::Error(e, _) = x_val {
                    return Ok(CellValue::Error(e, None));
                }
                let x = match x_val.coerce_to_number() {
                    Ok(v) => v,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                };
                let significance = if args.len() > 2 {
                    let sig_val = self.eval_node_cv(&args[2]).await?;
                    if let CellValue::Error(e, _) = sig_val {
                        return Ok(CellValue::Error(e, None));
                    }
                    match sig_val.coerce_to_number() {
                        Ok(s) if s < 1.0 => return Ok(CellValue::Error(CellError::Num, None)),
                        Ok(s) => s as u32,
                        Err(e) => return Ok(CellValue::Error(e, None)),
                    }
                } else {
                    3
                };
                let flat = compute_functions::helpers::coercion::flatten_values(&[array_val]);
                match self.get_sorted_for_range(&args[0], &flat) {
                    Ok(sorted) if sorted.is_empty() => Ok(CellValue::Error(CellError::Num, None)),
                    Ok(sorted) => {
                        if x < sorted[0] || x > sorted[sorted.len() - 1] {
                            return Ok(CellValue::Error(CellError::Na, None));
                        }
                        let n = sorted.len();
                        let pos = sorted.partition_point(|&v| v < x);
                        let rank = if pos < n && (sorted[pos] - x).abs() < 1e-15 {
                            (pos + 1) as f64 / (n + 1) as f64
                        } else if pos > 0 && pos < n {
                            let i = pos - 1;
                            ((i + 1) as f64 + (x - sorted[i]) / (sorted[i + 1] - sorted[i]))
                                / (n + 1) as f64
                        } else {
                            0.0
                        };
                        let factor = 10f64.powi(significance as i32);
                        Ok(CellValue::number((rank * factor).floor() / factor))
                    }
                    Err(e) => Ok(CellValue::Error(e, None)),
                }
            }

            // -- MEDIAN --
            "MEDIAN" => {
                if args.is_empty() {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                let flat = self.eval_and_flatten(args).await?;
                // For single-arg MEDIAN, try persistent cache on the range AST.
                let sorted_result = if args.len() == 1 {
                    self.get_sorted_for_range(&args[0], &flat)
                } else {
                    compute_functions::helpers::sorted_cache::get_or_sort_asc(&flat)
                };
                match sorted_result {
                    Ok(sorted) if sorted.is_empty() => Ok(CellValue::Error(CellError::Num, None)),
                    Ok(sorted) => {
                        let mid = sorted.len() / 2;
                        if sorted.len() % 2 == 0 {
                            Ok(CellValue::number((sorted[mid - 1] + sorted[mid]) / 2.0))
                        } else {
                            Ok(CellValue::number(sorted[mid]))
                        }
                    }
                    Err(e) => Ok(CellValue::Error(e, None)),
                }
            }

            // === End Percentile/Median ===

            // === MODE + D-functions evaluator primitives ===
            //
            // These dispatch through the evaluator to establish the path for future
            // cache wiring (frequency cache for MODE, database cache for D-functions).
            // Currently they evaluate args and delegate to GLOBAL_REGISTRY as a
            // passthrough — the actual cache integration happens incrementally.

            // -- MODE / MODE.SNGL --
            // MODE builds a frequency map over the input values and returns
            // the most frequently occurring numeric value.
            //
            // Implemented inline as an evaluator primitive to:
            // 1. Avoid double-flatten through PureFunction dispatch
            // 2. Prepare for WorkbookCache frequency cache wiring (requires
            //    a `get_or_build_count_frequency_for_range` trait method on
            //    EvalMetadata, similar to `get_or_build_sorted_for_range`)
            "MODE" | "MODE.SNGL" => {
                // Evaluate all arguments and flatten to a single CellValue slice.
                let mut evaluated_args = Vec::with_capacity(args.len());
                for arg in args {
                    evaluated_args.push(self.eval_node_cv(arg).await?);
                }
                let flat = compute_functions::helpers::coercion::flatten_values(&evaluated_args);

                // Extract numerics (strict: only Number variants, errors propagate).
                let nums = match compute_functions::helpers::coercion::extract_numbers_strict(&flat)
                {
                    Ok(nums) if nums.is_empty() => {
                        return Ok(CellValue::Error(CellError::Na, None));
                    }
                    Ok(nums) => nums,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                };

                // Build a local frequency map: value -> (count, first_occurrence_index).
                // Using FxHashMap with u64 bit keys for exact f64 matching (MODE uses
                // bitwise equality, not tolerance-based NormalizedKey matching).
                let mut counts: rustc_hash::FxHashMap<u64, (usize, usize)> =
                    rustc_hash::FxHashMap::default();
                for (i, &n) in nums.iter().enumerate() {
                    let bits = n.to_bits();
                    counts
                        .entry(bits)
                        .and_modify(|(count, _)| *count += 1)
                        .or_insert((1, i));
                }

                // Find the maximum count.
                let max_count = counts.values().map(|(c, _)| *c).max().unwrap_or(0);

                // MODE returns #N/A if no value appears more than once.
                if max_count <= 1 {
                    return Ok(CellValue::Error(CellError::Na, None));
                }

                // Return the first value (in original input order) with the max count.
                // This matches Excel behavior: among tied modes, the earliest wins.
                let mut best_idx = usize::MAX;
                let mut best_val = 0.0;
                for (&bits, &(count, first_idx)) in &counts {
                    if count == max_count && first_idx < best_idx {
                        best_idx = first_idx;
                        best_val = f64::from_bits(bits);
                    }
                }

                Ok(CellValue::number(best_val))
            }

            // -- D-functions (database functions) --
            // All 12 D-functions take 3 args: (database_range, field, criteria_range).
            //
            // Future optimization: when workbook_cache gains a `database_cache` tier,
            // extract the database range coordinates from args[0] (if it's a Range
            // ASTNode) and use the cache to avoid re-parsing headers/rows/criteria
            // for repeated D-function calls on the same database range.
            //
            // For now, passthrough to GLOBAL_REGISTRY is correct — each call
            // re-evaluates the database/criteria ranges from scratch.
            "DSUM" | "DAVERAGE" | "DCOUNT" | "DCOUNTA" | "DGET" | "DMAX" | "DMIN" | "DPRODUCT"
            | "DSTDEV" | "DSTDEVP" | "DVAR" | "DVARP" => {
                let mut evaluated_args = Vec::with_capacity(args.len());
                for arg in args {
                    evaluated_args.push(self.eval_node_cv(arg).await?);
                }
                Ok(GLOBAL_REGISTRY.call(upper, &evaluated_args))
            }

            // === End MODE + D-functions ===

            // === SMALL, LARGE, RANK, RANK.EQ, RANK.AVG evaluator primitives ===
            //
            // These functions are promoted from PureFunction dispatch to evaluator
            // primitives so they can:
            // 1. Evaluate range arguments directly from AST (avoiding registry overhead)
            // 2. Share the epoch-scoped sorted cache (`get_or_sort_asc`) with
            //    PERCENTILE/QUARTILE/MEDIAN calls on the same range
            // 3. Prepare for future WorkbookCache integration when mirror access
            //    is available from EvalMetadata
            //
            // The sorted `Arc<Vec<f64>>` is used inline for k-th element
            // extraction (SMALL/LARGE) and rank computation (RANK variants).
            "SMALL" => {
                // SMALL(array, k) — k-th smallest value
                if args.len() != 2 {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                let range_val = self.eval_node_cv(&args[0]).await?;
                let k_val = self.eval_node_cv(&args[1]).await?;
                let flat = compute_functions::helpers::coercion::flatten_values(&[range_val]);
                let k = match k_val.coerce_to_number() {
                    Ok(n) if n < 1.0 => return Ok(CellValue::Error(CellError::Num, None)),
                    Ok(n) => n as usize,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                };
                match self.get_sorted_for_range(&args[0], &flat) {
                    Ok(sorted) if sorted.is_empty() || k > sorted.len() => {
                        Ok(CellValue::Error(CellError::Num, None))
                    }
                    Ok(sorted) => Ok(CellValue::number(sorted[k - 1])),
                    Err(e) => Ok(CellValue::Error(e, None)),
                }
            }

            "LARGE" => {
                // LARGE(array, k) — k-th largest value
                if args.len() != 2 {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                let range_val = self.eval_node_cv(&args[0]).await?;
                let k_val = self.eval_node_cv(&args[1]).await?;
                let flat = compute_functions::helpers::coercion::flatten_values(&[range_val]);
                let k = match k_val.coerce_to_number() {
                    Ok(n) if n < 1.0 => return Ok(CellValue::Error(CellError::Num, None)),
                    Ok(n) => n as usize,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                };
                match self.get_sorted_for_range(&args[0], &flat) {
                    Ok(sorted) if sorted.is_empty() || k > sorted.len() => {
                        Ok(CellValue::Error(CellError::Num, None))
                    }
                    Ok(sorted) => {
                        // k-th largest = sorted_asc[len - k]
                        Ok(CellValue::number(sorted[sorted.len() - k]))
                    }
                    Err(e) => Ok(CellValue::Error(e, None)),
                }
            }

            "RANK" | "RANK.EQ" => {
                // RANK(number, ref, [order]) — rank of number in array
                // RANK.EQ is identical to RANK
                if args.len() < 2 || args.len() > 3 {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                let number_val = self.eval_node_cv(&args[0]).await?;
                if let CellValue::Error(e, _) = number_val {
                    return Ok(CellValue::Error(e, None));
                }
                let number = match number_val.coerce_to_number() {
                    Ok(n) => n,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                };
                let range_val = self.eval_node_cv(&args[1]).await?;
                let flat = compute_functions::helpers::coercion::flatten_values(&[range_val]);
                let order = if args.len() > 2 {
                    match self.eval_node_cv(&args[2]).await? {
                        CellValue::Error(e, _) => return Ok(CellValue::Error(e, None)),
                        v => match v.coerce_to_number() {
                            Ok(n) => n as i32,
                            Err(e) => return Ok(CellValue::Error(e, None)),
                        },
                    }
                } else {
                    0
                };
                match self.get_sorted_for_range(&args[1], &flat) {
                    Ok(sorted) => match rank_components_inline(&sorted, number, order) {
                        Some((less, _equal)) => Ok(CellValue::number((less + 1) as f64)),
                        None => Ok(CellValue::Error(CellError::Na, None)),
                    },
                    Err(e) => Ok(CellValue::Error(e, None)),
                }
            }

            "RANK.AVG" => {
                // RANK.AVG(number, ref, [order]) — average rank for ties
                if args.len() < 2 || args.len() > 3 {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                let number_val = self.eval_node_cv(&args[0]).await?;
                if let CellValue::Error(e, _) = number_val {
                    return Ok(CellValue::Error(e, None));
                }
                let number = match number_val.coerce_to_number() {
                    Ok(n) => n,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                };
                let range_val = self.eval_node_cv(&args[1]).await?;
                let flat = compute_functions::helpers::coercion::flatten_values(&[range_val]);
                let order = if args.len() > 2 {
                    match self.eval_node_cv(&args[2]).await? {
                        CellValue::Error(e, _) => return Ok(CellValue::Error(e, None)),
                        v => match v.coerce_to_number() {
                            Ok(n) => n as i32,
                            Err(e) => return Ok(CellValue::Error(e, None)),
                        },
                    }
                } else {
                    0
                };
                match self.get_sorted_for_range(&args[1], &flat) {
                    Ok(sorted) => match rank_components_inline(&sorted, number, order) {
                        Some((less, equal)) => {
                            let rank = less as f64 + 1.0 + (equal as f64 - 1.0) / 2.0;
                            Ok(CellValue::number(rank))
                        }
                        None => Ok(CellValue::Error(CellError::Na, None)),
                    },
                    Err(e) => Ok(CellValue::Error(e, None)),
                }
            }

            // === End SMALL/LARGE/RANK ===

            "AREAS" => {
                if args.len() != 1 {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                let count = match &args[0] {
                    ASTNode::Union { ranges } => ranges.len(),
                    ASTNode::Paren(inner) => match inner.as_ref() {
                        ASTNode::Union { ranges } => ranges.len(),
                        _ => 1,
                    },
                    _ => 1,
                };
                Ok(CellValue::number(count as f64))
            }

            // -- SUMPRODUCT: vectorized special dispatch (avoids intermediate arrays) --
            "SUMPRODUCT" => self.eval_sumproduct(args).await,

            // -- GETPIVOTDATA: needs AST access for cell ref + mirror pivot metadata --
            "GETPIVOTDATA" => self.eval_getpivotdata(args).await,

            // -- Fallback: delegate to FunctionRegistry for all other functions --
            other => {
                // Try borrowed fast paths for conditional aggregate functions.
                // These borrow &[CellValue] column slices directly from the mirror,
                // avoiding full range materialization. Falls back to normal dispatch
                // if ranges are not single-column or column data is unavailable.
                match other {
                    "COUNTIFS" | "SUMIFS" | "AVERAGEIFS" | "MAXIFS" | "MINIFS" => {
                        use crate::eval::functions::borrowed_multi_criteria::try_eval_multi_criteria_borrowed;
                        use compute_functions::helpers::conditional_aggregate::AggregateOp;
                        let op = match other {
                            "COUNTIFS" => AggregateOp::Count,
                            "SUMIFS" => AggregateOp::Sum,
                            "AVERAGEIFS" => AggregateOp::Average,
                            "MAXIFS" => AggregateOp::Max,
                            _ => AggregateOp::Min,
                        };
                        if let Some(result) = try_eval_multi_criteria_borrowed(self, args, op).await
                        {
                            return result;
                        }
                    }
                    "COUNTIF" | "SUMIF" | "AVERAGEIF" => {
                        use crate::eval::functions::borrowed_multi_criteria::try_eval_single_criteria_borrowed;
                        use compute_functions::helpers::conditional_aggregate::AggregateOp;
                        let op = match other {
                            "COUNTIF" => AggregateOp::Count,
                            "SUMIF" => AggregateOp::Sum,
                            _ => AggregateOp::Average,
                        };
                        if let Some(result) =
                            try_eval_single_criteria_borrowed(self, args, op).await
                        {
                            return result;
                        }
                    }
                    _ => {}
                }

                // Look up the function so we can intercept omitted args and
                // substitute the function's declared default (if any).
                match GLOBAL_REGISTRY.get_by_name(other) {
                    Some((_id, func)) => {
                        #[cfg(feature = "profile")]
                        let _arg_span = tracing::info_span!(
                            "fn_arg_eval",
                            fn_name = other,
                            arg_count = args.len()
                        )
                        .entered();
                        let mut evaluated_args = Vec::with_capacity(args.len());
                        for (i, arg) in args.iter().enumerate() {
                            if matches!(arg, ASTNode::Omitted) {
                                evaluated_args
                                    .push(func.default_for_arg(i).unwrap_or(CellValue::Null));
                            } else {
                                evaluated_args.push(self.eval_node_cv(arg).await?);
                            }
                        }
                        #[cfg(feature = "profile")]
                        drop(_arg_span);

                        // Validate argument count before calling the function body.
                        // Without this, wrong-arity calls silently reach the function
                        // and produce misleading errors (e.g. #NUM! instead of #VALUE!).
                        if evaluated_args.len() < func.min_args() {
                            return Ok(CellValue::error_with_message(
                                CellError::Value,
                                format!(
                                    "{other} requires at least {} argument(s), got {}",
                                    func.min_args(),
                                    evaluated_args.len()
                                ),
                            ));
                        }
                        if let Some(max) = func.max_args()
                            && evaluated_args.len() > max
                        {
                            return Ok(CellValue::error_with_message(
                                CellError::Value,
                                format!(
                                    "{other} accepts at most {max} argument(s), got {}",
                                    evaluated_args.len()
                                ),
                            ));
                        }

                        #[cfg(feature = "profile")]
                        let _body_span =
                            tracing::info_span!("fn_body", fn_name = other, arg_count = args.len())
                                .entered();
                        Ok(func.call(&evaluated_args))
                    }
                    None => Ok(CellValue::error_with_message(
                        CellError::Name,
                        format!("Unknown function '{other}'"),
                    )),
                }
            }
        }
    }

    fn eval_formulatext(&self, args: &[ASTNode]) -> Result<CellValue, ComputeError> {
        if args.len() != 1 {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        match self.resolve_formulatext_target(&args[0]) {
            FormulaTextTarget::Local { sheet, row, col } => {
                Ok(match self.meta.formula_text_at(&sheet, row, col) {
                    FormulaTextLookup::Visible(text) => CellValue::Text(text.into()),
                    FormulaTextLookup::NotFormula
                    | FormulaTextLookup::Hidden
                    | FormulaTextLookup::Unavailable => CellValue::Error(CellError::Na, None),
                    FormulaTextLookup::InvalidRef => CellValue::Error(CellError::Ref, None),
                })
            }
            FormulaTextTarget::ExternalUnavailable => Ok(CellValue::Error(CellError::Na, None)),
            FormulaTextTarget::InvalidRef => Ok(CellValue::Error(CellError::Ref, None)),
            FormulaTextTarget::Unsupported => Ok(CellValue::Error(CellError::Value, None)),
        }
    }

    fn resolve_formulatext_target(&self, node: &ASTNode) -> FormulaTextTarget {
        match node {
            ASTNode::CellReference(cell) => self.resolve_cell_ref_for_formulatext(&cell.reference),
            ASTNode::Range(range) => self.resolve_range_for_formulatext(range),
            ASTNode::SheetRef { sheet, inner } => {
                self.resolve_formulatext_target_in_sheet(inner, *sheet)
            }
            ASTNode::UnresolvedSheetRef { .. } | ASTNode::UnresolvedThreeDRef { .. } => {
                FormulaTextTarget::InvalidRef
            }
            ASTNode::ExternalSheetRef { .. }
            | ASTNode::ExternalThreeDRef { .. }
            | ASTNode::ExternalNameRef { .. } => FormulaTextTarget::ExternalUnavailable,
            ASTNode::Identifier(name) => match self.meta.resolve_defined_name(name) {
                Some(formula_types::ResolvedName::Cell { sheet, row, col }) => {
                    FormulaTextTarget::Local { sheet, row, col }
                }
                Some(formula_types::ResolvedName::Range {
                    sheet,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                }) => FormulaTextTarget::Local {
                    sheet,
                    row: start_row.min(end_row),
                    col: start_col.min(end_col),
                },
                Some(formula_types::ResolvedName::Error(CellError::Ref)) => {
                    FormulaTextTarget::InvalidRef
                }
                _ => FormulaTextTarget::Unsupported,
            },
            ASTNode::Paren(inner) => self.resolve_formulatext_target(inner),
            ASTNode::StructuredRef(_) | ASTNode::ThreeDRef { .. } => FormulaTextTarget::Unsupported,
            _ => FormulaTextTarget::Unsupported,
        }
    }

    fn resolve_formulatext_target_in_sheet(
        &self,
        node: &ASTNode,
        sheet: cell_types::SheetId,
    ) -> FormulaTextTarget {
        match self.resolve_formulatext_target(node) {
            FormulaTextTarget::Local { row, col, .. } => {
                FormulaTextTarget::Local { sheet, row, col }
            }
            other => other,
        }
    }

    fn resolve_cell_ref_for_formulatext(&self, cell_ref: &CellRef) -> FormulaTextTarget {
        match cell_ref {
            CellRef::Resolved(id) => self
                .meta
                .resolve_position(id)
                .map(|(sheet, row, col)| FormulaTextTarget::Local { sheet, row, col })
                .unwrap_or(FormulaTextTarget::InvalidRef),
            CellRef::Positional { sheet, row, col } => {
                let sheet = if *sheet == cell_types::SheetId::from_raw(0) {
                    self.current_sheet_for_formulatext()
                } else {
                    *sheet
                };
                FormulaTextTarget::Local {
                    sheet,
                    row: *row,
                    col: *col,
                }
            }
        }
    }

    fn resolve_range_for_formulatext(&self, range: &RangeRef) -> FormulaTextTarget {
        let start = match self.resolve_cell_ref_for_formulatext(&range.start) {
            FormulaTextTarget::Local { sheet, row, col } => (sheet, row, col),
            other => return other,
        };
        let end = match self.resolve_cell_ref_for_formulatext(&range.end) {
            FormulaTextTarget::Local { sheet, row, col } => (sheet, row, col),
            other => return other,
        };

        if start.0 != end.0 {
            return FormulaTextTarget::InvalidRef;
        }

        FormulaTextTarget::Local {
            sheet: start.0,
            row: start.1.min(end.1),
            col: start.2.min(end.2),
        }
    }

    fn current_sheet_for_formulatext(&self) -> cell_types::SheetId {
        let current = self.meta.current_cell();
        self.meta
            .resolve_position(&current)
            .map(|(sheet, _, _)| sheet)
            .unwrap_or_else(|| cell_types::SheetId::from_raw(0))
    }
}

// ---------------------------------------------------------------------------
// Inline helpers for RANK functions
// ---------------------------------------------------------------------------

/// Epsilon tolerance for "number exists in array" checks (matches Excel behavior).
const RANK_EPS: f64 = 1e-10;

fn binary_operator_alias(name: &str) -> Option<BinOp> {
    match name {
        "ADD" => Some(BinOp::Add),
        "MINUS" => Some(BinOp::Sub),
        "MULTIPLY" => Some(BinOp::Mul),
        "DIVIDE" => Some(BinOp::Div),
        "POW" => Some(BinOp::Pow),
        "EQ" => Some(BinOp::Eq),
        "NE" => Some(BinOp::Neq),
        "GT" => Some(BinOp::Gt),
        "GTE" => Some(BinOp::Gte),
        "LT" => Some(BinOp::Lt),
        "LTE" => Some(BinOp::Lte),
        _ => None,
    }
}

fn unary_operator_alias(name: &str) -> Option<UnaryOp> {
    match name {
        "UMINUS" => Some(UnaryOp::Minus),
        "UPLUS" => Some(UnaryOp::Plus),
        "UNARY_PERCENT" => Some(UnaryOp::Percent),
        _ => None,
    }
}

/// Find the rank of `number` in a sorted ascending slice using binary search
/// with epsilon tolerance. Returns `(count_less, count_equal)` where "less"
/// and "equal" are defined relative to the `order` parameter:
/// - order == 0 (descending): "less" means values > number, "equal" means values approx number
/// - order != 0 (ascending): "less" means values < number, "equal" means values approx number
///
/// Equivalent to `rank_components` in `compute-functions/src/statistical/ranking.rs`.
fn rank_components_inline(sorted_asc: &[f64], number: f64, order: i32) -> Option<(usize, usize)> {
    // Find the range of elements approximately equal to `number`
    let first_ge = sorted_asc.partition_point(|&x| x < number - RANK_EPS);
    let first_gt = sorted_asc.partition_point(|&x| x <= number + RANK_EPS);
    let equal_count = first_gt - first_ge;

    if equal_count == 0 {
        return None; // number not found in array
    }

    if order == 0 {
        // Descending: count how many are strictly greater
        let greater_count = sorted_asc.len() - first_gt;
        Some((greater_count, equal_count))
    } else {
        // Ascending: count how many are strictly less
        Some((first_ge, equal_count))
    }
}
