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

use super::super::GLOBAL_REGISTRY;
use super::evaluator::Evaluator;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};

use super::super::{agg_average, agg_count, agg_counta, agg_countblank, agg_max, agg_min, agg_sum};

use crate::eval::eval_value::EvalValue;
use compute_parser::ASTNode;
use value_types::{CellError, CellValue, ComputeError};

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
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
            "IF" => self.eval_if(args).await,

            "AND" => self.eval_and(args).await,

            "OR" => self.eval_or(args).await,

            "NOT" => self.eval_not(args).await,

            // -- Info / IS functions --
            "IFERROR" => self.eval_iferror(args).await,
            "IFNA" => self.eval_ifna(args).await,

            // -- CELL function: needs AST access for "row"/"col"/"address" --
            "CELL" => self.eval_cell(args).await,

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
            "ROW" => self.eval_row(args).await,
            "COLUMN" => self.eval_column(args).await,
            "ROWS" => self.eval_rows(args).await,
            "COLUMNS" => self.eval_columns(args).await,

            // -- SHEETS (no-arg form: total sheet count) --
            "SHEETS" => self.eval_sheets(args).await,

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

            // -- IFS: short-circuit evaluator primitive --
            "IFS" => self.eval_ifs(args).await,

            // -- ISFORMULA: needs AST access to inspect the referenced cell --
            "ISFORMULA" => self.eval_isformula(args).await,

            // === Percentile/Median evaluator primitives ===
            //
            // These functions sort the input array. By dispatching at the evaluator
            // level we can leverage the epoch-scoped sorted cache
            // (`get_or_sort_asc`) so that repeated calls on the same range
            // (e.g., PERCENTILE(A1:A1000, 0.25) and PERCENTILE(A1:A1000, 0.75))
            // share a single sort.

            // -- PERCENTILE family --
            "PERCENTILE" | "PERCENTILE.INC" => self.eval_percentile_inc(args).await,

            "PERCENTILE.EXC" => self.eval_percentile_exc(args).await,

            "QUARTILE" | "QUARTILE.INC" => self.eval_quartile_inc(args).await,

            "QUARTILE.EXC" => self.eval_quartile_exc(args).await,

            // -- PERCENTRANK family --
            "PERCENTRANK" | "PERCENTRANK.INC" => self.eval_percentrank_inc(args).await,

            "PERCENTRANK.EXC" => self.eval_percentrank_exc(args).await,

            // -- MEDIAN --
            "MEDIAN" => self.eval_median(args).await,

            // === End Percentile/Median ===

            // === MODE + D-functions evaluator primitives ===
            //
            // -- MODE / MODE.SNGL --
            "MODE" | "MODE.SNGL" => self.eval_mode_sngl(args).await,

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
            "SMALL" => self.eval_small(args).await,

            "LARGE" => self.eval_large(args).await,

            "RANK" | "RANK.EQ" => self.eval_rank_eq(args).await,

            "RANK.AVG" => self.eval_rank_avg(args).await,

            // === End SMALL/LARGE/RANK ===
            "AREAS" => self.eval_areas(args),

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
}
