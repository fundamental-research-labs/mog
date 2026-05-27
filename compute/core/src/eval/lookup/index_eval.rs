use cell_types::SheetId;
use compute_parser::ASTNode;
use formula_types::{CellRef, RangeType};
use value_types::{CellError, CellValue, ComputeError};

use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::engine::evaluator::Evaluator;

use super::primitives::{index_effective_position, index_scalar};

pub(in crate::eval) async fn eval_index<'a, D: EvalDataAccess, M: EvalMetadata>(
    evaluator: &mut Evaluator<'a, D, M>,
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
        evaluator.eval_node_as_area(&args[0]).await
    {
        let row_num = evaluator.eval_node_cv(&args[1]).await?;

        let has_col_arg = args.len() > 2 && !matches!(args[2], ASTNode::Omitted);
        let col_val = if has_col_arg {
            let c = evaluator.eval_node_cv(&args[2]).await?;
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
                            index_lazy_cell(
                                evaluator, sheet, range_sr, range_sc, range_er, range_ec, eff_row,
                                eff_col,
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
                                index_lazy_cell(
                                    evaluator, sheet, range_sr, range_sc, range_er, range_ec,
                                    eff_row, eff_col,
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
            return Ok(index_lazy_cell(
                evaluator, sheet, range_sr, range_sc, range_er, range_ec, eff_row, eff_col,
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
            return match evaluator
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
            return match evaluator
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
        return match evaluator
            .data
            .get_range_values(&start, &end, &RangeType::CellRange)
            .await
        {
            Ok(arr) => Ok(CellValue::Array(arr)),
            Err(e) => Ok(CellValue::Error(e, None)),
        };
    }

    // --- Eager fallback: non-reference args (computed arrays, literals, etc.) ---
    let arr = evaluator.eval_node_cv(&args[0]).await?;
    let row_num = evaluator.eval_node_cv(&args[1]).await?;

    // --- Array-lifting (eager) ---
    if let CellValue::Array(pos_arr) = &row_num {
        let source = match &arr {
            CellValue::Array(r) => r,
            CellValue::Error(e, _) => return Ok(CellValue::Error(*e, None)),
            _ => return Ok(CellValue::Error(CellError::Ref, None)),
        };
        let has_col_arg = args.len() > 2 && !matches!(args[2], ASTNode::Omitted);
        let col_val = if has_col_arg {
            let c = evaluator.eval_node_cv(&args[2]).await?;
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
        let c = evaluator.eval_node_cv(&args[2]).await?;
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
        CellValue::Array(arr_data) => Ok(index_scalar(&arr_data, row_idx, col_idx, has_col_arg)),
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

async fn index_lazy_cell<'a, D: EvalDataAccess, M: EvalMetadata>(
    evaluator: &mut Evaluator<'a, D, M>,
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
    evaluator.data.get_cell_value_by_ref(&ref_).await
}

pub(in crate::eval) async fn eval_index_as_area<'a, D: EvalDataAccess, M: EvalMetadata>(
    evaluator: &mut Evaluator<'a, D, M>,
    args: &[ASTNode],
) -> Result<(SheetId, u32, u32, u32, u32), ComputeError> {
    if args.len() < 2 || args.len() > 3 {
        return Err(ComputeError::Eval {
            message: "INDEX: expected 2-3 arguments".into(),
        });
    }

    // Get array reference area (supports Range, CellReference, SheetRef, etc.)
    let (sheet, range_sr, range_sc, range_er, range_ec) =
        evaluator.eval_node_as_area(&args[0]).await?;

    // Evaluate row_num
    let row_val = evaluator.eval_node_cv(&args[1]).await?;
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
        let col_val = evaluator.eval_node_cv(&args[2]).await?;
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
