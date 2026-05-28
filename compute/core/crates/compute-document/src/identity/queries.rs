use cell_types::CellId;

use super::GridIndex;

impl GridIndex {
    /// Iterate over all (CellId, row, col) tuples.
    pub fn cells(&self) -> impl Iterator<Item = (CellId, u32, u32)> + '_ {
        self.cell_to_pos
            .iter()
            .map(|(&cell_id, &(row, col))| (cell_id, row, col))
    }

    /// Collect all cells at or after a given row. Returns `(CellId, row, col)`.
    pub fn cells_at_or_after_row(&self, at_row: u32) -> Vec<(CellId, u32, u32)> {
        self.cell_at_pos
            .iter()
            .filter(|&(&(row, _), _)| row >= at_row)
            .map(|(&(row, col), &cell_id)| (cell_id, row, col))
            .collect()
    }

    /// Collect all cells at or after a given column. Returns `(CellId, row, col)`.
    pub fn cells_at_or_after_col(&self, at_col: u32) -> Vec<(CellId, u32, u32)> {
        self.cell_at_pos
            .iter()
            .filter(|&(&(_, col), _)| col >= at_col)
            .map(|(&(row, col), &cell_id)| (cell_id, row, col))
            .collect()
    }

    /// Collect all cells in the given row range [at, at+count). Returns `(CellId, row, col)`.
    pub fn cells_in_row_range(&self, at: u32, count: u32) -> Vec<(CellId, u32, u32)> {
        let end = at + count;
        self.cell_at_pos
            .iter()
            .filter(|&(&(row, _), _)| row >= at && row < end)
            .map(|(&(row, col), &cell_id)| (cell_id, row, col))
            .collect()
    }

    /// Collect all cells in the given col range [at, at+count). Returns `(CellId, row, col)`.
    pub fn cells_in_col_range(&self, at: u32, count: u32) -> Vec<(CellId, u32, u32)> {
        let end = at + count;
        self.cell_at_pos
            .iter()
            .filter(|&(&(_, col), _)| col >= at && col < end)
            .map(|(&(row, col), &cell_id)| (cell_id, row, col))
            .collect()
    }

    /// Iterate over existing (materialized) cells within a rectangular range.
    ///
    /// This iterates the sparse `cell_at_pos` map and filters by bounds,
    /// which is O(total_cells) but avoids the O(range_area) cost of brute-force
    /// iteration over every (row, col) position in the range. For large ranges
    /// with few populated cells (e.g., clearing an entire column) this is
    /// dramatically faster.
    ///
    /// Uses `cell_at_pos` (position-keyed) rather than `cell_to_pos` (id-keyed)
    /// since we're filtering by position bounds — this is both more natural and
    /// robust against any transient desync between the two maps.
    pub fn cells_in_range(
        &self,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> impl Iterator<Item = (CellId, u32, u32)> + '_ {
        self.cell_at_pos
            .iter()
            .filter(move |&(&(row, col), _)| {
                row >= start_row && row <= end_row && col >= start_col && col <= end_col
            })
            .map(|(&(row, col), &cell_id)| (cell_id, row, col))
    }
}
