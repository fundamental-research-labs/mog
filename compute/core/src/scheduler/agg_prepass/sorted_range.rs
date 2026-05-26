use super::*;

// ---------------------------------------------------------------------------
// Sorted-range prepass types
// ---------------------------------------------------------------------------

/// Comparison operator for range-query criteria.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RangeOp {
    Gte, // >=
    Lte, // <=
    Gt,  // >
    Lt,  // <
}

/// A single bound in a range query.
#[derive(Debug, Clone)]
pub(super) struct RangeBound {
    op: RangeOp,
    /// Column in the output row that provides the threshold value.
    dynamic_col: u32,
    dynamic_sheet: SheetId,
}

/// Plan for executing a group via the sorted-range prepass.
pub(super) struct RangePrepassPlan {
    /// Static criteria: (pair_index, criteria_source) for pre-filtering data rows.
    pub(crate) static_criteria: SmallVec<[(usize, CriteriaSource); 4]>,
    /// The data column that all range criteria query against.
    /// (sheet, col, start_row, end_row)
    pub(crate) range_data_col: (SheetId, u32, u32, u32),
    /// Lower bound (>= or >), if present.
    pub(crate) lower_bound: Option<RangeBound>,
    /// Upper bound (<= or <), if present.
    pub(crate) upper_bound: Option<RangeBound>,
}

/// Entry in the sorted range index: (range_column_value, sum_column_value, original_row_index).
/// `sum_val` is 0.0 for non-numeric values in the sum column (Excel SUMIFS behavior).
pub(crate) struct SortedRangeEntry {
    range_val: f64,
    sum_val: f64,
    /// Whether the sum column value was numeric. Used by AVERAGEIFS to exclude
    /// non-numeric entries from both numerator and denominator (matching Excel).
    is_numeric: bool,
    #[allow(dead_code)] // Diagnostic: populated for debug logging
    row_idx: u32,
}

/// Try to build a sorted-range prepass plan for a group with DynamicWithPrefix criteria.
///
/// Returns `Some(plan)` if the group is eligible:
/// - Has 1-2 DynamicWithPrefix criteria with comparison-operator prefix (>=, <=, >, <)
/// - All DynamicWithPrefix criteria reference the SAME data column
/// - Remaining criteria are static (can be used for pre-filtering)
///
/// Returns `None` if ineligible (falls through to normal per-cell evaluation).
pub(super) fn try_build_range_prepass_plan(pattern: &AggPattern) -> Option<RangePrepassPlan> {
    let mut static_criteria: SmallVec<[(usize, CriteriaSource); 4]> = SmallVec::new();
    let mut range_data_col: Option<(SheetId, u32, u32, u32)> = None;
    let mut lower_bound: Option<RangeBound> = None;
    let mut upper_bound: Option<RangeBound> = None;

    for (idx, pair) in pattern.pairs.iter().enumerate() {
        match &pair.criteria {
            CriteriaSource::DynamicWithPrefix { sheet, col, prefix } => {
                // Parse the prefix to a RangeOp
                let op = parse_range_op(prefix)?;

                // All DynamicWithPrefix must reference the same data column
                let this_data_col = (
                    pair.data_sheet,
                    pair.data_col,
                    pair.data_start_row,
                    pair.data_end_row,
                );
                match &range_data_col {
                    None => range_data_col = Some(this_data_col),
                    Some(existing) => {
                        if *existing != this_data_col {
                            tracing::debug!(
                                "sorted-range bail: DynamicWithPrefix criteria on different data columns"
                            );
                            return None;
                        }
                    }
                }

                let bound = RangeBound {
                    op,
                    dynamic_col: *col,
                    dynamic_sheet: *sheet,
                };

                // Assign to lower or upper bound
                match op {
                    RangeOp::Gte | RangeOp::Gt => {
                        if lower_bound.is_some() {
                            tracing::debug!("sorted-range bail: multiple lower bounds");
                            return None;
                        }
                        lower_bound = Some(bound);
                    }
                    RangeOp::Lte | RangeOp::Lt => {
                        if upper_bound.is_some() {
                            tracing::debug!("sorted-range bail: multiple upper bounds");
                            return None;
                        }
                        upper_bound = Some(bound);
                    }
                }
            }
            // All other criteria types are static (usable for pre-filtering)
            other => {
                static_criteria.push((idx, other.clone()));
            }
        }
    }

    // Must have at least one range bound
    let range_data_col = range_data_col?;

    Some(RangePrepassPlan {
        static_criteria,
        range_data_col,
        lower_bound,
        upper_bound,
    })
}

/// Parse a DynamicWithPrefix prefix string to a RangeOp.
fn parse_range_op(prefix: &str) -> Option<RangeOp> {
    match prefix {
        ">=" => Some(RangeOp::Gte),
        "<=" => Some(RangeOp::Lte),
        ">" => Some(RangeOp::Gt),
        "<" => Some(RangeOp::Lt),
        _ => None, // Wildcards, "<>", exact match — not eligible
    }
}

// ---------------------------------------------------------------------------
// Sorted-range prepass: build pre-filtered sorted index
// ---------------------------------------------------------------------------

/// Build a pre-filtered, sorted index for the sorted-range prepass.
///
/// 1. Iterate all data rows, apply static criteria to pre-filter.
/// 2. For passing rows, extract the numeric value from the range column.
///    Skip non-numeric values (text, errors — always false for >= / <= in Excel).
/// 3. Sort by range column value.
/// 4. Pre-extract sum column values (parallel array, same order).
pub(super) fn build_sorted_range_index(
    plan: &RangePrepassPlan,
    pattern: &AggPattern,
    mirror: &CellMirror,
) -> Option<Vec<SortedRangeEntry>> {
    // Read all criteria column slices.
    // Missing columns (not in col_data) are treated as empty — all rows read
    // as CellValue::Null via the `.get(row).unwrap_or(&CellValue::Null)` below.
    let empty_col: &[CellValue] = &[];
    let mut criteria_slices: SmallVec<[&[CellValue]; 4]> = SmallVec::new();
    for pair in &pattern.pairs {
        let sheet = mirror.get_sheet(&pair.data_sheet)?;
        let slice = sheet.get_column_slice(pair.data_col).unwrap_or(empty_col);
        criteria_slices.push(slice);
    }

    // Read value column slice (for SUMIFS etc.)
    // Missing column → empty slice (all values treated as 0.0 per Excel SUMIFS semantics).
    let value_slice: Option<&[CellValue]> = if let Some((vs, vc, _, _)) = &pattern.value_range {
        let sheet = mirror.get_sheet(vs)?;
        Some(sheet.get_column_slice(*vc).unwrap_or(empty_col))
    } else {
        None
    };

    // Read range column slice.
    // Missing column → empty slice (no numeric values → empty sorted index → all results 0).
    let (range_sheet, range_col, _range_start, _range_end) = plan.range_data_col;
    let range_sheet_data = mirror.get_sheet(&range_sheet)?;
    let range_slice = range_sheet_data
        .get_column_slice(range_col)
        .unwrap_or(empty_col);

    // Determine actual row bounds (same logic as build_agg_map)
    let first = &pattern.pairs[0];
    let data_start = first.data_start_row;
    let data_end = first.data_end_row;

    let actual_start = data_start as usize;
    let actual_end = if data_end == u32::MAX {
        let mut max_len = criteria_slices.iter().map(|s| s.len()).max().unwrap_or(0);
        if let Some(vs) = &value_slice {
            max_len = max_len.max(vs.len());
        }
        max_len.max(range_slice.len())
    } else {
        let end = data_end as usize;
        let mut max_len = criteria_slices.iter().map(|s| s.len()).max().unwrap_or(0);
        if let Some(vs) = &value_slice {
            max_len = max_len.max(vs.len());
        }
        end.min(max_len.max(range_slice.len()))
    };

    if actual_start >= actual_end {
        return Some(Vec::new());
    }

    // Pre-parse StaticFilter criteria into closures
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

    // Resolve StaticFromCell values once
    let static_from_cell_vals: SmallVec<[Option<NormalizedKey>; 4]> = pattern
        .pairs
        .iter()
        .map(|pair| match &pair.criteria {
            CriteriaSource::StaticFromCell { sheet, row, col } => {
                let val = mirror
                    .get_cell_value_at(sheet, SheetPos::new(*row, *col))
                    .unwrap_or(&CellValue::Null);
                let key = NormalizedKey::from_cell_value(val);
                tracing::info!(
                    col = *col,
                    row = *row,
                    val_debug = ?val,
                    key_debug = ?key,
                    "sorted_index StaticFromCell resolved"
                );
                Some(key)
            }
            _ => None,
        })
        .collect();

    let mut entries: Vec<SortedRangeEntry> = Vec::new();

    // Diagnostic counters for tracking filter effectiveness
    let mut _total_rows_scanned: u64 = 0;
    let mut _static_exact_rejects: u64 = 0;
    let mut _static_from_cell_rejects: u64 = 0;
    let mut _static_filter_rejects: u64 = 0;
    let mut _non_numeric_range_skips: u64 = 0;

    for row in actual_start..actual_end {
        _total_rows_scanned += 1;
        // Apply static criteria filter
        let mut pass = true;
        for &(pair_idx, ref criteria) in &plan.static_criteria {
            let cell_val = criteria_slices[pair_idx]
                .get(row)
                .unwrap_or(&CellValue::Null);
            match criteria {
                CriteriaSource::StaticExact { key } => {
                    let data_key = NormalizedKey::from_cell_value(cell_val);
                    if data_key != *key {
                        pass = false;
                        _static_exact_rejects += 1;
                        break;
                    }
                }
                CriteriaSource::StaticFromCell { .. } => {
                    if let Some(ref expected_key) = static_from_cell_vals[pair_idx] {
                        let data_key = NormalizedKey::from_cell_value(cell_val);
                        if data_key != *expected_key {
                            pass = false;
                            _static_from_cell_rejects += 1;
                            break;
                        }
                    }
                }
                CriteriaSource::StaticFilter { .. } => {
                    if let Some(ref filter_fn) = static_filters[pair_idx]
                        && !filter_fn(cell_val)
                    {
                        pass = false;
                        _static_filter_rejects += 1;
                        break;
                    }
                }
                CriteriaSource::Dynamic { .. } => {
                    // Dynamic criteria without prefix — treat as static for the
                    // pre-filter by not filtering (will be handled differently, but
                    // this shouldn't happen in practice for sorted-range groups)
                }
                CriteriaSource::DynamicWithPrefix { .. } => {
                    // These are the range criteria — not used for pre-filtering
                }
            }
        }
        if !pass {
            continue;
        }

        // Extract range column value — must be numeric
        let range_val = match range_slice.get(row).unwrap_or(&CellValue::Null) {
            CellValue::Number(n) => n.get(),
            _ => {
                _non_numeric_range_skips += 1;
                continue; // Non-numeric: skip (always false for >= / <= in Excel)
            }
        };

        // Extract sum column value
        let (sum_val, is_numeric) = match &value_slice {
            Some(vs) => match vs.get(row).unwrap_or(&CellValue::Null) {
                CellValue::Number(n) => (n.get(), true),
                _ => (0.0, false), // Non-numeric sum values are 0 in Excel SUMIFS
            },
            None => (0.0, false),
        };

        entries.push(SortedRangeEntry {
            range_val,
            sum_val,
            is_numeric,
            row_idx: row as u32,
        });
    }

    let _diag_span = tracing::info_span!(
        "sorted_index_build",
        total_rows = _total_rows_scanned,
        exact_rejects = _static_exact_rejects,
        from_cell_rejects = _static_from_cell_rejects,
        filter_rejects = _static_filter_rejects,
        non_numeric_range = _non_numeric_range_skips,
        passing = entries.len() as u64,
    )
    .entered();

    // Sort by range column value (stable sort for deterministic tie-breaking)
    entries.sort_by(|a, b| {
        a.range_val
            .partial_cmp(&b.range_val)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Some(entries)
}

// ---------------------------------------------------------------------------
// Sorted-range prepass: range lookup + accumulation
// ---------------------------------------------------------------------------

/// Execute the sorted-range prepass for a group.
///
/// For each output cell:
/// 1. Resolve dynamic criteria values (the range bounds)
/// 2. Binary search the sorted index for the matching slice
/// 3. Accumulate over the matched slice
/// 4. Apply PostOp if present
pub(super) fn execute_sorted_range_prepass(
    group: &AggFormulaGroup,
    plan: &RangePrepassPlan,
    sorted_index: &[SortedRangeEntry],
    mirror: &CellMirror,
) -> Option<Vec<(CellId, CellValue)>> {
    let _span = tracing::info_span!(
        "agg_prepass_sorted_range",
        cells = group.cell_ids.len(),
        index_size = sorted_index.len(),
    )
    .entered();

    // Pre-load dynamic column slices for bound resolution
    let lower_slice: Option<&[CellValue]> = plan.lower_bound.as_ref().and_then(|b| {
        let sh = mirror.get_sheet(&b.dynamic_sheet)?;
        sh.get_column_slice(b.dynamic_col)
    });
    let upper_slice: Option<&[CellValue]> = plan.upper_bound.as_ref().and_then(|b| {
        let sh = mirror.get_sheet(&b.dynamic_sheet)?;
        sh.get_column_slice(b.dynamic_col)
    });

    let mut results = Vec::with_capacity(group.cell_ids.len());

    for (idx, &cell_id) in group.cell_ids.iter().enumerate() {
        let output_row = group.start_row + idx as u32;

        // Resolve lower bound
        let lower_idx = if let Some(ref bound) = plan.lower_bound {
            let slice = lower_slice.as_ref()?;
            let val = slice.get(output_row as usize).unwrap_or(&CellValue::Null);
            match val {
                CellValue::Number(n) => {
                    let threshold = n.get();
                    match bound.op {
                        RangeOp::Gte => sorted_index.partition_point(|e| e.range_val < threshold),
                        RangeOp::Gt => sorted_index.partition_point(|e| e.range_val <= threshold),
                        _ => 0, // unreachable for lower bound
                    }
                }
                _ => {
                    // Non-numeric bound — no rows can match.
                    // Push 0 result for this cell and continue.
                    let result = zero_result_for_agg(group.pattern.agg_fn);
                    let final_result = if let Some(ref post_op) = group.post_op {
                        apply_post_op(result, post_op, mirror)
                    } else {
                        result
                    };
                    results.push((cell_id, final_result));
                    continue;
                }
            }
        } else {
            0 // No lower bound — start from beginning
        };

        // Resolve upper bound
        let upper_idx = if let Some(ref bound) = plan.upper_bound {
            let slice = upper_slice.as_ref()?;
            let val = slice.get(output_row as usize).unwrap_or(&CellValue::Null);
            match val {
                CellValue::Number(n) => {
                    let threshold = n.get();
                    match bound.op {
                        RangeOp::Lte => sorted_index.partition_point(|e| e.range_val <= threshold),
                        RangeOp::Lt => sorted_index.partition_point(|e| e.range_val < threshold),
                        _ => sorted_index.len(), // unreachable for upper bound
                    }
                }
                _ => {
                    // Non-numeric bound — no rows can match.
                    let result = zero_result_for_agg(group.pattern.agg_fn);
                    let final_result = if let Some(ref post_op) = group.post_op {
                        apply_post_op(result, post_op, mirror)
                    } else {
                        result
                    };
                    results.push((cell_id, final_result));
                    continue;
                }
            }
        } else {
            sorted_index.len() // No upper bound — go to end
        };

        // Accumulate over the matched slice
        let matched = if lower_idx < upper_idx {
            &sorted_index[lower_idx..upper_idx]
        } else {
            &[] // Empty range
        };

        let result = match group.pattern.agg_fn {
            AggFn::CountIf | AggFn::CountIfs => CellValue::number(matched.len() as f64),
            AggFn::SumIf | AggFn::SumIfs => {
                let mut ka = KahanSum::new();
                for entry in matched {
                    ka.add(entry.sum_val);
                }
                CellValue::number(ka.total())
            }
            AggFn::AverageIf | AggFn::AverageIfs => {
                let mut ka = KahanSum::new();
                let mut count = 0u64;
                for entry in matched {
                    if entry.is_numeric {
                        ka.add(entry.sum_val);
                        count += 1;
                    }
                }
                if count == 0 {
                    CellValue::Error(CellError::Div0, None)
                } else {
                    CellValue::number(ka.total() / count as f64)
                }
            }
            AggFn::MaxIfs => {
                if matched.is_empty() {
                    CellValue::number(0.0)
                } else {
                    let mut max_val = f64::NEG_INFINITY;
                    for entry in matched {
                        if entry.sum_val > max_val {
                            max_val = entry.sum_val;
                        }
                    }
                    CellValue::number(max_val)
                }
            }
            AggFn::MinIfs => {
                if matched.is_empty() {
                    CellValue::number(0.0)
                } else {
                    let mut min_val = f64::INFINITY;
                    for entry in matched {
                        if entry.sum_val < min_val {
                            min_val = entry.sum_val;
                        }
                    }
                    CellValue::number(min_val)
                }
            }
        };

        // Apply post-op if present
        let final_result = if let Some(ref post_op) = group.post_op {
            apply_post_op(result, post_op, mirror)
        } else {
            result
        };

        results.push((cell_id, final_result));
    }

    Some(results)
}

/// Produce the zero/empty result for an aggregation function.
fn zero_result_for_agg(agg_fn: AggFn) -> CellValue {
    match agg_fn {
        AggFn::CountIf | AggFn::CountIfs => CellValue::number(0.0),
        AggFn::SumIf | AggFn::SumIfs => CellValue::number(0.0),
        AggFn::AverageIf | AggFn::AverageIfs => CellValue::Error(CellError::Div0, None),
        AggFn::MaxIfs | AggFn::MinIfs => CellValue::number(0.0),
    }
}
