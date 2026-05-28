use std::collections::{HashMap, HashSet};

use compute_relational::AggregatedNode;

use crate::types::PivotRow;

use super::model::GroupHierarchy;

/// Build a `GroupHierarchy` from an `AggregatedNode` tree and flat `PivotRow` output.
///
/// Takes `AggregatedNode` (from the relational engine). The expansion state is
/// used to determine which nodes are expanded.
#[must_use]
#[allow(clippy::implicit_hasher)]
pub fn build_group_hierarchy_from_aggregated_tree(
    tree: &[compute_relational::AggregatedNode],
    rows: &[PivotRow],
    row_field_names: &[String],
    expanded_set: Option<&std::collections::HashSet<String>>,
) -> GroupHierarchy {
    let num_rows = rows.len();
    let num_depths = row_field_names.len();

    let mut key_to_row_idx: HashMap<String, usize> = HashMap::with_capacity(num_rows);
    let mut subtotal_key_to_row_idx: HashMap<String, usize> = HashMap::new();

    for (i, row) in rows.iter().enumerate() {
        if row.is_subtotal {
            subtotal_key_to_row_idx.insert(row.key.clone(), i);
        } else if !row.is_grand_total {
            key_to_row_idx.insert(row.key.clone(), i);
        }
    }

    let mut context = TreeBuildContext {
        key_to_row_idx: &key_to_row_idx,
        subtotal_key_to_row_idx: &subtotal_key_to_row_idx,
        row_group_paths: vec![Vec::new(); num_rows],
        subtotal_index: HashMap::new(),
        children_by_parent: HashMap::new(),
        num_depths,
        expanded_set,
    };

    context.walk(tree, &[]);

    GroupHierarchy {
        row_group_paths: context.row_group_paths,
        subtotal_index: context.subtotal_index,
        children_by_parent: context.children_by_parent,
        field_names: row_field_names.to_vec(),
    }
}

struct TreeBuildContext<'a> {
    key_to_row_idx: &'a HashMap<String, usize>,
    subtotal_key_to_row_idx: &'a HashMap<String, usize>,
    row_group_paths: Vec<Vec<(String, String)>>,
    subtotal_index: HashMap<(usize, String), usize>,
    children_by_parent: HashMap<(usize, String), Vec<usize>>,
    num_depths: usize,
    expanded_set: Option<&'a HashSet<String>>,
}

impl TreeBuildContext<'_> {
    fn walk(&mut self, nodes: &[AggregatedNode], ancestor_path: &[(String, String)]) {
        for node in nodes {
            let depth = node.depth;
            let is_expanded = self.expanded_set.is_none_or(|set| set.contains(&node.key));

            let mut path = ancestor_path.to_vec();
            let field_name = node.field_id.clone();
            path.push((field_name, node.key.clone()));

            let subtotal_key = format!("{}{}", node.key, crate::engine::SUBTOTAL_SUFFIX);
            if let Some(&row_idx) = self.subtotal_key_to_row_idx.get(&subtotal_key) {
                self.subtotal_index
                    .insert((depth, node.key.clone()), row_idx);
                if row_idx < self.row_group_paths.len() {
                    self.row_group_paths[row_idx].clone_from(&path);
                }
            }

            if is_expanded && !node.children.is_empty() {
                self.walk(&node.children, &path);
            } else if let Some(&row_idx) = self.key_to_row_idx.get(&node.key) {
                if row_idx < self.row_group_paths.len() {
                    self.row_group_paths[row_idx].clone_from(&path);
                }

                for d in 0..self.num_depths.min(path.len()) {
                    let parent_key = if d == 0 {
                        String::new()
                    } else {
                        path[d - 1].1.clone()
                    };
                    self.children_by_parent
                        .entry((d, parent_key))
                        .or_default()
                        .push(row_idx);
                }
            }
        }
    }
}
