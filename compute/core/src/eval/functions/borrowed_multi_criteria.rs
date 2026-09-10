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
//! 2. **Borrowed path** (this module): borrows native column views, avoiding
//!    O(n) allocation per range argument. Grouped result caches serve repeated
//!    exact-match sums within a recalculation. Criteria evaluation is async.
//!
//! This adapter handles AST argument extraction, cache interaction, bitmask
//! fast paths, and dispatch — all of which require
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
use value_types::ColumnView;
use value_types::{CellValue, ComputeError};

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
    let mut range_slices: Vec<ColumnView<'_>> = Vec::new();
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
            col_values.slice(start..end)
        } else {
            ColumnView::empty()
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
    let sum_slice: Option<ColumnView<'_>> = if let Some(sum_arg) = sum_range_arg {
        let (sheet, col, start_row, end_row) =
            try_extract_single_col_range_with_sentinels(sum_arg, evaluator.meta)?;
        sum_range_coords = Some((sheet, col, start_row, end_row));
        let col_values = evaluator.meta.get_column_values(&sheet, col)?;
        let start = start_row as usize;
        let end = (end_row as usize).saturating_add(1).min(col_values.len());
        Some(if start < end {
            col_values.slice(start..end)
        } else {
            ColumnView::empty()
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
    // when thousands of SUMIFS share the same ranges.
    if matches!(op, AggregateOp::Sum)
        && unwrapped_criteria
            .iter()
            .all(|cv| is_exact_match_criteria(cv))
        && let Some(ss) = sum_slice
        && let Some(sumifs_epoch) = evaluator.meta.sumifs_cache_epoch()
    {
        let criteria_keys: Vec<NormalizedKey> = unwrapped_criteria
            .iter()
            .map(|cv| NormalizedKey::from_criteria(cv))
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
            &ss,
            total_rows,
            &criteria_keys,
        );

        return Some(Ok(match result {
            Ok(sum) => CellValue::number(sum),
            Err(e) => CellValue::Error(e, None),
        }));
    }

    // An exact criterion can narrow the rows even when another criterion uses
    // an operator or wildcard. Build only exact-match masks; other criteria
    // may reuse an existing mask, or run on the selected rows below.
    let mut bitmask_path: Option<ColumnBitset> = None;
    let mut masked_criteria = vec![false; range_coords.len()];
    for (i, &(ref sheet, col, start_row, end_row)) in range_coords.iter().enumerate() {
        let mask = evaluator
            .meta
            .get_criteria_bitmask(
                sheet,
                col,
                start_row,
                end_row,
                unwrapped_criteria[i],
                range_slices[i],
            )
            .or_else(|| {
                if is_exact_match_criteria(unwrapped_criteria[i]) {
                    evaluator.meta.get_or_build_criteria_bitmask(
                        sheet,
                        col,
                        start_row,
                        end_row,
                        unwrapped_criteria[i],
                        range_slices[i],
                    )
                } else {
                    None
                }
            });
        if let Some(mask) = mask {
            let mask =
                align_criteria_mask(mask, total_rows as u32, criteria_fns[i](&CellValue::Null));
            if let Some(combined) = &mut bitmask_path {
                combined.and_assign(&mask);
            } else {
                bitmask_path = Some(mask);
            }
            masked_criteria[i] = true;
        }
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
        // Preserve source row order and the ordinary predicate semantics for
        // any criterion that was not represented by a cached mask.
        bmc_span.record("fast_path", 1u64);
        let matching_rows = combined.ones().map(|row| row as usize).filter(|&row| {
            criteria_fns.iter().enumerate().all(|(i, criterion)| {
                masked_criteria[i]
                    || criterion(range_slices[i].get(row).unwrap_or(&CellValue::Null))
            })
        });
        aggregate_matching_rows(matching_rows, sum_slice.as_ref(), op)
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
                let bitmap = align_criteria_mask(
                    index.query_exact(unwrapped_criteria[i]),
                    total_rows as u32,
                    criteria_fns[i](&CellValue::Null),
                );
                combined.and_assign(&bitmap);
            }
            Some(combined)
        })();

        if let Some(ref combined) = column_index_result {
            bmc_span.record("fast_path", 2u64);
            aggregate_matching_rows(combined.ones().map(|i| i as usize), sum_slice.as_ref(), op)
        } else {
            bmc_span.record("fast_path", 0u64);
            // Final fallback: multi-criteria linear scan
            scan_multi_criteria(
                &range_slices,
                &criteria_fns,
                sum_slice.as_ref(),
                total_rows,
                op,
            )
        }
    };

    Some(Ok(result))
}

fn align_criteria_mask(mask: ColumnBitset, rows: u32, null_matches: bool) -> ColumnBitset {
    if mask.len() == rows {
        return mask;
    }
    let mut aligned = ColumnBitset::new_all_false(rows);
    for row in mask.ones().take_while(|&row| row < rows) {
        aligned.set(row, true);
    }
    // A shorter criteria column reads as Null, just like the scanning path.
    if null_matches {
        for row in mask.len()..rows {
            aligned.set(row, true);
        }
    }
    aligned
}

fn sumifs_cache_key(
    epoch: SumifsCacheEpoch,
    total_rows: usize,
    sum_range: (SheetId, u32, u32, u32, usize),
    criteria_ranges: &[(SheetId, u32, u32, u32)],
    criteria_slices: &[ColumnView<'_>],
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
        col_values.slice(start..end)
    } else {
        ColumnView::empty()
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

    let (sum_coords, sum_slice) = if let Some(sum_arg) = sum_range_arg {
        let (s, c, sr, er) = try_extract_single_col_range_with_sentinels(sum_arg, evaluator.meta)?;
        let cv = evaluator.meta.get_column_values(&s, c)?;
        let s_start = sr as usize;
        let s_end = (er as usize).saturating_add(1).min(cv.len());
        let slice = if s_start < s_end {
            cv.slice(s_start..s_end)
        } else {
            ColumnView::empty()
        };
        (Some((s, c, sr, er, slice.len())), Some(slice))
    } else if is_sum_variant {
        (
            Some((sheet, col, start_row, end_row, criteria_slice.len())),
            Some(criteria_slice),
        )
    } else {
        (None, None)
    };

    // Repeated scalar SUMIF calls share a grouped result map. Text matching
    // retains the normal coercion/case rules. Numeric lookup falls back when
    // multiple distinct values match the tolerance, preserving row-order sums.
    let text_criterion = compute_functions::helpers::criteria::plain_text_criteria(&criteria_val);
    let numeric_criterion =
        compute_functions::helpers::criteria::numeric_equality_criteria(&criteria_val);
    if matches!(op, AggregateOp::Sum)
        && (text_criterion.is_some() || numeric_criterion.is_some())
        && let Some(epoch) = evaluator.meta.sumifs_cache_epoch()
        && let Some(ss) = sum_slice
    {
        let sum_coordinates = sum_coords?;
        let cache_key = sumifs_cache_key(
            epoch,
            total_rows,
            sum_coordinates,
            &[(sheet, col, start_row, end_row)],
            &[criteria_slice],
        );
        let criteria_version = evaluator.meta.col_version(&sheet, col);
        let sum_version = evaluator
            .meta
            .col_version(&sum_coordinates.0, sum_coordinates.1);
        let result = if let Some(text) = text_criterion {
            Some(
                compute_functions::helpers::sumifs_result_cache::sumifs_lookup(
                    &cache_key.with_text_criteria(criteria_version, sum_version),
                    &[criteria_slice],
                    &ss,
                    total_rows,
                    &[NormalizedKey::Text(text.to_ascii_lowercase())],
                ),
            )
        } else {
            compute_functions::helpers::sumifs_result_cache::sumif_numeric_lookup(
                &cache_key.with_numeric_criteria(criteria_version, sum_version),
                &[criteria_slice],
                &ss,
                total_rows,
                numeric_criterion?,
            )
        };
        if let Some(result) = result {
            return Some(Ok(match result {
                Ok(sum) => CellValue::number(sum),
                Err(e) => CellValue::Error(e, None),
            }));
        }
    }

    let criteria_fn = compute_functions::helpers::criteria::parse_criteria(&criteria_val);
    let result = scan_single_criteria(
        &criteria_slice,
        &*criteria_fn,
        sum_slice.as_ref(),
        total_rows,
        op,
    );

    Some(Ok(result))
}
