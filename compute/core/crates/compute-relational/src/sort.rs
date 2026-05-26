//! ORDER BY — sort tree nodes by aggregated values.
//!
//! Sort-by-value MUST happen AFTER aggregation, since nodes need their
//! `values` populated before they can be sorted by them.
//! Sort-by-label happens DURING tree building (in group.rs).

use value_types::CellValue;

use crate::types::{AggregatedNode, GroupField, SortBy, SortDirection};

/// Sort trees by value for any fields that have `SortBy::Value` configured.
///
/// Processes innermost fields first (deepest depth first) so that
/// child ordering is stable when parent nodes are re-sorted.
pub(crate) fn sort_trees_by_value(
    row_tree: &mut [AggregatedNode],
    row_fields: &[GroupField],
    column_leaf_keys: &[String],
    measure_count: usize,
) {
    // Collect fields that have sort-by-value, sorted by depth descending (innermost first).
    let mut value_sort_fields: Vec<(usize, &GroupField)> = row_fields
        .iter()
        .enumerate()
        .filter(|(_, f)| matches!(f.sort.sort_by, SortBy::Value { .. }))
        .collect();

    // Sort innermost first.
    value_sort_fields.sort_by(|a, b| b.0.cmp(&a.0));

    for (depth, field) in value_sort_fields {
        let (measure_index, column_key) = match &field.sort.sort_by {
            SortBy::Value {
                measure_index,
                column_key,
            } => (*measure_index, column_key.as_deref()),
            SortBy::Label => unreachable!(),
        };

        // Compute the value index into the flat values array.
        let col_idx = if let Some(col_key) = column_key {
            column_leaf_keys
                .iter()
                .position(|k| k == col_key)
                .unwrap_or(0)
        } else {
            0
        };

        let value_index = col_idx * measure_count + measure_index;
        let direction = field.sort.direction;

        sort_at_depth(row_tree, depth, 0, value_index, direction);
    }
}

/// Recursively sort nodes at a specific depth.
fn sort_at_depth(
    nodes: &mut [AggregatedNode],
    target_depth: usize,
    current_depth: usize,
    value_index: usize,
    direction: SortDirection,
) {
    if current_depth == target_depth {
        // Sort these siblings by the value at value_index.
        // Null values always sort last, regardless of direction.
        nodes.sort_by(|a, b| {
            let a_val = sort_value_opt(a, value_index);
            let b_val = sort_value_opt(b, value_index);
            match (a_val, b_val) {
                (None, None) => std::cmp::Ordering::Equal,
                (None, Some(_)) => std::cmp::Ordering::Greater, // null last
                (Some(_), None) => std::cmp::Ordering::Less,    // null last
                (Some(av), Some(bv)) => {
                    let ord = av.partial_cmp(&bv).unwrap_or(std::cmp::Ordering::Equal);
                    match direction {
                        SortDirection::Ascending => ord,
                        SortDirection::Descending => ord.reverse(),
                    }
                }
            }
        });
    } else {
        // Recurse into children.
        for node in nodes.iter_mut() {
            sort_at_depth(
                &mut node.children,
                target_depth,
                current_depth + 1,
                value_index,
                direction,
            );
        }
    }
}

/// Extract the f64 value for sorting. Returns None for non-numeric values.
fn sort_value_opt(node: &AggregatedNode, value_index: usize) -> Option<f64> {
    let vals = node.subtotal_values.as_ref().unwrap_or(&node.values);
    match vals.get(value_index) {
        Some(CellValue::Number(n)) => Some(n.get()),
        _ => None,
    }
}
