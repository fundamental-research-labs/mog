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
                            index_reference_value(
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
                                index_reference_value(
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

        return Ok(index_reference_value(
            evaluator, sheet, range_sr, range_sc, range_er, range_ec, eff_row, eff_col,
        )
        .await);
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

async fn index_reference_value<'a, D: EvalDataAccess, M: EvalMetadata>(
    evaluator: &mut Evaluator<'a, D, M>,
    sheet: SheetId,
    range_sr: u32,
    range_sc: u32,
    range_er: u32,
    range_ec: u32,
    eff_row: usize,
    eff_col: usize,
) -> CellValue {
    let Some((start_row, end_row)) = index_axis_bounds(range_sr, range_er, eff_row) else {
        return CellValue::Error(CellError::Ref, None);
    };
    let Some((start_col, end_col)) = index_axis_bounds(range_sc, range_ec, eff_col) else {
        return CellValue::Error(CellError::Ref, None);
    };
    let start = CellRef::Positional {
        sheet,
        row: start_row,
        col: start_col,
    };
    if eff_row != 0 && eff_col != 0 {
        return evaluator.data.get_cell_value_by_ref(&start).await;
    }
    // Zero selects the complete axis, including when INDEX is array-lifted.
    let end = CellRef::Positional {
        sheet,
        row: end_row,
        col: end_col,
    };
    match evaluator
        .data
        .get_range_values(&start, &end, &RangeType::CellRange)
        .await
    {
        Ok(array) => CellValue::Array(array),
        Err(error) => CellValue::Error(error, None),
    }
}

/// Resolve a one-based INDEX selector without truncation or coordinate overflow.
/// Zero retains the full axis; all other selectors must identify a cell in it.
fn index_axis_bounds(start: u32, end: u32, index: usize) -> Option<(u32, u32)> {
    if start > end {
        return None;
    }
    if index == 0 {
        return Some((start, end));
    }
    let offset = u32::try_from(index.checked_sub(1)?).ok()?;
    let selected = start.checked_add(offset)?;
    (selected <= end).then_some((selected, selected))
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
        Ok(n) if n >= 0.0 => n as i64,
        _ => {
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
            Ok(n) if n >= 0.0 => n as i64,
            _ => {
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

    let bounds = || {
        let (start_row, end_row) =
            index_axis_bounds(range_sr, range_er, usize::try_from(row_num).ok()?)?;
        let (start_col, end_col) =
            index_axis_bounds(range_sc, range_ec, usize::try_from(col_num).ok()?)?;
        Some((sheet, start_row, start_col, end_row, end_col))
    };
    bounds().ok_or_else(|| ComputeError::Eval {
        message: "INDEX: position out of bounds".into(),
    })
}
