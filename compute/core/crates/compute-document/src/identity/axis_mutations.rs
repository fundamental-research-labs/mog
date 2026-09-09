use cell_types::{AxisIdentityId, AxisIdentityStore, ColId, RowId, SheetId};

use super::GridIndex;
use std::sync::Arc;

impl GridIndex {
    /// Insert rows and return their stable identities.
    pub fn insert_rows(&mut self, at: u32, count: u32) -> Vec<RowId> {
        let at = at.min(self.row_count());
        grow_axis(
            Arc::make_mut(&mut self.row_axis),
            self.sheet_id,
            at,
            count,
            &self.id_alloc,
        );
        self.row_axis
            .identities_in(self.sheet_id, at, count)
            .collect()
    }

    /// Delete the requested row identities. The cell store removes affected cells.
    pub fn delete_rows(&mut self, at: u32, count: u32) {
        let at = at.min(self.row_count());
        let count = count.min(self.row_count() - at);
        Arc::make_mut(&mut self.row_axis).delete_range(at, count);
    }

    /// Insert columns and return their stable identities.
    pub fn insert_cols(&mut self, at: u32, count: u32) -> Vec<ColId> {
        let at = at.min(self.col_count());
        grow_axis(
            Arc::make_mut(&mut self.col_axis),
            self.sheet_id,
            at,
            count,
            &self.id_alloc,
        );
        self.col_axis
            .identities_in(self.sheet_id, at, count)
            .collect()
    }

    /// Delete the requested column identities. The cell store removes affected cells.
    pub fn delete_cols(&mut self, at: u32, count: u32) {
        let at = at.min(self.col_count());
        let count = count.min(self.col_count() - at);
        Arc::make_mut(&mut self.col_axis).delete_range(at, count);
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
    }

    /// Truncate columns from the tail without shifting surviving cell positions.
    pub fn truncate_cols(&mut self, new_len: u32) {
        let current = self.col_count();
        if new_len >= current {
            return;
        }
        Arc::make_mut(&mut self.col_axis).delete_range(new_len, current - new_len);
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
