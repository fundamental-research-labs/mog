use super::GridIndex;

impl GridIndex {
    /// Permute `row_ids` (and `row_to_index`) to match a reordered `rowOrder`.
    ///
    /// Called by the range sort path after the native row axis is reordered.
    /// Cell-range sorts move authored cells within the existing axes.
    pub fn reorder_row_ids(&mut self, permutation: &[(u32, u32)]) {
        if permutation.is_empty() {
            return;
        }

        #[cfg(debug_assertions)]
        {
            let mut seen_new_rows = rustc_hash::FxHashSet::default();
            for &(_old_row, new_row) in permutation {
                debug_assert!(
                    seen_new_rows.insert(new_row),
                    "reorder_row_ids: duplicate new_row target {new_row} -- permutation is not injective"
                );
            }
            let old_rows: rustc_hash::FxHashSet<u32> =
                permutation.iter().map(|&(old, _)| old).collect();
            let new_rows: rustc_hash::FxHashSet<u32> =
                permutation.iter().map(|&(_, new)| new).collect();
            debug_assert!(
                old_rows == new_rows,
                "reorder_row_ids: source set != target set -- permutation is not a bijection \
                 (sources: {old_rows:?}, targets: {new_rows:?})"
            );
        }

        std::sync::Arc::make_mut(&mut self.row_axis).reorder_positions(permutation);
    }
}
