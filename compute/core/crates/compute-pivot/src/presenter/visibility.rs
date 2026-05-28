use std::collections::HashSet;

use compute_relational::AggregatedNode;
use compute_stats::values::{GroupKey, cell_value_to_group_key};

/// Structural expansion key for OOXML per-item expansion state.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ExpansionKey {
    /// Hierarchy depth of the node this expansion key addresses.
    pub depth: usize,
    /// The node's leaf value, as a structural group key.
    pub leaf: GroupKey,
}

impl ExpansionKey {
    /// Render this expansion key in the legacy `"{depth}\x01{wire}"`
    /// format used by the XLSX parser and `PivotExpansionState`.
    #[must_use]
    pub fn to_wire_string(&self) -> String {
        format!("{}\x01{}", self.depth, self.leaf.to_wire_string())
    }
}

/// Check if a node is expanded based on the expansion set.
pub(super) fn is_node_expanded(
    node: &AggregatedNode,
    expanded_set: Option<&HashSet<String>>,
) -> bool {
    expanded_set.is_none_or(|set| {
        if set.contains(&node.key) {
            return true;
        }
        let expansion_key = ExpansionKey {
            depth: node.depth,
            leaf: cell_value_to_group_key(&node.value),
        };
        set.contains(&expansion_key.to_wire_string())
    })
}

/// Count visible leaves considering expansion state.
pub(super) fn count_visible_leaves(
    nodes: &[AggregatedNode],
    expanded_set: Option<&HashSet<String>>,
) -> usize {
    let mut count = 0;
    for node in nodes {
        let is_expanded = is_node_expanded(node, expanded_set);
        if node.children.is_empty() || !is_expanded {
            count += 1;
        } else {
            count += count_visible_leaves(&node.children, expanded_set);
        }
    }
    count
}

/// Get nodes at a specific depth, respecting expansion state.
pub(super) fn get_nodes_at_depth_agg<'a>(
    nodes: &'a [AggregatedNode],
    target_depth: usize,
    expanded_set: Option<&HashSet<String>>,
) -> Vec<&'a AggregatedNode> {
    if target_depth == 0 {
        return nodes.iter().collect();
    }
    let mut result = Vec::new();
    for node in nodes {
        let is_expanded = is_node_expanded(node, expanded_set);
        if is_expanded && !node.children.is_empty() {
            result.extend(get_nodes_at_depth_agg(
                &node.children,
                target_depth - 1,
                expanded_set,
            ));
        }
    }
    result
}

/// Get all visible leaf nodes considering expansion state.
pub(super) fn get_visible_leaves<'a>(
    nodes: &'a [AggregatedNode],
    expanded_set: Option<&HashSet<String>>,
) -> Vec<&'a AggregatedNode> {
    let mut leaves = Vec::new();
    collect_visible_leaves(nodes, expanded_set, &mut leaves);
    leaves
}

/// Collect visible leaf nodes into `out`.
pub(super) fn collect_visible_leaves<'a>(
    nodes: &'a [AggregatedNode],
    expanded_set: Option<&HashSet<String>>,
    out: &mut Vec<&'a AggregatedNode>,
) {
    for node in nodes {
        let is_expanded = is_node_expanded(node, expanded_set);
        if node.children.is_empty() || !is_expanded {
            out.push(node);
        } else {
            collect_visible_leaves(&node.children, expanded_set, out);
        }
    }
}

/// Collect all leaf nodes, ignoring expansion state.
pub(super) fn collect_all_leaves_recursive<'a>(
    nodes: &'a [AggregatedNode],
    out: &mut Vec<&'a AggregatedNode>,
) {
    for node in nodes {
        if node.children.is_empty() {
            out.push(node);
        } else {
            collect_all_leaves_recursive(&node.children, out);
        }
    }
}

/// Collect all leaf nodes, ignoring expansion state.
pub(super) fn collect_all_leaves(nodes: &[AggregatedNode]) -> Vec<&AggregatedNode> {
    let mut leaves = Vec::new();
    collect_all_leaves_recursive(nodes, &mut leaves);
    leaves
}

#[cfg(test)]
mod expansion_key_tests {
    use value_types::CellValue;

    use super::*;

    #[test]
    fn expansion_key_wire_string_matches_legacy_format() {
        let k_text = ExpansionKey {
            depth: 0,
            leaf: cell_value_to_group_key(&CellValue::Text("A".into())),
        };
        assert_eq!(k_text.to_wire_string(), "0\x01T:a");

        let k_blank = ExpansionKey {
            depth: 1,
            leaf: cell_value_to_group_key(&CellValue::Null),
        };
        assert_eq!(k_blank.to_wire_string(), "1\x01\x00BLANK\x00");

        let k_num = ExpansionKey {
            depth: 2,
            leaf: cell_value_to_group_key(&CellValue::number(42.0)),
        };
        assert!(k_num.to_wire_string().starts_with("2\x01N:"));
    }

    #[test]
    fn expansion_key_text_with_blank_sentinel_distinct_from_blank() {
        let blank = ExpansionKey {
            depth: 0,
            leaf: cell_value_to_group_key(&CellValue::Null),
        };
        let text_sentinel = ExpansionKey {
            depth: 0,
            leaf: cell_value_to_group_key(&CellValue::Text("\x00BLANK\x00".into())),
        };
        assert_ne!(blank, text_sentinel);
    }

    #[test]
    fn expansion_key_differs_across_depth() {
        let k0 = ExpansionKey {
            depth: 0,
            leaf: cell_value_to_group_key(&CellValue::Text("x".into())),
        };
        let k1 = ExpansionKey {
            depth: 1,
            leaf: cell_value_to_group_key(&CellValue::Text("x".into())),
        };
        assert_ne!(k0, k1);
        assert_ne!(k0.to_wire_string(), k1.to_wire_string());
    }
}
