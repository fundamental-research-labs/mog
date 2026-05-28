use cell_types::CellId;

use super::GridIndex;

impl GridIndex {
    /// Get or create a CellId at the given position.
    /// If the cell already has an identity, return it.
    /// If not, generate a new CellId and register it.
    /// Auto-expands the grid if the position is beyond current bounds.
    pub fn ensure_cell_id(&mut self, row: u32, col: u32) -> CellId {
        self.ensure_capacity(row, col);
        if let Some(&cell_id) = self.cell_at_pos.get(&(row, col)) {
            return cell_id;
        }
        let cell_id = self.id_alloc.next_cell_id();
        self.cell_at_pos.insert((row, col), cell_id);
        self.cell_to_pos.insert(cell_id, (row, col));
        cell_id
    }

    /// Get CellId at position (without creating if missing).
    #[inline]
    #[must_use]
    pub fn cell_id_at(&self, row: u32, col: u32) -> Option<CellId> {
        self.cell_at_pos.get(&(row, col)).copied()
    }

    /// Get position of a CellId.
    #[inline]
    #[must_use]
    pub fn cell_position(&self, cell_id: &CellId) -> Option<(u32, u32)> {
        self.cell_to_pos.get(cell_id).copied()
    }

    /// Register an externally-created CellId at a position (for sync/import).
    /// Auto-expands the grid if the position is beyond current bounds.
    pub fn register_cell(&mut self, cell_id: CellId, row: u32, col: u32) {
        // Virtual CellIds use a SipHash in the lower 64 bits — calling
        // ensure_past would advance the counter to a random-looking value.
        if !cell_id.is_virtual() {
            self.id_alloc.ensure_past(cell_id.as_u128());
        }
        self.ensure_capacity(row, col);
        // Clean up any existing CellId at this position
        if let Some(old_cell_id) = self.cell_at_pos.get(&(row, col)).copied()
            && old_cell_id != cell_id
        {
            self.cell_to_pos.remove(&old_cell_id);
        }
        // Clean up any existing position for this CellId
        if let Some(old_pos) = self.cell_to_pos.get(&cell_id).copied()
            && old_pos != (row, col)
        {
            self.cell_at_pos.remove(&old_pos);
        }
        self.cell_at_pos.insert((row, col), cell_id);
        self.cell_to_pos.insert(cell_id, (row, col));
    }

    /// Remove a cell identity (when cell is cleared).
    pub fn remove_cell(&mut self, cell_id: &CellId) {
        if let Some(pos) = self.cell_to_pos.remove(cell_id) {
            self.cell_at_pos.remove(&pos);
        }
    }
}
