use std::collections::HashSet;

use compute_relational::AggregatedNode;
use value_types::CellValue;

use crate::engine::VALUES_FIELD_KEY;
use crate::resolved::{ResolvedAxisPlacement, ResolvedValuePlacement};
use crate::types::{FieldId, PivotColumnHeader, PivotHeader};

use super::visibility::{
    count_visible_leaves, get_nodes_at_depth_agg, get_visible_leaves, is_node_expanded,
};

/// Build column headers from the column tree with expansion state.
pub(super) fn build_column_headers(
    column_tree: &[AggregatedNode],
    column_placements: &[ResolvedAxisPlacement],
    value_placements: &[ResolvedValuePlacement],
    expanded_set: Option<&HashSet<String>>,
) -> Vec<PivotColumnHeader> {
    let mut headers: Vec<PivotColumnHeader> = Vec::new();

    if column_placements.is_empty() {
        if !value_placements.is_empty() {
            headers.push(PivotColumnHeader {
                field_id: FieldId::from(VALUES_FIELD_KEY),
                headers: value_placements
                    .iter()
                    .map(|vp| {
                        let display = vp.display_name().unwrap_or("");
                        let value_str = if display.is_empty() {
                            let agg = format!("{:?}", vp.aggregate_function()).to_lowercase();
                            format!("{} of {}", agg, vp.field_id())
                        } else {
                            display.to_string()
                        };
                        PivotHeader {
                            key: format!("value_{}", vp.field_id()),
                            value: CellValue::Text(value_str.into()),
                            field_id: vp.field_id().clone(),
                            depth: 0,
                            span: 1,
                            is_expandable: false,
                            is_expanded: true,
                            is_subtotal: false,
                            is_grand_total: false,
                            parent_key: None,
                            child_keys: None,
                        }
                    })
                    .collect(),
            });
        }
        return headers;
    }

    for (depth, placement) in column_placements.iter().enumerate() {
        let nodes_at_depth = get_nodes_at_depth_agg(column_tree, depth, expanded_set);
        let level_headers: Vec<PivotHeader> = nodes_at_depth
            .iter()
            .map(|node| {
                let is_expanded = is_node_expanded(node, expanded_set);
                let leaf_count = if is_expanded && !node.children.is_empty() {
                    count_visible_leaves(&node.children, expanded_set)
                } else {
                    1
                };
                let span = leaf_count * value_placements.len().max(1);

                let value = if node.value == CellValue::Null {
                    CellValue::Text("(blank)".into())
                } else {
                    node.value.clone()
                };
                PivotHeader {
                    key: node.key.clone(),
                    value,
                    field_id: FieldId::from(node.field_id.clone()),
                    depth,
                    span,
                    is_expandable: !node.children.is_empty(),
                    is_expanded,
                    is_subtotal: false,
                    is_grand_total: false,
                    parent_key: node.parent_key.clone(),
                    child_keys: Some(node.children.iter().map(|c| c.key.clone()).collect()),
                }
            })
            .collect();

        headers.push(PivotColumnHeader {
            field_id: placement.field_id().clone(),
            headers: level_headers,
        });
    }

    if value_placements.len() > 1 {
        let leaves = get_visible_leaves(column_tree, expanded_set);
        let mut value_headers: Vec<PivotHeader> = Vec::new();

        for leaf in &leaves {
            for vp in value_placements {
                let display = vp.display_name().unwrap_or("");
                let value_str = if display.is_empty() {
                    format!("{:?}", vp.aggregate_function()).to_lowercase()
                } else {
                    display.to_string()
                };
                value_headers.push(PivotHeader {
                    key: format!("{}\x00value_{}", leaf.key, vp.field_id()),
                    value: CellValue::Text(value_str.into()),
                    field_id: vp.field_id().clone(),
                    depth: column_placements.len(),
                    span: 1,
                    is_expandable: false,
                    is_expanded: true,
                    is_subtotal: false,
                    is_grand_total: false,
                    parent_key: Some(leaf.key.clone()),
                    child_keys: None,
                });
            }
        }

        headers.push(PivotColumnHeader {
            field_id: FieldId::from(VALUES_FIELD_KEY),
            headers: value_headers,
        });
    }

    headers
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{AggregateFunction, SortDirection};

    fn node(value: CellValue) -> AggregatedNode {
        AggregatedNode {
            key: "blank".to_string(),
            value,
            field_id: "region".to_string(),
            depth: 0,
            values: Vec::new(),
            subtotal_values: None,
            row_indices: Vec::new(),
            children: Vec::new(),
            parent_key: None,
        }
    }

    fn axis_placement() -> ResolvedAxisPlacement {
        ResolvedAxisPlacement {
            field_id: FieldId::from("region"),
            column_index: 0,
            position: 0,
            display_name: None,
            sort_order: SortDirection::Asc,
            custom_sort_list: None,
            sort_by_value: None,
            date_grouping: None,
            number_grouping: None,
            show_subtotals: false,
        }
    }

    #[test]
    fn blank_column_group_values_render_as_blank_text() {
        let headers =
            build_column_headers(&[node(CellValue::Null)], &[axis_placement()], &[], None);

        assert_eq!(
            headers[0].headers[0].value,
            CellValue::Text("(blank)".into())
        );
    }

    #[test]
    fn no_column_fields_emit_value_headers_with_aggregate_fallback() {
        let values = [ResolvedValuePlacement {
            field_id: FieldId::from("sales"),
            column_index: 2,
            position: 0,
            display_name: None,
            aggregate_function: AggregateFunction::Sum,
            number_format: None,
            show_values_as: None,
        }];

        let headers = build_column_headers(&[], &[], &values, None);

        assert_eq!(headers[0].headers[0].key, "value_sales");
        assert_eq!(
            headers[0].headers[0].value,
            CellValue::Text("sum of sales".into())
        );
    }
}
