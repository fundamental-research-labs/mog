use value_types::CellValue;

use crate::types::PivotRow;
use crate::values::cell_value_eq;

use super::model::GroupHierarchy;

impl GroupHierarchy {
    /// Find the depth index for a given field name (for `base_field` resolution).
    ///
    /// Returns `None` if the field is not in the row hierarchy.
    ///
    /// # Example
    /// ```
    /// use compute_pivot::hierarchy::build_group_hierarchy;
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
    /// list without group-scoping - the current behavior is correct.
    #[must_use]
    pub fn is_flat(&self) -> bool {
        self.field_names.len() <= 1
    }
}
