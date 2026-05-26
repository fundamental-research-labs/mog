//! Pivot filtering — include/exclude lists, conditions, top/bottom N, wildcard matching.
//!
//! # Architecture
//!
//! Filtering operates on **indices into the source data**, never on cloned rows.
//! The main entry point [`apply_filters_resolved`] takes pre-validated resolved filters
//! and returns a narrowed index set. Each individual filter narrows the set further
//! (AND logic).
//!
//! # Filter application order (per Excel specification)
//!
//! 1. **Include list** — allowlist of specific values (`HashSet` membership via `cell_value_to_key`)
//! 2. **Exclude list** — denylist of specific values (`HashSet` membership)
//! 3. **Condition** — per-row predicate (pattern matching on `PivotFilterCondition`)
//! 4. **showItemsWithNoData** — removes blank rows unless explicitly allowed (respects explicit include)
//! 5. **Top/Bottom N** — ranking filter (requires aggregation; applied after blank removal)
//!
//! # Value normalization
//!
//! All value comparison, blank detection, numeric checks, and key generation delegate
//! to the canonical `values` module. Zero duplicate normalization logic exists here.

use std::collections::{HashMap, HashSet};

use value_types::CellValue;

use super::aggregator::aggregate;
use super::resolved::{ResolvedFilter, ResolvedTopBottom};
use super::types::{
    AggregateFunction, FilterOperator, NullaryFilterOp, PivotFilterCondition, TopBottomBy,
    TopBottomType,
};
use super::values::{
    cell_value_eq, cell_value_filter_keys, cell_value_is_numeric, cell_value_to_key, kahan_sum,
};
use compute_stats::filter::matches_condition;

// ============================================================================
// Resolved filter API (accepts pre-validated ResolvedFilter types)
// ============================================================================

/// Apply all resolved filters to the source data, returning indices of rows that pass.
///
/// Like [`apply_filters`] but accepts pre-validated `ResolvedFilter` types where
/// field column indices are pre-resolved and conditions are already type-safe.
/// No `field_column_map` lookup needed — column indices come from the resolved config.
///
/// # Parameters
///
/// - `data`: source data rows (each row is a `Vec<CellValue>`; row 0 is the first data row)
/// - `indices`: initial set of row indices to consider
/// - `filters`: pre-validated resolved filters with column indices already resolved
/// - `value_column_indices`: `(column_index, AggregateFunction)` pairs for top/bottom ranking
#[must_use]
pub fn apply_filters_resolved(
    data: &[Vec<CellValue>],
    indices: Vec<usize>,
    filters: &[ResolvedFilter],
    value_column_indices: &[(usize, AggregateFunction)],
) -> Vec<usize> {
    let mut surviving = indices;

    for filter in filters {
        surviving = apply_filter_resolved(data, &surviving, filter, value_column_indices);
    }

    surviving
}

/// Apply a single resolved filter to the surviving index set.
///
/// Same 5-step application order as [`apply_filter`]:
/// 1. Include list → 2. Exclude list → 3. Condition → 4. Blank removal → 5. Top/Bottom N
fn apply_filter_resolved(
    data: &[Vec<CellValue>],
    indices: &[usize],
    filter: &ResolvedFilter,
    value_column_indices: &[(usize, AggregateFunction)],
) -> Vec<usize> {
    let mut surviving: Vec<usize> = indices.to_vec();
    let column_index = filter.field_column_index();

    let get_value = |row_idx: usize| -> &CellValue {
        data.get(row_idx)
            .and_then(|row| row.get(column_index))
            .unwrap_or(&CellValue::Null)
    };

    // 1. Include list.
    //
    // Type-tolerant matching via `cell_value_filter_keys`: a filter value of
    // `Text("2024")` matches both `Text("2024")` and `Number(2024.0)` cell
    // values. The kernel never has to pre-coerce string filter values to
    // numbers; the engine knows the cell type and accepts both
    // representations.
    if let Some(include_values) = filter.include_values()
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
    if let Some(exclude_values) = filter.exclude_values()
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

    // 3. Condition — already type-safe PivotFilterCondition, no flat→typed conversion.
    if let Some(condition) = filter.condition() {
        match condition {
            PivotFilterCondition::Nullary(
                NullaryFilterOp::AboveAverage | NullaryFilterOp::BelowAverage,
            ) => {
                let numbers: Vec<f64> = surviving
                    .iter()
                    .filter_map(|&idx| {
                        let v = get_value(idx);
                        if cell_value_is_numeric(v) {
                            if let CellValue::Number(n) = v {
                                Some(n.get())
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    })
                    .collect();

                if !numbers.is_empty() {
                    let sum = kahan_sum(numbers.iter().copied());
                    // Safety: vector length is always much smaller than 2^52.
                    #[allow(clippy::cast_precision_loss)]
                    let avg = sum / numbers.len() as f64;
                    let is_above = matches!(
                        condition,
                        PivotFilterCondition::Nullary(NullaryFilterOp::AboveAverage)
                    );

                    surviving.retain(|&idx| {
                        let v = get_value(idx);
                        if let CellValue::Number(n) = v {
                            // Excel uses strict > for above average, strict < for below.
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
                surviving.retain(|&idx| matches_condition(get_value(idx), condition));
            }
        }
    }

    // 4. Blank removal — show_items_with_no_data is pre-resolved to bool.
    if !filter.show_items_with_no_data() {
        let blanks_explicitly_included = filter
            .include_values()
            .is_some_and(|vals| vals.iter().any(value_types::CellValue::is_visually_blank));
        if !blanks_explicitly_included {
            surviving.retain(|&idx| !get_value(idx).is_visually_blank());
        }
    }

    // 5. Top/Bottom N — uses pre-resolved value_field_index.
    if let Some(top_bottom) = filter.top_bottom() {
        surviving = apply_top_bottom_resolved(
            data,
            &surviving,
            top_bottom,
            column_index,
            value_column_indices,
        );
    }

    surviving
}

/// A group of rows sharing a field value, ranked by an aggregate value.
#[derive(Debug)]
struct RankedGroup {
    key: String,
    aggregate_value: f64,
}

/// Apply a resolved top/bottom N filter.
///
/// Uses [`ResolvedTopBottom::value_field_index`] to select the ranking column,
/// fixing the ghost-field bug where `value_field_id` was previously ignored.
fn apply_top_bottom_resolved(
    data: &[Vec<CellValue>],
    indices: &[usize],
    top_bottom: &ResolvedTopBottom,
    field_column_index: usize,
    value_column_indices: &[(usize, AggregateFunction)],
) -> Vec<usize> {
    let n_raw = top_bottom.n();
    let by = top_bottom.by();
    let filter_type = top_bottom.filter_type();

    // Use pre-resolved value_field_index (fixes B2: value_field_id ghost).
    // Falls back to first value column if not specified.
    // FIX 1a: Extract both column index AND aggregate function from the tuple.
    let rank_info: Option<(usize, AggregateFunction)> =
        if by == TopBottomBy::Items && value_column_indices.is_empty() {
            None
        } else {
            let vfi = top_bottom.value_field_index().unwrap_or(0);
            value_column_indices.get(vfi).copied()
        };

    if rank_info.is_none() && by != TopBottomBy::Items {
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

    // Calculate ranking value for each group.
    let mut ranked: Vec<RankedGroup> = Vec::with_capacity(group_order.len());

    for key in &group_order {
        let group_indices = groups.get(key).unwrap();
        let aggregate_value = if by == TopBottomBy::Items && rank_info.is_none() {
            // Safety: group count is always much smaller than 2^52.
            #[allow(clippy::cast_precision_loss)]
            let count = group_indices.len() as f64;
            count
        } else {
            // FIX 1a: Use the actual aggregate function instead of hardcoded Sum.
            let (vci, agg_fn) = rank_info.unwrap();
            let values: Vec<CellValue> = group_indices
                .iter()
                .map(|&idx| get_value(idx, vci).clone())
                .collect();
            let aggregated = aggregate(agg_fn, &values);
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
        _ => {
            ranked.sort_by(|a, b| {
                b.aggregate_value
                    .partial_cmp(&a.aggregate_value)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
        }
    }

    // Determine how many groups to keep.
    let mut keep_count = match by {
        TopBottomBy::Items => {
            // Safety: n_raw is a user-specified count, non-negative and within reasonable range.
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let item_count = n_raw.round() as usize;
            item_count.min(ranked.len())
        }
        TopBottomBy::Percent => {
            // Safety: ranked.len() is small (< 2^52), result is non-negative after ceil.
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
        _ => {
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let item_count = n_raw.round() as usize;
            item_count.min(ranked.len())
        }
    };

    // Tie-breaking — include ALL tied items at the boundary.
    if keep_count > 0 && keep_count < ranked.len() {
        let cutoff_value = ranked[keep_count - 1].aggregate_value;
        while keep_count < ranked.len() {
            if cell_value_eq(
                &CellValue::number(ranked[keep_count].aggregate_value),
                &CellValue::number(cutoff_value),
            ) {
                keep_count += 1;
            } else {
                break;
            }
        }
    }

    // Collect the keys of kept groups.
    let kept_keys: HashSet<&str> = ranked[..keep_count]
        .iter()
        .map(|g| g.key.as_str())
        .collect();

    // Return indices that belong to kept groups (preserving original order).
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

// ============================================================================
// Unique field values (for filter UI)
// ============================================================================

/// Get unique field values from source data at a given column (for filter UI).
///
/// Returns the first occurrence of each unique value (using canonical key generation).
/// Operates on index-based data — no cloning.
#[must_use]
pub fn get_unique_field_values(
    data: &[Vec<CellValue>],
    indices: &[usize],
    column_index: usize,
) -> Vec<CellValue> {
    let mut seen = HashSet::new();
    let mut unique: Vec<CellValue> = Vec::new();

    for &idx in indices {
        let value = data
            .get(idx)
            .and_then(|row| row.get(column_index))
            .unwrap_or(&CellValue::Null);
        let key = cell_value_to_key(value);
        if seen.insert(key.into_owned()) {
            unique.push(value.clone());
        }
    }

    unique
}

// ============================================================================
// Get filter operators
// ============================================================================

/// All available filter operators.
///
/// Returns a static slice — no allocation.
#[must_use]
pub fn get_filter_operators() -> &'static [FilterOperator] {
    &[
        FilterOperator::Equals,
        FilterOperator::NotEquals,
        FilterOperator::Contains,
        FilterOperator::NotContains,
        FilterOperator::StartsWith,
        FilterOperator::EndsWith,
        FilterOperator::GreaterThan,
        FilterOperator::GreaterThanOrEqual,
        FilterOperator::LessThan,
        FilterOperator::LessThanOrEqual,
        FilterOperator::Between,
        FilterOperator::NotBetween,
        FilterOperator::IsBlank,
        FilterOperator::IsNotBlank,
        FilterOperator::AboveAverage,
        FilterOperator::BelowAverage,
    ]
}

#[cfg(test)]
#[path = "filter_tests.rs"]
mod tests;
