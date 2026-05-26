//! Borrowed multi-criteria evaluation for COUNTIFS/SUMIFS/AVERAGEIFS/MAXIFS/MINIFS.
//!
//! ## Architecture: why two dispatch paths exist
//!
//! The conditional aggregate functions (COUNTIFS, SUMIFS, etc.) have TWO evaluation
//! paths that share the core aggregation logic in `conditional_aggregate.rs`:
//!
//! 1. **Standard path** (`compute-functions`): `ExcelFunction::call(&[CellValue])`.
//!    Receives pre-materialized argument slices. Uses thread-local per-recalc
//!    frequency caches (`frequency_cache::count_lookup()`).
//!
//! 2. **Borrowed path** (this module): borrows `&[CellValue]` directly from the
//!    mirror's column store, avoiding O(n) allocation per range argument. Uses
//!    persistent mirror-level `WorkbookCache` frequency maps for O(1) exact-match
//!    lookups. This is async (calls `evaluator.eval_node_cv().await` for criteria).
//!
//! The ~330 lines in this module are **irreducible eval-layer adapter code**, not
//! duplicated logic. They handle: AST argument extraction, mirror-level cache
//! interaction, bitmask fast paths, and dispatch scaffolding — all of which require
//! `ASTNode` (from `compute-parser`) and `EvalMetadata` (from `compute-core`),
//! which are unavailable in `compute-functions` (no such dependency exists).
//!
//! The shared aggregation logic (criteria parsing, row scanning, aggregate ops)
//! lives in `compute_functions::helpers::conditional_aggregate`.

use cell_types::SheetId;
use compute_functions::helpers::column_bitset::ColumnBitset;
use compute_functions::helpers::conditional_aggregate::{
    AggregateOp, aggregate_matching_rows, scan_multi_criteria, scan_single_criteria,
};
use compute_functions::helpers::frequency_cache::{NormalizedKey, is_exact_match_criteria};
use compute_functions::helpers::sumifs_result_cache::{
    SumifsCacheEpoch, SumifsCacheKey, SumifsRangeIdentity,
};
use compute_parser::ASTNode;
use value_types::{CellError, CellValue, ComputeError};

use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::engine::evaluator::Evaluator;
use crate::eval::lookup::range_geometry::try_extract_single_col_range_with_sentinels;

/// Try to evaluate a multi-criteria function using borrowed column slices.
///
/// Returns `None` if any range can't be borrowed (caller falls back to normal
/// dispatch). Returns `Some(Ok(val))` on success or `Some(Err(..))` on error.
#[allow(clippy::type_complexity)]
pub(in crate::eval) async fn try_eval_multi_criteria_borrowed<
    D: EvalDataAccess,
    M: EvalMetadata,
>(
    evaluator: &mut Evaluator<'_, D, M>,
    args: &[ASTNode],
    op: AggregateOp,
) -> Option<Result<CellValue, ComputeError>> {
    // COUNTIFS/SUMIFS layout:
    // COUNTIFS(criteria_range1, criteria1, criteria_range2, criteria2, ...)
    // SUMIFS(sum_range, criteria_range1, criteria1, criteria_range2, criteria2, ...)

    let is_sum_variant = matches!(
        op,
        AggregateOp::Sum | AggregateOp::Average | AggregateOp::Max | AggregateOp::Min
    );

    // Determine argument layout
    let (sum_range_arg, criteria_pairs) = if is_sum_variant {
        // SUMIFS/AVERAGEIFS/MAXIFS/MINIFS: first arg is sum_range
        if args.len() < 3 || !(args.len() - 1).is_multiple_of(2) {
            return None; // wrong arity, let normal dispatch handle error
        }
        (Some(&args[0]), &args[1..])
    } else {
        // COUNTIFS: all args are criteria_range/criteria pairs
        if args.len() < 2 || !args.len().is_multiple_of(2) {
            return None;
        }
        (None, args)
    };

    // Extract all criteria ranges as borrowed slices
    let mut range_slices: Vec<&[CellValue]> = Vec::new();
    let mut criteria_fns: Vec<Box<dyn Fn(&CellValue) -> bool>> = Vec::new();
    let mut criteria_vals: Vec<CellValue> = Vec::new();
    let mut range_coords: Vec<(SheetId, u32, u32, u32)> = Vec::new();
    let mut row_count: Option<usize> = None;

    for pair in criteria_pairs.chunks(2) {
        let range_arg = &pair[0];
        let criteria_arg = &pair[1];

        // Extract single-column range coordinates from AST
        let (sheet, col, start_row, end_row) =
            try_extract_single_col_range_with_sentinels(range_arg, evaluator.meta)?;
        range_coords.push((sheet, col, start_row, end_row));

        // Get borrowed column slice
        let col_values = evaluator.meta.get_column_values(&sheet, col)?;

        let start = start_row as usize;
        let end = (end_row as usize).saturating_add(1).min(col_values.len());
        let slice = if start < end {
            &col_values[start..end]
        } else {
            &[] as &[CellValue]
        };

        // Validate all ranges have same row count
        let this_rows = (end_row as usize)
            .saturating_sub(start_row as usize)
            .saturating_add(1);
        match row_count {
            None => row_count = Some(this_rows),
            Some(n) if n != this_rows => return None, // mismatched ranges, let normal handle
            _ => {}
        }

        range_slices.push(slice);

        // Evaluate the criteria argument (scalar, cheap)
        let criteria_val = match evaluator.eval_node_cv(criteria_arg).await {
            Ok(v) => v,
            Err(e) => return Some(Err(e)),
        };

        // Bail out for array criteria — the standard counting.rs path handles
        // these correctly by iterating each element and returning an array result.
        if compute_functions::helpers::criteria::extract_criteria_elements(&criteria_val).is_some()
        {
            return None;
        }

        criteria_vals.push(criteria_val.clone());
        criteria_fns.push(compute_functions::helpers::criteria::parse_criteria(
            &criteria_val,
        ));
    }

    // Get sum range slice if needed (before computing total_rows so we can
    // include it in the length calculation).
    let mut sum_range_coords: Option<(SheetId, u32, u32, u32)> = None;
    let sum_slice: Option<&[CellValue]> = if let Some(sum_arg) = sum_range_arg {
        let (sheet, col, start_row, end_row) =
            try_extract_single_col_range_with_sentinels(sum_arg, evaluator.meta)?;
        sum_range_coords = Some((sheet, col, start_row, end_row));
        let col_values = evaluator.meta.get_column_values(&sheet, col)?;
        let start = start_row as usize;
        let end = (end_row as usize).saturating_add(1).min(col_values.len());
        Some(if start < end {
            &col_values[start..end]
        } else {
            &[] as &[CellValue]
        })
    } else {
        None
    };

    // Use the maximum length across all ranges (criteria + sum/max/min) so
    // that no rows are missed when column slices have different lengths.
    // `all_criteria_match` uses `.get(row).unwrap_or(Null)` so shorter
    // criteria ranges safely return Null for out-of-bounds rows.
    let mut max_len = range_slices.iter().map(|s| s.len()).max().unwrap_or(0);
    if let Some(ss) = &sum_slice {
        max_len = max_len.max(ss.len());
    }
    let total_rows = row_count.unwrap_or(0).min(max_len);

    // Try bitmask fast path: get per-criterion bitmasks from cache and AND them
    let bitmask_path: Option<ColumnBitset> = (|| {
        let mut combined = ColumnBitset::new_all_true(total_rows as u32);
        for (i, &(ref sheet, col, start_row, end_row)) in range_coords.iter().enumerate() {
            let bm = evaluator.meta.get_criteria_bitmask(
                sheet,
                col,
                start_row,
                end_row,
                &criteria_vals[i],
                range_slices[i],
            )?;
            // Handle size mismatch: truncate or pad to total_rows
            if bm.len() == combined.len() {
                combined.and_assign(&bm);
            } else {
                let mut padded = ColumnBitset::new_all_false(total_rows as u32);
                let copy_len = (total_rows as u32).min(bm.len());
                for idx in bm.ones() {
                    if idx < copy_len {
                        padded.set(idx, true);
                    }
                }
                combined.and_assign(&padded);
            }
        }
        Some(combined)
    })();

    // Iterate rows and aggregate using shared conditional_aggregate module.
    // For Sum/Average/Max/Min, `sum_slice` must be Some; for Count it is None.
    // The `?` on sum_slice propagates the None → returns None from this function
    // (triggering normal dispatch fallback), which is the correct behavior when
    // sum_range_arg was required but missing.
    if !matches!(op, AggregateOp::Count) && sum_slice.is_none() {
        return None;
    }
    // Unwrap single-element Array criteria to their inner scalar value.
    // Multi-element arrays were already rejected by extract_criteria_elements above,
    // but 1x1 arrays (e.g. from structured table refs) pass through and need
    // unwrapping for both is_exact_match_criteria and column index query_exact.
    let unwrapped_criteria: Vec<&CellValue> = criteria_vals
        .iter()
        .map(|cv| match cv {
            CellValue::Array(arr) => arr.get(0, 0).unwrap_or(cv),
            _ => cv,
        })
        .collect();

    // --- SUMIFS result cache: O(1) lookup for exact-match multi-criteria ---
    //
    // When all criteria are exact-match and op is Sum, we can pre-compute ALL
    // results in a single O(rows × criteria_count) pass and serve each formula
    // with O(1) hash lookup. This eliminates 62K individual bitmap operations
    // for workbooks like EGdLdI where thousands of SUMIFS share the same ranges.
    if matches!(op, AggregateOp::Sum)
        && unwrapped_criteria
            .iter()
            .all(|cv| is_exact_match_criteria(cv))
        && let Some(ss) = sum_slice
        && let Some(sumifs_epoch) = evaluator.meta.sumifs_cache_epoch()
    {
        let criteria_keys: Vec<NormalizedKey> = unwrapped_criteria
            .iter()
            .map(|cv| NormalizedKey::from_cell_value(cv))
            .collect();
        let (sum_sheet, sum_col, sum_start, sum_end) = sum_range_coords?;
        let cache_key = sumifs_cache_key(
            sumifs_epoch,
            total_rows,
            (sum_sheet, sum_col, sum_start, sum_end, ss.len()),
            &range_coords,
            &range_slices,
        );

        let result = compute_functions::helpers::sumifs_result_cache::sumifs_lookup(
            &cache_key,
            &range_slices,
            ss,
            total_rows,
            &criteria_keys,
        );

        return Some(Ok(match result {
            Ok(sum) => CellValue::number(sum),
            Err(e) => CellValue::Error(e, None),
        }));
    }

    let bmc_span = tracing::info_span!(
        "borrowed_multi_criteria",
        total_rows = total_rows as u64,
        criteria_count = criteria_fns.len() as u64,
        // fast_path: 0 = linear scan, 1 = bitmask cache, 2 = column index
        fast_path = tracing::field::Empty,
    );
    let _bmc_guard = bmc_span.enter();

    let result = if let Some(ref combined) = bitmask_path {
        // Bitmask fast path: iterate set bits
        bmc_span.record("fast_path", 1u64);
        aggregate_matching_rows(combined.ones().map(|i| i as usize), sum_slice, op)
    } else {
        // Column index path: try to use column indexes for exact-match criteria
        let column_index_result: Option<ColumnBitset> = (|| {
            // All criteria must be exact-match for this path
            if !unwrapped_criteria
                .iter()
                .all(|cv| is_exact_match_criteria(cv))
            {
                return None;
            }

            let mut combined = ColumnBitset::new_all_true(total_rows as u32);
            for (i, &(ref sheet, col, start_row, end_row)) in range_coords.iter().enumerate() {
                let index = compute_functions::helpers::column_index::get_or_build_for_slice(
                    sheet,
                    col,
                    start_row,
                    end_row,
                    range_slices[i],
                );
                let bitmap = index.query_exact(unwrapped_criteria[i]);
                if bitmap.len() == combined.len() {
                    combined.and_assign(&bitmap);
                } else {
                    let mut padded = ColumnBitset::new_all_false(combined.len());
                    let copy_len = combined.len().min(bitmap.len());
                    for idx in bitmap.ones() {
                        if idx < copy_len {
                            padded.set(idx, true);
                        }
                    }
                    combined.and_assign(&padded);
                }
            }
            Some(combined)
        })();

        if let Some(ref combined) = column_index_result {
            bmc_span.record("fast_path", 2u64);
            aggregate_matching_rows(combined.ones().map(|i| i as usize), sum_slice, op)
        } else {
            bmc_span.record("fast_path", 0u64);
            // Final fallback: multi-criteria linear scan
            scan_multi_criteria(&range_slices, &criteria_fns, sum_slice, total_rows, op)
        }
    };

    Some(Ok(result))
}

fn sumifs_cache_key(
    epoch: SumifsCacheEpoch,
    total_rows: usize,
    sum_range: (SheetId, u32, u32, u32, usize),
    criteria_ranges: &[(SheetId, u32, u32, u32)],
    criteria_slices: &[&[CellValue]],
) -> SumifsCacheKey {
    let (sum_sheet, sum_col, sum_start, sum_end, sum_effective_len) = sum_range;
    let sum_identity = SumifsRangeIdentity::sum_range(
        sum_sheet.as_u128(),
        sum_col,
        sum_start,
        end_row_exclusive(sum_end),
        sum_effective_len,
    );
    let criteria_identities = criteria_ranges
        .iter()
        .enumerate()
        .map(|(order, &(sheet, col, start, end))| {
            SumifsRangeIdentity::criteria_range(
                order as u32,
                sheet.as_u128(),
                col,
                start,
                end_row_exclusive(end),
                criteria_slices.get(order).map_or(0, |s| s.len()),
            )
        })
        .collect();
    SumifsCacheKey::new(epoch, total_rows, sum_identity, criteria_identities)
}

fn end_row_exclusive(end_row: u32) -> u32 {
    if end_row == u32::MAX {
        u32::MAX
    } else {
        end_row.saturating_add(1)
    }
}

/// Try to evaluate single-criteria borrowed (COUNTIF, SUMIF, AVERAGEIF).
pub(in crate::eval) async fn try_eval_single_criteria_borrowed<
    D: EvalDataAccess,
    M: EvalMetadata,
>(
    evaluator: &mut Evaluator<'_, D, M>,
    args: &[ASTNode],
    op: AggregateOp,
) -> Option<Result<CellValue, ComputeError>> {
    // COUNTIF(range, criteria) - 2 args
    // SUMIF(range, criteria, [sum_range]) - 2-3 args
    // AVERAGEIF(range, criteria, [average_range]) - 2-3 args
    let is_sum_variant = matches!(op, AggregateOp::Sum | AggregateOp::Average);

    if args.len() < 2 || args.len() > 3 {
        return None;
    }

    let range_arg = &args[0];
    let criteria_arg = &args[1];
    let sum_range_arg = if args.len() == 3 {
        Some(&args[2])
    } else {
        None
    };

    // Extract criteria range
    let (sheet, col, start_row, end_row) =
        try_extract_single_col_range_with_sentinels(range_arg, evaluator.meta)?;
    let col_values = evaluator.meta.get_column_values(&sheet, col)?;
    let start = start_row as usize;
    let end = (end_row as usize).saturating_add(1).min(col_values.len());
    let criteria_slice = if start < end {
        &col_values[start..end]
    } else {
        &[] as &[CellValue]
    };
    let total_rows = (end_row as usize)
        .saturating_sub(start_row as usize)
        .saturating_add(1)
        .min(criteria_slice.len());

    // Evaluate criteria
    let criteria_val = match evaluator.eval_node_cv(criteria_arg).await {
        Ok(v) => v,
        Err(e) => return Some(Err(e)),
    };

    // Bail out for array criteria — the standard counting.rs path handles
    // these correctly by iterating each element and returning an array result.
    if compute_functions::helpers::criteria::extract_criteria_elements(&criteria_val).is_some() {
        return None;
    }

    // --- Fast path: frequency cache for exact-match criteria ---
    // When the criteria is an exact-match value (no operators, no wildcards),
    // the persistent WorkbookCache frequency map gives O(1) lookup per formula
    // cell instead of O(N) row iteration.
    let use_frequency = is_exact_match_criteria(&criteria_val);

    if use_frequency {
        // Extract sum range coordinates for SUMIF/AVERAGEIF
        let sum_coords: Option<(SheetId, u32, u32, u32, &[CellValue])> =
            if let Some(sum_arg) = sum_range_arg {
                let (s, c, sr, er) =
                    try_extract_single_col_range_with_sentinels(sum_arg, evaluator.meta)?;
                let cv = evaluator.meta.get_column_values(&s, c)?;
                let s_start = sr as usize;
                let s_end = (er as usize).saturating_add(1).min(cv.len());
                let slice = if s_start < s_end {
                    &cv[s_start..s_end]
                } else {
                    &[] as &[CellValue]
                };
                Some((s, c, sr, er, slice))
            } else if is_sum_variant {
                Some((sheet, col, start_row, end_row, criteria_slice))
            } else {
                None
            };

        match op {
            AggregateOp::Count => {
                let crit_refs: Vec<&CellValue> = criteria_slice.iter().collect();
                if let Some(count) = evaluator.meta.count_frequency_lookup(
                    &sheet,
                    col,
                    start_row,
                    end_row,
                    &crit_refs,
                    &criteria_val,
                ) {
                    return Some(Ok(CellValue::number(count as f64)));
                }
            }
            AggregateOp::Sum => {
                let (s_sheet, s_col, s_start, s_end, sum_data) = sum_coords?;
                let crit_refs: Vec<&CellValue> = criteria_slice.iter().collect();
                let sum_refs: Vec<&CellValue> = sum_data.iter().collect();
                if let Some(result) = evaluator.meta.sum_frequency_lookup(
                    &sheet,
                    col,
                    start_row,
                    end_row,
                    &s_sheet,
                    s_col,
                    s_start,
                    s_end,
                    &crit_refs,
                    &sum_refs,
                    &criteria_val,
                ) {
                    return Some(Ok(match result {
                        Ok(sum) => CellValue::number(sum),
                        Err(e) => CellValue::Error(e, None),
                    }));
                }
            }
            AggregateOp::Average => {
                let (s_sheet, s_col, s_start, s_end, sum_data) = sum_coords?;
                let crit_refs: Vec<&CellValue> = criteria_slice.iter().collect();
                let sum_refs: Vec<&CellValue> = sum_data.iter().collect();
                if let Some(result) = evaluator.meta.sum_and_count_frequency_lookup(
                    &sheet,
                    col,
                    start_row,
                    end_row,
                    &s_sheet,
                    s_col,
                    s_start,
                    s_end,
                    &crit_refs,
                    &sum_refs,
                    &criteria_val,
                ) {
                    return Some(Ok(match result {
                        Ok((sum, count)) => {
                            if count == 0 {
                                CellValue::Error(CellError::Div0, None)
                            } else {
                                CellValue::number(sum / count as f64)
                            }
                        }
                        Err(e) => CellValue::Error(e, None),
                    }));
                }
            }
            _ => {} // Max/Min don't use frequency cache
        }
    }

    // --- Slow path: row-by-row iteration (fallback) ---
    let criteria_fn = compute_functions::helpers::criteria::parse_criteria(&criteria_val);

    // Get sum range if needed
    let sum_slice: Option<&[CellValue]> = if let Some(sum_arg) = sum_range_arg {
        let (s, c, sr, er) = try_extract_single_col_range_with_sentinels(sum_arg, evaluator.meta)?;
        let cv = evaluator.meta.get_column_values(&s, c)?;
        let s_start = sr as usize;
        let s_end = (er as usize).saturating_add(1).min(cv.len());
        Some(if s_start < s_end {
            &cv[s_start..s_end]
        } else {
            &[] as &[CellValue]
        })
    } else if is_sum_variant {
        // SUMIF/AVERAGEIF with no sum_range: use criteria range as sum range
        Some(criteria_slice)
    } else {
        None
    };

    let result = scan_single_criteria(criteria_slice, &*criteria_fn, sum_slice, total_rows, op);

    Some(Ok(result))
}
