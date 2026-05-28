use std::collections::HashMap;

use crate::types::PivotRow;

use super::model::GroupHierarchy;

/// Build a `GroupHierarchy` from the flattened pivot rows.
///
/// This is O(R) - one pass over the rows. Call this in the engine after
/// `compute_pivot_rows` and before `apply_show_values_as`.
///
/// # Arguments
///
/// - `rows`: The flattened pivot rows (data rows + subtotal rows + grand total row)
/// - `row_field_names`: Names of the row grouping fields, in order
///   (e.g., `["Region", "Product"]`)
#[must_use]
pub fn build_group_hierarchy(rows: &[PivotRow], row_field_names: &[String]) -> GroupHierarchy {
    let num_rows = rows.len();
    let num_depths = row_field_names.len();

    let mut row_group_paths: Vec<Vec<(String, String)>> = Vec::with_capacity(num_rows);
    let mut subtotal_index: HashMap<(usize, String), usize> = HashMap::new();
    let mut children_by_parent: HashMap<(usize, String), Vec<usize>> = HashMap::new();

    for (row_idx, row) in rows.iter().enumerate() {
        if row.is_grand_total {
            row_group_paths.push(Vec::new());
            continue;
        }

        let mut path: Vec<(String, String)> = Vec::with_capacity(num_depths);
        for (d, header) in row.headers.iter().enumerate() {
            if d >= num_depths {
                break;
            }
            let field_name = if d < row_field_names.len() {
                row_field_names[d].clone()
            } else {
                header.field_id.to_string()
            };
            path.push((field_name, header.key.clone()));
        }

        if row.is_subtotal {
            let depth = row.depth;
            if depth < path.len() {
                let parent_key = path[depth].1.clone();
                subtotal_index.insert((depth, parent_key), row_idx);
            }
            row_group_paths.push(path);
            continue;
        }

        for d in 0..num_depths {
            let parent_key = if d == 0 {
                String::new()
            } else if d <= path.len() {
                path[d - 1].1.clone()
            } else {
                break;
            };
            children_by_parent
                .entry((d, parent_key))
                .or_default()
                .push(row_idx);
        }

        row_group_paths.push(path);
    }

    GroupHierarchy {
        row_group_paths,
        subtotal_index,
        children_by_parent,
        field_names: row_field_names.to_vec(),
    }
}
