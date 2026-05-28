use std::collections::HashMap;

/// Lightweight representation of the group tree for Show Values As.
///
/// Does NOT own the data - indexes into the engine's flat pivot row list.
///
/// This structure pre-indexes the hierarchical relationships between rows,
/// enabling O(1) parent lookup, group-scoped iteration, and group boundary
/// detection - all of which are impossible with a flat row list alone.
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
