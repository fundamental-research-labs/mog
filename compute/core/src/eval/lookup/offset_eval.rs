use cell_types::{MAX_COLS, MAX_ROWS, SheetId};
use compute_parser::ASTNode;
use formula_types::{CellRef, RangeType};
use value_types::{CellError, CellValue, ComputeError};

use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::engine::evaluator::Evaluator;

// Preserve the reference geometry before OFFSET resizes it. Materializing a
// name or INDEX result first loses its sheet/origin and can read a whole row.
async fn resolve_offset_base<D: EvalDataAccess, M: EvalMetadata>(
    evaluator: &mut Evaluator<'_, D, M>,
    node: &ASTNode,
) -> Result<(SheetId, i64, i64, i64, i64), ComputeError> {
    let (sheet, start_row, start_col, end_row, end_col) = evaluator.eval_node_as_area(node).await?;
    Ok((
        sheet,
        i64::from(start_row),
        i64::from(start_col),
        i64::from(end_row) - i64::from(start_row) + 1,
        i64::from(end_col) - i64::from(start_col) + 1,
    ))
}

// First and last row (or column) of OFFSET's target on one axis: `base`
// moved by `offset`, spanning `extent` (negative extends up or left).
// `None` when any of it falls outside `0..limit`, including on overflow.
fn offset_span(base: i64, offset: i64, extent: i64, limit: u32) -> Option<(u32, u32)> {
    let moved = base.checked_add(offset)?;
    let far = if extent > 0 {
        moved.checked_add(extent - 1)?
    } else {
        moved.checked_add(extent + 1)?
    };
    let start = u32::try_from(moved.min(far)).ok()?;
    let end = u32::try_from(moved.max(far)).ok()?;
    (end < limit).then_some((start, end))
}

pub(in crate::eval) async fn eval_offset<'a, D: EvalDataAccess, M: EvalMetadata>(
    evaluator: &mut Evaluator<'a, D, M>,
    args: &[ASTNode],
) -> Result<CellValue, ComputeError> {
    if args.len() < 3 || args.len() > 5 {
        return Ok(CellValue::Error(CellError::Value, None));
    }

    let (base_sheet, base_row, base_col, base_height, base_width) =
        match resolve_offset_base(evaluator, &args[0]).await {
            Ok(base) => base,
            Err(ComputeError::Eval { .. }) => {
                return Ok(CellValue::Error(CellError::Ref, None));
            }
            Err(error) => return Err(error),
        };

    // --- Evaluate numeric arguments ---
    let rows_offset = {
        let v = evaluator.eval_node_cv(&args[1]).await?;
        if let CellValue::Error(e, _) = v {
            return Ok(CellValue::Error(e, None));
        }
        match v.coerce_to_number() {
            Ok(n) => n as i64,
            Err(e) => return Ok(CellValue::Error(e, None)),
        }
    };
    let cols_offset = {
        let v = evaluator.eval_node_cv(&args[2]).await?;
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
            let v = evaluator.eval_node_cv(&args[3]).await?;
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
            let v = evaluator.eval_node_cv(&args[4]).await?;
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
    let (Some((start_row, end_row)), Some((start_col, end_col))) = (
        offset_span(base_row, rows_offset, height, MAX_ROWS),
        offset_span(base_col, cols_offset, width, MAX_COLS),
    ) else {
        return Ok(CellValue::Error(CellError::Ref, None));
    };

    // --- Fetch values ---
    if start_row == end_row && start_col == end_col {
        // Single cell
        let cell_ref = CellRef::Positional {
            sheet: base_sheet,
            row: start_row,
            col: start_col,
        };
        Ok(evaluator.data.get_cell_value_by_ref(&cell_ref).await)
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
        match evaluator
            .data
            .get_range_values(&start_ref, &end_ref, &RangeType::CellRange)
            .await
        {
            Ok(arr) => Ok(CellValue::Array(arr)),
            Err(e) => Ok(CellValue::Error(e, None)),
        }
    }
}

pub(in crate::eval) async fn eval_offset_as_area<'a, D: EvalDataAccess, M: EvalMetadata>(
    evaluator: &mut Evaluator<'a, D, M>,
    args: &[ASTNode],
) -> Result<(SheetId, u32, u32, u32, u32), ComputeError> {
    if args.len() < 3 || args.len() > 5 {
        return Err(ComputeError::Eval {
            message: "OFFSET: expected 3-5 arguments".into(),
        });
    }

    let (base_sheet, base_row, base_col, base_height, base_width) =
        resolve_offset_base(evaluator, &args[0]).await?;

    // Evaluate numeric arguments
    let rows_offset = {
        let v = evaluator.eval_node_cv(&args[1]).await?;
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
        let v = evaluator.eval_node_cv(&args[2]).await?;
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
        let v = evaluator.eval_node_cv(&args[3]).await?;
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
        let v = evaluator.eval_node_cv(&args[4]).await?;
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
    let (Some((start_row, end_row)), Some((start_col, end_col))) = (
        offset_span(base_row, rows_offset, height, MAX_ROWS),
        offset_span(base_col, cols_offset, width, MAX_COLS),
    ) else {
        return Err(ComputeError::Eval {
            message: "OFFSET: out of bounds".into(),
        });
    };

    Ok((base_sheet, start_row, start_col, end_row, end_col))
}
