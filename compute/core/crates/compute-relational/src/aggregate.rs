//! Aggregation pass — compute values at every node in the row/column trees.
//!
//! Walks the row tree, intersecting row indices with column leaf indices
//! to compute aggregated measure values at every node.

use std::collections::HashSet;

use value_types::CellValue;

use crate::filter::compute_aggregate;
use crate::types::{AggregateFunction, AggregatedNode, Measure};

/// Collected column leaf information for efficient aggregation.
pub(crate) struct ColumnLeafInfo {
    /// Index set for O(1) intersection checks.
    pub index_set: Option<HashSet<usize>>,
}

/// Aggregate values into the row tree.
///
/// For each row node (recursively):
/// 1. Get the node's `row_indices`
/// 2. For each column leaf x measure combination:
///    - Intersect `row_indices` with column leaf's index set
///    - Extract cell values from data at `measure.column_index`
///    - Aggregate
/// 3. Store in `node.values` as flat array: [`col0_m0`, `col0_m1`, ..., `col1_m0`, ...]
/// 4. For non-leaf nodes, compute `subtotal_values` over ALL descendant indices.
pub(crate) fn aggregate_trees(
    row_tree: &mut [AggregatedNode],
    column_leaves: &[ColumnLeafInfo],
    measures: &[Measure],
    data: &[Vec<CellValue>],
) {
    for node in row_tree.iter_mut() {
        aggregate_node(node, column_leaves, measures, data);
    }
}

/// Check if an aggregate function can be composed algebraically from children.
pub(crate) fn is_algebraic(agg: AggregateFunction) -> bool {
    matches!(
        agg,
        AggregateFunction::Sum
            | AggregateFunction::Count
            | AggregateFunction::CountNums
            | AggregateFunction::Min
            | AggregateFunction::Max
            | AggregateFunction::Product
    )
}

/// Compose a parent subtotal value from children's subtotal values algebraically.
///
/// `child_values` are the aggregated values at the same (column, measure) position
/// from each child node's `subtotal_values` (or values for leaf children).
pub(crate) fn compose_algebraic(agg: AggregateFunction, child_values: &[&CellValue]) -> CellValue {
    match agg {
        AggregateFunction::Sum => {
            let mut total = 0.0_f64;
            let mut any_num = false;
            for v in child_values {
                if let Some(n) = v.as_number() {
                    total += n;
                    any_num = true;
                }
            }
            if any_num {
                CellValue::number(total)
            } else {
                CellValue::Number(value_types::FiniteF64::ZERO)
            }
        }
        AggregateFunction::Count | AggregateFunction::CountNums => {
            let mut total = 0.0_f64;
            for v in child_values {
                if let Some(n) = v.as_number() {
                    total += n;
                }
            }
            CellValue::number(total)
        }
        AggregateFunction::Min => {
            let mut result: Option<f64> = None;
            for v in child_values {
                if let Some(n) = v.as_number() {
                    result = Some(match result {
                        Some(cur) => cur.min(n),
                        None => n,
                    });
                }
            }
            result.map_or(
                CellValue::Number(value_types::FiniteF64::ZERO),
                CellValue::number,
            )
        }
        AggregateFunction::Max => {
            let mut result: Option<f64> = None;
            for v in child_values {
                if let Some(n) = v.as_number() {
                    result = Some(match result {
                        Some(cur) => cur.max(n),
                        None => n,
                    });
                }
            }
            result.map_or(
                CellValue::Number(value_types::FiniteF64::ZERO),
                CellValue::number,
            )
        }
        AggregateFunction::Product => {
            let mut total = 1.0_f64;
            let mut any_num = false;
            for v in child_values {
                if let Some(n) = v.as_number() {
                    total *= n;
                    any_num = true;
                }
            }
            if any_num {
                CellValue::number(total)
            } else {
                CellValue::Number(value_types::FiniteF64::ZERO)
            }
        }
        _ => unreachable!("compose_algebraic called with non-algebraic function"),
    }
}

/// Recursively aggregate a single node and its children.
fn aggregate_node(
    node: &mut AggregatedNode,
    column_leaves: &[ColumnLeafInfo],
    measures: &[Measure],
    data: &[Vec<CellValue>],
) {
    // First, recurse into children.
    for child in &mut node.children {
        aggregate_node(child, column_leaves, measures, data);
    }

    // Compute values for this node's own row_indices.
    // For leaf nodes this IS the final value.
    // For non-leaf nodes, these are the "leaf-level" values (same indices).
    let values = compute_values_for_indices(&node.row_indices, column_leaves, measures, data);
    node.values = values;

    // For non-leaf nodes, compute subtotal_values over ALL descendant indices.
    if !node.children.is_empty() {
        // Check if ALL measures are algebraic — if so, derive subtotals from children.
        let all_algebraic = measures.iter().all(|m| is_algebraic(m.aggregate));

        if all_algebraic && !measures.is_empty() {
            // Compose subtotals algebraically from children.
            let num_cols = if column_leaves.is_empty() {
                1
            } else {
                column_leaves.len()
            };
            let num_measures = measures.len();
            let total_slots = num_cols * num_measures;
            let mut subtotal_values = Vec::with_capacity(total_slots);

            for slot in 0..total_slots {
                let measure_idx = slot % num_measures;
                let agg = measures[measure_idx].aggregate;

                // Collect this slot's value from each child.
                let child_vals: Vec<&CellValue> = node
                    .children
                    .iter()
                    .filter_map(|child| {
                        // Use child's subtotal_values if it has children, else values.
                        let child_vals = child.subtotal_values.as_deref().unwrap_or(&child.values);
                        child_vals.get(slot)
                    })
                    .collect();

                subtotal_values.push(compose_algebraic(agg, &child_vals));
            }

            node.subtotal_values = Some(subtotal_values);
        } else {
            // Non-algebraic measures present — fall back to raw data path.
            let all_indices = node.all_row_indices();
            let subtotal_values =
                compute_values_for_indices(&all_indices, column_leaves, measures, data);
            node.subtotal_values = Some(subtotal_values);
        }
    }
}

/// Compute aggregated values for a set of row indices against all column leaves and measures.
///
/// Returns a flat array: [`col0_m0`, `col0_m1`, ..., `col1_m0`, ...]
fn compute_values_for_indices(
    row_indices: &[usize],
    column_leaves: &[ColumnLeafInfo],
    measures: &[Measure],
    data: &[Vec<CellValue>],
) -> Vec<CellValue> {
    if measures.is_empty() {
        return vec![];
    }

    // If no column leaves, treat as a single "all" column (no column filtering).
    if column_leaves.is_empty() {
        let mut values = Vec::with_capacity(measures.len());
        for measure in measures {
            let cell_values: Vec<CellValue> = row_indices
                .iter()
                .map(|&i| {
                    data.get(i)
                        .and_then(|row| row.get(measure.column_index))
                        .cloned()
                        .unwrap_or(CellValue::Null)
                })
                .collect();
            values.push(compute_aggregate(measure.aggregate, &cell_values));
        }
        return values;
    }

    let mut values = Vec::with_capacity(column_leaves.len() * measures.len());

    for col_leaf in column_leaves {
        // Intersect row_indices with column leaf's index set.
        let matching_indices: Vec<usize> = if let Some(ref col_set) = col_leaf.index_set {
            row_indices
                .iter()
                .filter(|i| col_set.contains(i))
                .copied()
                .collect()
        } else {
            row_indices.to_vec()
        };

        for measure in measures {
            let cell_values: Vec<CellValue> = matching_indices
                .iter()
                .map(|&i| {
                    data.get(i)
                        .and_then(|row| row.get(measure.column_index))
                        .cloned()
                        .unwrap_or(CellValue::Null)
                })
                .collect();
            values.push(compute_aggregate(measure.aggregate, &cell_values));
        }
    }

    values
}
