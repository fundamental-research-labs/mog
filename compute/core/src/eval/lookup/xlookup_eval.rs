use compute_parser::ASTNode;
use value_types::{CellError, CellValue, ComputeError};

use crate::eval::context::traits::{EvalDataAccess, EvalMetadata, IndexedLookupResult};
use crate::eval::engine::evaluator::Evaluator;
use crate::eval::engine::operators::{cell_value_cmp_for_lookup, cell_value_eq_lookup};
use crate::functions::helpers::criteria::WildcardPattern;
use crate::functions::lookup::helpers::get_return_value;

use super::primitives::has_wildcard_chars;
use super::range_geometry::{is_whole_range, try_extract_single_col_range};

pub(in crate::eval) async fn eval_xlookup<'a, D: EvalDataAccess, M: EvalMetadata>(
    evaluator: &mut Evaluator<'a, D, M>,
    args: &[ASTNode],
) -> Result<CellValue, ComputeError> {
    if args.len() < 3 || args.len() > 6 {
        return Ok(CellValue::Error(CellError::Value, None));
    }

    // 1. Evaluate lookup_value
    let lookup = evaluator.eval_node_cv(&args[0]).await?;
    if let CellValue::Error(e, _) = lookup {
        return Ok(CellValue::Error(e, None));
    }

    // 2. Evaluate match_mode (arg[4], default 0) and search_mode (arg[5], default 1)
    //    BEFORE materializing lookup_array, so we can try the indexed path.
    let match_mode = if args.len() > 4 && !matches!(args[4], ASTNode::Omitted) {
        let v = evaluator.eval_node_cv(&args[4]).await?;
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
        let v = evaluator.eval_node_cv(&args[5]).await?;
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
                try_extract_single_col_range(&args[1], evaluator.meta)
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
                let search_result =
                    if match_mode == 2 || (match_mode == 0 && has_wildcard_chars(&elem)) {
                        match elem.coerce_to_string() {
                            Ok(pat) => evaluator
                                .meta
                                .indexed_column_wildcard_search(&sheet, col, &pat),
                            Err(_) => IndexedLookupResult::NotAvailable,
                        }
                    } else {
                        evaluator
                            .meta
                            .indexed_column_search(&sheet, col, &elem, indexed_mode)
                    };

                match search_result {
                    IndexedLookupResult::Found(row) if row >= start_row && row <= end_row => {
                        // Fetch return value
                        let return_val = if let Some((ret_sheet, ret_col, ret_start, ret_end)) =
                            try_extract_single_col_range(&args[2], evaluator.meta)
                        {
                            let ret_row = ret_start + (row - start_row);
                            if ret_row <= ret_end {
                                if let Some(col_vals) =
                                    evaluator.meta.get_column_values(&ret_sheet, ret_col)
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
                                CellValue::Null
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
                    let nf = evaluator.eval_node_cv(&args[3]).await?;
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
        let lookup_arr_val = evaluator.eval_node_cv(&args[1]).await?;
        if let CellValue::Error(e, _) = lookup_arr_val {
            return Ok(CellValue::Error(e, None));
        }
        let return_arr = evaluator.eval_node_cv(&args[2]).await?;

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
                    let row_result = get_xlookup_return_value(&return_arr, idx);
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
            let nf = evaluator.eval_node_cv(&args[3]).await?;
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
            try_extract_single_col_range(&args[1], evaluator.meta)
    {
        // Map XLOOKUP match_mode → indexed_column_search match_mode:
        //   XLOOKUP  0 (exact)        → indexed 0
        //   XLOOKUP -1 (next smaller)  → indexed 1 (leq / largest <=)
        //   XLOOKUP  1 (next larger)   → indexed -1 (geq / smallest >=)
        //   XLOOKUP  2 (wildcard)      → indexed_column_wildcard_search
        let search_result = if match_mode == 2 {
            match lookup.coerce_to_string() {
                Ok(pat) => evaluator
                    .meta
                    .indexed_column_wildcard_search(&sheet, col, &pat),
                Err(_) => IndexedLookupResult::NotAvailable,
            }
        } else if match_mode == 0 && has_wildcard_chars(&lookup) {
            // Exact match with wildcard characters in lookup value
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
                _ => 0,  // unreachable due to validation above
            };
            evaluator
                .meta
                .indexed_column_search(&sheet, col, &lookup, indexed_mode)
        };

        match search_result {
            IndexedLookupResult::Found(row) => {
                if row >= start_row && row <= end_row {
                    // Try direct cell fetch for single-column return ranges
                    if let Some((ret_sheet, ret_col, ret_start, ret_end)) =
                        try_extract_single_col_range(&args[2], evaluator.meta)
                    {
                        let ret_row = ret_start + (row - start_row);
                        if ret_row > ret_end {
                            return Ok(CellValue::Null);
                        }
                        if let Some(col_vals) =
                            evaluator.meta.get_column_values(&ret_sheet, ret_col)
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
                    let return_arr = evaluator.eval_node_cv(&args[2]).await?;
                    if let CellValue::Error(e, _) = return_arr {
                        return Ok(CellValue::Error(e, None));
                    }
                    return Ok(get_xlookup_return_value(
                        &return_arr,
                        (row - start_row) as usize,
                    ));
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
                    let nf = evaluator.eval_node_cv(&args[3]).await?;
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
    let lookup_arr_val = evaluator.eval_node_cv(&args[1]).await?;
    if let CellValue::Error(e, _) = lookup_arr_val {
        return Ok(CellValue::Error(e, None));
    }
    let return_arr = evaluator.eval_node_cv(&args[2]).await?;
    // Note: return_arr errors are checked at extraction time

    // Flatten lookup_array to a 1D vector
    let lookup_arr = match &lookup_arr_val {
        CellValue::Array(arr) => arr.iter().cloned().collect::<Vec<_>>(),
        other => vec![other.clone()],
    };

    // Find match using the extracted helper
    let match_idx = xlookup_match_in_materialized(&lookup, &lookup_arr, match_mode, search_mode);

    match match_idx {
        Some(idx) => Ok(get_xlookup_return_value(&return_arr, idx)),
        None => {
            // Whole-column/row references are clamped to sheet.rows,
            // so trailing empties beyond the data extent are lost.
            // When the lookup value is Null (empty cell), Excel would
            // match a trailing empty.  Return Null to simulate that.
            if lookup.is_null() && is_whole_range(&args[1]) {
                return Ok(CellValue::Null);
            }
            if args.len() > 3 && !matches!(args[3], ASTNode::Omitted) {
                let nf = evaluator.eval_node_cv(&args[3]).await?;
                Ok(nf)
            } else {
                Ok(CellValue::Error(CellError::Na, None))
            }
        }
    }
}

fn get_xlookup_return_value(return_arr: &CellValue, idx: usize) -> CellValue {
    match return_arr {
        CellValue::Array(arr) if arr.rows() == 1 && idx >= arr.cols() => CellValue::Null,
        CellValue::Array(arr) if arr.rows() > 1 && idx >= arr.rows() => CellValue::Null,
        CellValue::Array(_) => get_return_value(return_arr, idx),
        _ if idx == 0 => get_return_value(return_arr, idx),
        _ => CellValue::Null,
    }
}

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
