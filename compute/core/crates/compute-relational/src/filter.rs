//! WHERE clause — row-level filtering.
//!
//! Applies include/exclude lists, conditions, and top/bottom N filters
//! in order. Delegates to `compute_stats` for condition matching and
//! value normalization.

use std::collections::{HashMap, HashSet};

use value_types::CellValue;

use compute_stats::filter::matches_condition;
use compute_stats::values::{
    cell_value_filter_keys, cell_value_is_numeric, cell_value_to_key, kahan_sum,
};

use crate::types::{
    AggregateFunction, FilterCondition, Measure, QueryFilter, TopBottomBy, TopBottomType,
};

/// Apply all filters to the source data, returning indices of rows that pass.
///
/// Each filter narrows the surviving index set further (AND logic).
///
/// # Parameters
///
/// - `data`: source data rows (row 0 is headers, already skipped by caller — indices are 0-based into data rows)
/// - `indices`: initial set of row indices to consider
/// - `filters`: query filter configurations
/// - `measures`: value measures (for top/bottom N ranking)
#[must_use]
pub(crate) fn apply_filters(
    data: &[Vec<CellValue>],
    indices: Vec<usize>,
    filters: &[QueryFilter],
    measures: &[Measure],
) -> Vec<usize> {
    let mut surviving = indices;

    for filter in filters {
        surviving = apply_single_filter(data, &surviving, filter, measures);
    }

    surviving
}

/// Apply a single filter to the surviving index set.
///
/// Application order:
/// 1. Include list (allowlist)
/// 2. Exclude list (denylist)
/// 3. Condition (per-row predicate)
/// 4. showItemsWithNoData (blank removal)
/// 5. Top/Bottom N (ranking)
fn apply_single_filter(
    data: &[Vec<CellValue>],
    indices: &[usize],
    filter: &QueryFilter,
    measures: &[Measure],
) -> Vec<usize> {
    let mut surviving: Vec<usize> = indices.to_vec();
    let column_index = filter.column_index;

    let get_value = |row_idx: usize| -> &CellValue {
        data.get(row_idx)
            .and_then(|row| row.get(column_index))
            .unwrap_or(&CellValue::Null)
    };

    // 1. Include list.
    //
    // Type-tolerant matching: a filter value of `Text("2024")` matches both
    // `Text("2024")` and `Number(2024)` cell values. This is required because
    // user-supplied filter values (typed into UIs, persisted as strings in
    // OOXML, etc.) frequently disagree with the cell's underlying type.
    // `cell_value_filter_keys` returns the canonical key plus type-coerced
    // alternates; we insert every alternate into the include set.
    if let Some(ref include_values) = filter.include_values
        && !include_values.is_empty()
    {
        let include_set: HashSet<String> = include_values
            .iter()
            .flat_map(cell_value_filter_keys)
            .collect();
        surviving.retain(|&idx| {
            let key = cell_value_to_key(get_value(idx));
            include_set.contains(key.as_ref())
        });
    }

    // 2. Exclude list. Same type-tolerant alternate-key strategy as include.
    if let Some(ref exclude_values) = filter.exclude_values
        && !exclude_values.is_empty()
    {
        let exclude_set: HashSet<String> = exclude_values
            .iter()
            .flat_map(cell_value_filter_keys)
            .collect();
        surviving.retain(|&idx| {
            let key = cell_value_to_key(get_value(idx));
            !exclude_set.contains(key.as_ref())
        });
    }

    // 3. Condition.
    if let Some(ref condition) = filter.condition {
        match condition {
            FilterCondition::Pivot(pivot_condition) => {
                use compute_stats::types::{NullaryFilterOp, PivotFilterCondition};
                match pivot_condition {
                    PivotFilterCondition::Nullary(
                        NullaryFilterOp::AboveAverage | NullaryFilterOp::BelowAverage,
                    ) => {
                        let numbers: Vec<f64> = surviving
                            .iter()
                            .filter_map(|&idx| {
                                let v = get_value(idx);
                                if cell_value_is_numeric(v) {
                                    v.as_number()
                                } else {
                                    None
                                }
                            })
                            .collect();

                        if !numbers.is_empty() {
                            let sum = kahan_sum(numbers.iter().copied());
                            #[allow(clippy::cast_precision_loss)]
                            let avg = sum / numbers.len() as f64;
                            let is_above = matches!(
                                pivot_condition,
                                PivotFilterCondition::Nullary(NullaryFilterOp::AboveAverage)
                            );

                            surviving.retain(|&idx| {
                                let v = get_value(idx);
                                if let CellValue::Number(n) = v {
                                    if is_above {
                                        n.get() > avg
                                    } else {
                                        n.get() < avg
                                    }
                                } else {
                                    false
                                }
                            });
                        }
                    }
                    _ => {
                        surviving.retain(|&idx| matches_condition(get_value(idx), pivot_condition));
                    }
                }
            }
        }
    }

    // 4. Blank removal.
    if !filter.show_items_with_no_data {
        let blanks_explicitly_included = filter
            .include_values
            .as_ref()
            .is_some_and(|vals| vals.iter().any(value_types::CellValue::is_visually_blank));
        if !blanks_explicitly_included {
            surviving.retain(|&idx| !get_value(idx).is_visually_blank());
        }
    }

    // 5. Top/Bottom N.
    if let Some(ref top_bottom) = filter.top_bottom {
        surviving = apply_top_bottom(data, &surviving, top_bottom, column_index, measures);
    }

    surviving
}

/// Apply a top/bottom N filter.
fn apply_top_bottom(
    data: &[Vec<CellValue>],
    indices: &[usize],
    top_bottom: &crate::types::TopBottomFilter,
    field_column_index: usize,
    measures: &[Measure],
) -> Vec<usize> {
    struct RankedGroup {
        key: String,
        aggregate_value: f64,
    }

    let n_raw = top_bottom.n;
    let by = top_bottom.by;
    let filter_type = top_bottom.filter_type;

    // Count mode ranks by row count. Items/Percent/Sum rank by the selected
    // measure; Items and Percent differ only in how `n` is interpreted.
    let rank_measure: Option<&Measure> = if by == TopBottomBy::Count {
        None
    } else {
        let idx = top_bottom.measure_index.unwrap_or(0);
        measures.get(idx)
    };

    if rank_measure.is_none() && by != TopBottomBy::Count {
        return indices.to_vec();
    }

    let get_value = |row_idx: usize, col: usize| -> &CellValue {
        data.get(row_idx)
            .and_then(|row| row.get(col))
            .unwrap_or(&CellValue::Null)
    };

    // Group indices by field value.
    let mut groups: HashMap<String, Vec<usize>> = HashMap::new();
    let mut group_order: Vec<String> = Vec::new();

    for &idx in indices {
        let val = get_value(idx, field_column_index);
        let key = cell_value_to_key(val).into_owned();
        if !groups.contains_key(&key) {
            group_order.push(key.clone());
        }
        groups.entry(key).or_default().push(idx);
    }

    let mut ranked: Vec<RankedGroup> = Vec::with_capacity(group_order.len());

    for key in &group_order {
        let group_indices = groups.get(key).unwrap();
        let aggregate_value = if by == TopBottomBy::Count {
            #[allow(clippy::cast_precision_loss)]
            let count = group_indices.len() as f64;
            count
        } else {
            let measure = rank_measure.unwrap();
            let values: Vec<CellValue> = group_indices
                .iter()
                .map(|&idx| get_value(idx, measure.column_index).clone())
                .collect();
            let agg_fn = map_aggregate_function(measure.aggregate);
            let aggregated = compute_stats::aggregate::aggregate(agg_fn, &values);
            match aggregated {
                CellValue::Number(n) => n.get(),
                _ => 0.0,
            }
        };

        ranked.push(RankedGroup {
            key: key.clone(),
            aggregate_value,
        });
    }

    // Sort by aggregate value.
    match filter_type {
        TopBottomType::Top => {
            ranked.sort_by(|a, b| {
                b.aggregate_value
                    .partial_cmp(&a.aggregate_value)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
        }
        TopBottomType::Bottom => {
            ranked.sort_by(|a, b| {
                a.aggregate_value
                    .partial_cmp(&b.aggregate_value)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
        }
    }

    // Determine how many groups to keep.
    let mut keep_count = match by {
        TopBottomBy::Items | TopBottomBy::Count => {
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let item_count = n_raw.round() as usize;
            item_count.min(ranked.len())
        }
        TopBottomBy::Percent => {
            #[allow(
                clippy::cast_precision_loss,
                clippy::cast_possible_truncation,
                clippy::cast_sign_loss
            )]
            let pct_count = ((ranked.len() as f64) * n_raw / 100.0).ceil() as usize;
            pct_count.min(ranked.len())
        }
        TopBottomBy::Sum => {
            let mut cumulative = 0.0;
            let mut count = 0;
            for group in &ranked {
                cumulative += group.aggregate_value;
                count += 1;
                if cumulative >= n_raw {
                    break;
                }
            }
            count.min(ranked.len())
        }
    };

    // Tie-breaking: include ALL tied items at the boundary.
    if keep_count > 0 && keep_count < ranked.len() {
        let cutoff_value = ranked[keep_count - 1].aggregate_value;
        while keep_count < ranked.len() {
            if (ranked[keep_count].aggregate_value - cutoff_value).abs() < f64::EPSILON {
                keep_count += 1;
            } else {
                break;
            }
        }
    }

    let kept_keys: HashSet<&str> = ranked[..keep_count]
        .iter()
        .map(|g| g.key.as_str())
        .collect();

    indices
        .iter()
        .filter(|&&idx| {
            let val = get_value(idx, field_column_index);
            let key = cell_value_to_key(val);
            kept_keys.contains(key.as_ref())
        })
        .copied()
        .collect()
}

/// Map our `AggregateFunction` to compute-stats `AggregateFunction`.
pub(crate) fn map_aggregate_function(
    agg: AggregateFunction,
) -> compute_stats::types::AggregateFunction {
    match agg {
        AggregateFunction::Sum => compute_stats::types::AggregateFunction::Sum,
        AggregateFunction::Count => compute_stats::types::AggregateFunction::Count,
        AggregateFunction::CountNums => compute_stats::types::AggregateFunction::CountA,
        // Median is handled separately in compute_aggregate(); map to Average as fallback.
        AggregateFunction::Average | AggregateFunction::Median => {
            compute_stats::types::AggregateFunction::Average
        }
        AggregateFunction::Max => compute_stats::types::AggregateFunction::Max,
        AggregateFunction::Min => compute_stats::types::AggregateFunction::Min,
        AggregateFunction::Product => compute_stats::types::AggregateFunction::Product,
        AggregateFunction::StdDev => compute_stats::types::AggregateFunction::StdDev,
        AggregateFunction::StdDevP => compute_stats::types::AggregateFunction::StdDevP,
        AggregateFunction::Var => compute_stats::types::AggregateFunction::Var,
        AggregateFunction::VarP => compute_stats::types::AggregateFunction::VarP,
    }
}

/// Compute aggregation, handling Median specially.
pub(crate) fn compute_aggregate(agg: AggregateFunction, values: &[CellValue]) -> CellValue {
    if agg == AggregateFunction::Median {
        let nums: Vec<f64> = values
            .iter()
            .filter_map(|v| {
                if compute_stats::values::cell_value_is_numeric(v) {
                    v.as_number()
                } else {
                    None
                }
            })
            .collect();
        if nums.is_empty() {
            return CellValue::Null;
        }
        CellValue::number(compute_stats::statistics::median(&nums))
    } else {
        let stats_fn = map_aggregate_function(agg);
        compute_stats::aggregate::aggregate(stats_fn, values)
    }
}
