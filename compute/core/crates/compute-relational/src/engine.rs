//! Main execution pipeline for the relational compute engine.
//!
//! The pipeline:
//! 1. Skip header row (data[0] is headers, data[1..] is data rows)
//! 2. Filter: apply query.filters
//! 3. Group rows: build `AggregatedNode` tree for `row_fields`
//! 4. Group columns: build `AggregatedNode` tree for `column_fields`
//! 5. Aggregate: walk both trees, compute values at every node
//! 6. Sort by value (AFTER aggregation)
//! 7. Calc measures: apply calculated measures
//! 8. Grand totals
//! 9. Return `QueryResult`

use std::collections::HashSet;

use value_types::CellValue;

use crate::aggregate::{ColumnLeafInfo, aggregate_trees};
use crate::calc_measure::apply_calculated_measures;
use crate::error::RelationalError;
use crate::filter::apply_filters;
use crate::grand_totals::compute_grand_totals;
use crate::group::build_group_tree;
use crate::sort::sort_trees_by_value;
use crate::types::{AggregatedNode, QueryResult, RelationalQuery};

/// Execute a relational query against tabular data.
///
/// `data[0]` is assumed to be the header row. `data[1..]` contains data rows.
///
/// # Errors
///
/// Returns `RelationalError` if grouping produces too many nodes.
pub fn execute(
    query: &RelationalQuery,
    data: &[Vec<CellValue>],
) -> Result<QueryResult, RelationalError> {
    if let Some(measure) = query
        .measures
        .iter()
        .find(|measure| measure.window.is_some())
    {
        return Err(RelationalError::UnsupportedWindowFunction {
            measure_id: measure.id.clone(),
        });
    }

    // Source row count (excluding header).
    let source_row_count = if data.is_empty() { 0 } else { data.len() - 1 };

    if source_row_count == 0
        || (query.row_fields.is_empty()
            && query.column_fields.is_empty()
            && query.measures.is_empty())
    {
        return Ok(QueryResult::empty(source_row_count));
    }

    // Data rows (skip header).
    let data_rows = &data[1..];

    // 1. Initial indices: 0..source_row_count (indices into data_rows).
    let initial_indices: Vec<usize> = (0..source_row_count).collect();

    // 2. Filter.
    let filtered_indices =
        apply_filters(data_rows, initial_indices, &query.filters, &query.measures);
    let filtered_row_count = filtered_indices.len();

    // 3. Group rows.
    let mut row_tree = build_group_tree(data_rows, &filtered_indices, &query.row_fields)?;

    // 4. Group columns.
    let mut column_tree = build_group_tree(data_rows, &filtered_indices, &query.column_fields)?;

    // 5. Collect column leaf info (keys and index sets) without holding references.
    let (mut column_leaf_infos, mut column_leaf_keys) = collect_leaf_info(&column_tree);

    // 5a. Sort column tree by value if any column field has sort-by-value.
    let has_column_value_sort = query
        .column_fields
        .iter()
        .any(|f| matches!(f.sort.sort_by, crate::types::SortBy::Value { .. }));
    if has_column_value_sort {
        // Aggregate column tree (no column intersection — each node's indices is its own).
        let no_col = vec![ColumnLeafInfo { index_set: None }];
        aggregate_trees(&mut column_tree, &no_col, &query.measures, data_rows);
        sort_trees_by_value(
            &mut column_tree,
            &query.column_fields,
            &[],
            query.measures.len(),
        );
        // Re-collect after sorting.
        let (new_infos, new_keys) = collect_leaf_info(&column_tree);
        column_leaf_infos = new_infos;
        column_leaf_keys = new_keys;
    }

    // 6. Aggregate row tree: compute values at every node.
    aggregate_trees(
        &mut row_tree,
        &column_leaf_infos,
        &query.measures,
        data_rows,
    );

    // 7. Sort row tree by value (AFTER aggregation).
    sort_trees_by_value(
        &mut row_tree,
        &query.row_fields,
        &column_leaf_keys,
        query.measures.len(),
    );

    // 8. Calculated measures.
    let num_column_leaves = column_leaf_infos.len();
    apply_calculated_measures(
        &mut row_tree,
        &query.measures,
        &query.calculated_measures,
        num_column_leaves,
    );

    // 9. Grand totals.
    let grand_totals = compute_grand_totals(
        &row_tree,
        &column_leaf_infos,
        &query.measures,
        data_rows,
        &filtered_indices,
        &query.grand_totals,
    );

    let measure_count = query.measures.len() + query.calculated_measures.len();

    Ok(QueryResult {
        row_tree,
        column_tree,
        grand_totals,
        filtered_row_count,
        source_row_count,
        measure_count,
        column_leaf_keys,
    })
}

/// Collect all leaf nodes from a tree.
fn collect_leaves(nodes: &[AggregatedNode]) -> Vec<&AggregatedNode> {
    let mut leaves = Vec::new();
    collect_leaves_recursive(nodes, &mut leaves);
    leaves
}

/// Collect leaf info (index sets and keys) from a tree without holding references.
fn collect_leaf_info(tree: &[AggregatedNode]) -> (Vec<ColumnLeafInfo>, Vec<String>) {
    let leaves = collect_leaves(tree);
    let infos = leaves
        .iter()
        .map(|leaf| ColumnLeafInfo {
            index_set: Some(leaf.row_indices.iter().copied().collect::<HashSet<usize>>()),
        })
        .collect();
    let keys = leaves.iter().map(|leaf| leaf.key.clone()).collect();
    (infos, keys)
}

fn collect_leaves_recursive<'a>(nodes: &'a [AggregatedNode], out: &mut Vec<&'a AggregatedNode>) {
    for node in nodes {
        if node.children.is_empty() {
            out.push(node);
        } else {
            collect_leaves_recursive(&node.children, out);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::*;

    #[test]
    fn test_basic_group_and_aggregate() {
        let data = vec![
            vec![
                CellValue::Text("Region".into()),
                CellValue::Text("Sales".into()),
            ],
            vec![CellValue::Text("North".into()), CellValue::number(100.0)],
            vec![CellValue::Text("South".into()), CellValue::number(200.0)],
            vec![CellValue::Text("North".into()), CellValue::number(150.0)],
        ];

        let query = RelationalQuery {
            row_fields: vec![GroupField {
                id: "Region".to_string(),
                column_index: 0,
                grouping: GroupingStrategy::Identity,
                sort: SortConfig {
                    sort_by: SortBy::Label,
                    direction: SortDirection::Ascending,
                    custom_order: None,
                },
            }],
            column_fields: vec![],
            measures: vec![Measure {
                id: "Sales".to_string(),
                name: "Sum of Sales".to_string(),
                column_index: 1,
                aggregate: AggregateFunction::Sum,
                window: None,
            }],
            filters: vec![],
            calculated_measures: vec![],
            subtotals: SubtotalConfig { enabled: vec![] },
            grand_totals: GrandTotalConfig {
                show_row: true,
                show_column: false,
            },
        };

        let result = execute(&query, &data).unwrap();

        assert_eq!(result.row_tree.len(), 2); // North, South
        assert_eq!(result.source_row_count, 3);
        assert_eq!(result.filtered_row_count, 3);

        // North: 100 + 150 = 250
        let north = &result.row_tree[0]; // sorted ascending
        assert_eq!(north.value, CellValue::Text("North".into()));
        assert_eq!(north.values.len(), 1);
        assert_eq!(north.values[0], CellValue::number(250.0));

        // South: 200
        let south = &result.row_tree[1];
        assert_eq!(south.value, CellValue::Text("South".into()));
        assert_eq!(south.values[0], CellValue::number(200.0));

        // Grand total row
        assert!(result.grand_totals.row.is_some());
        let row_gt = result.grand_totals.row.as_ref().unwrap();
        assert_eq!(row_gt[0], CellValue::number(450.0));
    }

    #[test]
    fn test_empty_data() {
        let data: Vec<Vec<CellValue>> = vec![vec![CellValue::Text("Col1".into())]];

        let query = RelationalQuery {
            row_fields: vec![],
            column_fields: vec![],
            measures: vec![],
            filters: vec![],
            calculated_measures: vec![],
            subtotals: SubtotalConfig { enabled: vec![] },
            grand_totals: GrandTotalConfig {
                show_row: false,
                show_column: false,
            },
        };

        let result = execute(&query, &data).unwrap();
        assert_eq!(result.source_row_count, 0);
        assert_eq!(result.filtered_row_count, 0);
    }

    #[test]
    fn test_multiple_measures() {
        let data = vec![
            vec![
                CellValue::Text("Product".into()),
                CellValue::Text("Revenue".into()),
                CellValue::Text("Cost".into()),
            ],
            vec![
                CellValue::Text("A".into()),
                CellValue::number(100.0),
                CellValue::number(60.0),
            ],
            vec![
                CellValue::Text("B".into()),
                CellValue::number(200.0),
                CellValue::number(80.0),
            ],
            vec![
                CellValue::Text("A".into()),
                CellValue::number(150.0),
                CellValue::number(90.0),
            ],
        ];

        let query = RelationalQuery {
            row_fields: vec![GroupField {
                id: "Product".to_string(),
                column_index: 0,
                grouping: GroupingStrategy::Identity,
                sort: SortConfig {
                    sort_by: SortBy::Label,
                    direction: SortDirection::Ascending,
                    custom_order: None,
                },
            }],
            column_fields: vec![],
            measures: vec![
                Measure {
                    id: "Revenue".to_string(),
                    name: "Sum of Revenue".to_string(),
                    column_index: 1,
                    aggregate: AggregateFunction::Sum,
                    window: None,
                },
                Measure {
                    id: "Cost".to_string(),
                    name: "Sum of Cost".to_string(),
                    column_index: 2,
                    aggregate: AggregateFunction::Sum,
                    window: None,
                },
            ],
            filters: vec![],
            calculated_measures: vec![],
            subtotals: SubtotalConfig { enabled: vec![] },
            grand_totals: GrandTotalConfig {
                show_row: false,
                show_column: false,
            },
        };

        let result = execute(&query, &data).unwrap();

        // A: Revenue=250, Cost=150
        let a = &result.row_tree[0];
        assert_eq!(a.value, CellValue::Text("A".into()));
        assert_eq!(a.values.len(), 2);
        assert_eq!(a.values[0], CellValue::number(250.0));
        assert_eq!(a.values[1], CellValue::number(150.0));

        // B: Revenue=200, Cost=80
        let b = &result.row_tree[1];
        assert_eq!(b.values[0], CellValue::number(200.0));
        assert_eq!(b.values[1], CellValue::number(80.0));
    }
}
