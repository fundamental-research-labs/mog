use cell_types::{AxisIdentityId, AxisIdentityStore, CellId, ColId, RowId, SheetId};

use super::GridIndex;

impl GridIndex {
    /// Insert rows at the given index. Generates new RowIds.
    /// Shifts all cell positions at or after `at` down by `count`.
    /// Returns the new RowIds.
    pub fn insert_rows(&mut self, at: u32, count: u32) -> Vec<RowId> {
        let at = at.min(self.row_count());

        // Generate new RowIds for inserted rows
        let mut new_row_ids = Vec::with_capacity(count as usize);
        for _ in 0..count {
            new_row_ids.push(self.id_alloc.next_row_id());
        }

        axis_insert_explicit(
            &mut self.row_axis,
            self.sheet_id,
            at,
            new_row_ids.iter().copied(),
        );

        // Shift cell positions: cells at row >= at move down by count
        let cells_to_shift: Vec<((u32, u32), CellId)> = self
            .cell_at_pos
            .iter()
            .filter(|&(&(row, _), _)| row >= at)
            .map(|(&pos, &id)| (pos, id))
            .collect();

        // Pass 1: remove all old positions
        for &((row, col), cell_id) in &cells_to_shift {
            self.cell_at_pos.remove(&(row, col));
            self.cell_to_pos.remove(&cell_id);
        }
        // Pass 2: insert all new positions
        for &((row, col), cell_id) in &cells_to_shift {
            let new_row = row + count;
            self.cell_at_pos.insert((new_row, col), cell_id);
            self.cell_to_pos.insert(cell_id, (new_row, col));
        }

        new_row_ids
    }

    /// Delete rows at the given index.
    /// Removes cell identities in deleted rows.
    /// Shifts remaining cell positions up.
    /// Returns the deleted CellIds.
    pub fn delete_rows(&mut self, at: u32, count: u32) -> Vec<CellId> {
        let at = at.min(self.row_count());
        let count = count.min(self.row_count() - at);
        let end = at + count;

        // Collect CellIds in the deleted row range
        let deleted_cells: Vec<CellId> = self
            .cell_at_pos
            .iter()
            .filter(|&(&(row, _), _)| row >= at && row < end)
            .map(|(_, &id)| id)
            .collect();

        // Remove deleted cells from both maps
        for &cell_id in &deleted_cells {
            if let Some(pos) = self.cell_to_pos.remove(&cell_id) {
                self.cell_at_pos.remove(&pos);
            }
        }

        // Shift cells at row >= end up by count.
        // Remove all old positions first, then insert new positions,
        // to avoid collisions when a shifted cell lands on another's old position.
        let cells_to_shift: Vec<((u32, u32), CellId)> = self
            .cell_at_pos
            .iter()
            .filter(|&(&(row, _), _)| row >= end)
            .map(|(&pos, &id)| (pos, id))
            .collect();

        for &((row, col), cell_id) in &cells_to_shift {
            self.cell_at_pos.remove(&(row, col));
            self.cell_to_pos.remove(&cell_id);
        }
        for &((row, col), cell_id) in &cells_to_shift {
            let new_row = row - count;
            self.cell_at_pos.insert((new_row, col), cell_id);
            self.cell_to_pos.insert(cell_id, (new_row, col));
        }

        // Remove deleted RowIds from the active axis store.
        self.row_axis.delete_range(at, count);

        deleted_cells
    }

    /// Insert columns at the given index. Generates new ColIds.
    /// Shifts all cell positions at or after `at` right by `count`.
    /// Returns the new ColIds.
    pub fn insert_cols(&mut self, at: u32, count: u32) -> Vec<ColId> {
        let at = at.min(self.col_count());

        // Generate new ColIds for inserted columns
        let mut new_col_ids = Vec::with_capacity(count as usize);
        for _ in 0..count {
            new_col_ids.push(self.id_alloc.next_col_id());
        }

        axis_insert_explicit(
            &mut self.col_axis,
            self.sheet_id,
            at,
            new_col_ids.iter().copied(),
        );

        // Shift cell positions: cells at col >= at move right by count
        let cells_to_shift: Vec<((u32, u32), CellId)> = self
            .cell_at_pos
            .iter()
            .filter(|&(&(_, col), _)| col >= at)
            .map(|(&pos, &id)| (pos, id))
            .collect();

        // Pass 1: remove all old positions
        for &((row, col), cell_id) in &cells_to_shift {
            self.cell_at_pos.remove(&(row, col));
            self.cell_to_pos.remove(&cell_id);
        }
        // Pass 2: insert all new positions
        for &((row, col), cell_id) in &cells_to_shift {
            let new_col = col + count;
            self.cell_at_pos.insert((row, new_col), cell_id);
            self.cell_to_pos.insert(cell_id, (row, new_col));
        }

        new_col_ids
    }

    /// Delete columns at the given index.
    /// Removes cell identities in deleted columns.
    /// Shifts remaining cell positions left.
    /// Returns the deleted CellIds.
    pub fn delete_cols(&mut self, at: u32, count: u32) -> Vec<CellId> {
        let at = at.min(self.col_count());
        let count = count.min(self.col_count() - at);
        let end = at + count;

        // Collect CellIds in the deleted column range
        let deleted_cells: Vec<CellId> = self
            .cell_at_pos
            .iter()
            .filter(|&(&(_, col), _)| col >= at && col < end)
            .map(|(_, &id)| id)
            .collect();

        // Remove deleted cells from both maps
        for &cell_id in &deleted_cells {
            if let Some(pos) = self.cell_to_pos.remove(&cell_id) {
                self.cell_at_pos.remove(&pos);
            }
        }

        // Shift cells at col >= end left by count.
        // We must remove all old positions first, then insert all new positions,
        // to avoid collisions when a shifted cell lands on another's old position.
        let cells_to_shift: Vec<((u32, u32), CellId)> = self
            .cell_at_pos
            .iter()
            .filter(|&(&(_, col), _)| col >= end)
            .map(|(&pos, &id)| (pos, id))
            .collect();

        for &((row, col), cell_id) in &cells_to_shift {
            self.cell_at_pos.remove(&(row, col));
            self.cell_to_pos.remove(&cell_id);
        }
        for &((row, col), cell_id) in &cells_to_shift {
            let new_col = col - count;
            self.cell_at_pos.insert((row, new_col), cell_id);
            self.cell_to_pos.insert(cell_id, (row, new_col));
        }

        // Remove deleted ColIds from the active axis store.
        self.col_axis.delete_range(at, count);

        deleted_cells
    }

    /// Expand the grid to accommodate the given (row, col) position.
    /// Generates new RowIds/ColIds for any rows/cols beyond the current bounds.
    /// No-op if the position is already within bounds.
    pub fn ensure_capacity(&mut self, row: u32, col: u32) {
        let _ = self.ensure_capacity_returning(row, col);
    }

    /// Expand the grid to accommodate the given (row, col) position, returning
    /// the newly appended RowIds and ColIds in insertion order.
    ///
    /// Unlike [`Self::ensure_capacity`], this variant exposes the generated
    /// identities so that callers (e.g. `SheetDimensionsMut`) can mirror the
    /// same hexes into the yrs `rowOrder` / `colOrder` YArrays without
    /// allocating a second set of IDs that would drift from the in-memory
    /// index.
    ///
    /// Returns `(new_row_ids, new_col_ids)`. Either may be empty if the
    /// corresponding axis was already large enough.
    pub fn ensure_capacity_returning(&mut self, row: u32, col: u32) -> (Vec<RowId>, Vec<ColId>) {
        let mut new_row_ids = Vec::new();
        let needed_rows = row.saturating_add(1);
        if needed_rows > self.row_count() {
            let current = self.row_count();
            let delta = (needed_rows - current) as usize;
            new_row_ids.reserve(delta);
            for i in current..needed_rows {
                let rid = self.id_alloc.next_row_id();
                new_row_ids.push(rid);
                debug_assert_eq!(i, self.row_count() + new_row_ids.len() as u32 - 1);
            }
            axis_insert_explicit(
                &mut self.row_axis,
                self.sheet_id,
                current,
                new_row_ids.iter().copied(),
            );
        }
        let mut new_col_ids = Vec::new();
        let needed_cols = col.saturating_add(1);
        if needed_cols > self.col_count() {
            let current = self.col_count();
            let delta = (needed_cols - current) as usize;
            new_col_ids.reserve(delta);
            for i in current..needed_cols {
                let cid = self.id_alloc.next_col_id();
                new_col_ids.push(cid);
                debug_assert_eq!(i, self.col_count() + new_col_ids.len() as u32 - 1);
            }
            axis_insert_explicit(
                &mut self.col_axis,
                self.sheet_id,
                current,
                new_col_ids.iter().copied(),
            );
        }
        (new_row_ids, new_col_ids)
    }
}

fn axis_insert_explicit<Id>(
    store: &mut AxisIdentityStore<Id>,
    sheet_id: SheetId,
    at: u32,
    ids: impl IntoIterator<Item = Id>,
) where
    Id: AxisIdentityId,
{
    let insert_at = at.min(store.len()) as usize;
    if let AxisIdentityStore::Explicit(existing) = store {
        existing.splice(insert_at..insert_at, ids);
    } else {
        let mut materialized: Vec<Id> = store.identities_in(sheet_id, 0, store.len()).collect();
        materialized.splice(insert_at..insert_at, ids);
        *store = AxisIdentityStore::Explicit(materialized);
    }
}
