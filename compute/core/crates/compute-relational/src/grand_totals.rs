//! Grand totals — row, column, and corner grand totals.

use std::collections::HashMap;

use value_types::CellValue;

use crate::aggregate::{ColumnLeafInfo, compose_algebraic, is_algebraic};
use crate::filter::compute_aggregate;
use crate::types::{AggregatedNode, GrandTotalConfig, Measure, QueryGrandTotals};

/// Compute grand totals for the query result.
///
/// - **Row grand total**: aggregate ALL filtered rows for each (`column_leaf`, measure) pair.
/// - **Column grand totals**: per-row-node totals across all columns (one per measure).
/// - **Corner grand total**: aggregate ALL filtered rows across all columns (one per measure).
pub(crate) fn compute_grand_totals(
    row_tree: &[AggregatedNode],
    column_leaves: &[ColumnLeafInfo],
    measures: &[Measure],
    data: &[Vec<CellValue>],
    filtered_indices: &[usize],
    config: &GrandTotalConfig,
) -> QueryGrandTotals {
    let mut result = QueryGrandTotals::default();

    if measures.is_empty() {
        return result;
    }

    // Row grand total: aggregate over ALL filtered rows.
    // When all measures are algebraic, compose from top-level row tree nodes
    // instead of re-reading raw data.
    if config.show_row {
        let all_algebraic = measures.iter().all(|m| is_algebraic(m.aggregate));

        let row_gt = if all_algebraic && !row_tree.is_empty() {
            // Compose from top-level node subtotals/values.
            let num_cols = if column_leaves.is_empty() {
                1
            } else {
                column_leaves.len()
            };
            let total_slots = num_cols * measures.len();
            let mut gt = Vec::with_capacity(total_slots);

            for slot in 0..total_slots {
                let measure_idx = slot % measures.len();
                let agg = measures[measure_idx].aggregate;

                let child_vals: Vec<&CellValue> = row_tree
                    .iter()
                    .filter_map(|node| {
                        let vals = node.subtotal_values.as_deref().unwrap_or(&node.values);
                        vals.get(slot)
                    })
                    .collect();

                gt.push(compose_algebraic(agg, &child_vals));
            }
            gt
        } else {
            // Non-algebraic fallback: aggregate from raw data.
            let mut row_gt = Vec::new();

            if column_leaves.is_empty() {
                for measure in measures {
                    let cell_values: Vec<CellValue> = filtered_indices
                        .iter()
                        .map(|&i| {
                            data.get(i)
                                .and_then(|row| row.get(measure.column_index))
                                .cloned()
                                .unwrap_or(CellValue::Null)
                        })
                        .collect();
                    row_gt.push(compute_aggregate(measure.aggregate, &cell_values));
                }
            } else {
                for col_leaf in column_leaves {
                    let matching_indices: Vec<usize> = if let Some(ref col_set) = col_leaf.index_set
                    {
                        filtered_indices
                            .iter()
                            .filter(|i| col_set.contains(i))
                            .copied()
                            .collect()
                    } else {
                        filtered_indices.to_vec()
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
                        row_gt.push(compute_aggregate(measure.aggregate, &cell_values));
                    }
                }
            }
            row_gt
        };

        result.row = Some(row_gt);
    }

    // Column grand totals: per-row-node totals across all columns.
    if config.show_column {
        let mut col_totals: HashMap<String, Vec<CellValue>> = HashMap::new();
        compute_column_grand_totals_recursive(row_tree, measures, data, &mut col_totals);
        result.column = Some(col_totals);
    }

    // Corner grand total: aggregate ALL filtered rows, one per measure (ignoring column grouping).
    // Computed when either row or column grand totals are shown (not just both).
    if config.show_row || config.show_column {
        let mut corner = Vec::with_capacity(measures.len());
        for measure in measures {
            let cell_values: Vec<CellValue> = filtered_indices
                .iter()
                .map(|&i| {
                    data.get(i)
                        .and_then(|row| row.get(measure.column_index))
                        .cloned()
                        .unwrap_or(CellValue::Null)
                })
                .collect();
            corner.push(compute_aggregate(measure.aggregate, &cell_values));
        }
        result.corner = Some(corner);
    }

    result
}

/// Recursively compute column grand totals for each row node.
///
/// Column grand totals are per-row-node totals across all columns (one per measure).
/// When all measures are algebraic, we reuse the node's existing `subtotal_values`
/// to compute column-wise totals without re-reading raw data.
fn compute_column_grand_totals_recursive(
    nodes: &[AggregatedNode],
    measures: &[Measure],
    data: &[Vec<CellValue>],
    totals: &mut HashMap<String, Vec<CellValue>>,
) {
    let all_algebraic = measures.iter().all(|m| is_algebraic(m.aggregate));

    for node in nodes {
        let node_totals = if all_algebraic && !measures.is_empty() {
            // Reuse subtotal_values: aggregate across columns for each measure.
            // Layout is [col0_m0, col0_m1, ..., col1_m0, col1_m1, ...]
            let vals = node.subtotal_values.as_deref().unwrap_or(&node.values);
            let num_measures = measures.len();

            let mut col_totals = Vec::with_capacity(num_measures);
            for (m_idx, measure) in measures.iter().enumerate() {
                // Collect this measure's value across all columns.
                let col_values: Vec<&CellValue> =
                    vals.iter().skip(m_idx).step_by(num_measures).collect();
                col_totals.push(compose_algebraic(measure.aggregate, &col_values));
            }
            col_totals
        } else {
            // Non-algebraic fallback: read raw data.
            let indices = node.all_row_indices();
            let mut node_totals = Vec::with_capacity(measures.len());

            for measure in measures {
                let cell_values: Vec<CellValue> = indices
                    .iter()
                    .map(|&i| {
                        data.get(i)
                            .and_then(|row| row.get(measure.column_index))
                            .cloned()
                            .unwrap_or(CellValue::Null)
                    })
                    .collect();
                node_totals.push(compute_aggregate(measure.aggregate, &cell_values));
            }
            node_totals
        };

        totals.insert(node.key.clone(), node_totals);

        // Recurse into children.
        if !node.children.is_empty() {
            compute_column_grand_totals_recursive(&node.children, measures, data, totals);
        }
    }
}
