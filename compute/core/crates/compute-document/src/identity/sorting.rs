use cell_types::CellId;
use rustc_hash::FxHashMap;

use super::GridIndex;

impl GridIndex {
    /// Sort rows: given a permutation (old_index -> new_index), remap all cell positions.
    ///
    /// Each tuple `(old_row, new_row)` means the row that was at `old_row` should move
    /// to `new_row`. RowIds intentionally remain unchanged; only cell positions in
    /// affected rows are updated.
    pub fn sort_rows(&mut self, permutation: &[(u32, u32)]) {
        if permutation.is_empty() {
            return;
        }

        // Validate that the permutation is a bijection (debug-only, zero-cost in release).
        #[cfg(debug_assertions)]
        {
            let mut seen_new_rows = rustc_hash::FxHashSet::default();
            for &(_old_row, new_row) in permutation {
                debug_assert!(
                    seen_new_rows.insert(new_row),
                    "sort_rows: duplicate new_row target {new_row} -- permutation is not injective"
                );
            }
            let old_rows: rustc_hash::FxHashSet<u32> =
                permutation.iter().map(|&(old, _)| old).collect();
            let new_rows: rustc_hash::FxHashSet<u32> =
                permutation.iter().map(|&(_, new)| new).collect();
            debug_assert!(
                old_rows == new_rows,
                "sort_rows: source set != target set -- permutation is not a bijection \
                 (sources: {old_rows:?}, targets: {new_rows:?})"
            );
        }

        // Build old_row -> new_row lookup
        let mut row_map: FxHashMap<u32, u32> = FxHashMap::default();
        for &(old_row, new_row) in permutation {
            row_map.insert(old_row, new_row);
        }

        // NOTE: row_ids and row_to_index are NOT permuted here.
        // Sorting cell positions does not reorder the identity axis.

        // Remap cell positions: collect cells in affected rows, remove old, insert new
        let affected_rows: rustc_hash::FxHashSet<u32> =
            permutation.iter().map(|&(old, _)| old).collect();

        let cells_to_remap: Vec<((u32, u32), CellId)> = self
            .cell_at_pos
            .iter()
            .filter(|&(&(row, _), _)| affected_rows.contains(&row))
            .map(|(&pos, &id)| (pos, id))
            .collect();

        // Remove old positions
        for &((row, col), cell_id) in &cells_to_remap {
            self.cell_at_pos.remove(&(row, col));
            self.cell_to_pos.remove(&cell_id);
        }

        // Insert at new positions
        for &((old_row, col), cell_id) in &cells_to_remap {
            let new_row = row_map.get(&old_row).copied().unwrap_or(old_row);
            self.cell_at_pos.insert((new_row, col), cell_id);
            self.cell_to_pos.insert(cell_id, (new_row, col));
        }
    }

    /// Permute `row_ids` (and `row_to_index`) to match a reordered `rowOrder`.
    ///
    /// Called by the range sort path after the native row axis is reordered.
    /// The per-cell sort path does NOT call this (it uses `sort_rows` which
    /// leaves `row_ids` unchanged because per-cell sort doesn't touch `rowOrder`).
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
