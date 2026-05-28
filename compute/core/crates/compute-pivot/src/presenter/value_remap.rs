use std::collections::HashMap;

use compute_relational::AggregatedNode;
use value_types::CellValue;

use super::visibility::{collect_all_leaves, get_visible_leaves};

/// Pre-computed column remap from visible column positions to full column positions.
pub(super) struct ColumnRemap {
    visible_to_full: Vec<Option<usize>>,
    measure_count: usize,
    is_identity: bool,
}

impl ColumnRemap {
    /// Build the remap from column tree and expansion state.
    pub(super) fn build(
        column_tree: &[AggregatedNode],
        col_expanded_set: Option<&std::collections::HashSet<String>>,
        measure_count: usize,
    ) -> Self {
        if column_tree.is_empty() || measure_count == 0 {
            return Self {
                visible_to_full: Vec::new(),
                measure_count,
                is_identity: true,
            };
        }

        let all_leaves = collect_all_leaves(column_tree);
        let visible_leaves = get_visible_leaves(column_tree, col_expanded_set);

        if all_leaves.len() == visible_leaves.len() {
            return Self {
                visible_to_full: Vec::new(),
                measure_count,
                is_identity: true,
            };
        }

        let leaf_index: HashMap<&str, usize> = all_leaves
            .iter()
            .enumerate()
            .map(|(i, leaf)| (leaf.key.as_str(), i))
            .collect();

        let visible_to_full = visible_leaves
            .iter()
            .map(|v| leaf_index.get(v.key.as_str()).copied())
            .collect();

        Self {
            visible_to_full,
            measure_count,
            is_identity: false,
        }
    }

    /// Remap values from the full column set to only visible columns.
    pub(super) fn remap(&self, values: &[CellValue]) -> Vec<CellValue> {
        if self.is_identity {
            return values.to_vec();
        }

        let mut result = Vec::with_capacity(self.visible_to_full.len() * self.measure_count);
        for full_idx in &self.visible_to_full {
            if let Some(idx) = full_idx {
                let start = idx * self.measure_count;
                for i in 0..self.measure_count {
                    result.push(values.get(start + i).cloned().unwrap_or(CellValue::Null));
                }
            } else {
                for _ in 0..self.measure_count {
                    result.push(CellValue::Null);
                }
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    fn node(
        key: &str,
        value: CellValue,
        depth: usize,
        children: Vec<AggregatedNode>,
        parent_key: Option<&str>,
    ) -> AggregatedNode {
        AggregatedNode {
            key: key.to_string(),
            value,
            field_id: format!("field_{depth}"),
            depth,
            values: Vec::new(),
            subtotal_values: None,
            row_indices: Vec::new(),
            children,
            parent_key: parent_key.map(str::to_string),
        }
    }

    #[test]
    fn collapsed_columns_preserve_measure_width_and_pad_missing_parent_leaf() {
        let tree = vec![node(
            "east",
            CellValue::Text("East".into()),
            0,
            vec![
                node(
                    "east\x00a",
                    CellValue::Text("A".into()),
                    1,
                    Vec::new(),
                    Some("east"),
                ),
                node(
                    "east\x00b",
                    CellValue::Text("B".into()),
                    1,
                    Vec::new(),
                    Some("east"),
                ),
            ],
            None,
        )];
        let expanded = HashSet::from(["not-east".to_string()]);
        let remap = ColumnRemap::build(&tree, Some(&expanded), 2);

        assert_eq!(
            remap.remap(&[
                CellValue::number(1.0),
                CellValue::number(2.0),
                CellValue::number(3.0),
                CellValue::number(4.0),
            ]),
            vec![CellValue::Null, CellValue::Null]
        );
    }
}
