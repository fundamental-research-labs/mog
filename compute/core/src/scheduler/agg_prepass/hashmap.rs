use super::*;
use compute_functions::helpers::sumifs_result_cache::{
    SumifsCacheEpoch, SumifsCacheKey, SumifsRangeIdentity,
};

// ---------------------------------------------------------------------------
// warm_sumifs_result_cache — pre-populate the eval-time SUMIFS result cache
// ---------------------------------------------------------------------------

/// Pre-populate the thread-local SUMIFS result cache for a set of patterns.
///
/// For each pattern, reads the criteria and sum column slices from the mirror
/// and calls `sumifs_result_cache::sumifs_lookup()` with the stable range key
/// and sentinel criteria values. This triggers the cache to build a
/// `SumifsResultMap` keyed by stable range identity plus the current recalc
/// epoch. When the normal eval path later calls `sumifs_lookup()` with the same
/// key, it gets an O(1) cache hit instead of rebuilding.
///
/// Only applicable to SumIfs/SumIf patterns with a value range. Other pattern
/// types are skipped.
///
/// `check_data_formulas` is the same staleness guard used by `execute_agg_group`.
/// If any data column has dirty formulas, the pattern is skipped (the cache
/// would contain stale data).
pub fn warm_sumifs_result_cache(
    patterns: &[AggPattern],
    mirror: &CellMirror,
    check_data_formulas: &impl Fn(&SheetId, u32, u32, u32) -> bool,
    sumifs_epoch: SumifsCacheEpoch,
) -> usize {
    let mut warmed = 0usize;

    for pattern in patterns {
        // Only SUMIFS/SUMIF have a value range to cache
        if !matches!(pattern.agg_fn, AggFn::SumIfs | AggFn::SumIf) {
            continue;
        }
        let (vs, vc, vstart, vend) = match &pattern.value_range {
            Some(vr) => *vr,
            None => continue,
        };

        // Check data staleness for all criteria columns and value column
        let mut stale = false;
        for pair in &pattern.pairs {
            let (start, end) = if pair.data_end_row == u32::MAX {
                let Some(sheet) = mirror.get_sheet(&pair.data_sheet) else {
                    stale = true;
                    break;
                };
                (pair.data_start_row, sheet.rows)
            } else {
                (pair.data_start_row, pair.data_end_row)
            };
            if check_data_formulas(&pair.data_sheet, pair.data_col, start, end) {
                stale = true;
                break;
            }
        }
        if stale {
            continue;
        }

        // Check value column staleness
        {
            let (start, end) = if vend == u32::MAX {
                let Some(sheet) = mirror.get_sheet(&vs) else {
                    continue;
                };
                (vstart, sheet.rows)
            } else {
                (vstart, vend)
            };
            if check_data_formulas(&vs, vc, start, end) {
                continue;
            }
        }

        // Get column slices
        let mut criteria_slices: Vec<&[CellValue]> = Vec::new();
        let mut ok = true;
        for pair in &pattern.pairs {
            let Some(sheet) = mirror.get_sheet(&pair.data_sheet) else {
                ok = false;
                break;
            };
            let Some(slice) = sheet.get_column_slice(pair.data_col) else {
                ok = false;
                break;
            };
            criteria_slices.push(slice);
        }
        if !ok {
            continue;
        }

        let Some(sum_sheet) = mirror.get_sheet(&vs) else {
            continue;
        };
        let Some(sum_slice) = sum_sheet.get_column_slice(vc) else {
            continue;
        };

        // Determine total rows (same logic as build_agg_map)
        let actual_start = pattern.pairs[0].data_start_row as usize;
        let actual_end = if pattern.pairs[0].data_end_row == u32::MAX {
            let mut max_len = criteria_slices.iter().map(|s| s.len()).max().unwrap_or(0);
            max_len = max_len.max(sum_slice.len());
            max_len
        } else {
            let end = pattern.pairs[0].data_end_row as usize;
            let mut max_len = criteria_slices.iter().map(|s| s.len()).max().unwrap_or(0);
            max_len = max_len.max(sum_slice.len());
            end.min(max_len)
        };

        if actual_start >= actual_end {
            continue;
        }

        let total_rows = actual_end - actual_start;

        // Slice the criteria and sum columns to the actual range
        // (for full-column ranges, start=0, so slicing is a no-op)
        let sliced_criteria: Vec<&[CellValue]> = criteria_slices
            .iter()
            .map(|s| {
                let end = actual_end.min(s.len());
                if actual_start < end {
                    &s[actual_start..end]
                } else {
                    &[] as &[CellValue]
                }
            })
            .collect();

        let sliced_sum = {
            let end = actual_end.min(sum_slice.len());
            if actual_start < end {
                &sum_slice[actual_start..end]
            } else {
                &[] as &[CellValue]
            }
        };

        // Trigger cache build with sentinel criteria values. The
        // SumifsResultMap is built and cached; subsequent lookups with the same
        // stable range key will hit it.
        let dummy_keys: Vec<NormalizedKey> = vec![NormalizedKey::Null; pattern.pairs.len()];
        let cache_key = sumifs_cache_key_for_pattern(
            pattern,
            sumifs_epoch,
            total_rows,
            sliced_sum.len(),
            &sliced_criteria,
        );
        let _ = compute_functions::helpers::sumifs_result_cache::sumifs_lookup(
            &cache_key,
            &sliced_criteria,
            sliced_sum,
            total_rows,
            &dummy_keys,
        );

        warmed += 1;
    }

    warmed
}

fn sumifs_cache_key_for_pattern(
    pattern: &AggPattern,
    epoch: SumifsCacheEpoch,
    total_rows: usize,
    sum_effective_len: usize,
    criteria_slices: &[&[CellValue]],
) -> SumifsCacheKey {
    let (sum_sheet, sum_col, sum_start_row, sum_end_row) = pattern
        .value_range
        .expect("SUMIFS warm cache requires a value range");
    let sum_range = SumifsRangeIdentity::sum_range(
        sum_sheet.as_u128(),
        sum_col,
        sum_start_row,
        sum_end_row,
        sum_effective_len,
    );
    let criteria_ranges = pattern
        .pairs
        .iter()
        .enumerate()
        .map(|(order, pair)| {
            SumifsRangeIdentity::criteria_range(
                order as u32,
                pair.data_sheet.as_u128(),
                pair.data_col,
                pair.data_start_row,
                pair.data_end_row,
                criteria_slices.get(order).map_or(0, |s| s.len()),
            )
        })
        .collect();
    SumifsCacheKey::new(epoch, total_rows, sum_range, criteria_ranges)
}

// ---------------------------------------------------------------------------
// build_agg_map
// ---------------------------------------------------------------------------

/// Build a hash map from the data range in a single O(N) pass.
///
/// Returns `None` if any column slice is unavailable (e.g. sheet not found).
pub fn build_agg_map(
    pattern: &AggPattern,
    mirror: &CellMirror,
) -> Option<FxHashMap<AggKey, AggAccum>> {
    if pattern.pairs.is_empty() {
        return None;
    }

    // Validate all pairs share the same row range.
    let first = &pattern.pairs[0];
    let data_start = first.data_start_row;
    let data_end = first.data_end_row;

    for pair in &pattern.pairs[1..] {
        if pair.data_start_row != data_start || pair.data_end_row != data_end {
            return None;
        }
    }

    // Read column slices for each criteria dimension.
    // Missing columns (not in col_data) are treated as empty — all rows read
    // as CellValue::Null via `.get(row).unwrap_or(&CellValue::Null)`.
    let empty_col: &[CellValue] = &[];
    let mut criteria_slices: SmallVec<[&[CellValue]; 4]> = SmallVec::new();
    for pair in &pattern.pairs {
        let sheet = mirror.get_sheet(&pair.data_sheet)?;
        let slice = sheet.get_column_slice(pair.data_col).unwrap_or(empty_col);
        criteria_slices.push(slice);
    }

    // Read value column slice if needed (before computing actual_end so we
    // can include it in the length calculation).
    // Missing column → empty slice (all values treated as Null).
    let value_slice: Option<&[CellValue]> = if let Some((vs, vc, _, _)) = &pattern.value_range {
        let sheet = mirror.get_sheet(vs)?;
        Some(sheet.get_column_slice(*vc).unwrap_or(empty_col))
    } else {
        None
    };

    // Determine actual row bounds (clamp ColumnRange sentinel to slice length).
    // Use the maximum of all slice lengths (criteria + value) so that no rows
    // are missed when column slices have different lengths (e.g., different
    // columns on the same sheet with different data extents).
    let actual_start = data_start as usize;
    let actual_end = if data_end == u32::MAX {
        // ColumnRange: use the maximum slice length
        let mut max_len = criteria_slices.iter().map(|s| s.len()).max().unwrap_or(0);
        if let Some(vs) = &value_slice {
            max_len = max_len.max(vs.len());
        }
        max_len
    } else {
        let end = data_end as usize;
        // Clamp to maximum slice length
        let mut max_len = criteria_slices.iter().map(|s| s.len()).max().unwrap_or(0);
        if let Some(vs) = &value_slice {
            max_len = max_len.max(vs.len());
        }
        end.min(max_len)
    };

    if actual_start >= actual_end {
        return Some(FxHashMap::default());
    }

    // Bail if any criteria is DynamicWithPrefix — cannot build hash map for
    // range/comparison criteria that change per output cell.
    for pair in &pattern.pairs {
        if matches!(&pair.criteria, CriteriaSource::DynamicWithPrefix { .. }) {
            return None;
        }
    }

    // Pre-parse StaticFilter criteria into closures (build once, test per row).
    let static_filters: StaticFilterVec = pattern
        .pairs
        .iter()
        .map(|pair| match &pair.criteria {
            CriteriaSource::StaticFilter { text } => {
                Some(parse_criteria(&CellValue::Text(text.clone().into())))
            }
            _ => None,
        })
        .collect();

    let mut map: FxHashMap<AggKey, AggAccum> = FxHashMap::default();

    for row in actual_start..actual_end {
        // Check StaticFilter criteria first (skip row early if any fails).
        let mut skip = false;
        for (idx, pair) in pattern.pairs.iter().enumerate() {
            if let CriteriaSource::StaticFilter { .. } = &pair.criteria {
                let cell_val = criteria_slices[idx].get(row).unwrap_or(&CellValue::Null);
                if let Some(ref filter_fn) = static_filters[idx]
                    && !filter_fn(cell_val)
                {
                    skip = true;
                    break;
                }
            }
        }
        if skip {
            continue;
        }

        // Build composite key from all dimensions.
        // Dynamic + StaticExact: push the actual DATA value so that at lookup
        // time the static key only matches rows with the correct data.
        // StaticFilter: already filtered above; use constant placeholder.
        // StaticFromCell: push the data value (matched against the resolved cell value at lookup).
        let mut key: AggKey = SmallVec::new();
        for (idx, pair) in pattern.pairs.iter().enumerate() {
            match &pair.criteria {
                CriteriaSource::Dynamic { .. }
                | CriteriaSource::StaticExact { .. }
                | CriteriaSource::StaticFromCell { .. } => {
                    let cell_val = criteria_slices[idx].get(row).unwrap_or(&CellValue::Null);
                    key.push(NormalizedKey::from_cell_value(cell_val));
                }
                CriteriaSource::StaticFilter { .. } => {
                    // Already filtered; use a constant placeholder in the key.
                    key.push(NormalizedKey::Null);
                }
                CriteriaSource::DynamicWithPrefix { .. } => {
                    // Unreachable — we bail above if any pair has this variant.
                    unreachable!("DynamicWithPrefix should have been caught above");
                }
            }
        }

        // Read the value for accumulation.
        let num_val: Option<f64> = match &value_slice {
            Some(vs) => {
                let v = vs.get(row).unwrap_or(&CellValue::Null);
                match v {
                    CellValue::Number(n) => Some(n.get()),
                    _ => None,
                }
            }
            None => None,
        };

        // Accumulate into the map.
        let entry = map.entry(key);
        match pattern.agg_fn {
            AggFn::CountIf | AggFn::CountIfs => {
                let acc = entry.or_insert(AggAccum::Count(0));
                if let AggAccum::Count(c) = acc {
                    *c += 1;
                }
            }
            AggFn::SumIf | AggFn::SumIfs | AggFn::AverageIf | AggFn::AverageIfs => {
                let acc = entry.or_insert(AggAccum::Sum {
                    acc: KahanSum::new(),
                    count: 0,
                });
                if let AggAccum::Sum { acc: ka, count } = acc
                    && let Some(v) = num_val
                {
                    ka.add(v);
                    *count += 1;
                }
            }
            AggFn::MaxIfs => {
                let acc = entry.or_insert(AggAccum::Max {
                    val: f64::NEG_INFINITY,
                    count: 0,
                });
                if let AggAccum::Max { val, count } = acc
                    && let Some(v) = num_val
                {
                    if *count == 0 || v > *val {
                        *val = v;
                    }
                    *count += 1;
                }
            }
            AggFn::MinIfs => {
                let acc = entry.or_insert(AggAccum::Min {
                    val: f64::INFINITY,
                    count: 0,
                });
                if let AggAccum::Min { val, count } = acc
                    && let Some(v) = num_val
                {
                    if *count == 0 || v < *val {
                        *val = v;
                    }
                    *count += 1;
                }
            }
        }
    }

    Some(map)
}

// ---------------------------------------------------------------------------
// execute_agg_group
// ---------------------------------------------------------------------------

/// Execute an aggregation group using the prepass map.
///
/// For each output cell in the group, reads dynamic criteria values from the mirror,
/// builds a lookup key, and resolves the result from the pre-built map.
///
/// `check_data_formulas` is called with `(sheet, col, start_row, end_row)` to verify
/// that no dirty formula cells exist in the data range. If any do, returns `None` to
/// force fallback to normal evaluation (formula cells may have stale values).
///
/// `check_criteria_stale` is called with `(sheet, col, start_row, end_row)` for dynamic
/// criteria columns. Unlike `check_data_formulas`, this also detects stale spill
/// projections whose source formula hasn't been evaluated yet. Returns `true` if
/// any position in the range has a dirty formula OR an unevaluated spill projection.
pub fn execute_agg_group(
    group: &AggFormulaGroup,
    mirror: &CellMirror,
    check_data_formulas: impl Fn(&SheetId, u32, u32, u32) -> bool,
    check_criteria_stale: impl Fn(&SheetId, u32, u32, u32) -> bool,
) -> Option<Vec<(CellId, CellValue)>> {
    // Guard: bail if any data column contains dirty formulas.
    for (pair_idx, pair) in group.pattern.pairs.iter().enumerate() {
        let (start, end) = if pair.data_end_row == u32::MAX {
            let sheet = mirror.get_sheet(&pair.data_sheet)?;
            (pair.data_start_row, sheet.rows)
        } else {
            (pair.data_start_row, pair.data_end_row)
        };
        if check_data_formulas(&pair.data_sheet, pair.data_col, start, end) {
            let _span = tracing::info_span!(
                "agg_group_bail",
                reason = "data_formula_guard",
                cells = group.cell_ids.len(),
                pair_idx = pair_idx as u64,
                data_col = pair.data_col as u64,
            )
            .entered();
            return None;
        }
    }
    if let Some((vs, vc, vstart, vend)) = &group.pattern.value_range {
        let (start, end) = if *vend == u32::MAX {
            let sheet = mirror.get_sheet(vs)?;
            (*vstart, sheet.rows)
        } else {
            (*vstart, *vend)
        };
        if check_data_formulas(vs, *vc, start, end) {
            let _span = tracing::info_span!(
                "agg_group_bail",
                reason = "value_col_formula_guard",
                cells = group.cell_ids.len(),
                value_col = *vc as u64,
            )
            .entered();
            return None;
        }
    }

    // Guard: bail if any dynamic criteria column contains dirty formulas
    // or stale spill projections in the output row range. Without this,
    // spill-target criteria (e.g., SUMIF(Data!A:A, B4, Data!B:B) where B4
    // is a spill projection) would read stale/null values from the mirror
    // before the spill source formula has been evaluated.
    //
    // Uses `check_criteria_stale` instead of `check_data_formulas` to also
    // detect stale spill projections. This is more precise: data-only columns
    // (no formulas, no projections) pass through without false-positive bails.
    for (pair_idx, pair) in group.pattern.pairs.iter().enumerate() {
        let criteria_range = match &pair.criteria {
            CriteriaSource::Dynamic { sheet, col }
            | CriteriaSource::DynamicWithPrefix { sheet, col, .. } => Some((
                *sheet,
                *col,
                group.start_row,
                group.start_row + group.cell_ids.len() as u32,
            )),
            // StaticFromCell references a single cell (e.g., BK$4) that may contain
            // a formula. Check staleness for that specific cell's row.
            CriteriaSource::StaticFromCell { sheet, row, col } => {
                Some((*sheet, *col, *row, *row + 1))
            }
            _ => None,
        };
        if let Some((crit_sheet, crit_col, row_start, row_end)) = criteria_range
            && check_criteria_stale(&crit_sheet, crit_col, row_start, row_end)
        {
            let _span = tracing::info_span!(
                "agg_group_bail",
                reason = "criteria_formula_guard",
                cells = group.cell_ids.len(),
                pair_idx = pair_idx as u64,
                criteria_col = crit_col as u64,
            )
            .entered();
            return None;
        }
    }

    // Build the aggregation map.
    let map = match build_agg_map(&group.pattern, mirror) {
        Some(m) => m,
        None => {
            // Hash-map path failed (likely DynamicWithPrefix criteria).
            // Try the sorted-range prepass as a fallback.
            if let Some(plan) = try_build_range_prepass_plan(&group.pattern) {
                if let Some(sorted_index) = build_sorted_range_index(&plan, &group.pattern, mirror)
                {
                    tracing::info!(
                        cells = group.cell_ids.len(),
                        filtered_rows = sorted_index.len(),
                        "sorted-range prepass activated"
                    );
                    return execute_sorted_range_prepass(group, &plan, &sorted_index, mirror);
                }
                let _span = tracing::info_span!(
                    "agg_group_bail",
                    reason = "sorted_index_failed",
                    cells = group.cell_ids.len(),
                )
                .entered();
            } else {
                let _span = tracing::info_span!(
                    "agg_group_bail",
                    reason = "no_range_plan",
                    cells = group.cell_ids.len(),
                )
                .entered();
            }
            return None;
        }
    };

    // Pre-load dynamic criteria column slices for output lookup.
    struct DynCol<'a> {
        slice: &'a [CellValue],
    }

    let mut dyn_cols: SmallVec<[Option<DynCol<'_>>; 4]> = SmallVec::new();
    for pair in &group.pattern.pairs {
        match &pair.criteria {
            CriteriaSource::Dynamic { sheet, col } => {
                let sm = mirror.get_sheet(sheet)?;
                let slice = sm.get_column_slice(*col)?;
                dyn_cols.push(Some(DynCol { slice }));
            }
            _ => {
                dyn_cols.push(None);
            }
        }
    }

    // Resolve each output cell.
    let mut results = Vec::with_capacity(group.cell_ids.len());

    for (idx, &cell_id) in group.cell_ids.iter().enumerate() {
        let output_row = group.start_row + idx as u32;

        // Build lookup key.
        let mut key: AggKey = SmallVec::new();
        for (pair_idx, pair) in group.pattern.pairs.iter().enumerate() {
            match &pair.criteria {
                CriteriaSource::Dynamic { .. } => {
                    if let Some(ref dc) = dyn_cols[pair_idx] {
                        let v = dc
                            .slice
                            .get(output_row as usize)
                            .unwrap_or(&CellValue::Null);
                        key.push(NormalizedKey::from_cell_value(v));
                    } else {
                        key.push(NormalizedKey::Null);
                    }
                }
                CriteriaSource::StaticExact { key: k } => {
                    key.push(k.clone());
                }
                CriteriaSource::StaticFilter { .. } => {
                    key.push(NormalizedKey::Null);
                }
                CriteriaSource::StaticFromCell { sheet, row, col } => {
                    let val = mirror
                        .get_cell_value_at(sheet, SheetPos::new(*row, *col))
                        .unwrap_or(&CellValue::Null);
                    key.push(NormalizedKey::from_cell_value(val));
                }
                CriteriaSource::DynamicWithPrefix { .. } => {
                    // Should not reach here — build_agg_map returns None for
                    // groups with DynamicWithPrefix criteria.
                    return None;
                }
            }
        }

        // Look up and convert to CellValue.
        let result = match group.pattern.agg_fn {
            AggFn::CountIf | AggFn::CountIfs => {
                let count = match map.get(&key) {
                    Some(AggAccum::Count(c)) => *c as f64,
                    _ => 0.0,
                };
                CellValue::number(count)
            }
            AggFn::SumIf | AggFn::SumIfs => {
                let total = match map.get(&key) {
                    Some(AggAccum::Sum { acc, .. }) => acc.total(),
                    _ => 0.0,
                };
                CellValue::number(total)
            }
            AggFn::AverageIf | AggFn::AverageIfs => match map.get(&key) {
                Some(AggAccum::Sum { acc, count }) if *count > 0 => {
                    CellValue::number(acc.total() / *count as f64)
                }
                _ => CellValue::Error(CellError::Div0, None),
            },
            AggFn::MaxIfs => {
                let val = match map.get(&key) {
                    Some(AggAccum::Max { val, count }) if *count > 0 => *val,
                    _ => 0.0,
                };
                CellValue::number(val)
            }
            AggFn::MinIfs => {
                let val = match map.get(&key) {
                    Some(AggAccum::Min { val, count }) if *count > 0 => *val,
                    _ => 0.0,
                };
                CellValue::number(val)
            }
        };

        // Apply post-op if present (e.g., SUMIFS(...) / $DD$2).
        let final_result = if let Some(ref post_op) = group.post_op {
            apply_post_op(result, post_op, mirror)
        } else {
            result
        };

        results.push((cell_id, final_result));
    }

    Some(results)
}
