use cell_types::SheetId;
use compute_parser::ASTNode;
use compute_parser::{CellRefNode, RangeRef};
use formula_types::{CellRef, RangeType};
use value_types::{CellError, CellValue, ComputeError};

use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::engine::evaluator::Evaluator;

use super::range_geometry::resolve_cellref;

pub(in crate::eval) async fn eval_offset<'a, D: EvalDataAccess, M: EvalMetadata>(
    evaluator: &mut Evaluator<'a, D, M>,
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
                resolve_cellref(reference, evaluator.meta).ok_or_else(|| ComputeError::Eval {
                    message: "OFFSET: cannot resolve base reference".into(),
                })?;
            (sheet, row as i64, col as i64, 1i64, 1i64)
        }
        ASTNode::Range(RangeRef { start, end, .. }) => {
            let (s_sheet, s_row, s_col) =
                resolve_cellref(start, evaluator.meta).ok_or_else(|| ComputeError::Eval {
                    message: "OFFSET: cannot resolve range start".into(),
                })?;
            let (e_sheet, e_row, e_col) =
                resolve_cellref(end, evaluator.meta).ok_or_else(|| ComputeError::Eval {
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

    // Extract base reference position from first argument (same as eval_offset)
    let arg0 = match &args[0] {
        ASTNode::SheetRef { inner, .. } => inner.as_ref(),
        other => other,
    };

    let (base_sheet, base_row, base_col, base_height, base_width) = match arg0 {
        ASTNode::CellReference(CellRefNode { reference, .. }) => {
            let (sheet, row, col) =
                resolve_cellref(reference, evaluator.meta).ok_or_else(|| ComputeError::Eval {
                    message: "OFFSET: cannot resolve base reference".into(),
                })?;
            (sheet, row as i64, col as i64, 1i64, 1i64)
        }
        ASTNode::Range(RangeRef { start, end, .. }) => {
            let (s_sheet, s_row, s_col) =
                resolve_cellref(start, evaluator.meta).ok_or_else(|| ComputeError::Eval {
                    message: "OFFSET: cannot resolve range start".into(),
                })?;
            let (e_sheet, e_row, e_col) =
                resolve_cellref(end, evaluator.meta).ok_or_else(|| ComputeError::Eval {
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
