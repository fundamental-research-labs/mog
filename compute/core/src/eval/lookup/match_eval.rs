use compute_parser::ASTNode;
use value_types::{CellError, CellValue, ComputeError};

use crate::eval::context::traits::{EvalDataAccess, EvalMetadata, IndexedLookupResult};
use crate::eval::engine::evaluator::Evaluator;

use super::primitives::{has_wildcard_chars, match_scalar_in_flat};
use super::range_geometry::try_extract_single_col_range;

pub(in crate::eval) async fn eval_match<'a, D: EvalDataAccess, M: EvalMetadata>(
    evaluator: &mut Evaluator<'a, D, M>,
    args: &[ASTNode],
) -> Result<CellValue, ComputeError> {
    if args.len() < 2 || args.len() > 3 {
        return Ok(CellValue::Error(CellError::Value, None));
    }
    let lookup = evaluator.eval_node_cv(&args[0]).await?;

    // Evaluate match_type BEFORE materializing the array
    let match_type = if args.len() > 2 {
        let mt_val = evaluator.eval_node_cv(&args[2]).await?;
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
        let arr = evaluator.eval_node_cv(&args[1]).await?;
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
        try_extract_single_col_range(&args[1], evaluator.meta)
    {
        let search_result = if match_type == 0 && has_wildcard_chars(&lookup) {
            match lookup.coerce_to_string() {
                Ok(pat) => evaluator
                    .meta
                    .indexed_column_wildcard_search(&sheet, col, &pat),
                Err(_) => IndexedLookupResult::NotAvailable,
            }
        } else {
            evaluator
                .meta
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
    let arr = evaluator.eval_node_cv(&args[1]).await?;
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

pub(in crate::eval) async fn eval_xmatch<'a, D: EvalDataAccess, M: EvalMetadata>(
    evaluator: &mut Evaluator<'a, D, M>,
    args: &[ASTNode],
) -> Result<CellValue, ComputeError> {
    if args.len() < 2 || args.len() > 4 {
        return Ok(CellValue::Error(CellError::Value, None));
    }
    let lookup = evaluator.eval_node_cv(&args[0]).await?;
    if let CellValue::Error(e, _) = lookup {
        return Ok(CellValue::Error(e, None));
    }

    // Evaluate match_mode (arg[2], default 0) and search_mode (arg[3], default 1)
    let match_mode = if args.len() > 2 && !matches!(args[2], ASTNode::Omitted) {
        let v = evaluator.eval_node_cv(&args[2]).await?;
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
        let v = evaluator.eval_node_cv(&args[3]).await?;
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
            try_extract_single_col_range(&args[1], evaluator.meta)
    {
        // Map XMATCH match_mode → indexed_column_search match_mode:
        //   XMATCH  0 (exact)         → indexed 0
        //   XMATCH -1 (next smaller)  → indexed 1 (leq)
        //   XMATCH  1 (next larger)   → indexed -1 (geq)
        //   XMATCH  2 (wildcard)      → wildcard search
        let search_result = if match_mode == 2 || (match_mode == 0 && has_wildcard_chars(&lookup)) {
            match lookup.coerce_to_string() {
                Ok(pat) => evaluator
                    .meta
                    .indexed_column_wildcard_search(&sheet, col, &pat),
                Err(_) => IndexedLookupResult::NotAvailable,
            }
        } else {
            let indexed_mode = match match_mode {
                0 => 0,  // exact
                -1 => 1, // next smaller → leq
                1 => -1, // next larger → geq
                _ => 0,
            };
            evaluator
                .meta
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
    evaluated_args.push(evaluator.eval_node_cv(&args[1]).await?);
    if args.len() > 2 {
        evaluated_args.push(CellValue::number(match_mode as f64));
    }
    if args.len() > 3 {
        evaluated_args.push(CellValue::number(search_mode as f64));
    }
    Ok(super::super::GLOBAL_REGISTRY.call("XMATCH", &evaluated_args))
}
