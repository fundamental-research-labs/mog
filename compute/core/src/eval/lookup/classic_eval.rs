use compute_parser::ASTNode;
use formula_types::CellRef;
use value_types::{CellArray, CellError, CellValue, ComputeError};

use crate::eval::context::traits::{EvalDataAccess, EvalMetadata, IndexedLookupResult};
use crate::eval::engine::evaluator::Evaluator;
use crate::eval::engine::operators::cell_value_eq_lookup;
use crate::functions::helpers::criteria::WildcardPattern;

use super::primitives::{approx_match_binary_search, has_wildcard_chars};
use super::range_geometry::{extract_range_bounds, try_extract_single_row_range};

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

pub(in crate::eval) async fn eval_vlookup<'a, D: EvalDataAccess, M: EvalMetadata>(
    evaluator: &mut Evaluator<'a, D, M>,
    args: &[ASTNode],
) -> Result<CellValue, ComputeError> {
    if args.len() < 3 || args.len() > 4 {
        return Ok(CellValue::Error(CellError::Value, None));
    }
    let lookup = evaluator.eval_node_cv(&args[0]).await?;
    if let CellValue::Error(e, _) = lookup {
        return Ok(CellValue::Error(e, None));
    }

    // Evaluate col_idx and exact BEFORE materializing the table,
    // so we can attempt the indexed fast path first.
    let col_v = evaluator.eval_node_cv(&args[2]).await?;
    if let CellValue::Error(e, _) = col_v {
        return Ok(CellValue::Error(e, None));
    }
    let col_idx = match col_v.coerce_to_number() {
        Ok(n) if n < 1.0 => return Ok(CellValue::Error(CellError::Value, None)),
        Ok(n) => n as usize - 1,
        Err(e) => return Ok(CellValue::Error(e, None)),
    };
    let exact = if args.len() > 3 {
        let v = evaluator.eval_node_cv(&args[3]).await?;
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
        let table = evaluator.eval_node_cv(&args[1]).await?;
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
        extract_range_bounds(&args[1], evaluator.meta)
    {
        let lookup_col = start_col;
        let result_col_abs = start_col + col_idx as u32;

        if result_col_abs > end_col {
            return Ok(CellValue::Error(CellError::Ref, None));
        }

        let search_result = if exact {
            if has_wildcard_chars(&lookup) {
                match lookup.coerce_to_string() {
                    Ok(pat) => evaluator
                        .meta
                        .indexed_column_wildcard_search(&sheet, lookup_col, &pat),
                    Err(_) => IndexedLookupResult::NotAvailable,
                }
            } else {
                evaluator
                    .meta
                    .indexed_column_search(&sheet, lookup_col, &lookup, 0)
            }
        } else {
            evaluator
                .meta
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
                    return Ok(evaluator.data.get_cell_value_by_ref(&cell_ref).await);
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
    let table = evaluator.eval_node_cv(&args[1]).await?;
    let rows = match table {
        CellValue::Array(r) => r,
        CellValue::Error(e, _) => return Ok(CellValue::Error(e, None)),
        _ => return Ok(CellValue::Error(CellError::Value, None)),
    };

    Ok(vlookup_scalar_in_table(&lookup, &rows, col_idx, exact))
}

pub(in crate::eval) async fn eval_hlookup<'a, D: EvalDataAccess, M: EvalMetadata>(
    evaluator: &mut Evaluator<'a, D, M>,
    args: &[ASTNode],
) -> Result<CellValue, ComputeError> {
    if args.len() < 3 || args.len() > 4 {
        return Ok(CellValue::Error(CellError::Value, None));
    }
    let lookup = evaluator.eval_node_cv(&args[0]).await?;
    if let CellValue::Error(e, _) = lookup {
        return Ok(CellValue::Error(e, None));
    }

    // Evaluate row_idx and exact BEFORE materializing the table,
    // so we can attempt the indexed fast path first.
    let row_v = evaluator.eval_node_cv(&args[2]).await?;
    if let CellValue::Error(e, _) = row_v {
        return Ok(CellValue::Error(e, None));
    }
    let row_idx = match row_v.coerce_to_number() {
        Ok(n) if n < 1.0 => return Ok(CellValue::Error(CellError::Value, None)),
        Ok(n) => n as usize - 1,
        Err(e) => return Ok(CellValue::Error(e, None)),
    };
    let exact = if args.len() > 3 {
        let v = evaluator.eval_node_cv(&args[3]).await?;
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
        let table = evaluator.eval_node_cv(&args[1]).await?;
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
            try_extract_single_row_range(&args[1], evaluator.meta)
    {
        // Single-row table with row_index=1 — scan the row directly.
        let mut first_row_values: Vec<(u32, CellValue)> = Vec::new();
        for c in start_col..=end_col {
            if let Some(col_vals) = evaluator.meta.get_column_values(&sheet, c) {
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
                    return Ok(evaluator.data.get_cell_value_by_ref(&cell_ref).await);
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
        extract_range_bounds(&args[1], evaluator.meta)
    {
        let result_row_abs = start_row + row_idx as u32;
        if result_row_abs > end_row {
            return Ok(CellValue::Error(CellError::Ref, None));
        }

        // Get first row values across all columns in the range
        let lookup_row = start_row;
        let mut first_row_values: Vec<(u32, CellValue)> = Vec::new();
        for c in start_col..=end_col {
            if let Some(col_vals) = evaluator.meta.get_column_values(&sheet, c) {
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
                    return Ok(evaluator.data.get_cell_value_by_ref(&cell_ref).await);
                }
                Some(_) => { /* col outside range — fall through */ }
                None => {
                    return Ok(CellValue::Error(CellError::Na, None));
                }
            }
        }
    }

    // ---- Materialization path (original) ----
    let table = evaluator.eval_node_cv(&args[1]).await?;
    let rows = match table {
        CellValue::Array(r) => r,
        CellValue::Error(e, _) => return Ok(CellValue::Error(e, None)),
        _ => return Ok(CellValue::Error(CellError::Value, None)),
    };

    Ok(hlookup_scalar_in_table(&lookup, &rows, row_idx, exact))
}
