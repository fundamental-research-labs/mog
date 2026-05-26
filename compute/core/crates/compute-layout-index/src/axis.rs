//! Per-axis spatial index using a sparse Fenwick tree over dimension deltas.
//!
//! Decomposes cumulative position as:
//!   `get_position(i) = i * default_size + fenwick.prefix_sum(i - 1)`
//! where the Fenwick tree stores `delta[i] = actual_size[i] - default_size`
//! (only non-zero for rows/cols with custom dimensions or hidden state).
//!
//! With k custom entries out of n total:
//! - `get_position(i)`:      O(log n)
//! - `get_index_at(px)`:     O(log n) via Fenwick descent
//! - `set_dimension(i, v)`:  O(log n)
//! - `build_position_array`: O(v * log n) for v entries
//! - Memory:                 O(n) for the Fenwick tree (but sparse BTreeMap for k entries)

use std::collections::{BTreeMap, BTreeSet};

use domain_types::units::Pixels;

use crate::fenwick::FenwickTree;

/// Spatial index for one axis (rows or columns).
#[derive(Debug, Clone)]
pub struct AxisIndex {
    /// Default dimension size (e.g., 20.0 for row height, 64.0 for col width).
    default_size: Pixels,
    /// Total number of entries on this axis.
    count: usize,
    /// Sparse map of custom dimensions: index → actual size.
    /// Only entries that differ from `default_size` are stored.
    custom: BTreeMap<usize, f64>,
    /// Set of hidden indices (these have effective size 0).
    hidden: BTreeSet<usize>,
    /// Fenwick tree storing deltas: `delta[i] = effective_size[i] - default_size`.
    /// `effective_size[i]` = 0 if hidden, `custom[i]` if custom, else `default_size`.
    fenwick: FenwickTree,
}

impl AxisIndex {
    /// Create an empty axis index with all entries at default size.
    pub fn new(count: usize, default_size: Pixels) -> Self {
        Self {
            default_size,
            count,
            custom: BTreeMap::new(),
            hidden: BTreeSet::new(),
            fenwick: FenwickTree::new(count),
        }
    }

    /// Build from sparse custom dimensions and hidden set.
    pub fn from_sparse(
        count: usize,
        default_size: Pixels,
        custom_dims: impl IntoIterator<Item = (usize, Pixels)>,
        hidden_indices: impl IntoIterator<Item = usize>,
    ) -> Self {
        let mut axis = Self::new(count, default_size);

        // Apply custom dimensions first
        for (idx, size) in custom_dims {
            if idx < count {
                axis.custom.insert(idx, size.0);
                let delta = size.0 - default_size.0;
                if delta != 0.0 {
                    axis.fenwick.update(idx, delta);
                }
            }
        }

        // Apply hidden state (overrides custom dimensions for effective size)
        for idx in hidden_indices {
            if idx < count {
                // If already custom, the delta was (custom - default).
                // We need the delta to be (0 - default) = -default.
                // So adjust by -(custom_or_default).
                let current_effective = if let Some(&custom) = axis.custom.get(&idx) {
                    custom
                } else {
                    default_size.0
                };
                // Current delta = current_effective - default.
                // We want delta = 0 - default = -default.
                // Adjustment = -default - (current_effective - default) = -current_effective.
                axis.fenwick.update(idx, -current_effective);
                axis.hidden.insert(idx);
            }
        }

        axis
    }

    /// Total number of entries on this axis.
    pub fn count(&self) -> usize {
        self.count
    }

    /// Default dimension size.
    pub fn default_size(&self) -> Pixels {
        self.default_size
    }

    /// Get the effective dimension of entry `i`.
    /// Returns 0 for hidden entries, custom size if set, default otherwise.
    pub fn get_dimension(&self, i: usize) -> Pixels {
        if i >= self.count {
            return self.default_size;
        }
        if self.hidden.contains(&i) {
            return Pixels(0.0);
        }
        Pixels(self.custom.get(&i).copied().unwrap_or(self.default_size.0))
    }

    /// Set the dimension of entry `i` to `size`.
    /// Pass `default_size` to reset to default (removes the custom entry).
    pub fn set_dimension(&mut self, i: usize, size: Pixels) {
        if i >= self.count {
            return;
        }
        let old_effective = self.effective_size(i);
        let is_hidden = self.hidden.contains(&i);

        // Update custom map
        if (size.0 - self.default_size.0).abs() < f64::EPSILON {
            self.custom.remove(&i);
        } else {
            self.custom.insert(i, size.0);
        }

        // New effective size: 0 if hidden, else the new size
        let new_effective = if is_hidden { 0.0 } else { size.0 };
        let delta_change = new_effective - old_effective;
        if delta_change.abs() > f64::EPSILON {
            self.fenwick.update(i, delta_change);
        }
    }

    /// Hide entry `i` (effective size becomes 0).
    pub fn hide(&mut self, i: usize) {
        if i >= self.count || self.hidden.contains(&i) {
            return;
        }
        let old_effective = self.effective_size(i);
        self.hidden.insert(i);
        // New effective = 0, so delta change = -old_effective
        // But we track delta = effective - default, so:
        // old_delta = old_effective - default
        // new_delta = 0 - default = -default
        // change = new_delta - old_delta = -old_effective
        if old_effective.abs() > f64::EPSILON {
            self.fenwick.update(i, -old_effective);
        }
    }

    /// Unhide entry `i` (effective size reverts to custom or default).
    pub fn unhide(&mut self, i: usize) {
        if i >= self.count || !self.hidden.contains(&i) {
            return;
        }
        self.hidden.remove(&i);
        let new_effective = self.custom.get(&i).copied().unwrap_or(self.default_size.0);
        // old effective was 0 (hidden), change = new_effective
        // delta was -default, now delta = new_effective - default
        // change = new_effective
        if new_effective.abs() > f64::EPSILON {
            self.fenwick.update(i, new_effective);
        }
    }

    /// Whether entry `i` is hidden.
    pub fn is_hidden(&self, i: usize) -> bool {
        self.hidden.contains(&i)
    }

    /// Pixel position of the top/left edge of entry `i`.
    ///
    /// `position(i) = i * default_size + sum(delta[0..i])`
    /// where delta[j] = effective_size[j] - default_size.
    ///
    /// For i=0, position is 0. For i>0, we sum deltas for 0..i-1.
    pub fn get_position(&self, i: usize) -> Pixels {
        if i == 0 {
            return Pixels(0.0);
        }
        if self.count == 0 {
            return self.default_size * i as f64;
        }
        if i > self.count {
            // Extrapolate: position at count + defaults beyond
            let pos_at_count = self.get_position_internal(self.count);
            return Pixels(pos_at_count + (i - self.count) as f64 * self.default_size.0);
        }
        Pixels(self.get_position_internal(i))
    }

    /// Internal position calculation for i in 1..=count.
    fn get_position_internal(&self, i: usize) -> f64 {
        debug_assert!(i >= 1 && i <= self.count);
        // position(i) = i * default + prefix_sum(0..i-1)
        i as f64 * self.default_size.0 + self.fenwick.prefix_sum(i - 1)
    }

    /// Find the index at a given pixel position (inverse of `get_position`).
    ///
    /// Returns the index `i` such that `get_position(i) <= px < get_position(i+1)`,
    /// i.e., the entry that contains pixel position `px`.
    ///
    /// Uses Fenwick descent on the adjusted position:
    ///   `total_position(i) = i * default + delta_prefix(i)`
    /// We search for i such that this ≤ px.
    pub fn get_index_at(&self, px: Pixels) -> usize {
        if self.count == 0 || px.0 < 0.0 {
            return 0;
        }

        // Binary search approach: we need to find the largest i where
        //   i * default_size + fenwick.prefix_sum(i - 1) <= px
        //
        // This is equivalent to finding i where the cumulative position ≤ px.
        // We use a manual Fenwick descent that accounts for the linear term.
        let mut pos: usize = 0; // 1-based position in Fenwick tree
        let mut remaining = px.0;
        let n = self.count;

        // Find highest power of 2 ≤ n
        if n == 0 {
            return 0;
        }
        let mut bit = 1usize << (usize::BITS - 1 - n.leading_zeros());

        while bit > 0 {
            let next = pos + bit;
            if next <= n {
                // The interval [pos+1..next] has `bit` entries, contributing:
                //   bit * default_size (linear part) + fenwick.tree[next] (delta part)
                let interval_cost = bit as f64 * self.default_size.0 + self.fenwick_tree_val(next);
                if interval_cost <= remaining {
                    pos = next;
                    remaining -= interval_cost;
                }
            }
            bit >>= 1;
        }

        // pos is now 1-based: it represents the number of complete entries
        // that fit before `px`. The entry *containing* px is at index `pos`.
        // But we need to handle the case where pos == 0 (px is in the first entry).
        pos.min(self.count - 1)
    }

    /// Build a position array for the given range [start..end).
    ///
    /// Returns positions (top/left edges) for each index in `start..end`,
    /// PLUS a trailing sentinel entry at index `end` (top edge of the entry
    /// after the range — equal to `top_of(end-1) + height_of(end-1)`).
    /// The sentinel lets callers derive `height_of(end-1)` as
    /// `result[end-start] - result[end-start-1]` without a separate query.
    ///
    /// Length: `end - start + 1` for non-empty ranges, 0 for empty.
    ///
    /// # Note on `count == 0`
    /// When `self.count == 0` (no custom dimensions stored, e.g. a freshly
    /// created sheet whose column axis has never been mutated), the previous
    /// implementation clamped `end` to `self.count = 0` and returned an empty
    /// Vec even when the caller requested a non-empty range. This caused the
    /// TypeScript side to receive zero col-position bytes and store
    /// `_colPositions = null`, so the canvas fell back to the default 64 px
    /// column width and could not reflect per-column geometry.
    ///
    /// The fix: remove the `end.min(self.count)` clamp. `get_position(i)`
    /// already handles `count == 0` by returning `default_size * i`, and
    /// handles `i > count` by extrapolating from the last explicit entry.
    pub fn build_position_array(&self, start: usize, end: usize) -> Vec<f64> {
        if start >= end {
            return Vec::new();
        }
        let mut result = Vec::with_capacity(end - start + 1);
        for i in start..=end {
            result.push(self.get_position(i).0);
        }
        result
    }

    /// Build a dimension array for the given range [start..end).
    ///
    /// Returns effective sizes for each index in the range.
    pub fn build_dimension_array(&self, start: usize, end: usize) -> Vec<f64> {
        let end = end.min(self.count);
        if start >= end {
            return Vec::new();
        }
        let mut result = Vec::with_capacity(end - start);
        for i in start..end {
            result.push(self.get_dimension(i).0);
        }
        result
    }

    /// Get the visible range of indices whose positions intersect [start_px, end_px].
    /// Returns (start, end) where end is exclusive.
    pub fn get_visible_range(&self, start_px: Pixels, end_px: Pixels) -> (usize, usize) {
        if self.count == 0 || end_px.0 <= 0.0 {
            return (0, 0);
        }
        let first = self.get_index_at(start_px);
        let last = self.get_index_at(end_px);
        // exclusive end: include the entry containing end_px
        (first, (last + 1).min(self.count))
    }

    /// Total pixel size of this axis (sum of all effective dimensions).
    pub fn total_size(&self) -> Pixels {
        self.get_position(self.count)
    }

    // -- Private helpers --

    /// The effective size of entry i (accounting for hidden state).
    fn effective_size(&self, i: usize) -> f64 {
        if self.hidden.contains(&i) {
            0.0
        } else {
            self.custom.get(&i).copied().unwrap_or(self.default_size.0)
        }
    }

    /// Direct access to the Fenwick tree's internal array (1-based).
    /// Used by `get_index_at` for the descent algorithm.
    fn fenwick_tree_val(&self, pos_1based: usize) -> f64 {
        // Access the tree value at the given 1-based position.
        // This is the sum of deltas in the interval ending at this position.
        // We need access to the raw tree array for the descent.
        self.fenwick.raw_tree_val(pos_1based)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_only() {
        let axis = AxisIndex::new(100, Pixels(20.0));
        assert_eq!(axis.get_dimension(0), Pixels(20.0));
        assert_eq!(axis.get_dimension(99), Pixels(20.0));
        assert_eq!(axis.get_position(0), Pixels(0.0));
        assert_eq!(axis.get_position(1), Pixels(20.0));
        assert_eq!(axis.get_position(50), Pixels(1000.0));
        assert_eq!(axis.get_position(100), Pixels(2000.0));
        assert_eq!(axis.total_size(), Pixels(2000.0));
    }

    #[test]
    fn custom_dimensions() {
        // 10 rows, default 20px, row 3 is 50px
        let axis = AxisIndex::from_sparse(10, Pixels(20.0), vec![(3, Pixels(50.0))], vec![]);
        assert_eq!(axis.get_dimension(3), Pixels(50.0));
        assert_eq!(axis.get_dimension(0), Pixels(20.0));
        // Position of row 3: 3 * 20 = 60
        assert_eq!(axis.get_position(3), Pixels(60.0));
        // Position of row 4: 3 * 20 + 50 = 110
        assert_eq!(axis.get_position(4), Pixels(110.0));
        // Position of row 5: 4 * 20 + 50 = 130
        assert_eq!(axis.get_position(5), Pixels(130.0));
    }

    #[test]
    fn hidden_entries() {
        // 5 rows, default 20px, row 2 hidden
        let axis = AxisIndex::from_sparse(5, Pixels(20.0), vec![], vec![2]);
        assert_eq!(axis.get_dimension(2), Pixels(0.0));
        assert!(axis.is_hidden(2));
        // Positions: [0, 20, 40, 40, 60]
        assert_eq!(axis.get_position(0), Pixels(0.0));
        assert_eq!(axis.get_position(1), Pixels(20.0));
        assert_eq!(axis.get_position(2), Pixels(40.0));
        assert_eq!(axis.get_position(3), Pixels(40.0)); // hidden row 2 has 0 height
        assert_eq!(axis.get_position(4), Pixels(60.0));
        assert_eq!(axis.total_size(), Pixels(80.0)); // 4 * 20 = 80
    }

    #[test]
    fn hidden_custom_entry() {
        // Row 1 is custom 50px but hidden → effective 0
        let axis = AxisIndex::from_sparse(5, Pixels(20.0), vec![(1, Pixels(50.0))], vec![1]);
        assert_eq!(axis.get_dimension(1), Pixels(0.0));
        assert!(axis.is_hidden(1));
        // Position of row 2: 20 + 0 = 20 (not 20 + 50)
        assert_eq!(axis.get_position(2), Pixels(20.0));
    }

    #[test]
    fn set_dimension() {
        let mut axis = AxisIndex::new(5, Pixels(20.0));
        axis.set_dimension(2, Pixels(40.0));
        assert_eq!(axis.get_dimension(2), Pixels(40.0));
        assert_eq!(axis.get_position(3), Pixels(80.0)); // 2*20 + 40 = 80
        // Reset to default
        axis.set_dimension(2, Pixels(20.0));
        assert_eq!(axis.get_dimension(2), Pixels(20.0));
        assert_eq!(axis.get_position(3), Pixels(60.0)); // 3*20 = 60
    }

    #[test]
    fn hide_unhide() {
        let mut axis = AxisIndex::new(5, Pixels(20.0));
        axis.hide(2);
        assert!(axis.is_hidden(2));
        assert_eq!(axis.get_dimension(2), Pixels(0.0));
        assert_eq!(axis.get_position(3), Pixels(40.0)); // 2*20 + 0 = 40

        axis.unhide(2);
        assert!(!axis.is_hidden(2));
        assert_eq!(axis.get_dimension(2), Pixels(20.0));
        assert_eq!(axis.get_position(3), Pixels(60.0)); // 3*20 = 60
    }

    #[test]
    fn get_index_at_default() {
        let axis = AxisIndex::new(100, Pixels(20.0));
        assert_eq!(axis.get_index_at(Pixels(0.0)), 0);
        assert_eq!(axis.get_index_at(Pixels(10.0)), 0);
        assert_eq!(axis.get_index_at(Pixels(19.9)), 0);
        assert_eq!(axis.get_index_at(Pixels(20.0)), 1);
        assert_eq!(axis.get_index_at(Pixels(39.9)), 1);
        assert_eq!(axis.get_index_at(Pixels(40.0)), 2);
        assert_eq!(axis.get_index_at(Pixels(1999.0)), 99);
        assert_eq!(axis.get_index_at(Pixels(5000.0)), 99); // clamped
    }

    #[test]
    fn get_index_at_custom() {
        // 10 rows, default 20px, row 3 is 50px
        let axis = AxisIndex::from_sparse(10, Pixels(20.0), vec![(3, Pixels(50.0))], vec![]);
        // positions: [0, 20, 40, 60, 110, 130, 150, 170, 190, 210]
        assert_eq!(axis.get_index_at(Pixels(0.0)), 0);
        assert_eq!(axis.get_index_at(Pixels(59.9)), 2);
        assert_eq!(axis.get_index_at(Pixels(60.0)), 3);
        assert_eq!(axis.get_index_at(Pixels(109.9)), 3);
        assert_eq!(axis.get_index_at(Pixels(110.0)), 4);
    }

    #[test]
    fn get_index_at_hidden() {
        // 5 rows, default 20px, row 2 hidden
        let axis = AxisIndex::from_sparse(5, Pixels(20.0), vec![], vec![2]);
        // positions: [0, 20, 40, 40, 60]
        assert_eq!(axis.get_index_at(Pixels(39.9)), 1);
        // At px=40, rows 2 and 3 both start there. get_index_at should return
        // the row that contains the pixel — row 3 (since row 2 has 0 height).
        assert_eq!(axis.get_index_at(Pixels(40.0)), 3);
    }

    #[test]
    fn build_position_array_basic() {
        let axis = AxisIndex::from_sparse(10, Pixels(20.0), vec![(3, Pixels(50.0))], vec![]);
        let positions = axis.build_position_array(2, 6);
        // Length is end-start+1 (4 in-range + 1 sentinel = 5).
        // Trailing sentinel is the position of index 6 (top of the row after the range).
        assert_eq!(positions, vec![40.0, 60.0, 110.0, 130.0, 150.0]);
    }

    #[test]
    fn build_position_array_sentinel_lets_caller_derive_last_height() {
        // Row 5 has a non-default height of 50. The sentinel at index 6 is what lets
        // a caller compute height_of(5) as positions[end-start] - positions[end-start-1].
        let axis = AxisIndex::from_sparse(10, Pixels(20.0), vec![(5, Pixels(50.0))], vec![]);
        let positions = axis.build_position_array(2, 6);
        // [top_of(2)=40, top_of(3)=60, top_of(4)=80, top_of(5)=100, sentinel=top_of(6)=150]
        assert_eq!(positions.len(), 5);
        assert_eq!(positions[4] - positions[3], 50.0);
    }

    #[test]
    fn build_dimension_array_basic() {
        let axis = AxisIndex::from_sparse(10, Pixels(20.0), vec![(3, Pixels(50.0))], vec![2]);
        let dims = axis.build_dimension_array(1, 5);
        assert_eq!(dims, vec![20.0, 0.0, 50.0, 20.0]);
    }

    #[test]
    fn visible_range() {
        let axis = AxisIndex::new(100, Pixels(20.0));
        let (start, end) = axis.get_visible_range(Pixels(50.0), Pixels(150.0));
        assert_eq!(start, 2); // row 2 starts at 40
        assert_eq!(end, 8); // row 7 ends at 160
    }

    #[test]
    fn out_of_range_position() {
        let axis = AxisIndex::new(10, Pixels(20.0));
        // Beyond count, extrapolate with defaults
        assert_eq!(axis.get_position(10), Pixels(200.0));
        assert_eq!(axis.get_position(11), Pixels(220.0));
    }

    #[test]
    fn all_hidden() {
        let hidden: Vec<usize> = (0..5).collect();
        let axis = AxisIndex::from_sparse(5, Pixels(20.0), vec![], hidden);
        assert_eq!(axis.total_size(), Pixels(0.0));
        for i in 0..5 {
            assert_eq!(axis.get_position(i), Pixels(0.0));
            assert_eq!(axis.get_dimension(i), Pixels(0.0));
        }
    }

    #[test]
    fn single_custom_in_large_sheet() {
        // 1M rows, only row 500,000 has custom height 100px
        let axis = AxisIndex::from_sparse(
            1_000_000,
            Pixels(20.0),
            vec![(500_000, Pixels(100.0))],
            vec![],
        );
        assert_eq!(axis.get_dimension(500_000), Pixels(100.0));
        assert_eq!(axis.get_position(500_000), Pixels(500_000.0 * 20.0));
        assert_eq!(axis.get_position(500_001), Pixels(500_000.0 * 20.0 + 100.0));
        // Position after the custom row should account for the extra 80px
        assert_eq!(
            axis.get_position(1_000_000),
            Pixels(1_000_000.0 * 20.0 + 80.0) // 80 = 100 - 20
        );
    }

    // =========================================================================
    // First-principles tests
    // =========================================================================

    /// Helper: assert the fundamental position-dimension invariant across all indices.
    /// get_position(i+1) == get_position(i) + get_dimension(i)
    fn assert_position_dimension_invariant(axis: &AxisIndex, label: &str) {
        for i in 0..axis.count() {
            let pos_i = axis.get_position(i);
            let dim_i = axis.get_dimension(i);
            let pos_next = axis.get_position(i + 1);
            assert!(
                (pos_next.0 - (pos_i.0 + dim_i.0)).abs() < 1e-9,
                "{label}: pos({}) + dim({}) = {} + {} = {}, but pos({}) = {}",
                i,
                i,
                pos_i.0,
                dim_i.0,
                pos_i.0 + dim_i.0,
                i + 1,
                pos_next.0,
            );
        }
    }

    /// Helper: assert total_size == sum of all dimensions.
    fn assert_total_size_is_sum(axis: &AxisIndex, label: &str) {
        let sum: f64 = (0..axis.count()).map(|i| axis.get_dimension(i).0).sum();
        assert!(
            (axis.total_size().0 - sum).abs() < 1e-9,
            "{label}: total_size={} but sum of dims={}",
            axis.total_size().0,
            sum,
        );
    }

    // --- 1. Position-dimension relationship ---

    #[test]
    fn fp_pos_dim_all_defaults() {
        let axis = AxisIndex::new(50, Pixels(25.0));
        assert_position_dimension_invariant(&axis, "all_defaults");
    }

    #[test]
    fn fp_pos_dim_scattered_customs() {
        let customs = vec![
            (0, Pixels(10.0)),
            (5, Pixels(100.0)),
            (9, Pixels(1.0)),
            (15, Pixels(50.0)),
            (19, Pixels(0.5)),
        ];
        let axis = AxisIndex::from_sparse(20, Pixels(20.0), customs, vec![]);
        assert_position_dimension_invariant(&axis, "scattered_customs");
    }

    #[test]
    fn fp_pos_dim_with_hidden() {
        let axis = AxisIndex::from_sparse(10, Pixels(20.0), vec![], vec![0, 3, 7, 9]);
        assert_position_dimension_invariant(&axis, "with_hidden");
    }

    #[test]
    fn fp_pos_dim_custom_and_hidden() {
        let customs = vec![(2, Pixels(50.0)), (5, Pixels(80.0)), (7, Pixels(10.0))];
        let hidden = vec![1, 5, 8]; // note: 5 is both custom and hidden
        let axis = AxisIndex::from_sparse(10, Pixels(20.0), customs, hidden);
        assert_position_dimension_invariant(&axis, "custom_and_hidden");
    }

    #[test]
    fn fp_pos_dim_after_mutations() {
        let mut axis = AxisIndex::new(15, Pixels(20.0));
        axis.set_dimension(3, Pixels(50.0));
        assert_position_dimension_invariant(&axis, "after set_dim");

        axis.hide(7);
        assert_position_dimension_invariant(&axis, "after hide");

        axis.set_dimension(7, Pixels(100.0)); // set dim on hidden entry
        assert_position_dimension_invariant(&axis, "after set_dim on hidden");

        axis.unhide(7);
        assert_position_dimension_invariant(&axis, "after unhide");

        axis.hide(0);
        axis.hide(14);
        assert_position_dimension_invariant(&axis, "after hide first and last");

        axis.set_dimension(0, Pixels(5.0));
        axis.unhide(0);
        assert_position_dimension_invariant(&axis, "after unhide with custom dim");
    }

    // --- 2. Total size consistency ---

    #[test]
    fn fp_total_size_equals_position_at_count() {
        let configs: Vec<AxisIndex> = vec![
            AxisIndex::new(0, Pixels(20.0)),
            AxisIndex::new(1, Pixels(20.0)),
            AxisIndex::new(100, Pixels(20.0)),
            AxisIndex::from_sparse(10, Pixels(20.0), vec![(3, Pixels(50.0))], vec![]),
            AxisIndex::from_sparse(10, Pixels(20.0), vec![], vec![2, 5]),
            AxisIndex::from_sparse(
                10,
                Pixels(20.0),
                vec![(2, Pixels(50.0)), (5, Pixels(80.0))],
                vec![2, 7],
            ),
        ];
        for (idx, axis) in configs.iter().enumerate() {
            assert_eq!(
                axis.total_size(),
                axis.get_position(axis.count()),
                "config {idx}: total_size != get_position(count)"
            );
        }
    }

    #[test]
    fn fp_total_size_equals_sum_of_dimensions() {
        let axis = AxisIndex::from_sparse(
            20,
            Pixels(15.0),
            vec![(0, Pixels(30.0)), (10, Pixels(5.0)), (19, Pixels(100.0))],
            vec![3, 10, 15],
        );
        assert_total_size_is_sum(&axis, "mixed");
    }

    // --- 3. Inverse function property (get_index_at) ---

    #[test]
    fn fp_index_at_roundtrip_defaults() {
        let axis = AxisIndex::new(50, Pixels(20.0));
        for i in 0..50 {
            let pos = axis.get_position(i);
            assert_eq!(
                axis.get_index_at(pos),
                i,
                "get_index_at(get_position({})) should be {}",
                i,
                i
            );
        }
    }

    #[test]
    fn fp_index_at_roundtrip_customs() {
        let customs = vec![
            (0, Pixels(10.0)),
            (3, Pixels(100.0)),
            (7, Pixels(5.0)),
            (9, Pixels(50.0)),
        ];
        let axis = AxisIndex::from_sparse(10, Pixels(20.0), customs, vec![]);
        for i in 0..10 {
            let pos = axis.get_position(i);
            let dim = axis.get_dimension(i);
            if dim.0 > 0.0 {
                assert_eq!(axis.get_index_at(pos), i, "roundtrip failed at index {}", i);
                // Middle of entry should also return i
                if dim.0 > 1.0 {
                    assert_eq!(
                        axis.get_index_at(Pixels(pos.0 + dim.0 / 2.0)),
                        i,
                        "mid-entry roundtrip failed at index {}",
                        i
                    );
                }
                // Just before the end of entry should also return i
                assert_eq!(
                    axis.get_index_at(Pixels(pos.0 + dim.0 - 0.001)),
                    i,
                    "near-end roundtrip failed at index {}",
                    i
                );
            }
        }
    }

    #[test]
    fn fp_index_at_roundtrip_with_hidden() {
        let axis = AxisIndex::from_sparse(10, Pixels(20.0), vec![], vec![2, 5]);
        for i in 0..10 {
            let dim = axis.get_dimension(i);
            if dim.0 > 0.0 {
                let pos = axis.get_position(i);
                assert_eq!(
                    axis.get_index_at(pos),
                    i,
                    "roundtrip failed at visible index {}",
                    i
                );
            }
        }
    }

    #[test]
    fn fp_index_at_epsilon_inside_entry() {
        let axis = AxisIndex::from_sparse(10, Pixels(20.0), vec![(3, Pixels(50.0))], vec![]);
        for i in 0..10 {
            let pos = axis.get_position(i);
            let dim = axis.get_dimension(i);
            if dim.0 > 0.0 {
                // A small epsilon inside the entry should still map to i
                let eps = dim.0.min(0.01);
                assert_eq!(
                    axis.get_index_at(Pixels(pos.0 + eps)),
                    i,
                    "epsilon inside entry {} failed",
                    i
                );
            }
        }
    }

    // --- 4. get_index_at monotonicity ---

    #[test]
    fn fp_index_at_monotonic_defaults() {
        let axis = AxisIndex::new(100, Pixels(20.0));
        let mut prev = 0;
        for px in (0..2100).step_by(3) {
            let idx = axis.get_index_at(Pixels(px as f64));
            assert!(
                idx >= prev,
                "monotonicity violated: idx_at({}) = {} < prev {}",
                px,
                idx,
                prev,
            );
            prev = idx;
        }
    }

    #[test]
    fn fp_index_at_monotonic_mixed() {
        let customs = vec![(2, Pixels(100.0)), (5, Pixels(1.0)), (8, Pixels(50.0))];
        let hidden = vec![3, 6];
        let axis = AxisIndex::from_sparse(10, Pixels(20.0), customs, hidden);
        let total = axis.total_size().0 as i64 + 50;
        let mut prev = 0;
        for px in (0..total).step_by(1) {
            let idx = axis.get_index_at(Pixels(px as f64));
            assert!(
                idx >= prev,
                "monotonicity violated at px={}: {} < {}",
                px,
                idx,
                prev,
            );
            prev = idx;
        }
    }

    // --- 5. Hidden entry semantics ---

    #[test]
    fn fp_hidden_dimension_is_zero() {
        let mut axis = AxisIndex::new(10, Pixels(20.0));
        for i in 0..10 {
            axis.hide(i);
            assert_eq!(
                axis.get_dimension(i),
                Pixels(0.0),
                "hidden entry {} should have dim 0",
                i
            );
        }
    }

    #[test]
    fn fp_hide_unhide_restores_default() {
        let mut axis = AxisIndex::new(10, Pixels(25.0));
        for i in 0..10 {
            axis.hide(i);
            axis.unhide(i);
            assert_eq!(
                axis.get_dimension(i),
                Pixels(25.0),
                "unhide should restore default for entry {}",
                i
            );
        }
        assert_position_dimension_invariant(&axis, "hide_unhide_default");
    }

    #[test]
    fn fp_hide_unhide_restores_custom() {
        let mut axis = AxisIndex::new(10, Pixels(20.0));
        axis.set_dimension(4, Pixels(77.0));
        axis.hide(4);
        assert_eq!(axis.get_dimension(4), Pixels(0.0));
        axis.unhide(4);
        assert_eq!(
            axis.get_dimension(4),
            Pixels(77.0),
            "unhide should restore custom dimension"
        );
        assert_position_dimension_invariant(&axis, "hide_unhide_custom");
    }

    #[test]
    fn fp_hidden_adjacent_positions() {
        // Hiding entry i should make entries i and i+1 have the same position
        let mut axis = AxisIndex::new(10, Pixels(20.0));
        axis.hide(5);
        assert_eq!(
            axis.get_position(5),
            axis.get_position(6),
            "hidden entry should make adjacent positions equal"
        );
        // And entry 4's end should touch entry 6's start
        let pos4_end = axis.get_position(4).0 + axis.get_dimension(4).0;
        assert!(
            (pos4_end - axis.get_position(6).0).abs() < 1e-9,
            "gap created by hidden entry"
        );
    }

    #[test]
    fn fp_hide_all_total_zero() {
        let mut axis = AxisIndex::new(20, Pixels(30.0));
        for i in 0..20 {
            axis.hide(i);
        }
        assert_eq!(axis.total_size(), Pixels(0.0));
        for i in 0..=20 {
            assert_eq!(axis.get_position(i), Pixels(0.0));
        }
    }

    // --- 6. set_dimension correctness ---

    #[test]
    fn fp_set_dimension_only_affects_subsequent() {
        let mut axis = AxisIndex::new(10, Pixels(20.0));
        // Record positions before mutation
        let positions_before: Vec<Pixels> = (0..10).map(|i| axis.get_position(i)).collect();

        axis.set_dimension(5, Pixels(50.0));

        // Positions 0..=5 should be unchanged
        for i in 0..=5 {
            assert_eq!(
                axis.get_position(i),
                positions_before[i],
                "position {} should be unchanged after modifying entry 5",
                i
            );
        }
        // Positions after 5 should have shifted by the delta (50-20=30)
        for i in 6..10 {
            assert!(
                (axis.get_position(i).0 - positions_before[i].0 - 30.0).abs() < 1e-9,
                "position {} should have shifted by 30",
                i
            );
        }
    }

    #[test]
    fn fp_set_dimension_to_default_clears_custom() {
        let mut axis = AxisIndex::new(10, Pixels(20.0));
        axis.set_dimension(3, Pixels(50.0));
        axis.set_dimension(3, Pixels(20.0)); // back to default

        // Should be indistinguishable from a fresh axis
        let fresh = AxisIndex::new(10, Pixels(20.0));
        for i in 0..=10 {
            assert_eq!(
                axis.get_position(i),
                fresh.get_position(i),
                "position {} differs after reset to default",
                i
            );
        }
    }

    #[test]
    fn fp_set_dimension_on_hidden_remembered() {
        let mut axis = AxisIndex::new(10, Pixels(20.0));
        axis.hide(3);
        axis.set_dimension(3, Pixels(99.0));

        // While hidden, dimension should still be 0
        assert_eq!(axis.get_dimension(3), Pixels(0.0));
        assert_position_dimension_invariant(&axis, "set_dim_on_hidden");

        // Unhiding should reveal the custom dimension
        axis.unhide(3);
        assert_eq!(axis.get_dimension(3), Pixels(99.0));
        assert_position_dimension_invariant(&axis, "unhide_after_set_dim_on_hidden");
    }

    // --- 7. from_sparse equivalence ---

    #[test]
    fn fp_from_sparse_equals_incremental_custom() {
        let customs = vec![(1, Pixels(30.0)), (4, Pixels(10.0)), (7, Pixels(50.0))];
        let axis_sparse = AxisIndex::from_sparse(10, Pixels(20.0), customs.clone(), vec![]);

        let mut axis_incr = AxisIndex::new(10, Pixels(20.0));
        for (i, size) in &customs {
            axis_incr.set_dimension(*i, *size);
        }

        for i in 0..=10 {
            assert!(
                (axis_sparse.get_position(i).0 - axis_incr.get_position(i).0).abs() < 1e-9,
                "position {} differs between from_sparse and incremental",
                i
            );
        }
        for i in 0..10 {
            assert_eq!(
                axis_sparse.get_dimension(i),
                axis_incr.get_dimension(i),
                "dimension {} differs",
                i
            );
        }
    }

    #[test]
    fn fp_from_sparse_equals_incremental_hidden() {
        let hidden = vec![2, 5, 8];
        let axis_sparse = AxisIndex::from_sparse(10, Pixels(20.0), vec![], hidden.clone());

        let mut axis_incr = AxisIndex::new(10, Pixels(20.0));
        for &i in &hidden {
            axis_incr.hide(i);
        }

        for i in 0..=10 {
            assert!(
                (axis_sparse.get_position(i).0 - axis_incr.get_position(i).0).abs() < 1e-9,
                "position {} differs",
                i
            );
        }
        assert!(
            (axis_sparse.total_size().0 - axis_incr.total_size().0).abs() < 1e-9,
            "total sizes differ"
        );
    }

    #[test]
    fn fp_from_sparse_equals_incremental_custom_and_hidden() {
        let customs = vec![(2, Pixels(50.0)), (5, Pixels(80.0))];
        let hidden = vec![2, 7]; // note: 2 is both custom and hidden
        let axis_sparse = AxisIndex::from_sparse(10, Pixels(20.0), customs.clone(), hidden.clone());

        let mut axis_incr = AxisIndex::new(10, Pixels(20.0));
        for (i, size) in &customs {
            axis_incr.set_dimension(*i, *size);
        }
        for &i in &hidden {
            axis_incr.hide(i);
        }

        for i in 0..=10 {
            assert!(
                (axis_sparse.get_position(i).0 - axis_incr.get_position(i).0).abs() < 1e-9,
                "position {} differs",
                i
            );
        }
        for i in 0..10 {
            assert_eq!(
                axis_sparse.get_dimension(i),
                axis_incr.get_dimension(i),
                "dimension {} differs",
                i
            );
            assert_eq!(
                axis_sparse.is_hidden(i),
                axis_incr.is_hidden(i),
                "hidden state {} differs",
                i
            );
        }
    }

    // --- 8. build_position_array / build_dimension_array consistency ---

    #[test]
    fn fp_build_position_array_matches_get_position() {
        let axis = AxisIndex::from_sparse(
            15,
            Pixels(20.0),
            vec![(3, Pixels(50.0)), (10, Pixels(5.0))],
            vec![7],
        );
        let arr = axis.build_position_array(2, 13);
        // Length is end-start+1 (in-range entries + trailing sentinel).
        assert_eq!(arr.len(), 12);
        for (j, i) in (2..=13).enumerate() {
            assert!(
                (arr[j] - axis.get_position(i).0).abs() < 1e-9,
                "build_position_array[{}] != get_position({})",
                j,
                i,
            );
        }
    }

    #[test]
    fn fp_build_dimension_array_matches_get_dimension() {
        let axis = AxisIndex::from_sparse(
            15,
            Pixels(20.0),
            vec![(3, Pixels(50.0)), (10, Pixels(5.0))],
            vec![7],
        );
        let arr = axis.build_dimension_array(0, 15);
        for i in 0..15 {
            assert!(
                (arr[i] - axis.get_dimension(i).0).abs() < 1e-9,
                "build_dimension_array[{}] != get_dimension({})",
                i,
                i,
            );
        }
    }

    #[test]
    fn fp_build_position_array_empty_range() {
        let axis = AxisIndex::new(10, Pixels(20.0));
        assert!(axis.build_position_array(5, 5).is_empty());
        assert!(axis.build_position_array(7, 3).is_empty());
    }

    // --- 9. get_visible_range correctness ---

    #[test]
    fn fp_visible_range_entries_intersect() {
        let axis = AxisIndex::from_sparse(
            20,
            Pixels(20.0),
            vec![(5, Pixels(100.0)), (15, Pixels(5.0))],
            vec![10],
        );
        let start_px = Pixels(50.0);
        let end_px = Pixels(250.0);
        let (first, last_excl) = axis.get_visible_range(start_px, end_px);

        // All entries in the range should have positions that are <= end_px
        for i in first..last_excl {
            let pos = axis.get_position(i);
            let _end = pos.0 + axis.get_dimension(i).0;
            // The entry's interval [pos, pos+dim) should intersect [start_px, end_px]
            // An entry intersects if pos < end_px and pos+dim > start_px
            // (with exception for hidden entries which have dim=0)
            if axis.get_dimension(i).0 > 0.0 {
                assert!(
                    pos.0 <= end_px.0,
                    "entry {} starts at {} which is beyond end_px {}",
                    i,
                    pos.0,
                    end_px.0
                );
            }
        }

        // The first entry in range should contain or start at/after start_px
        // (or be the entry whose region includes start_px)
        if first < last_excl {
            let pos_first = axis.get_position(first);
            let end_first = pos_first.0 + axis.get_dimension(first).0;
            assert!(
                end_first > start_px.0 || axis.get_dimension(first).0 == 0.0,
                "first visible entry {} ends at {} before start_px {}",
                first,
                end_first,
                start_px.0
            );
        }
    }

    #[test]
    fn fp_visible_range_empty_for_negative_end() {
        let axis = AxisIndex::new(10, Pixels(20.0));
        assert_eq!(axis.get_visible_range(Pixels(-100.0), Pixels(0.0)), (0, 0));
        assert_eq!(
            axis.get_visible_range(Pixels(-100.0), Pixels(-50.0)),
            (0, 0)
        );
    }

    // --- 10. Edge cases ---

    #[test]
    fn fp_count_zero() {
        let axis = AxisIndex::new(0, Pixels(20.0));
        assert_eq!(axis.count(), 0);
        assert_eq!(axis.total_size(), Pixels(0.0));
        assert_eq!(axis.get_position(0), Pixels(0.0));
        assert_eq!(axis.get_index_at(Pixels(0.0)), 0);
        assert_eq!(axis.get_index_at(Pixels(100.0)), 0);
        assert!(axis.build_position_array(0, 0).is_empty());
        assert!(axis.build_dimension_array(0, 0).is_empty());
        assert_eq!(axis.get_visible_range(Pixels(0.0), Pixels(100.0)), (0, 0));
    }

    #[test]
    fn fp_count_one() {
        let axis = AxisIndex::new(1, Pixels(20.0));
        assert_eq!(axis.get_position(0), Pixels(0.0));
        assert_eq!(axis.get_position(1), Pixels(20.0));
        assert_eq!(axis.get_dimension(0), Pixels(20.0));
        assert_eq!(axis.total_size(), Pixels(20.0));
        assert_eq!(axis.get_index_at(Pixels(0.0)), 0);
        assert_eq!(axis.get_index_at(Pixels(10.0)), 0);
        assert_eq!(axis.get_index_at(Pixels(19.99)), 0);
        assert_eq!(axis.get_index_at(Pixels(100.0)), 0); // clamped to count-1
        assert_position_dimension_invariant(&axis, "count_one");
    }

    #[test]
    fn fp_position_beyond_count_extrapolates() {
        let axis = AxisIndex::from_sparse(5, Pixels(20.0), vec![(2, Pixels(50.0))], vec![]);
        let pos_at_count = axis.get_position(5);
        // Beyond count should extrapolate with default size
        assert_eq!(axis.get_position(6), Pixels(pos_at_count.0 + 20.0),);
        assert_eq!(axis.get_position(10), Pixels(pos_at_count.0 + 5.0 * 20.0),);
    }

    #[test]
    fn fp_negative_pixel_returns_zero() {
        let axis = AxisIndex::new(10, Pixels(20.0));
        assert_eq!(axis.get_index_at(Pixels(-1.0)), 0);
        assert_eq!(axis.get_index_at(Pixels(-1000.0)), 0);
        assert_eq!(axis.get_index_at(Pixels(-0.001)), 0);
    }

    #[test]
    fn fp_get_dimension_beyond_count_returns_default() {
        let axis = AxisIndex::new(5, Pixels(20.0));
        assert_eq!(axis.get_dimension(5), Pixels(20.0));
        assert_eq!(axis.get_dimension(100), Pixels(20.0));
    }

    #[test]
    fn fp_hide_out_of_range_is_noop() {
        let mut axis = AxisIndex::new(5, Pixels(20.0));
        axis.hide(10); // beyond count, should be noop
        assert_eq!(axis.total_size(), Pixels(100.0));
        axis.unhide(10); // beyond count, noop
        assert_eq!(axis.total_size(), Pixels(100.0));
    }

    #[test]
    fn fp_set_dimension_out_of_range_is_noop() {
        let mut axis = AxisIndex::new(5, Pixels(20.0));
        axis.set_dimension(10, Pixels(99.0));
        assert_eq!(axis.total_size(), Pixels(100.0));
    }

    #[test]
    fn fp_double_hide_is_idempotent() {
        let mut axis = AxisIndex::new(10, Pixels(20.0));
        axis.hide(3);
        let total_after_first = axis.total_size();
        axis.hide(3); // already hidden
        assert_eq!(axis.total_size(), total_after_first);
        assert_position_dimension_invariant(&axis, "double_hide");
    }

    #[test]
    fn fp_double_unhide_is_idempotent() {
        let mut axis = AxisIndex::new(10, Pixels(20.0));
        axis.hide(3);
        axis.unhide(3);
        let total_after_first = axis.total_size();
        axis.unhide(3); // already visible
        assert_eq!(axis.total_size(), total_after_first);
        assert_position_dimension_invariant(&axis, "double_unhide");
    }

    #[test]
    fn fp_stress_invariant_many_mutations() {
        let mut axis = AxisIndex::new(30, Pixels(20.0));

        // Series of mutations
        axis.set_dimension(0, Pixels(5.0));
        axis.set_dimension(10, Pixels(100.0));
        axis.set_dimension(20, Pixels(1.0));
        axis.hide(5);
        axis.hide(15);
        axis.hide(25);
        axis.set_dimension(5, Pixels(50.0)); // custom on hidden
        axis.set_dimension(15, Pixels(0.5)); // custom on hidden
        axis.unhide(5); // reveal custom 50
        axis.set_dimension(10, Pixels(20.0)); // reset to default
        axis.hide(0);
        axis.unhide(0);

        assert_position_dimension_invariant(&axis, "stress_mutations");
        assert_total_size_is_sum(&axis, "stress_mutations");

        // Also verify get_index_at roundtrip for visible entries
        for i in 0..30 {
            if axis.get_dimension(i).0 > 0.0 {
                let pos = axis.get_position(i);
                assert_eq!(
                    axis.get_index_at(pos),
                    i,
                    "roundtrip failed at {} after stress mutations",
                    i
                );
            }
        }
    }

    #[test]
    fn fp_position_starts_at_zero() {
        // For any configuration, position(0) must be 0
        let configs: Vec<AxisIndex> = vec![
            AxisIndex::new(0, Pixels(20.0)),
            AxisIndex::new(1, Pixels(0.0)),
            AxisIndex::new(100, Pixels(20.0)),
            AxisIndex::from_sparse(10, Pixels(20.0), vec![(0, Pixels(100.0))], vec![]),
            AxisIndex::from_sparse(10, Pixels(20.0), vec![], vec![0]),
        ];
        for (idx, axis) in configs.iter().enumerate() {
            assert_eq!(
                axis.get_position(0),
                Pixels(0.0),
                "config {}: position(0) must be 0",
                idx
            );
        }
    }

    #[test]
    fn fp_positions_nondecreasing() {
        // Positions must be non-decreasing (since dimensions >= 0)
        let axis = AxisIndex::from_sparse(
            20,
            Pixels(20.0),
            vec![(3, Pixels(0.0)), (7, Pixels(100.0)), (15, Pixels(0.5))],
            vec![5, 10, 11, 12],
        );
        let mut prev = 0.0f64;
        for i in 0..=20 {
            let pos = axis.get_position(i).0;
            assert!(
                pos >= prev - 1e-9,
                "position({}) = {} < position({}) = {}",
                i,
                pos,
                i - 1,
                prev,
            );
            prev = pos;
        }
    }

    #[test]
    fn fp_zero_default_size() {
        // Edge case: default size 0
        let axis = AxisIndex::new(10, Pixels(0.0));
        assert_eq!(axis.total_size(), Pixels(0.0));
        for i in 0..=10 {
            assert_eq!(axis.get_position(i), Pixels(0.0));
        }
        assert_position_dimension_invariant(&axis, "zero_default");
    }

    #[test]
    fn fp_zero_default_with_custom() {
        // Default 0, but some entries have custom sizes
        let axis = AxisIndex::from_sparse(
            5,
            Pixels(0.0),
            vec![(1, Pixels(30.0)), (3, Pixels(50.0))],
            vec![],
        );
        assert_eq!(axis.get_dimension(0), Pixels(0.0));
        assert_eq!(axis.get_dimension(1), Pixels(30.0));
        assert_eq!(axis.get_dimension(2), Pixels(0.0));
        assert_eq!(axis.get_dimension(3), Pixels(50.0));
        assert_eq!(axis.total_size(), Pixels(80.0));
        assert_position_dimension_invariant(&axis, "zero_default_with_custom");
    }

    #[test]
    fn fp_consecutive_hidden_entries() {
        // Multiple consecutive hidden entries
        let axis = AxisIndex::from_sparse(10, Pixels(20.0), vec![], vec![3, 4, 5, 6]);
        // Positions of 3,4,5,6,7 should all be 3*20=60
        let pos3 = axis.get_position(3).0;
        assert_eq!(axis.get_position(4).0, pos3);
        assert_eq!(axis.get_position(5).0, pos3);
        assert_eq!(axis.get_position(6).0, pos3);
        assert_eq!(axis.get_position(7).0, pos3);
        assert_position_dimension_invariant(&axis, "consecutive_hidden");
    }
}
