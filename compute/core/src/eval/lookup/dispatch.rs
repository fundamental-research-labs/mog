//! Lookup functions — INDEX, MATCH, VLOOKUP, HLOOKUP, XLOOKUP, XMATCH, OFFSET.

use cell_types::SheetId;
use compute_parser::ASTNode;
use compute_parser::{CellRefNode, RangeRef};
use formula_types::{CellRef, RangeType};
use value_types::{CellArray, CellError, CellValue, ComputeError};

use crate::eval::context::traits::{EvalDataAccess, EvalMetadata, IndexedLookupResult};
use crate::eval::engine::evaluator::Evaluator;
use crate::eval::engine::operators::{cell_value_cmp_for_lookup, cell_value_eq_lookup};
use crate::functions::helpers::criteria::WildcardPattern;
use crate::functions::lookup::helpers::get_return_value;

use super::primitives::{
    approx_match_binary_search, has_wildcard_chars, index_effective_position, index_scalar,
    match_scalar_in_flat,
};
use super::range_geometry::{
    extract_range_bounds, is_whole_range, resolve_cellref, try_extract_single_col_range,
    try_extract_single_row_range,
};

/// Perform a scalar VLOOKUP in a materialized table array.
fn vlookup_scalar_in_table(
    lookup: &CellValue,
    rows: &CellArray,
    col_idx: usize,
    exact: bool,
) -> CellValue {
    if exact {
        if has_wildcard_chars(lookup) {
            let pattern = match lookup.coerce_to_string() {
                Ok(s) => WildcardPattern::new(&s),
                Err(e) => return CellValue::Error(e, None),
            };
            for ri in 0..rows.rows() {
                if let Some(first) = rows.get(ri, 0)
                    && let Ok(s) = first.coerce_to_string()
                    && pattern.matches(&s)
                {
                    return rows
                        .get(ri, col_idx)
                        .cloned()
                        .unwrap_or(CellValue::Error(CellError::Ref, None));
                }
            }
        } else {
            for ri in 0..rows.rows() {
                if let Some(first) = rows.get(ri, 0)
                    && cell_value_eq_lookup(lookup, first)
                {
                    return rows
                        .get(ri, col_idx)
                        .cloned()
                        .unwrap_or(CellValue::Error(CellError::Ref, None));
                }
            }
        }
        CellValue::Error(CellError::Na, None)
    } else {
        let first_col: Vec<(usize, &CellValue)> = (0..rows.rows())
            .filter_map(|i| rows.get(i, 0).map(|v| (i, v)))
            .collect();
        let best = approx_match_binary_search(lookup, first_col.into_iter(), true);
        match best {
            Some(i) => rows
                .get(i, col_idx)
                .cloned()
                .unwrap_or(CellValue::Error(CellError::Ref, None)),
            None => CellValue::Error(CellError::Na, None),
        }
    }
}

/// Perform a scalar HLOOKUP in a materialized table array.
fn hlookup_scalar_in_table(
    lookup: &CellValue,
    rows: &CellArray,
    row_idx: usize,
    exact: bool,
) -> CellValue {
    if rows.rows() == 0 {
        return CellValue::Error(CellError::Ref, None);
    }
    let first_row = rows.row(0);
    if exact {
        if has_wildcard_chars(lookup) {
            let pattern = match lookup.coerce_to_string() {
                Ok(s) => WildcardPattern::new(&s),
                Err(e) => return CellValue::Error(e, None),
            };
            for (ci, val) in first_row.iter().enumerate() {
                if let Ok(s) = val.coerce_to_string()
                    && pattern.matches(&s)
                {
                    return rows
                        .get(row_idx, ci)
                        .cloned()
                        .unwrap_or(CellValue::Error(CellError::Ref, None));
                }
            }
        } else {
            for (ci, val) in first_row.iter().enumerate() {
                if cell_value_eq_lookup(lookup, val) {
                    return rows
                        .get(row_idx, ci)
                        .cloned()
                        .unwrap_or(CellValue::Error(CellError::Ref, None));
                }
            }
        }
        CellValue::Error(CellError::Na, None)
    } else {
        let best = approx_match_binary_search(lookup, first_row.iter().enumerate(), true);
        match best {
            Some(ci) => rows
                .get(row_idx, ci)
                .cloned()
                .unwrap_or(CellValue::Error(CellError::Ref, None)),
            None => CellValue::Error(CellError::Na, None),
        }
    }
}

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    // -----------------------------------------------------------------------
    // INDEX
    // -----------------------------------------------------------------------
    pub(in crate::eval) async fn eval_index(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() < 2 || args.len() > 3 {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        // --- Lazy reference path ---
        // Resolve range bounds WITHOUT evaluating any cells. This avoids
        // false circular references when INDEX targets a whole-column range
        // that overlaps with the caller's dependencies.
        if let Ok((sheet, range_sr, range_sc, range_er, range_ec)) =
            self.eval_node_as_area(&args[0]).await
        {
            let row_num = self.eval_node_cv(&args[1]).await?;

            let has_col_arg = args.len() > 2 && !matches!(args[2], ASTNode::Omitted);
            let col_val = if has_col_arg {
                let c = self.eval_node_cv(&args[2]).await?;
                if let CellValue::Error(e, _) = c {
                    return Ok(CellValue::Error(e, None));
                }
                Some(c)
            } else {
                None
            };

            let num_rows = (range_er - range_sr + 1) as usize;
            let num_cols = (range_ec - range_sc + 1) as usize;

            // --- Array-lifting: when row_num is an array, map element-wise ---
            if let CellValue::Array(pos_arr) = &row_num {
                // When col_num is also an array, zip element-wise with row_num
                if let Some(CellValue::Array(col_arr)) = &col_val {
                    let mut result_data = Vec::with_capacity(pos_arr.len());
                    for (row_v, col_v) in pos_arr.iter().zip(col_arr.iter()) {
                        let val = match (row_v, col_v) {
                            (CellValue::Error(e, None), _) | (_, CellValue::Error(e, None)) => {
                                CellValue::Error(*e, None)
                            }
                            (rv, cv) => {
                                let row_idx = match rv.coerce_to_number() {
                                    Ok(n) if n < 0.0 => {
                                        result_data.push(CellValue::Error(CellError::Value, None));
                                        continue;
                                    }
                                    Ok(n) => n as usize,
                                    Err(e) => {
                                        result_data.push(CellValue::Error(e, None));
                                        continue;
                                    }
                                };
                                let ci = match cv.coerce_to_number() {
                                    Ok(n) if n < 0.0 => {
                                        result_data.push(CellValue::Error(CellError::Value, None));
                                        continue;
                                    }
                                    Ok(n) => n as usize,
                                    Err(e) => {
                                        result_data.push(CellValue::Error(e, None));
                                        continue;
                                    }
                                };
                                let (eff_row, eff_col) = index_effective_position(
                                    row_idx,
                                    ci,
                                    has_col_arg,
                                    num_rows,
                                    num_cols,
                                );
                                self.index_lazy_cell(
                                    sheet, range_sr, range_sc, range_er, range_ec, eff_row, eff_col,
                                )
                                .await
                            }
                        };
                        result_data.push(val);
                    }
                    return Ok(CellValue::array(result_data, pos_arr.cols()));
                }

                // col_num is scalar (or omitted)
                let col_idx = match &col_val {
                    Some(c) => match c.coerce_to_number() {
                        Ok(n) if n < 0.0 => return Ok(CellValue::Error(CellError::Value, None)),
                        Ok(n) => n as usize,
                        Err(e) => return Ok(CellValue::Error(e, None)),
                    },
                    None => 0,
                };
                let mut result_data = Vec::with_capacity(pos_arr.len());
                for pos_row in pos_arr.rows_iter() {
                    for pos in pos_row.iter() {
                        let val = match pos {
                            CellValue::Error(e, _) => CellValue::Error(*e, None),
                            other => match other.coerce_to_number() {
                                Ok(n) if n < 0.0 => CellValue::Error(CellError::Value, None),
                                Ok(n) => {
                                    let (eff_row, eff_col) = index_effective_position(
                                        n as usize,
                                        col_idx,
                                        has_col_arg,
                                        num_rows,
                                        num_cols,
                                    );
                                    self.index_lazy_cell(
                                        sheet, range_sr, range_sc, range_er, range_ec, eff_row,
                                        eff_col,
                                    )
                                    .await
                                }
                                Err(e) => CellValue::Error(e, None),
                            },
                        };
                        result_data.push(val);
                    }
                }
                return Ok(CellValue::array(result_data, pos_arr.cols()));
            }

            // --- Scalar path ---
            if let CellValue::Error(e, _) = row_num {
                return Ok(CellValue::Error(e, None));
            }
            let row_idx = match row_num.coerce_to_number() {
                Ok(n) if n < 0.0 => return Ok(CellValue::Error(CellError::Value, None)),
                Ok(n) => n as usize,
                Err(e) => return Ok(CellValue::Error(e, None)),
            };
            let col_idx = match &col_val {
                Some(c) => match c.coerce_to_number() {
                    Ok(n) if n < 0.0 => return Ok(CellValue::Error(CellError::Value, None)),
                    Ok(n) => n as usize,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                },
                None => 0,
            };

            let (eff_row, eff_col) =
                index_effective_position(row_idx, col_idx, has_col_arg, num_rows, num_cols);

            // Single cell → lazy access (the common case, avoids false cycles)
            if eff_row > 0 && eff_col > 0 {
                return Ok(self
                    .index_lazy_cell(
                        sheet, range_sr, range_sc, range_er, range_ec, eff_row, eff_col,
                    )
                    .await);
            }

            // Row/column slice → narrowed sub-range (much smaller than full range)
            if eff_row == 0 && eff_col == 0 {
                // Return entire range — must materialize
                let start = CellRef::Positional {
                    sheet,
                    row: range_sr,
                    col: range_sc,
                };
                let end = CellRef::Positional {
                    sheet,
                    row: range_er,
                    col: range_ec,
                };
                return match self
                    .data
                    .get_range_values(&start, &end, &RangeType::CellRange)
                    .await
                {
                    Ok(arr) => Ok(CellValue::Array(arr)),
                    Err(e) => Ok(CellValue::Error(e, None)),
                };
            }
            if eff_row == 0 {
                // Return entire column within range (single column)
                let ci = (eff_col - 1) as u32;
                let target_col = range_sc + ci;
                if target_col > range_ec {
                    return Ok(CellValue::Error(CellError::Ref, None));
                }
                let start = CellRef::Positional {
                    sheet,
                    row: range_sr,
                    col: target_col,
                };
                let end = CellRef::Positional {
                    sheet,
                    row: range_er,
                    col: target_col,
                };
                return match self
                    .data
                    .get_range_values(&start, &end, &RangeType::CellRange)
                    .await
                {
                    Ok(arr) => Ok(CellValue::Array(arr)),
                    Err(e) => Ok(CellValue::Error(e, None)),
                };
            }
            // eff_col == 0: return entire row within range (single row)
            let ri = (eff_row - 1) as u32;
            let target_row = range_sr + ri;
            if target_row > range_er {
                return Ok(CellValue::Error(CellError::Ref, None));
            }
            let start = CellRef::Positional {
                sheet,
                row: target_row,
                col: range_sc,
            };
            let end = CellRef::Positional {
                sheet,
                row: target_row,
                col: range_ec,
            };
            return match self
                .data
                .get_range_values(&start, &end, &RangeType::CellRange)
                .await
            {
                Ok(arr) => Ok(CellValue::Array(arr)),
                Err(e) => Ok(CellValue::Error(e, None)),
            };
        }

        // --- Eager fallback: non-reference args (computed arrays, literals, etc.) ---
        let arr = self.eval_node_cv(&args[0]).await?;
        let row_num = self.eval_node_cv(&args[1]).await?;

        // --- Array-lifting (eager) ---
        if let CellValue::Array(pos_arr) = &row_num {
            let source = match &arr {
                CellValue::Array(r) => r,
                CellValue::Error(e, _) => return Ok(CellValue::Error(*e, None)),
                _ => return Ok(CellValue::Error(CellError::Ref, None)),
            };
            let has_col_arg = args.len() > 2 && !matches!(args[2], ASTNode::Omitted);
            let col_val = if has_col_arg {
                let c = self.eval_node_cv(&args[2]).await?;
                if let CellValue::Error(e, _) = c {
                    return Ok(CellValue::Error(e, None));
                }
                Some(c)
            } else {
                None
            };

            // When col_num is also an array, zip element-wise with row_num
            if let Some(CellValue::Array(col_arr)) = &col_val {
                let result_data: Vec<CellValue> = pos_arr
                    .iter()
                    .zip(col_arr.iter())
                    .map(|(row_v, col_v)| {
                        let row_idx = match row_v {
                            CellValue::Error(e, _) => return CellValue::Error(*e, None),
                            other => match other.coerce_to_number() {
                                Ok(n) if n < 0.0 => {
                                    return CellValue::Error(CellError::Value, None);
                                }
                                Ok(n) => n as usize,
                                Err(e) => return CellValue::Error(e, None),
                            },
                        };
                        let col_idx = match col_v {
                            CellValue::Error(e, _) => return CellValue::Error(*e, None),
                            other => match other.coerce_to_number() {
                                Ok(n) if n < 0.0 => {
                                    return CellValue::Error(CellError::Value, None);
                                }
                                Ok(n) => n as usize,
                                Err(e) => return CellValue::Error(e, None),
                            },
                        };
                        index_scalar(source, row_idx, col_idx, has_col_arg)
                    })
                    .collect();
                return Ok(CellValue::array(result_data, pos_arr.cols()));
            }

            // col_num is scalar (or omitted)
            let col_idx = match &col_val {
                Some(c) => match c.coerce_to_number() {
                    Ok(n) if n < 0.0 => return Ok(CellValue::Error(CellError::Value, None)),
                    Ok(n) => n as usize,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                },
                None => 0,
            };
            let result_data: Vec<CellValue> = pos_arr
                .iter()
                .map(|pos| match pos {
                    CellValue::Error(e, _) => CellValue::Error(*e, None),
                    other => match other.coerce_to_number() {
                        Ok(n) if n < 0.0 => CellValue::Error(CellError::Value, None),
                        Ok(n) => index_scalar(source, n as usize, col_idx, has_col_arg),
                        Err(e) => CellValue::Error(e, None),
                    },
                })
                .collect();
            return Ok(CellValue::array(result_data, pos_arr.cols()));
        }

        if let CellValue::Error(e, _) = row_num {
            return Ok(CellValue::Error(e, None));
        }
        let row_idx = match row_num.coerce_to_number() {
            Ok(n) if n < 0.0 => return Ok(CellValue::Error(CellError::Value, None)),
            Ok(n) => n as usize,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };
        let has_col_arg = args.len() > 2 && !matches!(args[2], ASTNode::Omitted);
        let col_idx = if has_col_arg {
            let c = self.eval_node_cv(&args[2]).await?;
            if let CellValue::Error(e, _) = c {
                return Ok(CellValue::Error(e, None));
            }
            match c.coerce_to_number() {
                Ok(n) if n < 0.0 => return Ok(CellValue::Error(CellError::Value, None)),
                Ok(n) => n as usize,
                Err(e) => return Ok(CellValue::Error(e, None)),
            }
        } else {
            0
        };

        match arr {
            CellValue::Array(arr_data) => {
                Ok(index_scalar(&arr_data, row_idx, col_idx, has_col_arg))
            }
            CellValue::Error(e, _) => Ok(CellValue::Error(e, None)),
            other => {
                if row_idx <= 1 && col_idx <= 1 {
                    Ok(other)
                } else {
                    Ok(CellValue::Error(CellError::Ref, None))
                }
            }
        }
    }

    /// Resolve a single cell from a reference area at the given INDEX position.
    /// Returns the cell value via lazy demand evaluation (only evaluates the target cell).
    #[allow(clippy::too_many_arguments)]
    async fn index_lazy_cell(
        &mut self,
        sheet: SheetId,
        range_sr: u32,
        range_sc: u32,
        range_er: u32,
        range_ec: u32,
        eff_row: usize,
        eff_col: usize,
    ) -> CellValue {
        let target_row = range_sr + (eff_row - 1) as u32;
        let target_col = range_sc + (eff_col - 1) as u32;
        if target_row > range_er || target_col > range_ec {
            return CellValue::Error(CellError::Ref, None);
        }
        let ref_ = CellRef::Positional {
            sheet,
            row: target_row,
            col: target_col,
        };
        self.data.get_cell_value_by_ref(&ref_).await
    }

    // -----------------------------------------------------------------------
    // INDEX — reference area variant (for RangeOp)
    // -----------------------------------------------------------------------

    /// Evaluate `INDEX(array, row_num, [col_num])` as a reference area.
    ///
    /// Instead of returning the cell value, returns the absolute position
    /// `(sheet, start_row, start_col, end_row, end_col)` that the INDEX
    /// expression points to. Used by `RangeOp` to construct ranges like
    /// `INDEX(A:A,1):INDEX(A:A,5)` → range A1:A5.
    pub(in crate::eval) async fn eval_index_as_area(
        &mut self,
        args: &[ASTNode],
    ) -> Result<(SheetId, u32, u32, u32, u32), ComputeError> {
        if args.len() < 2 || args.len() > 3 {
            return Err(ComputeError::Eval {
                message: "INDEX: expected 2-3 arguments".into(),
            });
        }

        // Get array reference area (supports Range, CellReference, SheetRef, etc.)
        let (sheet, range_sr, range_sc, range_er, range_ec) =
            self.eval_node_as_area(&args[0]).await?;

        // Evaluate row_num
        let row_val = self.eval_node_cv(&args[1]).await?;
        if let CellValue::Error(..) = row_val {
            return Err(ComputeError::Eval {
                message: "INDEX: error in row_num".into(),
            });
        }
        let row_num = match row_val.coerce_to_number() {
            Ok(n) => n as i64,
            Err(_) => {
                return Err(ComputeError::Eval {
                    message: "INDEX: row_num not numeric".into(),
                });
            }
        };

        // Evaluate col_num (default depends on range shape)
        let has_col_arg = args.len() > 2 && !matches!(args[2], ASTNode::Omitted);
        let col_num = if has_col_arg {
            let col_val = self.eval_node_cv(&args[2]).await?;
            if let CellValue::Error(..) = col_val {
                return Err(ComputeError::Eval {
                    message: "INDEX: error in col_num".into(),
                });
            }
            match col_val.coerce_to_number() {
                Ok(n) => n as i64,
                Err(_) => {
                    return Err(ComputeError::Eval {
                        message: "INDEX: col_num not numeric".into(),
                    });
                }
            }
        } else {
            0
        };

        // Excel INDEX semantics for 2-arg form (no col_num):
        // - Single-row range: row_num is treated as column index
        // - Otherwise: row_num selects a row (col_num=0 means entire row)
        let (row_num, col_num) = if !has_col_arg {
            let range_rows = range_er - range_sr + 1;
            if range_rows == 1 {
                // Single-row range: treat row_num as column index
                (0i64, row_num)
            } else {
                (row_num, 0i64)
            }
        } else {
            (row_num, col_num)
        };

        // Compute target area within the range
        if row_num == 0 && col_num == 0 {
            // Return entire range
            Ok((sheet, range_sr, range_sc, range_er, range_ec))
        } else if row_num == 0 {
            // Return entire column within range
            let ci = (col_num - 1) as u32;
            let target_col = range_sc + ci;
            if target_col > range_ec {
                return Err(ComputeError::Eval {
                    message: "INDEX: column out of bounds".into(),
                });
            }
            Ok((sheet, range_sr, target_col, range_er, target_col))
        } else if col_num == 0 {
            // Return entire row within range
            let ri = (row_num - 1) as u32;
            let target_row = range_sr + ri;
            if target_row > range_er {
                return Err(ComputeError::Eval {
                    message: "INDEX: row out of bounds".into(),
                });
            }
            Ok((sheet, target_row, range_sc, target_row, range_ec))
        } else {
            // Return single cell
            let ri = (row_num - 1) as u32;
            let ci = (col_num - 1) as u32;
            let target_row = range_sr + ri;
            let target_col = range_sc + ci;
            if target_row > range_er || target_col > range_ec {
                return Err(ComputeError::Eval {
                    message: "INDEX: position out of bounds".into(),
                });
            }
            Ok((sheet, target_row, target_col, target_row, target_col))
        }
    }

    // -----------------------------------------------------------------------
    // MATCH
    // -----------------------------------------------------------------------
    pub(in crate::eval) async fn eval_match(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() < 2 || args.len() > 3 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let lookup = self.eval_node_cv(&args[0]).await?;

        // Evaluate match_type BEFORE materializing the array
        let match_type = if args.len() > 2 {
            let mt_val = self.eval_node_cv(&args[2]).await?;
            if let CellValue::Error(e, _) = mt_val {
                return Ok(CellValue::Error(e, None));
            }
            if mt_val.is_null() {
                1
            } else {
                match mt_val.coerce_to_number() {
                    Ok(n) => n as i32,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                }
            }
        } else {
            1
        };

        // --- Array-lifting: when lookup is an array, map element-wise ---
        if let CellValue::Array(lookup_arr) = &lookup {
            let arr = self.eval_node_cv(&args[1]).await?;
            let flat = match arr {
                CellValue::Array(rows) => {
                    let mut v = Vec::new();
                    if rows.rows() == 1 {
                        v.extend(rows.row(0).iter().cloned());
                    } else {
                        for row_slice in rows.rows_iter() {
                            if let Some(val) = row_slice.first() {
                                v.push(val.clone());
                            }
                        }
                    }
                    v
                }
                other => vec![other],
            };
            let result_data: Vec<CellValue> = lookup_arr
                .iter()
                .map(|elem| match elem {
                    CellValue::Error(e, _) => CellValue::Error(*e, None),
                    _ => match_scalar_in_flat(elem, &flat, match_type),
                })
                .collect();
            return Ok(CellValue::array(result_data, lookup_arr.cols()));
        }

        // Scalar error check (after array branch — errors are not arrays)
        if let CellValue::Error(e, _) = lookup {
            return Ok(CellValue::Error(e, None));
        }
        // ---- Indexed fast path for single-column ranges ----
        if let Some((sheet, col, start_row, end_row)) =
            try_extract_single_col_range(&args[1], self.meta)
        {
            let search_result = if match_type == 0 && has_wildcard_chars(&lookup) {
                match lookup.coerce_to_string() {
                    Ok(pat) => self.meta.indexed_column_wildcard_search(&sheet, col, &pat),
                    Err(_) => IndexedLookupResult::NotAvailable,
                }
            } else {
                self.meta
                    .indexed_column_search(&sheet, col, &lookup, match_type)
            };

            match search_result {
                IndexedLookupResult::Found(row) => {
                    if row >= start_row && row <= end_row {
                        let position = (row - start_row + 1) as f64;
                        return Ok(CellValue::number(position));
                    }
                    // Row outside range -- fall through
                }
                IndexedLookupResult::NotFound => {
                    return Ok(CellValue::Error(CellError::Na, None));
                }
                IndexedLookupResult::NotAvailable => {}
            }
        }

        // ---- Materialization path (original) ----
        let arr = self.eval_node_cv(&args[1]).await?;
        let flat = match arr {
            CellValue::Array(rows) => {
                let mut v = Vec::new();
                // MATCH works on a 1D vector (single row or single column)
                if rows.rows() == 1 {
                    v.extend(rows.row(0).iter().cloned());
                } else {
                    for row_slice in rows.rows_iter() {
                        if let Some(val) = row_slice.first() {
                            v.push(val.clone());
                        }
                    }
                }
                v
            }
            other => vec![other],
        };

        Ok(match_scalar_in_flat(&lookup, &flat, match_type))
    }

    // -----------------------------------------------------------------------
    // XMATCH — evaluator-level fast path
    // -----------------------------------------------------------------------

    /// Evaluate XMATCH(lookup_value, lookup_array, [match_mode], [search_mode]).
    ///
    /// Uses `indexed_column_search` for single-column ranges with compatible
    /// match/search modes. Falls back to the `FunctionRegistry` PureFunction
    /// implementation for other cases.
    pub(in crate::eval) async fn eval_xmatch(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() < 2 || args.len() > 4 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let lookup = self.eval_node_cv(&args[0]).await?;
        if let CellValue::Error(e, _) = lookup {
            return Ok(CellValue::Error(e, None));
        }

        // Evaluate match_mode (arg[2], default 0) and search_mode (arg[3], default 1)
        let match_mode = if args.len() > 2 && !matches!(args[2], ASTNode::Omitted) {
            let v = self.eval_node_cv(&args[2]).await?;
            if let CellValue::Error(e, _) = v {
                return Ok(CellValue::Error(e, None));
            }
            if v.is_null() {
                0i32
            } else {
                match v.coerce_to_number() {
                    Ok(n) => n as i32,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                }
            }
        } else {
            0
        };

        let search_mode = if args.len() > 3 && !matches!(args[3], ASTNode::Omitted) {
            let v = self.eval_node_cv(&args[3]).await?;
            if let CellValue::Error(e, _) = v {
                return Ok(CellValue::Error(e, None));
            }
            if v.is_null() {
                1i32
            } else {
                match v.coerce_to_number() {
                    Ok(n) => n as i32,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                }
            }
        } else {
            1
        };

        // Validate
        if !matches!(search_mode, 1 | -1 | 2 | -2) {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        if !matches!(match_mode, -1..=2) {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        // Indexed fast path for single-column ranges with search_mode ±1
        if matches!(search_mode, 1 | -1)
            && let Some((sheet, col, start_row, end_row)) =
                try_extract_single_col_range(&args[1], self.meta)
        {
            // Map XMATCH match_mode → indexed_column_search match_mode:
            //   XMATCH  0 (exact)         → indexed 0
            //   XMATCH -1 (next smaller)  → indexed 1 (leq)
            //   XMATCH  1 (next larger)   → indexed -1 (geq)
            //   XMATCH  2 (wildcard)      → wildcard search
            let search_result =
                if match_mode == 2 || (match_mode == 0 && has_wildcard_chars(&lookup)) {
                    match lookup.coerce_to_string() {
                        Ok(pat) => self.meta.indexed_column_wildcard_search(&sheet, col, &pat),
                        Err(_) => IndexedLookupResult::NotAvailable,
                    }
                } else {
                    let indexed_mode = match match_mode {
                        0 => 0,  // exact
                        -1 => 1, // next smaller → leq
                        1 => -1, // next larger → geq
                        _ => 0,
                    };
                    self.meta
                        .indexed_column_search(&sheet, col, &lookup, indexed_mode)
                };

            match search_result {
                IndexedLookupResult::Found(row) => {
                    if row >= start_row && row <= end_row {
                        let position = (row - start_row + 1) as f64;
                        return Ok(CellValue::number(position));
                    }
                    // Row outside range — fall through
                }
                IndexedLookupResult::NotFound => {
                    return Ok(CellValue::Error(CellError::Na, None));
                }
                IndexedLookupResult::NotAvailable => {}
            }
        }

        // Fallback: evaluate args and delegate to the FunctionRegistry pure function
        let mut evaluated_args = Vec::with_capacity(args.len());
        evaluated_args.push(lookup);
        evaluated_args.push(self.eval_node_cv(&args[1]).await?);
        if args.len() > 2 {
            evaluated_args.push(CellValue::number(match_mode as f64));
        }
        if args.len() > 3 {
            evaluated_args.push(CellValue::number(search_mode as f64));
        }
        Ok(super::super::GLOBAL_REGISTRY.call("XMATCH", &evaluated_args))
    }

    // -----------------------------------------------------------------------
    // VLOOKUP
    // -----------------------------------------------------------------------
    pub(in crate::eval) async fn eval_vlookup(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() < 3 || args.len() > 4 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let lookup = self.eval_node_cv(&args[0]).await?;
        if let CellValue::Error(e, _) = lookup {
            return Ok(CellValue::Error(e, None));
        }

        // Evaluate col_idx and exact BEFORE materializing the table,
        // so we can attempt the indexed fast path first.
        let col_v = self.eval_node_cv(&args[2]).await?;
        if let CellValue::Error(e, _) = col_v {
            return Ok(CellValue::Error(e, None));
        }
        let col_idx = match col_v.coerce_to_number() {
            Ok(n) if n < 1.0 => return Ok(CellValue::Error(CellError::Value, None)),
            Ok(n) => n as usize - 1,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };
        let exact = if args.len() > 3 {
            let v = self.eval_node_cv(&args[3]).await?;
            if let CellValue::Error(e, _) = v {
                return Ok(CellValue::Error(e, None));
            }
            if v.is_null() {
                false
            } else {
                match v.coerce_to_bool() {
                    Ok(b) => !b,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                }
            }
        } else {
            false
        };

        // --- Array-lifting: when lookup is an array, map element-wise ---
        if let CellValue::Array(lookup_arr) = &lookup {
            // Reject 2D arrays
            if lookup_arr.rows() > 1 && lookup_arr.cols() > 1 {
                return Ok(CellValue::Error(CellError::Value, None));
            }

            // Materialize the table once
            let table = self.eval_node_cv(&args[1]).await?;
            let rows = match table {
                CellValue::Array(r) => r,
                CellValue::Error(e, _) => return Ok(CellValue::Error(e, None)),
                _ => return Ok(CellValue::Error(CellError::Value, None)),
            };

            let result_data: Vec<CellValue> = lookup_arr
                .iter()
                .map(|elem| {
                    match elem {
                        CellValue::Error(e, _) => CellValue::Error(*e, None),
                        _ => {
                            // Null lookup with approximate match → #N/A
                            if !exact && elem.is_null() {
                                return CellValue::Error(CellError::Na, None);
                            }
                            vlookup_scalar_in_table(elem, &rows, col_idx, exact)
                        }
                    }
                })
                .collect();
            return Ok(CellValue::array(result_data, lookup_arr.cols()));
        }

        // Null (empty cell) lookup with approximate match → #N/A.
        // Excel does not match blank against sorted data (exact match CAN find blanks).
        if !exact && lookup.is_null() {
            return Ok(CellValue::Error(CellError::Na, None));
        }

        // ---- Indexed fast path: O(log n) search on cached column index ----
        if let Some((sheet, start_row, end_row, start_col, end_col)) =
            extract_range_bounds(&args[1], self.meta)
        {
            let lookup_col = start_col;
            let result_col_abs = start_col + col_idx as u32;

            if result_col_abs > end_col {
                return Ok(CellValue::Error(CellError::Ref, None));
            }

            let search_result = if exact {
                if has_wildcard_chars(&lookup) {
                    match lookup.coerce_to_string() {
                        Ok(pat) => self
                            .meta
                            .indexed_column_wildcard_search(&sheet, lookup_col, &pat),
                        Err(_) => IndexedLookupResult::NotAvailable,
                    }
                } else {
                    self.meta
                        .indexed_column_search(&sheet, lookup_col, &lookup, 0)
                }
            } else {
                self.meta
                    .indexed_column_search(&sheet, lookup_col, &lookup, 1)
            };

            match search_result {
                IndexedLookupResult::Found(row) => {
                    if row >= start_row && row <= end_row {
                        let cell_ref = CellRef::Positional {
                            sheet,
                            row,
                            col: result_col_abs,
                        };
                        return Ok(self.data.get_cell_value_by_ref(&cell_ref).await);
                    }
                    // Row outside range -- fall through
                }
                IndexedLookupResult::NotFound => {
                    return Ok(CellValue::Error(CellError::Na, None));
                }
                IndexedLookupResult::NotAvailable => {}
            }
        }

        // ---- Materialization path (original) ----
        let table = self.eval_node_cv(&args[1]).await?;
        let rows = match table {
            CellValue::Array(r) => r,
            CellValue::Error(e, _) => return Ok(CellValue::Error(e, None)),
            _ => return Ok(CellValue::Error(CellError::Value, None)),
        };

        Ok(vlookup_scalar_in_table(&lookup, &rows, col_idx, exact))
    }
    // -----------------------------------------------------------------------
    // HLOOKUP
    // -----------------------------------------------------------------------
    pub(in crate::eval) async fn eval_hlookup(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() < 3 || args.len() > 4 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let lookup = self.eval_node_cv(&args[0]).await?;
        if let CellValue::Error(e, _) = lookup {
            return Ok(CellValue::Error(e, None));
        }

        // Evaluate row_idx and exact BEFORE materializing the table,
        // so we can attempt the indexed fast path first.
        let row_v = self.eval_node_cv(&args[2]).await?;
        if let CellValue::Error(e, _) = row_v {
            return Ok(CellValue::Error(e, None));
        }
        let row_idx = match row_v.coerce_to_number() {
            Ok(n) if n < 1.0 => return Ok(CellValue::Error(CellError::Value, None)),
            Ok(n) => n as usize - 1,
            Err(e) => return Ok(CellValue::Error(e, None)),
        };
        let exact = if args.len() > 3 {
            let v = self.eval_node_cv(&args[3]).await?;
            if let CellValue::Error(e, _) = v {
                return Ok(CellValue::Error(e, None));
            }
            if v.is_null() {
                false // default approximate match (range_lookup = TRUE → exact = false)
            } else {
                match v.coerce_to_bool() {
                    Ok(b) => !b,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                }
            }
        } else {
            false
        };

        // --- Array-lifting: when lookup is an array, map element-wise ---
        if let CellValue::Array(lookup_arr) = &lookup {
            // Reject 2D arrays
            if lookup_arr.rows() > 1 && lookup_arr.cols() > 1 {
                return Ok(CellValue::Error(CellError::Value, None));
            }

            // Materialize the table once
            let table = self.eval_node_cv(&args[1]).await?;
            let rows = match table {
                CellValue::Array(r) => r,
                CellValue::Error(e, _) => return Ok(CellValue::Error(e, None)),
                _ => return Ok(CellValue::Error(CellError::Value, None)),
            };

            let result_data: Vec<CellValue> = lookup_arr
                .iter()
                .map(|elem| {
                    match elem {
                        CellValue::Error(e, _) => CellValue::Error(*e, None),
                        _ => {
                            // Null lookup with approximate match → #N/A
                            if !exact && elem.is_null() {
                                return CellValue::Error(CellError::Na, None);
                            }
                            hlookup_scalar_in_table(elem, &rows, row_idx, exact)
                        }
                    }
                })
                .collect();
            return Ok(CellValue::array(result_data, lookup_arr.cols()));
        }

        // Null (empty cell) lookup with approximate match → #N/A (same as Excel).
        if !exact && lookup.is_null() {
            return Ok(CellValue::Error(CellError::Na, None));
        }

        // === Single-row range fast path for HLOOKUP ===
        // When the table argument is a single-row range, use try_extract_single_row_range
        // to validate the shape and avoid the general range bounds extraction.
        if row_idx == 0
            && let Some((sheet, row, start_col, end_col)) =
                try_extract_single_row_range(&args[1], self.meta)
        {
            // Single-row table with row_index=1 — scan the row directly.
            let mut first_row_values: Vec<(u32, CellValue)> = Vec::new();
            for c in start_col..=end_col {
                if let Some(col_vals) = self.meta.get_column_values(&sheet, c) {
                    let val = col_vals
                        .get(row as usize)
                        .cloned()
                        .unwrap_or(CellValue::Null);
                    if !val.is_null() {
                        first_row_values.push((c, val));
                    }
                } else {
                    first_row_values.clear();
                    break;
                }
            }
            if !first_row_values.is_empty() {
                use super::index::HorizontalLookupIndex;
                let h_idx = HorizontalLookupIndex::build(first_row_values.into_iter());
                let found_col = if exact {
                    match &lookup {
                        CellValue::Number(n) => h_idx.search_exact_numeric(n.get()),
                        CellValue::Text(s) => h_idx.search_exact_text(s),
                        _ => None,
                    }
                } else {
                    match &lookup {
                        CellValue::Number(n) => h_idx.search_leq_numeric(n.get()),
                        CellValue::Text(s) => h_idx.search_leq_text(s),
                        _ => None,
                    }
                };
                match found_col {
                    Some(col) if col >= start_col && col <= end_col => {
                        let cell_ref = CellRef::Positional { sheet, row, col };
                        return Ok(self.data.get_cell_value_by_ref(&cell_ref).await);
                    }
                    Some(_) => { /* col outside range — fall through */ }
                    None => return Ok(CellValue::Error(CellError::Na, None)),
                }
            }
        }

        // === Indexed fast path for HLOOKUP ===
        // When the table argument is a range reference, build a HorizontalLookupIndex
        // from the first row's column data and use O(log n) search.
        if let Some((sheet, start_row, end_row, start_col, end_col)) =
            extract_range_bounds(&args[1], self.meta)
        {
            let result_row_abs = start_row + row_idx as u32;
            if result_row_abs > end_row {
                return Ok(CellValue::Error(CellError::Ref, None));
            }

            // Get first row values across all columns in the range
            let lookup_row = start_row;
            let mut first_row_values: Vec<(u32, CellValue)> = Vec::new();
            for c in start_col..=end_col {
                if let Some(col_vals) = self.meta.get_column_values(&sheet, c) {
                    let val = col_vals
                        .get(lookup_row as usize)
                        .cloned()
                        .unwrap_or(CellValue::Null);
                    if !val.is_null() {
                        first_row_values.push((c, val));
                    }
                } else {
                    // Column data not available — fall through to materialization
                    first_row_values.clear();
                    break;
                }
            }

            if !first_row_values.is_empty() {
                use super::index::HorizontalLookupIndex;
                let h_idx = HorizontalLookupIndex::build(first_row_values.into_iter());

                let found_col = if exact {
                    // Exact match
                    match &lookup {
                        CellValue::Number(n) => h_idx.search_exact_numeric(n.get()),
                        CellValue::Text(s) => h_idx.search_exact_text(s),
                        _ => None,
                    }
                } else {
                    // Approximate match (largest <= target)
                    match &lookup {
                        CellValue::Number(n) => h_idx.search_leq_numeric(n.get()),
                        CellValue::Text(s) => h_idx.search_leq_text(s),
                        _ => None,
                    }
                };

                match found_col {
                    Some(col) if col >= start_col && col <= end_col => {
                        let cell_ref = CellRef::Positional {
                            sheet,
                            row: result_row_abs,
                            col,
                        };
                        return Ok(self.data.get_cell_value_by_ref(&cell_ref).await);
                    }
                    Some(_) => { /* col outside range — fall through */ }
                    None => {
                        return Ok(CellValue::Error(CellError::Na, None));
                    }
                }
            }
        }

        // ---- Materialization path (original) ----
        let table = self.eval_node_cv(&args[1]).await?;
        let rows = match table {
            CellValue::Array(r) => r,
            CellValue::Error(e, _) => return Ok(CellValue::Error(e, None)),
            _ => return Ok(CellValue::Error(CellError::Value, None)),
        };

        Ok(hlookup_scalar_in_table(&lookup, &rows, row_idx, exact))
    }

    // -----------------------------------------------------------------------
    // XLOOKUP
    // -----------------------------------------------------------------------

    /// Evaluate XLOOKUP(lookup_value, lookup_array, return_array,
    ///                   [if_not_found], [match_mode], [search_mode]).
    ///
    /// Uses an indexed fast path when the lookup_array is a single-column range
    /// with a compatible match/search mode, falling through to the materialization
    /// path (equivalent to the PureFunction logic) otherwise.
    pub(in crate::eval) async fn eval_xlookup(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() < 3 || args.len() > 6 {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        // 1. Evaluate lookup_value
        let lookup = self.eval_node_cv(&args[0]).await?;
        if let CellValue::Error(e, _) = lookup {
            return Ok(CellValue::Error(e, None));
        }

        // 2. Evaluate match_mode (arg[4], default 0) and search_mode (arg[5], default 1)
        //    BEFORE materializing lookup_array, so we can try the indexed path.
        let match_mode = if args.len() > 4 && !matches!(args[4], ASTNode::Omitted) {
            let v = self.eval_node_cv(&args[4]).await?;
            if let CellValue::Error(e, _) = v {
                return Ok(CellValue::Error(e, None));
            }
            if v.is_null() {
                0i32
            } else {
                match v.coerce_to_number() {
                    Ok(n) => n as i32,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                }
            }
        } else {
            0
        };

        let search_mode = if args.len() > 5 && !matches!(args[5], ASTNode::Omitted) {
            let v = self.eval_node_cv(&args[5]).await?;
            if let CellValue::Error(e, _) = v {
                return Ok(CellValue::Error(e, None));
            }
            if v.is_null() {
                1i32
            } else {
                match v.coerce_to_number() {
                    Ok(n) => n as i32,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                }
            }
        } else {
            1
        };

        // Validate search_mode early
        if !matches!(search_mode, 1 | -1 | 2 | -2) {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        // Validate match_mode early
        if !matches!(match_mode, -1..=2) {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        // --- Array lookup: map element-wise ---
        if let CellValue::Array(lookup_arr_inner) = &lookup {
            // Reject 2D lookup arrays
            if lookup_arr_inner.rows() > 1 && lookup_arr_inner.cols() > 1 {
                return Ok(CellValue::Error(CellError::Value, None));
            }

            // For exact/next-smaller/next-larger match + linear search, try indexed path per element
            let use_indexed = matches!(match_mode, -1..=1) && matches!(search_mode, 1 | -1);

            if use_indexed
                && let Some((sheet, col, start_row, end_row)) =
                    try_extract_single_col_range(&args[1], self.meta)
            {
                let n = lookup_arr_inner.len();
                let mut results: Vec<CellValue> = Vec::with_capacity(n);
                let mut has_na = false;
                let mut all_indexed = true;

                for i in 0..n {
                    let elem = lookup_arr_inner
                        .data()
                        .get(i)
                        .cloned()
                        .unwrap_or(CellValue::Null);

                    let indexed_mode = match match_mode {
                        0 => 0,  // exact
                        -1 => 1, // next smaller -> leq
                        1 => -1, // next larger -> geq
                        _ => 0,
                    };

                    // Handle wildcard separately
                    let search_result = if match_mode == 2
                        || (match_mode == 0 && has_wildcard_chars(&elem))
                    {
                        match elem.coerce_to_string() {
                            Ok(pat) => self.meta.indexed_column_wildcard_search(&sheet, col, &pat),
                            Err(_) => IndexedLookupResult::NotAvailable,
                        }
                    } else {
                        self.meta
                            .indexed_column_search(&sheet, col, &elem, indexed_mode)
                    };

                    match search_result {
                        IndexedLookupResult::Found(row) if row >= start_row && row <= end_row => {
                            // Fetch return value
                            let return_val = if let Some((ret_sheet, ret_col, ret_start, ret_end)) =
                                try_extract_single_col_range(&args[2], self.meta)
                            {
                                let ret_row = ret_start + (row - start_row);
                                if ret_row <= ret_end {
                                    if let Some(col_vals) =
                                        self.meta.get_column_values(&ret_sheet, ret_col)
                                    {
                                        col_vals
                                            .get(ret_row as usize)
                                            .cloned()
                                            .unwrap_or(CellValue::Null)
                                    } else {
                                        // Fall back to materialization
                                        all_indexed = false;
                                        break;
                                    }
                                } else {
                                    CellValue::Error(CellError::Ref, None)
                                }
                            } else {
                                // Non-single-column return range -- need materialization
                                all_indexed = false;
                                break;
                            };
                            results.push(return_val);
                        }
                        IndexedLookupResult::Found(_) => {
                            // Row outside range
                            all_indexed = false;
                            break;
                        }
                        IndexedLookupResult::NotFound => {
                            if elem.is_null() && is_whole_range(&args[1]) {
                                results.push(CellValue::Null);
                            } else {
                                has_na = true;
                                results.push(CellValue::Error(CellError::Na, None));
                            }
                        }
                        IndexedLookupResult::NotAvailable => {
                            all_indexed = false;
                            break;
                        }
                    }
                }

                if all_indexed {
                    // Lazy if_not_found
                    if has_na && args.len() > 3 && !matches!(args[3], ASTNode::Omitted) {
                        let nf = self.eval_node_cv(&args[3]).await?;
                        for v in results.iter_mut() {
                            if matches!(v, CellValue::Error(CellError::Na, _)) {
                                *v = nf.clone();
                            }
                        }
                    }
                    return Ok(CellValue::array(results, lookup_arr_inner.cols()));
                }
                // If not all_indexed, fall through to materialization path below
            }

            // Materialization fallback for array lookup
            let lookup_arr_val = self.eval_node_cv(&args[1]).await?;
            if let CellValue::Error(e, _) = lookup_arr_val {
                return Ok(CellValue::Error(e, None));
            }
            let return_arr = self.eval_node_cv(&args[2]).await?;

            let lookup_flat = match &lookup_arr_val {
                CellValue::Array(arr) => arr.iter().cloned().collect::<Vec<_>>(),
                other => vec![other.clone()],
            };

            let return_cols = match &return_arr {
                CellValue::Array(arr) => arr.cols(),
                _ => 1,
            };

            let n = lookup_arr_inner.len();
            let mut results: Vec<CellValue> = Vec::with_capacity(n * return_cols);
            let mut has_na = false;

            for i in 0..n {
                let elem = lookup_arr_inner
                    .data()
                    .get(i)
                    .cloned()
                    .unwrap_or(CellValue::Null);
                match xlookup_match_in_materialized(&elem, &lookup_flat, match_mode, search_mode) {
                    Some(idx) => {
                        let row_result = get_return_value(&return_arr, idx);
                        match row_result {
                            CellValue::Array(arr) => results.extend(arr.iter().cloned()),
                            scalar => results.push(scalar),
                        }
                    }
                    None => {
                        has_na = true;
                        if return_cols > 1 {
                            results.extend(std::iter::repeat_n(
                                CellValue::Error(CellError::Na, None),
                                return_cols,
                            ));
                        } else {
                            results.push(CellValue::Error(CellError::Na, None));
                        }
                    }
                }
            }

            // Lazy if_not_found
            if has_na && args.len() > 3 && !matches!(args[3], ASTNode::Omitted) {
                let nf = self.eval_node_cv(&args[3]).await?;
                for v in results.iter_mut() {
                    if matches!(v, CellValue::Error(CellError::Na, _)) {
                        *v = nf.clone();
                    }
                }
            }

            // Preserve the lookup array's shape for single-column returns;
            // for multi-column returns, each element maps to a row of return_cols.
            let out_cols = if return_cols > 1 {
                return_cols
            } else {
                lookup_arr_inner.cols()
            };
            return Ok(CellValue::array(results, out_cols));
        }

        // 3. Indexed fast path for single-column lookup ranges with
        //    search_mode ±1 (linear — the index handles it).
        //    Binary search modes (±2) are not supported by the column index.
        if matches!(search_mode, 1 | -1)
            && let Some((sheet, col, start_row, end_row)) =
                try_extract_single_col_range(&args[1], self.meta)
        {
            // Map XLOOKUP match_mode → indexed_column_search match_mode:
            //   XLOOKUP  0 (exact)        → indexed 0
            //   XLOOKUP -1 (next smaller)  → indexed 1 (leq / largest <=)
            //   XLOOKUP  1 (next larger)   → indexed -1 (geq / smallest >=)
            //   XLOOKUP  2 (wildcard)      → indexed_column_wildcard_search
            let search_result = if match_mode == 2 {
                match lookup.coerce_to_string() {
                    Ok(pat) => self.meta.indexed_column_wildcard_search(&sheet, col, &pat),
                    Err(_) => IndexedLookupResult::NotAvailable,
                }
            } else if match_mode == 0 && has_wildcard_chars(&lookup) {
                // Exact match with wildcard characters in lookup value
                match lookup.coerce_to_string() {
                    Ok(pat) => self.meta.indexed_column_wildcard_search(&sheet, col, &pat),
                    Err(_) => IndexedLookupResult::NotAvailable,
                }
            } else {
                let indexed_mode = match match_mode {
                    0 => 0,  // exact
                    -1 => 1, // next smaller → leq
                    1 => -1, // next larger → geq
                    _ => 0,  // unreachable due to validation above
                };
                self.meta
                    .indexed_column_search(&sheet, col, &lookup, indexed_mode)
            };

            match search_result {
                IndexedLookupResult::Found(row) => {
                    if row >= start_row && row <= end_row {
                        // Try direct cell fetch for single-column return ranges
                        if let Some((ret_sheet, ret_col, ret_start, ret_end)) =
                            try_extract_single_col_range(&args[2], self.meta)
                        {
                            let ret_row = ret_start + (row - start_row);
                            if ret_row <= ret_end
                                && let Some(col_vals) =
                                    self.meta.get_column_values(&ret_sheet, ret_col)
                            {
                                let val = col_vals
                                    .get(ret_row as usize)
                                    .cloned()
                                    .unwrap_or(CellValue::Null);
                                return Ok(val);
                            }
                        }
                        // Fallback: materialize return array (non-column return ranges,
                        // or when get_column_values returns None for non-dense columns)
                        let return_arr = self.eval_node_cv(&args[2]).await?;
                        if let CellValue::Error(e, _) = return_arr {
                            return Ok(CellValue::Error(e, None));
                        }
                        return Ok(get_return_value(&return_arr, (row - start_row) as usize));
                    }
                    // Row outside range — fall through to materialization
                }
                IndexedLookupResult::NotFound => {
                    // Whole-column/row references are clamped to sheet.rows,
                    // so trailing empties beyond the data extent are lost.
                    // When the lookup value is Null (empty cell), Excel would
                    // match a trailing empty.  Return Null to simulate that.
                    if lookup.is_null() && is_whole_range(&args[1]) {
                        return Ok(CellValue::Null);
                    }
                    // Return if_not_found or #N/A
                    if args.len() > 3 && !matches!(args[3], ASTNode::Omitted) {
                        let nf = self.eval_node_cv(&args[3]).await?;
                        return Ok(nf);
                    }
                    return Ok(CellValue::Error(CellError::Na, None));
                }
                IndexedLookupResult::NotAvailable => {
                    // Fall through to materialization path
                }
            }
        }

        // 4. Materialization fallback — evaluate lookup_array and return_array,
        //    then run the same linear/binary search as the PureFunction.
        let lookup_arr_val = self.eval_node_cv(&args[1]).await?;
        if let CellValue::Error(e, _) = lookup_arr_val {
            return Ok(CellValue::Error(e, None));
        }
        let return_arr = self.eval_node_cv(&args[2]).await?;
        // Note: return_arr errors are checked at extraction time

        // Flatten lookup_array to a 1D vector
        let lookup_arr = match &lookup_arr_val {
            CellValue::Array(arr) => arr.iter().cloned().collect::<Vec<_>>(),
            other => vec![other.clone()],
        };

        // Find match using the extracted helper
        let match_idx =
            xlookup_match_in_materialized(&lookup, &lookup_arr, match_mode, search_mode);

        match match_idx {
            Some(idx) => Ok(get_return_value(&return_arr, idx)),
            None => {
                // Whole-column/row references are clamped to sheet.rows,
                // so trailing empties beyond the data extent are lost.
                // When the lookup value is Null (empty cell), Excel would
                // match a trailing empty.  Return Null to simulate that.
                if lookup.is_null() && is_whole_range(&args[1]) {
                    return Ok(CellValue::Null);
                }
                if args.len() > 3 && !matches!(args[3], ASTNode::Omitted) {
                    let nf = self.eval_node_cv(&args[3]).await?;
                    Ok(nf)
                } else {
                    Ok(CellValue::Error(CellError::Na, None))
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // OFFSET
    // -----------------------------------------------------------------------

    /// Evaluate OFFSET(reference, rows, cols, [height], [width]).
    ///
    /// OFFSET is a special form because its first argument must be a cell or
    /// range reference (AST node), not a pre-evaluated value. It offsets the
    /// base reference by the given rows/cols and optionally resizes the result.
    ///
    /// - If height and width are both 1 (or omitted for a single cell), returns
    ///   the scalar value at the offset position.
    /// - If height or width > 1, returns a `CellValue::Array`.
    /// - Returns `#REF!` if the offset goes out of bounds (negative row/col).
    pub(in crate::eval) async fn eval_offset(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() < 3 || args.len() > 5 {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        // --- Extract base reference position from the first argument (AST) ---
        let arg0 = match &args[0] {
            ASTNode::SheetRef { inner, .. } => inner.as_ref(),
            other => other,
        };

        let (base_sheet, base_row, base_col, base_height, base_width) = match arg0 {
            ASTNode::CellReference(CellRefNode { reference, .. }) => {
                let (sheet, row, col) =
                    resolve_cellref(reference, self.meta).ok_or_else(|| ComputeError::Eval {
                        message: "OFFSET: cannot resolve base reference".into(),
                    })?;
                (sheet, row as i64, col as i64, 1i64, 1i64)
            }
            ASTNode::Range(RangeRef { start, end, .. }) => {
                let (s_sheet, s_row, s_col) =
                    resolve_cellref(start, self.meta).ok_or_else(|| ComputeError::Eval {
                        message: "OFFSET: cannot resolve range start".into(),
                    })?;
                let (e_sheet, e_row, e_col) =
                    resolve_cellref(end, self.meta).ok_or_else(|| ComputeError::Eval {
                        message: "OFFSET: cannot resolve range end".into(),
                    })?;
                if s_sheet != e_sheet {
                    return Ok(CellValue::Error(CellError::Ref, None));
                }
                let min_row = s_row.min(e_row) as i64;
                let min_col = s_col.min(e_col) as i64;
                let h = (s_row.max(e_row) as i64 - min_row) + 1;
                let w = (s_col.max(e_col) as i64 - min_col) + 1;
                (s_sheet, min_row, min_col, h, w)
            }
            _ => {
                return Ok(CellValue::Error(CellError::Ref, None));
            }
        };

        // --- Evaluate numeric arguments ---
        let rows_offset = {
            let v = self.eval_node_cv(&args[1]).await?;
            if let CellValue::Error(e, _) = v {
                return Ok(CellValue::Error(e, None));
            }
            match v.coerce_to_number() {
                Ok(n) => n as i64,
                Err(e) => return Ok(CellValue::Error(e, None)),
            }
        };
        let cols_offset = {
            let v = self.eval_node_cv(&args[2]).await?;
            if let CellValue::Error(e, _) = v {
                return Ok(CellValue::Error(e, None));
            }
            match v.coerce_to_number() {
                Ok(n) => n as i64,
                Err(e) => return Ok(CellValue::Error(e, None)),
            }
        };

        // Height: if omitted, use the base reference's height
        let height = if args.len() > 3 {
            if matches!(args[3], ASTNode::Omitted) {
                base_height
            } else {
                let v = self.eval_node_cv(&args[3]).await?;
                if let CellValue::Error(e, _) = v {
                    return Ok(CellValue::Error(e, None));
                }
                match v.coerce_to_number() {
                    Ok(n) => {
                        let h = n as i64;
                        if h == 0 {
                            return Ok(CellValue::Error(CellError::Ref, None));
                        }
                        h
                    }
                    Err(e) => return Ok(CellValue::Error(e, None)),
                }
            }
        } else {
            base_height
        };

        // Width: if omitted, use the base reference's width
        let width = if args.len() > 4 {
            if matches!(args[4], ASTNode::Omitted) {
                base_width
            } else {
                let v = self.eval_node_cv(&args[4]).await?;
                if let CellValue::Error(e, _) = v {
                    return Ok(CellValue::Error(e, None));
                }
                match v.coerce_to_number() {
                    Ok(n) => {
                        let w = n as i64;
                        if w == 0 {
                            return Ok(CellValue::Error(CellError::Ref, None));
                        }
                        w
                    }
                    Err(e) => return Ok(CellValue::Error(e, None)),
                }
            }
        } else {
            base_width
        };

        // --- Compute the result region ---
        let new_row = base_row + rows_offset;
        let new_col = base_col + cols_offset;

        // Negative height/width means the range extends upward/leftward
        let (start_row, end_row) = if height > 0 {
            (new_row, new_row + height - 1)
        } else {
            (new_row + height + 1, new_row)
        };
        let (start_col, end_col) = if width > 0 {
            (new_col, new_col + width - 1)
        } else {
            (new_col + width + 1, new_col)
        };

        // Bounds check
        if start_row < 0 || start_col < 0 || end_row < 0 || end_col < 0 {
            return Ok(CellValue::Error(CellError::Ref, None));
        }

        let start_row = start_row as u32;
        let start_col = start_col as u32;
        let end_row = end_row as u32;
        let end_col = end_col as u32;

        // --- Fetch values ---
        if start_row == end_row && start_col == end_col {
            // Single cell
            let cell_ref = CellRef::Positional {
                sheet: base_sheet,
                row: start_row,
                col: start_col,
            };
            Ok(self.data.get_cell_value_by_ref(&cell_ref).await)
        } else {
            // Range
            let start_ref = CellRef::Positional {
                sheet: base_sheet,
                row: start_row,
                col: start_col,
            };
            let end_ref = CellRef::Positional {
                sheet: base_sheet,
                row: end_row,
                col: end_col,
            };
            match self
                .data
                .get_range_values(&start_ref, &end_ref, &RangeType::CellRange)
                .await
            {
                Ok(arr) => Ok(CellValue::Array(arr)),
                Err(e) => Ok(CellValue::Error(e, None)),
            }
        }
    }

    // -----------------------------------------------------------------------
    // OFFSET — reference area variant (for RangeOp)
    // -----------------------------------------------------------------------

    /// Evaluate `OFFSET(reference, rows, cols, [height], [width])` as a reference area.
    ///
    /// Returns the computed region `(sheet, start_row, start_col, end_row, end_col)`
    /// instead of fetching the cell values. Used by `RangeOp` to construct ranges
    /// like `OFFSET(A1,0,0,5):OFFSET(B1,0,0,5)`.
    pub(in crate::eval) async fn eval_offset_as_area(
        &mut self,
        args: &[ASTNode],
    ) -> Result<(SheetId, u32, u32, u32, u32), ComputeError> {
        if args.len() < 3 || args.len() > 5 {
            return Err(ComputeError::Eval {
                message: "OFFSET: expected 3-5 arguments".into(),
            });
        }

        // Extract base reference position from first argument (same as eval_offset)
        let arg0 = match &args[0] {
            ASTNode::SheetRef { inner, .. } => inner.as_ref(),
            other => other,
        };

        let (base_sheet, base_row, base_col, base_height, base_width) = match arg0 {
            ASTNode::CellReference(CellRefNode { reference, .. }) => {
                let (sheet, row, col) =
                    resolve_cellref(reference, self.meta).ok_or_else(|| ComputeError::Eval {
                        message: "OFFSET: cannot resolve base reference".into(),
                    })?;
                (sheet, row as i64, col as i64, 1i64, 1i64)
            }
            ASTNode::Range(RangeRef { start, end, .. }) => {
                let (s_sheet, s_row, s_col) =
                    resolve_cellref(start, self.meta).ok_or_else(|| ComputeError::Eval {
                        message: "OFFSET: cannot resolve range start".into(),
                    })?;
                let (e_sheet, e_row, e_col) =
                    resolve_cellref(end, self.meta).ok_or_else(|| ComputeError::Eval {
                        message: "OFFSET: cannot resolve range end".into(),
                    })?;
                if s_sheet != e_sheet {
                    return Err(ComputeError::Eval {
                        message: "OFFSET: cross-sheet range".into(),
                    });
                }
                let min_row = s_row.min(e_row) as i64;
                let min_col = s_col.min(e_col) as i64;
                let h = (s_row.max(e_row) as i64 - min_row) + 1;
                let w = (s_col.max(e_col) as i64 - min_col) + 1;
                (s_sheet, min_row, min_col, h, w)
            }
            _ => {
                return Err(ComputeError::Eval {
                    message: "OFFSET: first argument must be a reference".into(),
                });
            }
        };

        // Evaluate numeric arguments
        let rows_offset = {
            let v = self.eval_node_cv(&args[1]).await?;
            if let CellValue::Error(..) = v {
                return Err(ComputeError::Eval {
                    message: "OFFSET: error in rows".into(),
                });
            }
            v.coerce_to_number().map_err(|_| ComputeError::Eval {
                message: "OFFSET: rows not numeric".into(),
            })? as i64
        };
        let cols_offset = {
            let v = self.eval_node_cv(&args[2]).await?;
            if let CellValue::Error(..) = v {
                return Err(ComputeError::Eval {
                    message: "OFFSET: error in cols".into(),
                });
            }
            v.coerce_to_number().map_err(|_| ComputeError::Eval {
                message: "OFFSET: cols not numeric".into(),
            })? as i64
        };

        let height = if args.len() > 3 && !matches!(args[3], ASTNode::Omitted) {
            let v = self.eval_node_cv(&args[3]).await?;
            if let CellValue::Error(..) = v {
                return Err(ComputeError::Eval {
                    message: "OFFSET: error in height".into(),
                });
            }
            let h = v.coerce_to_number().map_err(|_| ComputeError::Eval {
                message: "OFFSET: height not numeric".into(),
            })? as i64;
            if h == 0 {
                return Err(ComputeError::Eval {
                    message: "OFFSET: height is zero".into(),
                });
            }
            h
        } else {
            base_height
        };

        let width = if args.len() > 4 && !matches!(args[4], ASTNode::Omitted) {
            let v = self.eval_node_cv(&args[4]).await?;
            if let CellValue::Error(..) = v {
                return Err(ComputeError::Eval {
                    message: "OFFSET: error in width".into(),
                });
            }
            let w = v.coerce_to_number().map_err(|_| ComputeError::Eval {
                message: "OFFSET: width not numeric".into(),
            })? as i64;
            if w == 0 {
                return Err(ComputeError::Eval {
                    message: "OFFSET: width is zero".into(),
                });
            }
            w
        } else {
            base_width
        };

        // Compute the result region
        let new_row = base_row + rows_offset;
        let new_col = base_col + cols_offset;

        let (start_row, end_row) = if height > 0 {
            (new_row, new_row + height - 1)
        } else {
            (new_row + height + 1, new_row)
        };
        let (start_col, end_col) = if width > 0 {
            (new_col, new_col + width - 1)
        } else {
            (new_col + width + 1, new_col)
        };

        if start_row < 0 || start_col < 0 || end_row < 0 || end_col < 0 {
            return Err(ComputeError::Eval {
                message: "OFFSET: out of bounds".into(),
            });
        }

        Ok((
            base_sheet,
            start_row as u32,
            start_col as u32,
            end_row as u32,
            end_col as u32,
        ))
    }
}

// -----------------------------------------------------------------------
// Free helper for XLOOKUP materialization-based match
// -----------------------------------------------------------------------

/// Find the index of the best match for `lookup_val` in `lookup_flat` using
/// the specified match_mode and search_mode.
/// Returns `Some(index)` or `None` (for #N/A).
fn xlookup_match_in_materialized(
    lookup_val: &CellValue,
    lookup_flat: &[CellValue],
    match_mode: i32,
    search_mode: i32,
) -> Option<usize> {
    // Build iteration order based on search_mode
    let indices: Vec<usize> = match search_mode {
        1 => (0..lookup_flat.len()).collect(),
        -1 => (0..lookup_flat.len()).rev().collect(),
        2 | -2 => (0..lookup_flat.len()).collect(), // binary search handled below
        _ => return None,
    };

    match match_mode {
        0 => {
            // Exact match
            if search_mode == 2 {
                crate::functions::lookup::helpers::binary_search_exact(
                    lookup_flat,
                    lookup_val,
                    true,
                )
            } else if search_mode == -2 {
                crate::functions::lookup::helpers::binary_search_exact(
                    lookup_flat,
                    lookup_val,
                    false,
                )
            } else {
                indices
                    .iter()
                    .find(|&&i| cell_value_eq_lookup(lookup_val, &lookup_flat[i]))
                    .copied()
            }
        }
        -1 => {
            // Exact match or next smaller
            if search_mode == 2 || search_mode == -2 {
                let ascending = search_mode == 2;
                crate::functions::lookup::helpers::binary_search_skip_errors(
                    lookup_flat,
                    lookup_val,
                    ascending,
                    crate::functions::lookup::helpers::SearchMode::NextSmaller,
                )
            } else {
                let mut best: Option<(usize, &CellValue)> = None;
                for &i in &indices {
                    let v = &lookup_flat[i];
                    if cell_value_eq_lookup(lookup_val, v) {
                        return Some(i);
                    }
                    if cell_value_cmp_for_lookup(lookup_val, v).is_some_and(|c| c > 0) {
                        // v < lookup_val
                        match best {
                            None => best = Some((i, v)),
                            Some((_, bv)) => {
                                if cell_value_cmp_for_lookup(v, bv).is_some_and(|c| c > 0) {
                                    best = Some((i, v));
                                }
                            }
                        }
                    }
                }
                best.map(|(i, _)| i)
            }
        }
        1 => {
            // Exact match or next larger
            if search_mode == 2 || search_mode == -2 {
                let ascending = search_mode == 2;
                crate::functions::lookup::helpers::binary_search_skip_errors(
                    lookup_flat,
                    lookup_val,
                    ascending,
                    crate::functions::lookup::helpers::SearchMode::NextLarger,
                )
            } else {
                let mut best: Option<(usize, &CellValue)> = None;
                for &i in &indices {
                    let v = &lookup_flat[i];
                    if cell_value_eq_lookup(lookup_val, v) {
                        return Some(i);
                    }
                    if cell_value_cmp_for_lookup(lookup_val, v).is_some_and(|c| c < 0) {
                        // v > lookup_val
                        match best {
                            None => best = Some((i, v)),
                            Some((_, bv)) => {
                                if cell_value_cmp_for_lookup(v, bv).is_some_and(|c| c < 0) {
                                    best = Some((i, v));
                                }
                            }
                        }
                    }
                }
                best.map(|(i, _)| i)
            }
        }
        2 => {
            // Wildcard match
            let pattern = match lookup_val.coerce_to_string() {
                Ok(s) => WildcardPattern::new(&s),
                Err(_) => return None,
            };
            indices
                .iter()
                .find(|&&i| match lookup_flat[i].coerce_to_string() {
                    Ok(s) => pattern.matches(&s),
                    Err(_) => false,
                })
                .copied()
        }
        _ => None,
    }
}
