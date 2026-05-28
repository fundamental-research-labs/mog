use std::collections::{HashMap, HashSet};

use compute_relational::AggregatedNode;
use value_types::CellValue;

use crate::engine::SUBTOTAL_SUFFIX;
use crate::types::{FieldId, PivotHeader, PivotRow};

use super::value_remap::ColumnRemap;
use super::visibility::is_node_expanded;

/// Build a map from node key to node reference for the entire tree.
pub(super) fn build_node_map<'a>(
    nodes: &'a [AggregatedNode],
    map: &mut HashMap<String, &'a AggregatedNode>,
) {
    for node in nodes {
        map.insert(node.key.clone(), node);
        if !node.children.is_empty() {
            build_node_map(&node.children, map);
        }
    }
}

/// Build the ancestor chain of `PivotHeader`s for a node by walking `parent_key`.
pub(super) fn build_ancestor_chain<'a>(
    node: &'a AggregatedNode,
    node_map: &'a HashMap<String, &'a AggregatedNode>,
    is_expanded: bool,
) -> Vec<PivotHeader> {
    let mut chain: Vec<&AggregatedNode> = Vec::new();
    let mut cur: Option<&AggregatedNode> = Some(node);
    while let Some(cn) = cur {
        chain.push(cn);
        cur = cn
            .parent_key
            .as_ref()
            .and_then(|pk| node_map.get(pk.as_str()).copied());
    }
    chain.reverse();

    let mut headers = Vec::new();
    for (i, ancestor) in chain.iter().enumerate() {
        let is_last = i == chain.len() - 1;
        let value = if ancestor.value == CellValue::Null {
            CellValue::Text("(blank)".into())
        } else {
            ancestor.value.clone()
        };
        headers.push(PivotHeader {
            key: ancestor.key.clone(),
            value,
            field_id: FieldId::from(ancestor.field_id.clone()),
            depth: ancestor.depth,
            span: 1,
            is_expandable: !ancestor.children.is_empty(),
            is_expanded: if is_last { is_expanded } else { true },
            is_subtotal: false,
            is_grand_total: false,
            parent_key: ancestor.parent_key.clone(),
            child_keys: if is_last {
                Some(ancestor.children.iter().map(|c| c.key.clone()).collect())
            } else {
                None
            },
        });
    }

    headers
}

/// Flatten the row tree into `PivotRow`s, applying expansion state.
#[allow(clippy::too_many_arguments)]
pub(super) fn flatten_row_tree<'a>(
    nodes: &'a [AggregatedNode],
    expanded_set: Option<&HashSet<String>>,
    show_subtotals: &[bool],
    is_tabular: bool,
    depth: usize,
    result: &mut Vec<PivotRow>,
    col_remap: &ColumnRemap,
    node_map: &'a HashMap<String, &'a AggregatedNode>,
) {
    let depth_show_subtotal = show_subtotals.get(depth).copied().unwrap_or(false);

    for node in nodes {
        let is_expanded = is_node_expanded(node, expanded_set);
        let has_visible_children = is_expanded && !node.children.is_empty();

        if is_tabular && has_visible_children {
            flatten_row_tree(
                &node.children,
                expanded_set,
                show_subtotals,
                is_tabular,
                depth + 1,
                result,
                col_remap,
                node_map,
            );

            if depth_show_subtotal {
                emit_subtotal_row(node, result, col_remap, node_map);
            }
            continue;
        }

        let headers = build_ancestor_chain(node, node_map, is_expanded);
        let values = col_remap.remap(&node.values);

        result.push(PivotRow {
            key: node.key.clone(),
            headers,
            values,
            depth: node.depth,
            is_subtotal: false,
            is_grand_total: false,
            source_row_indices: Some(node.row_indices.clone()),
        });

        if has_visible_children {
            flatten_row_tree(
                &node.children,
                expanded_set,
                show_subtotals,
                is_tabular,
                depth + 1,
                result,
                col_remap,
                node_map,
            );

            if depth_show_subtotal {
                emit_subtotal_row(node, result, col_remap, node_map);
            }
        }
    }
}

/// Emit a subtotal row for a node.
pub(super) fn emit_subtotal_row(
    node: &AggregatedNode,
    result: &mut Vec<PivotRow>,
    col_remap: &ColumnRemap,
    node_map: &HashMap<String, &AggregatedNode>,
) {
    let mut chain: Vec<&AggregatedNode> = Vec::new();
    let mut cur: Option<&AggregatedNode> = Some(node);
    while let Some(cn) = cur {
        chain.push(cn);
        cur = cn
            .parent_key
            .as_ref()
            .and_then(|pk| node_map.get(pk.as_str()).copied());
    }
    chain.reverse();

    let mut headers = Vec::new();
    for ancestor in &chain[..chain.len().saturating_sub(1)] {
        headers.push(PivotHeader {
            key: ancestor.key.clone(),
            value: ancestor.value.clone(),
            field_id: FieldId::from(ancestor.field_id.clone()),
            depth: ancestor.depth,
            span: 1,
            is_expandable: !ancestor.children.is_empty(),
            is_expanded: true,
            is_subtotal: false,
            is_grand_total: false,
            parent_key: ancestor.parent_key.clone(),
            child_keys: None,
        });
    }

    headers.push(PivotHeader {
        key: format!("{}{}", node.key, SUBTOTAL_SUFFIX),
        value: CellValue::Text(format!("{} Total", node.value).into()),
        field_id: FieldId::from(node.field_id.clone()),
        depth: node.depth,
        span: 1,
        is_expandable: !node.children.is_empty(),
        is_expanded: true,
        is_subtotal: true,
        is_grand_total: false,
        parent_key: node.parent_key.clone(),
        child_keys: None,
    });

    let raw_values = node.subtotal_values.as_deref().unwrap_or(&node.values);
    let values = col_remap.remap(raw_values);

    result.push(PivotRow {
        key: format!("{}{}", node.key, SUBTOTAL_SUFFIX),
        headers,
        values,
        depth: node.depth,
        is_subtotal: true,
        is_grand_total: false,
        source_row_indices: Some(node.row_indices.clone()),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(values: Vec<CellValue>, subtotal_values: Option<Vec<CellValue>>) -> AggregatedNode {
        AggregatedNode {
            key: "east".to_string(),
            value: CellValue::Text("East".into()),
            field_id: "region".to_string(),
            depth: 0,
            values,
            subtotal_values,
            row_indices: vec![0, 1],
            children: Vec::new(),
            parent_key: None,
        }
    }

    #[test]
    fn subtotal_rows_prefer_subtotal_values_over_node_values() {
        let node = node(
            vec![CellValue::number(1.0)],
            Some(vec![CellValue::number(9.0)]),
        );
        let mut node_map = HashMap::new();
        node_map.insert(node.key.clone(), &node);
        let remap = ColumnRemap::build(&[], None, 1);
        let mut rows = Vec::new();

        emit_subtotal_row(&node, &mut rows, &remap, &node_map);

        assert_eq!(rows[0].values, vec![CellValue::number(9.0)]);
        assert_eq!(rows[0].source_row_indices, Some(vec![0, 1]));
    }
}
