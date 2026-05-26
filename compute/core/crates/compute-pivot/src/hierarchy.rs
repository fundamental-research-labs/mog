//! Group hierarchy index for Show Values As.
//!
//! This module solves the core architectural problem with Show Values As:
//! the transform layer currently operates on a flat list of `PivotRow`s and
//! cannot reset running totals at group boundaries, scope ranks within
//! parent groups, or find parent totals efficiently.
//!
//! `GroupHierarchy` is a lightweight pre-indexed structure built in O(R) time
//! (one pass over the flattened rows) that provides:
//!
//! - **O(1) parent lookup**: given a row, find its parent subtotal at any depth
//! - **Group-scoped iteration**: iterate siblings within a parent group
//! - **Group boundary detection**: check if a row is the first/last in its group
//! - **Field depth resolution**: map a `base_field` name to the hierarchy depth
//!
//! # Usage
//!
//! ```
//! use compute_pivot::hierarchy::{build_group_hierarchy, GroupHierarchy};
//! use compute_pivot::types::PivotRow;
//!
//! let rows: Vec<PivotRow> = vec![];
//! let row_field_names: Vec<String> = vec!["Region".to_string()];
//! let hierarchy = build_group_hierarchy(&rows, &row_field_names);
//! assert_eq!(hierarchy.depth_for_field("Region"), Some(0));
//! assert_eq!(hierarchy.depth_for_field("Unknown"), None);
//! ```
//!
//! # Allocation Strategy
//!
//! Uses owned `String`s (not lifetimes) for simplicity. The hierarchy is built
//! once per `compute()` call and the allocation is O(R * D) where D is the
//! hierarchy depth (typically 2–5). Lifetime complexity is not worth it here.

//! # Important: Equality Semantics
//!
//! This module MUST use `cell_value_eq` from `super::values` for all
//! `CellValue` comparisons. Do NOT use the `==` operator on `CellValue` —
//! it uses ASCII-only case folding and exact float comparison, which differs
//! from the pivot engine's canonical Unicode-aware, epsilon-tolerant equality.

use std::collections::HashMap;

use value_types::CellValue;

use super::types::PivotRow;
use super::values::cell_value_eq;

// ============================================================================
// Core Type
// ============================================================================

/// Lightweight representation of the group tree for Show Values As.
///
/// Does NOT own the data — indexes into the engine's flat pivot row list.
///
/// This structure pre-indexes the hierarchical relationships between rows,
/// enabling O(1) parent lookup, group-scoped iteration, and group boundary
/// detection — all of which are impossible with a flat row list alone.
pub struct GroupHierarchy {
    /// For each data row index in the flat list, which group path does it belong to?
    /// `path[i] = vec![("Region", "East"), ("Product", "Widget")]` for row i.
    /// The tuple is `(field_name, group_key)`.
    ///
    /// Only populated for data rows (not subtotal or grand total rows).
    /// Subtotal/grand total rows have an empty path.
    pub row_group_paths: Vec<Vec<(String, String)>>,

    /// Pre-indexed: for each `(depth, parent_path_key)`, the subtotal row index
    /// in the flat list.
    ///
    /// `parent_path_key` is the NUL-separated path key up to that depth.
    /// For depth 0, the `parent_path_key` is the key of the depth-0 header itself.
    pub subtotal_index: HashMap<(usize, String), usize>,

    /// Pre-indexed: for each `(depth, parent_path_key)`, the list of data row
    /// indices that are children of that parent group.
    ///
    /// At depth 0, the `parent_path_key` is "" (root), and children are all
    /// top-level data rows.
    /// At depth 1, the `parent_path_key` is the depth-0 header key, and children
    /// are the data rows within that group.
    pub children_by_parent: HashMap<(usize, String), Vec<usize>>,

    /// The group field names at each depth level.
    /// e.g., `["Region", "Product", "SKU"]` for a 3-level row hierarchy.
    pub field_names: Vec<String>,
}

// ============================================================================
// Builder
// ============================================================================

/// Build a `GroupHierarchy` from the flattened pivot rows.
///
/// This is O(R) — one pass over the rows. Call this in the engine after
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
            // Grand total rows don't belong to any group path
            row_group_paths.push(Vec::new());
            continue;
        }

        // Extract the group path from headers.
        // Each PivotHeader at depth d has field_id and a key.
        // We use up to `num_depths` headers to build the path.
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
            // Index this subtotal row.
            // A subtotal at depth d summarizes the group at depth d.
            // The parent_path_key is the key of the header at depth d (the group being subtotaled).
            let depth = row.depth;
            if depth < path.len() {
                let parent_key = path[depth].1.clone();
                subtotal_index.insert((depth, parent_key), row_idx);
            }
            row_group_paths.push(path);
            continue;
        }

        // Data row — add to children_by_parent at each depth level.
        // At depth d, the "parent" is identified by the path up to depth d
        // (exclusive of depth d itself). The root parent (depth 0) has key "".
        for d in 0..num_depths {
            let parent_key = if d == 0 {
                // Root level — all data rows are children of the root
                String::new()
            } else if d <= path.len() {
                // Parent key is the header key at depth d-1
                // (the group that contains this row at depth d)
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

    // Build key → row index maps for O(1) lookup.
    let mut key_to_row_idx: HashMap<String, usize> = HashMap::with_capacity(num_rows);
    let mut subtotal_key_to_row_idx: HashMap<String, usize> = HashMap::new();

    for (i, row) in rows.iter().enumerate() {
        if row.is_subtotal {
            subtotal_key_to_row_idx.insert(row.key.clone(), i);
        } else if !row.is_grand_total {
            key_to_row_idx.insert(row.key.clone(), i);
        }
    }

    // Initialize outputs.
    let mut row_group_paths: Vec<Vec<(String, String)>> = vec![Vec::new(); num_rows];
    let mut subtotal_index: HashMap<(usize, String), usize> = HashMap::new();
    let mut children_by_parent: HashMap<(usize, String), Vec<usize>> = HashMap::new();

    // Walk the tree recursively, building hierarchy metadata.
    walk_agg_tree(
        tree,
        &[],
        &key_to_row_idx,
        &subtotal_key_to_row_idx,
        &mut row_group_paths,
        &mut subtotal_index,
        &mut children_by_parent,
        num_depths,
        expanded_set,
    );

    GroupHierarchy {
        row_group_paths,
        subtotal_index,
        children_by_parent,
        field_names: row_field_names.to_vec(),
    }
}

// ============================================================================
// Helper Methods
// ============================================================================

#[allow(clippy::too_many_arguments)]
fn walk_agg_tree(
    nodes: &[compute_relational::AggregatedNode],
    ancestor_path: &[(String, String)],
    key_to_row_idx: &HashMap<String, usize>,
    subtotal_key_to_row_idx: &HashMap<String, usize>,
    row_group_paths: &mut [Vec<(String, String)>],
    subtotal_index: &mut HashMap<(usize, String), usize>,
    children_by_parent: &mut HashMap<(usize, String), Vec<usize>>,
    num_depths: usize,
    expanded_set: Option<&std::collections::HashSet<String>>,
) {
    for node in nodes {
        let depth = node.depth;
        let is_expanded = expanded_set.is_none_or(|set| set.contains(&node.key));

        // Build the full path for this node.
        let mut path = ancestor_path.to_vec();
        let field_name = node.field_id.clone();
        path.push((field_name, node.key.clone()));

        // Check for subtotal row.
        let subtotal_key = format!("{}{}", node.key, crate::engine::SUBTOTAL_SUFFIX);
        if let Some(&row_idx) = subtotal_key_to_row_idx.get(&subtotal_key) {
            subtotal_index.insert((depth, node.key.clone()), row_idx);
            if row_idx < row_group_paths.len() {
                row_group_paths[row_idx].clone_from(&path);
            }
        }

        if is_expanded && !node.children.is_empty() {
            walk_agg_tree(
                &node.children,
                &path,
                key_to_row_idx,
                subtotal_key_to_row_idx,
                row_group_paths,
                subtotal_index,
                children_by_parent,
                num_depths,
                expanded_set,
            );
        } else if let Some(&row_idx) = key_to_row_idx.get(&node.key) {
            if row_idx < row_group_paths.len() {
                row_group_paths[row_idx].clone_from(&path);
            }

            for d in 0..num_depths.min(path.len()) {
                let parent_key = if d == 0 {
                    String::new()
                } else {
                    path[d - 1].1.clone()
                };
                children_by_parent
                    .entry((d, parent_key))
                    .or_default()
                    .push(row_idx);
            }
        }
    }
}

impl GroupHierarchy {
    /// Find the depth index for a given field name (for `base_field` resolution).
    ///
    /// Returns `None` if the field is not in the row hierarchy.
    ///
    /// # Example
    /// ```
    /// use compute_pivot::hierarchy::{build_group_hierarchy, GroupHierarchy};
    ///
    /// let rows = vec![];
    /// let field_names = vec!["Region".to_string(), "Product".to_string(), "SKU".to_string()];
    /// let hierarchy = build_group_hierarchy(&rows, &field_names);
    /// assert_eq!(hierarchy.depth_for_field("Region"), Some(0));
    /// assert_eq!(hierarchy.depth_for_field("Product"), Some(1));
    /// assert_eq!(hierarchy.depth_for_field("Unknown"), None);
    /// ```
    #[must_use]
    pub fn depth_for_field(&self, field_name: &str) -> Option<usize> {
        self.field_names.iter().position(|f| f == field_name)
    }

    /// Get the parent path key for a row at a given depth.
    ///
    /// This is the key that identifies the parent group at `depth`.
    /// At depth 0, the parent is the root (returns `""`).
    /// At depth 1+, the parent is identified by the header key at `depth - 1`.
    ///
    /// Returns an empty string if the row has no path data (grand total row)
    /// or if the depth is out of range.
    #[must_use]
    pub fn parent_path_key_at_depth(&self, row_idx: usize, depth: usize) -> String {
        if depth == 0 {
            return String::new();
        }
        let Some(path) = self.row_group_paths.get(row_idx) else {
            return String::new();
        };
        if depth <= path.len() {
            // Parent key at depth d is the header key at depth d-1
            path[depth - 1].1.clone()
        } else {
            String::new()
        }
    }

    /// Get all sibling data row indices for a given row at a given depth.
    ///
    /// "Siblings" means rows sharing the same parent at the specified depth.
    /// For depth 0, siblings are all data rows at the top level.
    ///
    /// Returns `None` if no siblings are indexed for this row at this depth.
    #[must_use]
    pub fn siblings_at_depth(&self, row_idx: usize, depth: usize) -> Option<&[usize]> {
        let parent_key = self.parent_path_key_at_depth(row_idx, depth);
        self.children_by_parent
            .get(&(depth, parent_key))
            .map(std::vec::Vec::as_slice)
    }

    /// Find the subtotal row index for the parent group at a given depth.
    ///
    /// Looks up the subtotal row that summarizes the group containing
    /// `row_idx` at `depth`.
    ///
    /// Returns `None` if no subtotal row exists for this group.
    #[must_use]
    pub fn subtotal_at_depth(&self, row_idx: usize, depth: usize) -> Option<usize> {
        let path = self.row_group_paths.get(row_idx)?;
        if depth >= path.len() {
            return None;
        }
        // The subtotal for a group at depth d is indexed by (d, group_key_at_d)
        let group_key = &path[depth].1;
        self.subtotal_index
            .get(&(depth, group_key.clone()))
            .copied()
    }

    /// Get the position of a row within its sibling group at a given depth.
    ///
    /// Returns `(position, total_siblings)` where `position` is 0-indexed.
    /// Returns `None` if the row is not found in its sibling group.
    #[must_use]
    pub fn position_in_group(&self, row_idx: usize, depth: usize) -> Option<(usize, usize)> {
        self.siblings_at_depth(row_idx, depth).and_then(|siblings| {
            siblings
                .iter()
                .position(|&idx| idx == row_idx)
                .map(|pos| (pos, siblings.len()))
        })
    }

    /// Check if a row is the first in its group at a given depth.
    ///
    /// Useful for detecting group boundaries (e.g., resetting running totals).
    #[must_use]
    pub fn is_first_in_group(&self, row_idx: usize, depth: usize) -> bool {
        self.position_in_group(row_idx, depth)
            .is_some_and(|(pos, _)| pos == 0)
    }

    /// Check if a row is the last in its group at a given depth.
    ///
    /// Useful for detecting group boundaries.
    #[must_use]
    pub fn is_last_in_group(&self, row_idx: usize, depth: usize) -> bool {
        self.position_in_group(row_idx, depth)
            .is_some_and(|(pos, total)| pos == total - 1)
    }

    /// Get the previous sibling row index within the group at a given depth.
    ///
    /// Returns `None` if the row is the first in its group.
    #[must_use]
    pub fn previous_sibling(&self, row_idx: usize, depth: usize) -> Option<usize> {
        let (pos, _) = self.position_in_group(row_idx, depth)?;
        if pos == 0 {
            return None;
        }
        self.siblings_at_depth(row_idx, depth).map(|s| s[pos - 1])
    }

    /// Get the next sibling row index within the group at a given depth.
    ///
    /// Returns `None` if the row is the last in its group.
    #[must_use]
    pub fn next_sibling(&self, row_idx: usize, depth: usize) -> Option<usize> {
        let (pos, total) = self.position_in_group(row_idx, depth)?;
        if pos >= total - 1 {
            return None;
        }
        self.siblings_at_depth(row_idx, depth).map(|s| s[pos + 1])
    }

    /// Find a specific sibling by matching a header value within the group at a given depth.
    ///
    /// Searches siblings of `row_idx` at `depth` for one whose `PivotHeader`
    /// at `depth` has a `value` equal to `target_value`.
    ///
    /// This is used by `ShowValuesAs::Difference` with `Specific` base items
    /// to find the comparison row within the correct group scope.
    #[must_use]
    pub fn find_sibling_by_value(
        &self,
        row_idx: usize,
        depth: usize,
        rows: &[PivotRow],
        target_value: &CellValue,
    ) -> Option<usize> {
        self.siblings_at_depth(row_idx, depth)?
            .iter()
            .find(|&&sibling_idx| {
                rows.get(sibling_idx)
                    .and_then(|r| r.headers.get(depth))
                    .is_some_and(|h| cell_value_eq(&h.value, target_value))
            })
            .copied()
    }

    /// Number of depth levels in the hierarchy.
    #[must_use]
    pub fn depth(&self) -> usize {
        self.field_names.len()
    }

    /// Returns `true` if this is a flat (single-level) hierarchy.
    ///
    /// For flat hierarchies, Show Values As can operate on the global flat
    /// list without group-scoping — the current behavior is correct.
    #[must_use]
    pub fn is_flat(&self) -> bool {
        self.field_names.len() <= 1
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{FieldId, PivotHeader};
    use value_types::CellValue;

    // ---- Test helpers ----

    /// Create a PivotHeader for testing.
    fn make_header(key: &str, value: CellValue, field_id: &str, depth: usize) -> PivotHeader {
        PivotHeader {
            key: key.to_string(),
            value,
            field_id: FieldId::from(field_id.to_string()),
            depth,
            span: 1,
            is_expandable: false,
            is_expanded: true,
            is_subtotal: false,
            is_grand_total: false,
            parent_key: None,
            child_keys: None,
        }
    }

    /// Create a data row (not subtotal, not grand total).
    fn make_data_row(key: &str, headers: Vec<PivotHeader>, values: Vec<CellValue>) -> PivotRow {
        let depth = headers.last().map_or(0, |h| h.depth);
        PivotRow {
            key: key.to_string(),
            headers,
            values,
            depth,
            is_subtotal: false,
            is_grand_total: false,
            source_row_indices: None,
        }
    }

    /// Create a subtotal row.
    fn make_subtotal_row(
        key: &str,
        headers: Vec<PivotHeader>,
        depth: usize,
        values: Vec<CellValue>,
    ) -> PivotRow {
        PivotRow {
            key: key.to_string(),
            headers,
            values,
            depth,
            is_subtotal: true,
            is_grand_total: false,
            source_row_indices: None,
        }
    }

    /// Create a grand total row.
    fn make_grand_total_row(values: Vec<CellValue>) -> PivotRow {
        PivotRow {
            key: "__grand_total__".to_string(),
            headers: vec![],
            values,
            depth: 0,
            is_subtotal: false,
            is_grand_total: true,
            source_row_indices: None,
        }
    }

    /// Build a standard 2-level hierarchy for testing.
    ///
    /// Structure (Region > Product):
    ///   Row 0: East / Widget  (data)
    ///   Row 1: East / Gadget  (data)
    ///   Row 2: East subtotal
    ///   Row 3: West / Widget  (data)
    ///   Row 4: West subtotal
    ///   Row 5: Grand total
    fn build_two_level_rows() -> (Vec<PivotRow>, Vec<String>) {
        let field_names = vec!["Region".to_string(), "Product".to_string()];

        let rows = vec![
            // Row 0: East / Widget
            make_data_row(
                "east\x00widget",
                vec![
                    make_header("east", CellValue::Text("East".into()), "region", 0),
                    make_header(
                        "east\x00widget",
                        CellValue::Text("Widget".into()),
                        "product",
                        1,
                    ),
                ],
                vec![CellValue::number(100.0)],
            ),
            // Row 1: East / Gadget
            make_data_row(
                "east\x00gadget",
                vec![
                    make_header("east", CellValue::Text("East".into()), "region", 0),
                    make_header(
                        "east\x00gadget",
                        CellValue::Text("Gadget".into()),
                        "product",
                        1,
                    ),
                ],
                vec![CellValue::number(200.0)],
            ),
            // Row 2: East subtotal
            make_subtotal_row(
                "east__SUBTOTAL__",
                vec![make_header(
                    "east",
                    CellValue::Text("East Total".into()),
                    "region",
                    0,
                )],
                0,
                vec![CellValue::number(300.0)],
            ),
            // Row 3: West / Widget
            make_data_row(
                "west\x00widget",
                vec![
                    make_header("west", CellValue::Text("West".into()), "region", 0),
                    make_header(
                        "west\x00widget",
                        CellValue::Text("Widget".into()),
                        "product",
                        1,
                    ),
                ],
                vec![CellValue::number(150.0)],
            ),
            // Row 4: West subtotal
            make_subtotal_row(
                "west__SUBTOTAL__",
                vec![make_header(
                    "west",
                    CellValue::Text("West Total".into()),
                    "region",
                    0,
                )],
                0,
                vec![CellValue::number(150.0)],
            ),
            // Row 5: Grand total
            make_grand_total_row(vec![CellValue::number(450.0)]),
        ];

        (rows, field_names)
    }

    // ---- build_group_hierarchy: basic structure ----

    #[test]
    fn test_build_two_level_hierarchy_paths() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // Row 0 (East/Widget): path should have two entries
        assert_eq!(hierarchy.row_group_paths[0].len(), 2);
        assert_eq!(hierarchy.row_group_paths[0][0].0, "Region");
        assert_eq!(hierarchy.row_group_paths[0][0].1, "east");
        assert_eq!(hierarchy.row_group_paths[0][1].0, "Product");
        assert_eq!(hierarchy.row_group_paths[0][1].1, "east\x00widget");

        // Row 1 (East/Gadget): same region, different product
        assert_eq!(hierarchy.row_group_paths[1][0].1, "east");
        assert_eq!(hierarchy.row_group_paths[1][1].1, "east\x00gadget");

        // Row 3 (West/Widget): different region
        assert_eq!(hierarchy.row_group_paths[3][0].1, "west");
        assert_eq!(hierarchy.row_group_paths[3][1].1, "west\x00widget");

        // Row 5 (Grand total): empty path
        assert!(hierarchy.row_group_paths[5].is_empty());
    }

    #[test]
    fn test_build_two_level_hierarchy_children_by_parent() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // At depth 0, parent is root (""). All data rows should be children.
        let root_children = hierarchy.children_by_parent.get(&(0, String::new()));
        assert!(root_children.is_some());
        let root_children = root_children.unwrap();
        assert_eq!(root_children, &[0, 1, 3]); // East/Widget, East/Gadget, West/Widget

        // At depth 1, parent "east" should have rows 0 and 1
        let east_children = hierarchy.children_by_parent.get(&(1, "east".to_string()));
        assert!(east_children.is_some());
        assert_eq!(east_children.unwrap(), &[0, 1]);

        // At depth 1, parent "west" should have row 3
        let west_children = hierarchy.children_by_parent.get(&(1, "west".to_string()));
        assert!(west_children.is_some());
        assert_eq!(west_children.unwrap(), &[3]);
    }

    #[test]
    fn test_build_two_level_hierarchy_subtotal_index() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // East subtotal at depth 0, key "east" -> row 2
        assert_eq!(
            hierarchy.subtotal_index.get(&(0, "east".to_string())),
            Some(&2)
        );

        // West subtotal at depth 0, key "west" -> row 4
        assert_eq!(
            hierarchy.subtotal_index.get(&(0, "west".to_string())),
            Some(&4)
        );
    }

    #[test]
    fn test_build_two_level_hierarchy_field_names() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        assert_eq!(hierarchy.field_names, vec!["Region", "Product"]);
    }

    // ---- siblings_at_depth ----

    #[test]
    fn test_siblings_at_depth_1() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // East/Widget (row 0) siblings at depth 1 (Product level) = [0, 1]
        let siblings = hierarchy.siblings_at_depth(0, 1);
        assert!(siblings.is_some());
        assert_eq!(siblings.unwrap(), &[0, 1]);

        // East/Gadget (row 1) siblings at depth 1 should be the same
        let siblings = hierarchy.siblings_at_depth(1, 1);
        assert!(siblings.is_some());
        assert_eq!(siblings.unwrap(), &[0, 1]);

        // West/Widget (row 3) siblings at depth 1 = [3]
        let siblings = hierarchy.siblings_at_depth(3, 1);
        assert!(siblings.is_some());
        assert_eq!(siblings.unwrap(), &[3]);
    }

    #[test]
    fn test_siblings_at_depth_0() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // All data rows are siblings at depth 0
        let siblings = hierarchy.siblings_at_depth(0, 0);
        assert!(siblings.is_some());
        assert_eq!(siblings.unwrap(), &[0, 1, 3]);
    }

    // ---- previous_sibling / next_sibling ----

    #[test]
    fn test_previous_sibling_within_group() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // East/Gadget (row 1) previous at depth 1 = East/Widget (row 0)
        assert_eq!(hierarchy.previous_sibling(1, 1), Some(0));

        // East/Widget (row 0) previous at depth 1 = None (first in group)
        assert_eq!(hierarchy.previous_sibling(0, 1), None);
    }

    #[test]
    fn test_next_sibling_within_group() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // East/Widget (row 0) next at depth 1 = East/Gadget (row 1)
        assert_eq!(hierarchy.next_sibling(0, 1), Some(1));

        // East/Gadget (row 1) next at depth 1 = None (last in group)
        assert_eq!(hierarchy.next_sibling(1, 1), None);
    }

    #[test]
    fn test_previous_next_does_not_cross_group_boundary() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // West/Widget (row 3) previous at depth 1 = None
        // Even though East/Gadget (row 1) comes before it in the flat list,
        // they are in different parent groups at depth 1.
        assert_eq!(hierarchy.previous_sibling(3, 1), None);

        // East/Gadget (row 1) next at depth 1 = None
        // Even though West/Widget (row 3) comes after it in the flat list.
        assert_eq!(hierarchy.next_sibling(1, 1), None);
    }

    #[test]
    fn test_previous_next_at_depth_0() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // At depth 0, all data rows are in the root group: [0, 1, 3]
        // Row 0 next = row 1
        assert_eq!(hierarchy.next_sibling(0, 0), Some(1));
        // Row 1 next = row 3
        assert_eq!(hierarchy.next_sibling(1, 0), Some(3));
        // Row 3 next = None
        assert_eq!(hierarchy.next_sibling(3, 0), None);

        // Row 0 previous = None
        assert_eq!(hierarchy.previous_sibling(0, 0), None);
        // Row 1 previous = row 0
        assert_eq!(hierarchy.previous_sibling(1, 0), Some(0));
        // Row 3 previous = row 1
        assert_eq!(hierarchy.previous_sibling(3, 0), Some(1));
    }

    // ---- find_sibling_by_value ----

    #[test]
    fn test_find_sibling_by_value() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // From East/Gadget (row 1), find "Widget" at depth 1 -> East/Widget (row 0)
        let found = hierarchy.find_sibling_by_value(1, 1, &rows, &CellValue::Text("Widget".into()));
        assert_eq!(found, Some(0));

        // From East/Widget (row 0), find "Gadget" at depth 1 -> East/Gadget (row 1)
        let found = hierarchy.find_sibling_by_value(0, 1, &rows, &CellValue::Text("Gadget".into()));
        assert_eq!(found, Some(1));
    }

    #[test]
    fn test_find_sibling_by_value_not_found() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // From East/Widget (row 0), find "Nonexistent" at depth 1 -> None
        let found =
            hierarchy.find_sibling_by_value(0, 1, &rows, &CellValue::Text("Nonexistent".into()));
        assert_eq!(found, None);
    }

    #[test]
    fn test_find_sibling_by_value_scoped_to_parent() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // From West/Widget (row 3), find "Gadget" at depth 1 -> None
        // Gadget only exists under East, not under West.
        let found = hierarchy.find_sibling_by_value(3, 1, &rows, &CellValue::Text("Gadget".into()));
        assert_eq!(found, None);
    }

    // ---- subtotal_at_depth ----

    #[test]
    fn test_subtotal_at_depth() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // East/Widget (row 0) subtotal at depth 0 -> East subtotal (row 2)
        assert_eq!(hierarchy.subtotal_at_depth(0, 0), Some(2));

        // East/Gadget (row 1) subtotal at depth 0 -> East subtotal (row 2)
        assert_eq!(hierarchy.subtotal_at_depth(1, 0), Some(2));

        // West/Widget (row 3) subtotal at depth 0 -> West subtotal (row 4)
        assert_eq!(hierarchy.subtotal_at_depth(3, 0), Some(4));
    }

    #[test]
    fn test_subtotal_at_depth_out_of_range() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // There are no subtotals at depth 1 (product level) in this test data
        assert_eq!(hierarchy.subtotal_at_depth(0, 1), None);
    }

    // ---- depth_for_field ----

    #[test]
    fn test_depth_for_field() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        assert_eq!(hierarchy.depth_for_field("Region"), Some(0));
        assert_eq!(hierarchy.depth_for_field("Product"), Some(1));
        assert_eq!(hierarchy.depth_for_field("Unknown"), None);
    }

    // ---- position_in_group ----

    #[test]
    fn test_position_in_group() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // East/Widget (row 0) is first of 2 siblings at depth 1
        assert_eq!(hierarchy.position_in_group(0, 1), Some((0, 2)));

        // East/Gadget (row 1) is second of 2 siblings at depth 1
        assert_eq!(hierarchy.position_in_group(1, 1), Some((1, 2)));

        // West/Widget (row 3) is first (and only) at depth 1
        assert_eq!(hierarchy.position_in_group(3, 1), Some((0, 1)));
    }

    // ---- is_first_in_group / is_last_in_group ----

    #[test]
    fn test_is_first_in_group() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        assert!(hierarchy.is_first_in_group(0, 1)); // East/Widget
        assert!(!hierarchy.is_first_in_group(1, 1)); // East/Gadget
        assert!(hierarchy.is_first_in_group(3, 1)); // West/Widget (only one in West)
    }

    #[test]
    fn test_is_last_in_group() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        assert!(!hierarchy.is_last_in_group(0, 1)); // East/Widget
        assert!(hierarchy.is_last_in_group(1, 1)); // East/Gadget
        assert!(hierarchy.is_last_in_group(3, 1)); // West/Widget (only one in West)
    }

    // ---- depth / is_flat ----

    #[test]
    fn test_depth_and_is_flat() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        assert_eq!(hierarchy.depth(), 2);
        assert!(!hierarchy.is_flat());
    }

    #[test]
    fn test_is_flat_single_level() {
        let field_names = vec!["Region".to_string()];
        let rows = vec![
            make_data_row(
                "east",
                vec![make_header(
                    "east",
                    CellValue::Text("East".into()),
                    "region",
                    0,
                )],
                vec![CellValue::number(100.0)],
            ),
            make_data_row(
                "west",
                vec![make_header(
                    "west",
                    CellValue::Text("West".into()),
                    "region",
                    0,
                )],
                vec![CellValue::number(200.0)],
            ),
            make_grand_total_row(vec![CellValue::number(300.0)]),
        ];

        let hierarchy = build_group_hierarchy(&rows, &field_names);
        assert_eq!(hierarchy.depth(), 1);
        assert!(hierarchy.is_flat());
    }

    // ---- 3-level hierarchy (Region > State > City) ----

    #[test]
    fn test_three_level_hierarchy() {
        let field_names = vec![
            "Region".to_string(),
            "State".to_string(),
            "City".to_string(),
        ];

        let rows = vec![
            // Row 0: East / NY / NYC
            make_data_row(
                "east\x00ny\x00nyc",
                vec![
                    make_header("east", CellValue::Text("East".into()), "region", 0),
                    make_header("east\x00ny", CellValue::Text("NY".into()), "state", 1),
                    make_header(
                        "east\x00ny\x00nyc",
                        CellValue::Text("NYC".into()),
                        "city",
                        2,
                    ),
                ],
                vec![CellValue::number(500.0)],
            ),
            // Row 1: East / NY / Buffalo
            make_data_row(
                "east\x00ny\x00buf",
                vec![
                    make_header("east", CellValue::Text("East".into()), "region", 0),
                    make_header("east\x00ny", CellValue::Text("NY".into()), "state", 1),
                    make_header(
                        "east\x00ny\x00buf",
                        CellValue::Text("Buffalo".into()),
                        "city",
                        2,
                    ),
                ],
                vec![CellValue::number(100.0)],
            ),
            // Row 2: East / NY subtotal
            make_subtotal_row(
                "east\x00ny__SUBTOTAL__",
                vec![
                    make_header("east", CellValue::Text("East".into()), "region", 0),
                    make_header("east\x00ny", CellValue::Text("NY Total".into()), "state", 1),
                ],
                1,
                vec![CellValue::number(600.0)],
            ),
            // Row 3: East / CT / Hartford
            make_data_row(
                "east\x00ct\x00hart",
                vec![
                    make_header("east", CellValue::Text("East".into()), "region", 0),
                    make_header("east\x00ct", CellValue::Text("CT".into()), "state", 1),
                    make_header(
                        "east\x00ct\x00hart",
                        CellValue::Text("Hartford".into()),
                        "city",
                        2,
                    ),
                ],
                vec![CellValue::number(80.0)],
            ),
            // Row 4: East / CT subtotal
            make_subtotal_row(
                "east\x00ct__SUBTOTAL__",
                vec![
                    make_header("east", CellValue::Text("East".into()), "region", 0),
                    make_header("east\x00ct", CellValue::Text("CT Total".into()), "state", 1),
                ],
                1,
                vec![CellValue::number(80.0)],
            ),
            // Row 5: East subtotal
            make_subtotal_row(
                "east__SUBTOTAL__",
                vec![make_header(
                    "east",
                    CellValue::Text("East Total".into()),
                    "region",
                    0,
                )],
                0,
                vec![CellValue::number(680.0)],
            ),
            // Row 6: West / CA / LA
            make_data_row(
                "west\x00ca\x00la",
                vec![
                    make_header("west", CellValue::Text("West".into()), "region", 0),
                    make_header("west\x00ca", CellValue::Text("CA".into()), "state", 1),
                    make_header("west\x00ca\x00la", CellValue::Text("LA".into()), "city", 2),
                ],
                vec![CellValue::number(400.0)],
            ),
            // Row 7: West / CA subtotal
            make_subtotal_row(
                "west\x00ca__SUBTOTAL__",
                vec![
                    make_header("west", CellValue::Text("West".into()), "region", 0),
                    make_header("west\x00ca", CellValue::Text("CA Total".into()), "state", 1),
                ],
                1,
                vec![CellValue::number(400.0)],
            ),
            // Row 8: West subtotal
            make_subtotal_row(
                "west__SUBTOTAL__",
                vec![make_header(
                    "west",
                    CellValue::Text("West Total".into()),
                    "region",
                    0,
                )],
                0,
                vec![CellValue::number(400.0)],
            ),
            // Row 9: Grand total
            make_grand_total_row(vec![CellValue::number(1080.0)]),
        ];

        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // Verify depth and field names
        assert_eq!(hierarchy.depth(), 3);
        assert!(!hierarchy.is_flat());
        assert_eq!(hierarchy.depth_for_field("Region"), Some(0));
        assert_eq!(hierarchy.depth_for_field("State"), Some(1));
        assert_eq!(hierarchy.depth_for_field("City"), Some(2));

        // Verify children at depth 0 (root): all data rows [0, 1, 3, 6]
        let root_children = hierarchy
            .children_by_parent
            .get(&(0, String::new()))
            .unwrap();
        assert_eq!(root_children, &[0, 1, 3, 6]);

        // Verify children at depth 1 under "east": [0, 1, 3]
        let east_children = hierarchy
            .children_by_parent
            .get(&(1, "east".to_string()))
            .unwrap();
        assert_eq!(east_children, &[0, 1, 3]);

        // Verify children at depth 1 under "west": [6]
        let west_children = hierarchy
            .children_by_parent
            .get(&(1, "west".to_string()))
            .unwrap();
        assert_eq!(west_children, &[6]);

        // Verify children at depth 2 under "east\x00ny": [0, 1]
        let east_ny_children = hierarchy
            .children_by_parent
            .get(&(2, "east\x00ny".to_string()))
            .unwrap();
        assert_eq!(east_ny_children, &[0, 1]);

        // Verify children at depth 2 under "east\x00ct": [3]
        let east_ct_children = hierarchy
            .children_by_parent
            .get(&(2, "east\x00ct".to_string()))
            .unwrap();
        assert_eq!(east_ct_children, &[3]);

        // Verify children at depth 2 under "west\x00ca": [6]
        let west_ca_children = hierarchy
            .children_by_parent
            .get(&(2, "west\x00ca".to_string()))
            .unwrap();
        assert_eq!(west_ca_children, &[6]);

        // Verify subtotals
        // East/NY subtotal at depth 1 -> row 2
        assert_eq!(
            hierarchy.subtotal_index.get(&(1, "east\x00ny".to_string())),
            Some(&2)
        );
        // East/CT subtotal at depth 1 -> row 4
        assert_eq!(
            hierarchy.subtotal_index.get(&(1, "east\x00ct".to_string())),
            Some(&4)
        );
        // East subtotal at depth 0 -> row 5
        assert_eq!(
            hierarchy.subtotal_index.get(&(0, "east".to_string())),
            Some(&5)
        );
        // West/CA subtotal at depth 1 -> row 7
        assert_eq!(
            hierarchy.subtotal_index.get(&(1, "west\x00ca".to_string())),
            Some(&7)
        );
        // West subtotal at depth 0 -> row 8
        assert_eq!(
            hierarchy.subtotal_index.get(&(0, "west".to_string())),
            Some(&8)
        );

        // Verify siblings at different depths
        // NYC (row 0) and Buffalo (row 1) are siblings at depth 2 under east/ny
        assert_eq!(hierarchy.siblings_at_depth(0, 2), Some([0, 1].as_slice()));
        assert_eq!(hierarchy.siblings_at_depth(1, 2), Some([0, 1].as_slice()));

        // Hartford (row 3) is alone at depth 2 under east/ct
        assert_eq!(hierarchy.siblings_at_depth(3, 2), Some([3].as_slice()));

        // LA (row 6) is alone at depth 2 under west/ca
        assert_eq!(hierarchy.siblings_at_depth(6, 2), Some([6].as_slice()));

        // At depth 1 under east: [0, 1, 3]
        assert_eq!(
            hierarchy.siblings_at_depth(0, 1),
            Some([0, 1, 3].as_slice())
        );
        assert_eq!(
            hierarchy.siblings_at_depth(3, 1),
            Some([0, 1, 3].as_slice())
        );

        // At depth 1 under west: [6]
        assert_eq!(hierarchy.siblings_at_depth(6, 1), Some([6].as_slice()));

        // Previous/next at depth 2
        assert_eq!(hierarchy.previous_sibling(1, 2), Some(0)); // Buffalo -> NYC
        assert_eq!(hierarchy.next_sibling(0, 2), Some(1)); // NYC -> Buffalo
        assert_eq!(hierarchy.previous_sibling(0, 2), None); // NYC is first
        assert_eq!(hierarchy.next_sibling(1, 2), None); // Buffalo is last

        // Previous/next at depth 1 under east
        assert_eq!(hierarchy.next_sibling(0, 1), Some(1)); // NYC -> Buffalo
        assert_eq!(hierarchy.next_sibling(1, 1), Some(3)); // Buffalo -> Hartford
        assert_eq!(hierarchy.next_sibling(3, 1), None); // Hartford is last under east

        // find_sibling_by_value at depth 2
        let found = hierarchy.find_sibling_by_value(1, 2, &rows, &CellValue::Text("NYC".into()));
        assert_eq!(found, Some(0));

        // find_sibling_by_value should NOT find across parent groups
        // LA (row 6) looking for "NYC" at depth 2 -> None (different parent)
        let found = hierarchy.find_sibling_by_value(6, 2, &rows, &CellValue::Text("NYC".into()));
        assert_eq!(found, None);

        // subtotal_at_depth
        // NYC (row 0) -> East subtotal at depth 0 (row 5)
        assert_eq!(hierarchy.subtotal_at_depth(0, 0), Some(5));
        // NYC (row 0) -> East/NY subtotal at depth 1 (row 2)
        assert_eq!(hierarchy.subtotal_at_depth(0, 1), Some(2));
        // Hartford (row 3) -> East/CT subtotal at depth 1 (row 4)
        assert_eq!(hierarchy.subtotal_at_depth(3, 1), Some(4));
        // LA (row 6) -> West/CA subtotal at depth 1 (row 7)
        assert_eq!(hierarchy.subtotal_at_depth(6, 1), Some(7));
        // LA (row 6) -> West subtotal at depth 0 (row 8)
        assert_eq!(hierarchy.subtotal_at_depth(6, 0), Some(8));
    }

    // ---- Empty rows ----

    #[test]
    fn test_empty_rows_empty_hierarchy() {
        let rows: Vec<PivotRow> = vec![];
        let field_names: Vec<String> = vec![];
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        assert!(hierarchy.row_group_paths.is_empty());
        assert!(hierarchy.subtotal_index.is_empty());
        assert!(hierarchy.children_by_parent.is_empty());
        assert!(hierarchy.field_names.is_empty());
        assert_eq!(hierarchy.depth(), 0);
        assert!(hierarchy.is_flat());
    }

    // ---- Single row ----

    #[test]
    fn test_single_data_row() {
        let field_names = vec!["Region".to_string()];
        let rows = vec![
            make_data_row(
                "east",
                vec![make_header(
                    "east",
                    CellValue::Text("East".into()),
                    "region",
                    0,
                )],
                vec![CellValue::number(100.0)],
            ),
            make_grand_total_row(vec![CellValue::number(100.0)]),
        ];

        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // Single data row at depth 0
        assert_eq!(
            hierarchy
                .children_by_parent
                .get(&(0, String::new()))
                .unwrap(),
            &[0]
        );

        // Position in group
        assert_eq!(hierarchy.position_in_group(0, 0), Some((0, 1)));

        // First and last
        assert!(hierarchy.is_first_in_group(0, 0));
        assert!(hierarchy.is_last_in_group(0, 0));

        // No siblings
        assert_eq!(hierarchy.previous_sibling(0, 0), None);
        assert_eq!(hierarchy.next_sibling(0, 0), None);
    }

    // ---- Flat hierarchy (single-level) ----

    #[test]
    fn test_flat_hierarchy_is_flat() {
        let field_names = vec!["Region".to_string()];
        let rows = vec![
            make_data_row(
                "east",
                vec![make_header(
                    "east",
                    CellValue::Text("East".into()),
                    "region",
                    0,
                )],
                vec![CellValue::number(100.0)],
            ),
            make_data_row(
                "west",
                vec![make_header(
                    "west",
                    CellValue::Text("West".into()),
                    "region",
                    0,
                )],
                vec![CellValue::number(200.0)],
            ),
            make_data_row(
                "north",
                vec![make_header(
                    "north",
                    CellValue::Text("North".into()),
                    "region",
                    0,
                )],
                vec![CellValue::number(300.0)],
            ),
            make_grand_total_row(vec![CellValue::number(600.0)]),
        ];

        let hierarchy = build_group_hierarchy(&rows, &field_names);

        assert!(hierarchy.is_flat());
        assert_eq!(hierarchy.depth(), 1);

        // All data rows are siblings at depth 0
        assert_eq!(
            hierarchy.siblings_at_depth(0, 0),
            Some([0, 1, 2].as_slice())
        );

        // Navigation at depth 0
        assert_eq!(hierarchy.next_sibling(0, 0), Some(1));
        assert_eq!(hierarchy.next_sibling(1, 0), Some(2));
        assert_eq!(hierarchy.next_sibling(2, 0), None);
        assert_eq!(hierarchy.previous_sibling(0, 0), None);
        assert_eq!(hierarchy.previous_sibling(1, 0), Some(0));
        assert_eq!(hierarchy.previous_sibling(2, 0), Some(1));
    }

    // ---- No field names (zero-level) ----

    #[test]
    fn test_zero_field_names() {
        let field_names: Vec<String> = vec![];
        let rows = vec![
            make_data_row("row0", vec![], vec![CellValue::number(100.0)]),
            make_grand_total_row(vec![CellValue::number(100.0)]),
        ];

        let hierarchy = build_group_hierarchy(&rows, &field_names);

        assert!(hierarchy.is_flat());
        assert_eq!(hierarchy.depth(), 0);
        // No children indexed because num_depths is 0
        assert!(hierarchy.children_by_parent.is_empty());
    }

    // ---- Grand total row gets empty path ----

    #[test]
    fn test_grand_total_row_has_empty_path() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // Row 5 is grand total
        assert!(hierarchy.row_group_paths[5].is_empty());

        // Helpers should handle grand total gracefully
        assert_eq!(hierarchy.parent_path_key_at_depth(5, 0), "");
        assert_eq!(hierarchy.parent_path_key_at_depth(5, 1), "");
    }

    // ---- Subtotal row gets a path but is not added to children_by_parent ----

    #[test]
    fn test_subtotal_rows_not_in_children() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // Row 2 is East subtotal, row 4 is West subtotal.
        // They should NOT appear in children_by_parent.
        let root_children = hierarchy
            .children_by_parent
            .get(&(0, String::new()))
            .unwrap();
        assert!(!root_children.contains(&2));
        assert!(!root_children.contains(&4));

        let east_children = hierarchy
            .children_by_parent
            .get(&(1, "east".to_string()))
            .unwrap();
        assert!(!east_children.contains(&2));
    }

    // ---- parent_path_key_at_depth edge cases ----

    #[test]
    fn test_parent_path_key_at_depth_out_of_range() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // Depth 5 is way out of range for a 2-level hierarchy
        assert_eq!(hierarchy.parent_path_key_at_depth(0, 5), "");
    }

    #[test]
    fn test_parent_path_key_at_depth_for_invalid_row() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // Row index 999 doesn't exist
        assert_eq!(hierarchy.parent_path_key_at_depth(999, 0), "");
        assert_eq!(hierarchy.parent_path_key_at_depth(999, 1), "");
    }

    // ---- position_in_group for grand total / subtotal ----

    #[test]
    fn test_position_in_group_for_subtotal_returns_none() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // Row 2 is East subtotal — it should NOT appear in any children list
        assert_eq!(hierarchy.position_in_group(2, 0), None);
        assert_eq!(hierarchy.position_in_group(2, 1), None);
    }

    #[test]
    fn test_position_in_group_for_grand_total_returns_none() {
        let (rows, field_names) = build_two_level_rows();
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // Row 5 is grand total — it should NOT appear in any children list
        assert_eq!(hierarchy.position_in_group(5, 0), None);
    }

    // ---- find_sibling_by_value: cell_value_eq consistency tests ----

    /// Helper to build a simple 1-level hierarchy with given header values at depth 0.
    fn build_single_level_rows(values: Vec<CellValue>) -> (Vec<PivotRow>, Vec<String>) {
        let field_names = vec!["Category".to_string()];
        let mut rows: Vec<PivotRow> = values
            .into_iter()
            .enumerate()
            .map(|(i, val)| {
                let key = format!("row{i}");
                make_data_row(
                    &key,
                    vec![make_header(&key, val, "category", 0)],
                    vec![CellValue::number(i as f64)],
                )
            })
            .collect();
        rows.push(make_grand_total_row(vec![CellValue::number(0.0)]));
        (rows, field_names)
    }

    #[test]
    fn test_find_sibling_by_value_unicode_case_insensitive() {
        // "MÜNCHEN" vs "münchen" — Unicode to_lowercase should match.
        // ASCII-only eq_ignore_ascii_case would NOT match the ü/Ü pair.
        let (rows, field_names) = build_single_level_rows(vec![
            CellValue::Text("MÜNCHEN".into()),
            CellValue::Text("Berlin".into()),
        ]);
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // Search from row 1 (Berlin) for "münchen" at depth 0.
        let found =
            hierarchy.find_sibling_by_value(1, 0, &rows, &CellValue::Text("münchen".into()));
        assert_eq!(
            found,
            Some(0),
            "Unicode case-insensitive match should find MÜNCHEN"
        );
    }

    #[test]
    fn test_find_sibling_by_value_blank_unification() {
        // CellValue::Null should equal CellValue::Text("") under cell_value_eq
        // (blank unification), but NOT under PartialEq.
        let (rows, field_names) =
            build_single_level_rows(vec![CellValue::Null, CellValue::Text("Something".into())]);
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // Search from row 1 for Text("") at depth 0 — should find the Null row.
        let found = hierarchy.find_sibling_by_value(1, 0, &rows, &CellValue::Text("".into()));
        assert_eq!(
            found,
            Some(0),
            "Blank unification: Null should match empty Text"
        );
    }

    #[test]
    fn test_find_sibling_by_value_epsilon_float() {
        // 1.0000000000001 vs 1.0 — within 1e-12 relative epsilon.
        // Exact bitwise comparison would NOT match.
        let (rows, field_names) = build_single_level_rows(vec![
            CellValue::number(1.0000000000001),
            CellValue::number(999.0),
        ]);
        let hierarchy = build_group_hierarchy(&rows, &field_names);

        // Search from row 1 for Number(1.0) at depth 0.
        let found = hierarchy.find_sibling_by_value(1, 0, &rows, &CellValue::number(1.0));
        assert_eq!(
            found,
            Some(0),
            "Epsilon float: 1.0000000000001 should match 1.0"
        );
    }
}
