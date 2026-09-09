use cell_types::{AxisIdentityId, AxisIdentityStore, CellId, ColId, RowId, SheetId};

use super::GridIndex;
use std::sync::Arc;

impl GridIndex {
    /// Insert rows at the given index. Generates new RowIds.
    /// Shifts all cell positions at or after `at` down by `count`.
    /// Returns the new RowIds.
    pub fn insert_rows(&mut self, at: u32, count: u32) -> Vec<RowId> {
        let at = at.min(self.row_count());

        grow_axis(
            Arc::make_mut(&mut self.row_axis),
            self.sheet_id,
            at,
            count,
            &self.id_alloc,
        );
        let new_row_ids = self
            .row_axis
            .identities_in(self.sheet_id, at, count)
            .collect();

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
        Arc::make_mut(&mut self.row_axis).delete_range(at, count);

        deleted_cells
    }

    /// Insert columns at the given index. Generates new ColIds.
    /// Shifts all cell positions at or after `at` right by `count`.
    /// Returns the new ColIds.
    pub fn insert_cols(&mut self, at: u32, count: u32) -> Vec<ColId> {
        let at = at.min(self.col_count());

        grow_axis(
            Arc::make_mut(&mut self.col_axis),
            self.sheet_id,
            at,
            count,
            &self.id_alloc,
        );
        let new_col_ids = self
            .col_axis
            .identities_in(self.sheet_id, at, count)
            .collect();

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
        Arc::make_mut(&mut self.col_axis).delete_range(at, count);

        deleted_cells
    }

    /// Expand the grid to accommodate the given (row, col) position.
    /// Generates new RowIds/ColIds for any rows/cols beyond the current bounds.
    /// No-op if the position is already within bounds.
    pub fn ensure_capacity(&mut self, row: u32, col: u32) {
        self.ensure_row_capacity(row);
        self.ensure_col_capacity(col);
    }

    /// Grow the row axis without materializing generated identities.
    pub fn ensure_row_capacity(&mut self, row: u32) {
        let needed = row.saturating_add(1);
        let current = self.row_count();
        if needed > current {
            grow_axis(
                Arc::make_mut(&mut self.row_axis),
                self.sheet_id,
                current,
                needed - current,
                &self.id_alloc,
            );
        }
    }

    /// Grow the column axis without materializing generated identities.
    pub fn ensure_col_capacity(&mut self, col: u32) {
        let needed = col.saturating_add(1);
        let current = self.col_count();
        if needed > current {
            grow_axis(
                Arc::make_mut(&mut self.col_axis),
                self.sheet_id,
                current,
                needed - current,
                &self.id_alloc,
            );
        }
    }

    /// Expand the row axis to accommodate `row`, returning the newly appended
    /// RowIds in insertion order.
    pub fn ensure_row_capacity_returning(&mut self, row: u32) -> Vec<RowId> {
        let old = self.row_count();
        self.ensure_row_capacity(row);
        self.row_axis
            .identities_in(self.sheet_id, old, self.row_count() - old)
            .collect()
    }

    /// Expand the column axis to accommodate `col`, returning the newly
    /// appended ColIds in insertion order.
    pub fn ensure_col_capacity_returning(&mut self, col: u32) -> Vec<ColId> {
        let old = self.col_count();
        self.ensure_col_capacity(col);
        self.col_axis
            .identities_in(self.sheet_id, old, self.col_count() - old)
            .collect()
    }

    /// Expand the grid to accommodate the given (row, col) position, returning
    /// the newly appended RowIds and ColIds in insertion order.
    ///
    /// Materializes only the newly added identities when a caller needs them.
    ///
    /// Returns `(new_row_ids, new_col_ids)`. Either may be empty if the
    /// corresponding axis was already large enough.
    pub fn ensure_capacity_returning(&mut self, row: u32, col: u32) -> (Vec<RowId>, Vec<ColId>) {
        let new_row_ids = self.ensure_row_capacity_returning(row);
        let new_col_ids = self.ensure_col_capacity_returning(col);
        (new_row_ids, new_col_ids)
    }

    /// Truncate rows from the tail without shifting surviving cell positions.
    pub fn truncate_rows(&mut self, new_len: u32) {
        let current = self.row_count();
        if new_len >= current {
            return;
        }
        Arc::make_mut(&mut self.row_axis).delete_range(new_len, current - new_len);
        let removed: Vec<CellId> = self
            .cell_to_pos
            .iter()
            .filter_map(|(cell_id, (row, _))| (*row >= new_len).then_some(*cell_id))
            .collect();
        for cell_id in removed {
            self.remove_cell(&cell_id);
        }
    }

    /// Truncate columns from the tail without shifting surviving cell positions.
    pub fn truncate_cols(&mut self, new_len: u32) {
        let current = self.col_count();
        if new_len >= current {
            return;
        }
        Arc::make_mut(&mut self.col_axis).delete_range(new_len, current - new_len);
        let removed: Vec<CellId> = self
            .cell_to_pos
            .iter()
            .filter_map(|(cell_id, (_, col))| (*col >= new_len).then_some(*cell_id))
            .collect();
        for cell_id in removed {
            self.remove_cell(&cell_id);
        }
    }
}

fn grow_axis<Id: AxisIdentityId + std::hash::Hash>(
    axis: &mut super::AxisIndex<Id>,
    sheet: SheetId,
    at: u32,
    count: u32,
    alloc: &cell_types::IdAllocator,
) {
    if count == 0 {
        return;
    }
    if matches!(axis.store(), AxisIdentityStore::Runs(_)) {
        let run = alloc.next_axis_run(count);
        axis.insert_run(sheet, at, run);
    } else {
        axis.insert_explicit(
            sheet,
            at,
            (0..count).map(|_| Id::from_compact_raw(alloc.next_u128())),
        );
    }
}
