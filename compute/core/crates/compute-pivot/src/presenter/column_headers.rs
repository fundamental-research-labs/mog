use std::collections::HashSet;

use compute_relational::AggregatedNode;
use value_types::CellValue;

use crate::engine::VALUES_FIELD_KEY;
use crate::resolved::{ResolvedAxisPlacement, ResolvedCalculatedField, ResolvedValuePlacement};
use crate::types::{FieldId, PivotColumnHeader, PivotHeader};

use super::visibility::{
    count_visible_leaves, get_nodes_at_depth_agg, get_visible_leaves, is_node_expanded,
};

/// Build column headers from the column tree with expansion state.
pub(super) fn build_column_headers(
    column_tree: &[AggregatedNode],
    column_placements: &[ResolvedAxisPlacement],
    value_placements: &[ResolvedValuePlacement],
    calculated_fields: &[ResolvedCalculatedField],
    expanded_set: Option<&HashSet<String>>,
) -> Vec<PivotColumnHeader> {
    let mut headers: Vec<PivotColumnHeader> = Vec::new();
    let value_headers = measure_headers(value_placements, calculated_fields);
    let measure_count = value_headers.len();

    if column_placements.is_empty() {
        if !value_headers.is_empty() {
            headers.push(PivotColumnHeader {
                field_id: FieldId::from(VALUES_FIELD_KEY),
                headers: value_headers
                    .into_iter()
                    .map(|header| header.into_pivot_header(0, None))
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
                let span = leaf_count * measure_count.max(1);

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

    if measure_count > 1 {
        let leaves = get_visible_leaves(column_tree, expanded_set);
        let mut value_headers: Vec<PivotHeader> = Vec::new();

        for leaf in &leaves {
            for header in measure_headers(value_placements, calculated_fields) {
                value_headers.push(
                    header.into_pivot_header(column_placements.len(), Some(leaf.key.clone())),
                );
            }
        }

        headers.push(PivotColumnHeader {
            field_id: FieldId::from(VALUES_FIELD_KEY),
            headers: value_headers,
        });
    }

    headers
}

struct MeasureHeader {
    key: String,
    value: String,
    field_id: FieldId,
}

impl MeasureHeader {
    fn into_pivot_header(self, depth: usize, parent_key: Option<String>) -> PivotHeader {
        PivotHeader {
            key: match &parent_key {
                Some(parent) => format!("{parent}\x00{}", self.key),
                None => self.key,
            },
            value: CellValue::Text(self.value.into()),
            field_id: self.field_id,
            depth,
            span: 1,
            is_expandable: false,
            is_expanded: true,
            is_subtotal: false,
            is_grand_total: false,
            parent_key,
            child_keys: None,
        }
    }
}

fn measure_headers(
    value_placements: &[ResolvedValuePlacement],
    calculated_fields: &[ResolvedCalculatedField],
) -> Vec<MeasureHeader> {
    let mut headers = Vec::with_capacity(value_placements.len() + calculated_fields.len());
    headers.extend(value_placements.iter().map(|vp| {
        let display = vp.display_name().unwrap_or("");
        let value = if display.is_empty() {
            let agg = format!("{:?}", vp.aggregate_function()).to_lowercase();
            format!("{} of {}", agg, vp.field_id())
        } else {
            display.to_string()
        };
        MeasureHeader {
            key: format!("value_{}", vp.field_id()),
            value,
            field_id: vp.field_id().clone(),
        }
    }));
    headers.extend(calculated_fields.iter().map(|cf| MeasureHeader {
        key: format!("value_{}", cf.field_id()),
        value: cf.name().to_string(),
        field_id: cf.field_id().clone(),
    }));
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
        let headers = build_column_headers(
            &[node(CellValue::Null)],
            &[axis_placement()],
            &[],
            &[],
            None,
        );

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

        let headers = build_column_headers(&[], &[], &values, &[], None);

        assert_eq!(headers[0].headers[0].key, "value_sales");
        assert_eq!(
            headers[0].headers[0].value,
            CellValue::Text("sum of sales".into())
        );
    }

    #[test]
    fn calculated_fields_extend_value_header_width() {
        let values = [
            ResolvedValuePlacement {
                field_id: FieldId::from("revenue"),
                column_index: 1,
                position: 0,
                display_name: Some("Revenue".to_string()),
                aggregate_function: AggregateFunction::Sum,
                number_format: None,
                show_values_as: None,
            },
            ResolvedValuePlacement {
                field_id: FieldId::from("cost"),
                column_index: 2,
                position: 1,
                display_name: Some("Cost".to_string()),
                aggregate_function: AggregateFunction::Sum,
                number_format: None,
                show_values_as: None,
            },
        ];
        let calculated = [ResolvedCalculatedField {
            field_id: FieldId::from("profit"),
            name: "Profit".to_string(),
            formula: "Revenue - Cost".to_string(),
            parsed_expr: crate::calc_field::parse_calc_field("Revenue - Cost").unwrap(),
        }];

        let headers = build_column_headers(&[], &[], &values, &calculated, None);

        assert_eq!(headers[0].headers.len(), 3);
        assert_eq!(
            headers[0].headers[2].value,
            CellValue::Text("Profit".into())
        );
    }
}
