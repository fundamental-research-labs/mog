use std::sync::Arc;

use cell_types::{AxisIdentityId, AxisIdentityStore, CellId, ColId, IdAllocator, RowId, SheetId};
use rustc_hash::FxHashMap;

// ---------------------------------------------------------------------------
// GridIndex
// ---------------------------------------------------------------------------

/// Tracks identity-position mappings for a single sheet.
///
/// Design: CellIds are created lazily. Empty cells don't have CellIds.
/// When a cell is first written to, a CellId is generated.
/// When a row is inserted, RowIds are generated for the new rows.
/// When a column is inserted, ColIds are generated for the new columns.
///
/// The GridIndex maintains:
/// - Row identities: row_index -> RowId, RowId -> row_index
/// - Column identities: col_index -> ColId, ColId -> col_index
/// - Cell identities: (row, col) -> CellId, CellId -> (row, col)
#[derive(Debug, Clone)]
pub struct GridIndex {
    sheet_id: SheetId,
    /// Shared monotonic ID allocator — `Arc` so `Clone` is cheap and all
    /// clones share the same counter (no duplicate IDs across copies).
    id_alloc: Arc<IdAllocator>,

    // Row identity tracking. Legacy rowOrder hydrates as Explicit; compact
    // persisted axes hydrate as Runs and resolve reverse lookups without a
    // dense RowId -> row_index map.
    row_axis: AxisIdentityStore<RowId>,

    // Column identity tracking. See row_axis.
    col_axis: AxisIdentityStore<ColId>,

    // Cell identity tracking (SPARSE -- only materialized cells)
    cell_at_pos: FxHashMap<(u32, u32), CellId>, // (row, col) -> CellId
    cell_to_pos: FxHashMap<CellId, (u32, u32)>, // CellId -> (row, col)
}

impl GridIndex {
    /// Create a new GridIndex for a sheet with the given dimensions.
    /// Generates RowIds and ColIds for all initial rows/columns.
    pub fn new(sheet_id: SheetId, rows: u32, cols: u32, id_alloc: Arc<IdAllocator>) -> Self {
        let mut row_ids = Vec::with_capacity(rows as usize);
        for _ in 0..rows {
            let rid = id_alloc.next_row_id();
            row_ids.push(rid);
        }

        let mut col_ids = Vec::with_capacity(cols as usize);
        for _ in 0..cols {
            let cid = id_alloc.next_col_id();
            col_ids.push(cid);
        }

        Self {
            sheet_id,
            id_alloc,
            row_axis: AxisIdentityStore::Explicit(row_ids),
            col_axis: AxisIdentityStore::Explicit(col_ids),
            cell_at_pos: FxHashMap::default(),
            cell_to_pos: FxHashMap::default(),
        }
    }

    /// Create a GridIndex from Yrs YArray data (for rebuild from CRDT state).
    ///
    /// Takes the ordered RowId and ColId hex strings from the rowOrder/colOrder
    /// YArrays. This avoids allocating fresh random IDs and instead uses the
    /// stable identities already stored in the CRDT document.
    pub fn from_yrs_arrays(
        sheet_id: SheetId,
        row_id_hexes: &[String],
        col_id_hexes: &[String],
        id_alloc: Arc<IdAllocator>,
    ) -> Self {
        let mut row_ids = Vec::with_capacity(row_id_hexes.len());
        for hex in row_id_hexes {
            if let Some(raw) = crate::hex::hex_to_id(hex) {
                id_alloc.ensure_past(raw);
                let rid = RowId::from_raw(raw);
                row_ids.push(rid);
            }
        }

        let mut col_ids = Vec::with_capacity(col_id_hexes.len());
        for hex in col_id_hexes {
            if let Some(raw) = crate::hex::hex_to_id(hex) {
                id_alloc.ensure_past(raw);
                let cid = ColId::from_raw(raw);
                col_ids.push(cid);
            }
        }

        Self {
            sheet_id,
            id_alloc,
            row_axis: AxisIdentityStore::Explicit(row_ids),
            col_axis: AxisIdentityStore::Explicit(col_ids),
            cell_at_pos: FxHashMap::default(),
            cell_to_pos: FxHashMap::default(),
        }
    }

    /// Create a GridIndex from persisted compact/explicit axis identity stores.
    ///
    /// This path is used when the document carries compact row/column axis
    /// metadata under `gridIndex`. Unlike [`Self::from_yrs_arrays`], reverse
    /// lookups for compact axes do not build dense maps.
    pub fn from_axis_stores(
        sheet_id: SheetId,
        row_axis: AxisIdentityStore<RowId>,
        col_axis: AxisIdentityStore<ColId>,
        id_alloc: Arc<IdAllocator>,
    ) -> Self {
        ensure_allocator_past_axis_store(&id_alloc, sheet_id, &row_axis);
        ensure_allocator_past_axis_store(&id_alloc, sheet_id, &col_axis);

        Self {
            sheet_id,
            id_alloc,
            row_axis,
            col_axis,
            cell_at_pos: FxHashMap::default(),
            cell_to_pos: FxHashMap::default(),
        }
    }

    /// Get the SheetId this GridIndex belongs to.
    #[inline]
    pub fn sheet_id(&self) -> SheetId {
        self.sheet_id
    }

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

    /// Get RowId for a row index.
    #[inline]
    #[must_use]
    pub fn row_id(&self, row: u32) -> Option<RowId> {
        self.row_axis.identity_at(self.sheet_id, row)
    }

    /// Get ColId for a column index.
    #[inline]
    #[must_use]
    pub fn col_id(&self, col: u32) -> Option<ColId> {
        self.col_axis.identity_at(self.sheet_id, col)
    }

    /// Get row index for a RowId.
    #[inline]
    #[must_use]
    pub fn row_index(&self, row_id: &RowId) -> Option<u32> {
        self.row_axis.position_of(self.sheet_id, *row_id)
    }

    /// Get column index for a ColId.
    #[inline]
    #[must_use]
    pub fn col_index(&self, col_id: &ColId) -> Option<u32> {
        self.col_axis.position_of(self.sheet_id, *col_id)
    }

    /// Get the hex string for a RowId at a row index.
    #[inline]
    #[must_use]
    pub fn row_id_hex(&self, row: u32) -> Option<crate::hex::SmallHex> {
        self.row_id(row)
            .map(|rid| crate::hex::id_to_hex(rid.as_u128()))
    }

    /// Get the hex string for a ColId at a column index.
    #[inline]
    #[must_use]
    pub fn col_id_hex(&self, col: u32) -> Option<crate::hex::SmallHex> {
        self.col_id(col)
            .map(|cid| crate::hex::id_to_hex(cid.as_u128()))
    }

    /// Look up a row index from a hex string.
    ///
    /// Compact stores decode the generated identity and resolve via compact
    /// run metadata. Legacy explicit stores preserve dense `rowOrder`
    /// behavior.
    #[inline]
    #[must_use]
    pub fn row_index_from_hex(&self, hex: &str) -> Option<u32> {
        let raw = crate::hex::hex_to_id(hex)?;
        self.row_index(&RowId::from_raw(raw))
    }

    /// Look up a column index from a hex string. See [`Self::row_index_from_hex`].
    #[inline]
    #[must_use]
    pub fn col_index_from_hex(&self, hex: &str) -> Option<u32> {
        let raw = crate::hex::hex_to_id(hex)?;
        self.col_index(&ColId::from_raw(raw))
    }

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

    /// Sort rows: given a permutation (old_index -> new_index), remap all cell positions.
    ///
    /// Each tuple `(old_row, new_row)` means the row that was at `old_row` should move
    /// to `new_row`. RowIds follow the permutation, and all cell positions in affected
    /// rows are updated accordingly.
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
        // Yrs rowOrder is the authoritative source for row ordering;
        // row_ids must stay in sync with Yrs, so we leave them unchanged.

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
    /// Called by the Range sort path after `rowOrder` has been reordered in Yrs.
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

        let old_row_ids: Vec<RowId> = self
            .row_axis
            .identities_in(self.sheet_id, 0, self.row_axis.len())
            .collect();
        let mut row_ids = old_row_ids.clone();
        for &(old_idx, new_idx) in permutation {
            row_ids[new_idx as usize] = old_row_ids[old_idx as usize];
        }
        self.row_axis = AxisIdentityStore::Explicit(row_ids);
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

    /// Number of rows.
    #[inline]
    pub fn row_count(&self) -> u32 {
        self.row_axis.len()
    }

    /// Number of columns.
    #[inline]
    pub fn col_count(&self) -> u32 {
        self.col_axis.len()
    }

    /// Number of materialized cells (cells with CellIds).
    #[inline]
    pub fn cell_count(&self) -> u32 {
        self.cell_at_pos.len() as u32
    }

    /// Return the dense `row_index → RowId` slice for legacy explicit axes.
    ///
    /// unified reference model consumer: the mirror uses this to seed its own
    /// `RowId → (SheetId, row_index)` reverse index so `WorkbookLookup`
    /// can answer full-row display queries without threading the grid index
    /// through every call site.
    #[inline]
    #[must_use]
    pub fn row_ids_dense(&self) -> &[RowId] {
        match &self.row_axis {
            AxisIdentityStore::Explicit(ids) => ids,
            AxisIdentityStore::Runs(_) => &[],
        }
    }

    /// Collect all row identities in current positional order.
    ///
    /// This is the compatibility bridge for consumers that still own dense
    /// mirror indexes. Unlike [`Self::row_ids_dense`], it is correct for
    /// compact axes because it resolves identities through the axis store.
    #[must_use]
    pub fn row_ids_ordered(&self) -> Vec<RowId> {
        self.row_axis
            .identities_in(self.sheet_id, 0, self.row_axis.len())
            .collect()
    }

    /// Return the dense `col_index → ColId` slice for legacy explicit axes.
    #[inline]
    #[must_use]
    pub fn col_ids_dense(&self) -> &[ColId] {
        match &self.col_axis {
            AxisIdentityStore::Explicit(ids) => ids,
            AxisIdentityStore::Runs(_) => &[],
        }
    }

    /// Collect all column identities in current positional order.
    ///
    /// This is the compatibility bridge for consumers that still own dense
    /// mirror indexes. Unlike [`Self::col_ids_dense`], it is correct for
    /// compact axes because it resolves identities through the axis store.
    #[must_use]
    pub fn col_ids_ordered(&self) -> Vec<ColId> {
        self.col_axis
            .identities_in(self.sheet_id, 0, self.col_axis.len())
            .collect()
    }

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

fn ensure_allocator_past_axis_store<Id>(
    id_alloc: &IdAllocator,
    sheet_id: SheetId,
    store: &AxisIdentityStore<Id>,
) where
    Id: AxisIdentityId,
{
    let AxisIdentityStore::Explicit(_) = store else {
        return;
    };
    for id in store.identities_in(sheet_id, 0, store.len()) {
        id_alloc.ensure_past(id.as_raw());
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

#[cfg(test)]
mod tests {
    use super::*;
    use cell_types::{AxisIdentityRun, AxisIdentitySeed, AxisRunId};
    use std::collections::HashSet;
    use std::sync::Arc;

    fn make_grid(rows: u32, cols: u32) -> GridIndex {
        let alloc = Arc::new(IdAllocator::new());
        GridIndex::new(SheetId::from_raw(1), rows, cols, alloc)
    }

    /// Assert the bidirectional mapping invariant holds for all rows, cols, and cells.
    fn assert_invariants(grid: &GridIndex) {
        // Row invariant: row_id(i) == Some(rid) iff row_index(rid) == Some(i)
        for i in 0..grid.row_count() {
            let rid = grid.row_id(i).expect("row_id should exist for valid index");
            assert_eq!(
                grid.row_index(&rid),
                Some(i),
                "row_index(row_id({i})) should be {i}"
            );
        }
        // Col invariant
        for i in 0..grid.col_count() {
            let cid = grid.col_id(i).expect("col_id should exist for valid index");
            assert_eq!(
                grid.col_index(&cid),
                Some(i),
                "col_index(col_id({i})) should be {i}"
            );
        }
        // Cell invariant: forward and reverse maps consistent and same size
        let mut cell_count_forward = 0u32;
        for (cell_id, row, col) in grid.cells() {
            cell_count_forward += 1;
            assert_eq!(
                grid.cell_id_at(row, col),
                Some(cell_id),
                "cell_id_at({row},{col}) should match cells() entry"
            );
            assert_eq!(
                grid.cell_position(&cell_id),
                Some((row, col)),
                "cell_position should match cells() entry"
            );
        }
        assert_eq!(cell_count_forward, grid.cell_count());
    }

    // -----------------------------------------------------------------------
    // 1. Construction
    // -----------------------------------------------------------------------

    #[test]
    fn new_grid_has_correct_dimensions() {
        let grid = make_grid(5, 3);
        assert_eq!(grid.row_count(), 5);
        assert_eq!(grid.col_count(), 3);
        assert_eq!(grid.cell_count(), 0);
    }

    #[test]
    fn new_grid_zero_dimensions() {
        let grid = make_grid(0, 0);
        assert_eq!(grid.row_count(), 0);
        assert_eq!(grid.col_count(), 0);
        assert_eq!(grid.cell_count(), 0);
    }

    #[test]
    fn new_grid_all_row_col_ids_unique() {
        let grid = make_grid(10, 8);
        let row_ids: Vec<RowId> = (0..10).map(|i| grid.row_id(i).unwrap()).collect();
        let col_ids: Vec<ColId> = (0..8).map(|i| grid.col_id(i).unwrap()).collect();

        let unique_rows: HashSet<u128> = row_ids.iter().map(|r| r.as_u128()).collect();
        assert_eq!(unique_rows.len(), 10, "all RowIds should be unique");

        let unique_cols: HashSet<u128> = col_ids.iter().map(|c| c.as_u128()).collect();
        assert_eq!(unique_cols.len(), 8, "all ColIds should be unique");
    }

    #[test]
    fn new_grid_bidirectional_invariant() {
        let grid = make_grid(4, 6);
        assert_invariants(&grid);
    }

    #[test]
    fn compact_axis_grid_resolves_position_and_id_without_dense_maps() {
        let sheet_id = SheetId::from_raw(0x500);
        let row_run = AxisIdentityRun::new(
            AxisRunId::from_raw(7),
            AxisIdentitySeed::from_raw(0x71),
            10,
            4,
        );
        let col_run = AxisIdentityRun::new(
            AxisRunId::from_raw(8),
            AxisIdentitySeed::from_raw(0x82),
            20,
            3,
        );
        let grid = GridIndex::from_axis_stores(
            sheet_id,
            AxisIdentityStore::<RowId>::from_runs([row_run]),
            AxisIdentityStore::<ColId>::from_runs([col_run]),
            Arc::new(IdAllocator::new()),
        );

        assert_eq!(grid.row_ids_dense(), &[]);
        assert_eq!(grid.col_ids_dense(), &[]);
        assert_eq!(
            grid.row_ids_ordered(),
            (0..4)
                .map(|position| grid.row_id(position).unwrap())
                .collect::<Vec<_>>()
        );
        assert_eq!(
            grid.col_ids_ordered(),
            (0..3)
                .map(|position| grid.col_id(position).unwrap())
                .collect::<Vec<_>>()
        );
        assert_eq!(grid.row_count(), 4);
        assert_eq!(grid.col_count(), 3);

        let row = grid.row_id(2).expect("compact row id at position");
        let col = grid.col_id(1).expect("compact col id at position");
        assert!(row.is_compact_axis_identity());
        assert!(col.is_compact_axis_identity());
        assert_eq!(grid.row_index(&row), Some(2));
        assert_eq!(grid.col_index(&col), Some(1));
        assert_eq!(
            grid.row_index_from_hex(&crate::hex::id_to_hex(row.as_u128())),
            Some(2)
        );
        assert_eq!(
            grid.col_index_from_hex(&crate::hex::id_to_hex(col.as_u128())),
            Some(1)
        );
    }

    #[test]
    fn legacy_yrs_arrays_hydrate_dense_axis_behavior() {
        let row_ids = [RowId::from_raw(0x101), RowId::from_raw(0x102)];
        let col_ids = [
            ColId::from_raw(0x201),
            ColId::from_raw(0x202),
            ColId::from_raw(0x203),
        ];
        let row_hexes: Vec<String> = row_ids
            .iter()
            .map(|id| crate::hex::id_to_hex(id.as_u128()).to_string())
            .collect();
        let col_hexes: Vec<String> = col_ids
            .iter()
            .map(|id| crate::hex::id_to_hex(id.as_u128()).to_string())
            .collect();

        let grid = GridIndex::from_yrs_arrays(
            SheetId::from_raw(0x600),
            &row_hexes,
            &col_hexes,
            Arc::new(IdAllocator::new()),
        );

        assert_eq!(grid.row_ids_dense(), row_ids);
        assert_eq!(grid.col_ids_dense(), col_ids);
        assert_eq!(grid.row_id(1), Some(row_ids[1]));
        assert_eq!(grid.col_id(2), Some(col_ids[2]));
        assert_eq!(grid.row_index(&row_ids[0]), Some(0));
        assert_eq!(grid.col_index(&col_ids[1]), Some(1));
        assert_eq!(grid.row_index_from_hex(&row_hexes[1]), Some(1));
        assert_eq!(grid.col_index_from_hex(&col_hexes[2]), Some(2));
    }

    #[test]
    fn row_id_out_of_bounds_returns_none() {
        let grid = make_grid(3, 3);
        assert_eq!(grid.row_id(3), None);
        assert_eq!(grid.col_id(3), None);
    }

    // -----------------------------------------------------------------------
    // 2. Cell lifecycle
    // -----------------------------------------------------------------------

    #[test]
    fn cell_id_at_unmaterialized_returns_none() {
        let grid = make_grid(3, 3);
        assert_eq!(grid.cell_id_at(0, 0), None);
        assert_eq!(grid.cell_id_at(2, 2), None);
    }

    #[test]
    fn ensure_cell_id_creates_and_returns_same() {
        let mut grid = make_grid(3, 3);
        let id1 = grid.ensure_cell_id(1, 1);
        let id2 = grid.ensure_cell_id(1, 1);
        assert_eq!(
            id1, id2,
            "ensure_cell_id should return same ID on repeat call"
        );
        assert_eq!(grid.cell_count(), 1);
    }

    #[test]
    fn ensure_cell_id_bidirectional() {
        let mut grid = make_grid(3, 3);
        let id = grid.ensure_cell_id(1, 2);
        assert_eq!(grid.cell_id_at(1, 2), Some(id));
        assert_eq!(grid.cell_position(&id), Some((1, 2)));
        assert_invariants(&grid);
    }

    #[test]
    fn remove_cell_cleans_both_maps() {
        let mut grid = make_grid(3, 3);
        let id = grid.ensure_cell_id(1, 1);
        grid.remove_cell(&id);
        assert_eq!(grid.cell_id_at(1, 1), None);
        assert_eq!(grid.cell_position(&id), None);
        assert_eq!(grid.cell_count(), 0);
        assert_invariants(&grid);
    }

    #[test]
    fn remove_nonexistent_cell_is_noop() {
        let mut grid = make_grid(3, 3);
        let alloc = Arc::new(IdAllocator::with_seed(9999));
        let fake_id = alloc.next_cell_id();
        grid.remove_cell(&fake_id); // should not panic
        assert_eq!(grid.cell_count(), 0);
    }

    #[test]
    fn multiple_cells_independent() {
        let mut grid = make_grid(3, 3);
        let a = grid.ensure_cell_id(0, 0);
        let b = grid.ensure_cell_id(2, 2);
        assert_ne!(a, b);
        assert_eq!(grid.cell_count(), 2);
        grid.remove_cell(&a);
        assert_eq!(grid.cell_count(), 1);
        assert_eq!(grid.cell_id_at(2, 2), Some(b));
        assert_invariants(&grid);
    }

    // -----------------------------------------------------------------------
    // 3. Register cell
    // -----------------------------------------------------------------------

    #[test]
    fn register_cell_basic() {
        let mut grid = make_grid(3, 3);
        let alloc = Arc::new(IdAllocator::with_seed(5000));
        let ext_id = alloc.next_cell_id();
        grid.register_cell(ext_id, 1, 1);
        assert_eq!(grid.cell_id_at(1, 1), Some(ext_id));
        assert_eq!(grid.cell_position(&ext_id), Some((1, 1)));
        assert_invariants(&grid);
    }

    #[test]
    fn register_cell_replaces_old_cell_at_same_position() {
        let mut grid = make_grid(3, 3);
        let old_id = grid.ensure_cell_id(1, 1);
        let alloc = Arc::new(IdAllocator::with_seed(5000));
        let new_id = alloc.next_cell_id();
        grid.register_cell(new_id, 1, 1);

        assert_eq!(grid.cell_id_at(1, 1), Some(new_id));
        assert_eq!(grid.cell_position(&new_id), Some((1, 1)));
        // Old cell should be cleaned up from reverse map
        assert_eq!(grid.cell_position(&old_id), None);
        assert_eq!(grid.cell_count(), 1);
        assert_invariants(&grid);
    }

    #[test]
    fn register_cell_moves_existing_cell_to_new_position() {
        let mut grid = make_grid(3, 3);
        let id = grid.ensure_cell_id(0, 0);
        grid.register_cell(id, 2, 2);

        assert_eq!(grid.cell_position(&id), Some((2, 2)));
        assert_eq!(grid.cell_id_at(2, 2), Some(id));
        // Old position should be cleaned up
        assert_eq!(grid.cell_id_at(0, 0), None);
        assert_eq!(grid.cell_count(), 1);
        assert_invariants(&grid);
    }

    #[test]
    fn register_cell_same_position_is_noop() {
        let mut grid = make_grid(3, 3);
        let id = grid.ensure_cell_id(1, 1);
        grid.register_cell(id, 1, 1);
        assert_eq!(grid.cell_id_at(1, 1), Some(id));
        assert_eq!(grid.cell_count(), 1);
        assert_invariants(&grid);
    }

    // -----------------------------------------------------------------------
    // 4. Insert rows
    // -----------------------------------------------------------------------

    #[test]
    fn insert_rows_increases_row_count() {
        let mut grid = make_grid(3, 3);
        let new_ids = grid.insert_rows(1, 2);
        assert_eq!(grid.row_count(), 5);
        assert_eq!(new_ids.len(), 2);
        assert_invariants(&grid);
    }

    #[test]
    fn insert_rows_new_ids_are_unique() {
        let mut grid = make_grid(3, 3);
        let original_ids: Vec<RowId> = (0..3).map(|i| grid.row_id(i).unwrap()).collect();
        let new_ids = grid.insert_rows(1, 2);

        let all_ids: HashSet<u128> = original_ids
            .iter()
            .chain(new_ids.iter())
            .map(|r| r.as_u128())
            .collect();
        assert_eq!(all_ids.len(), 5);
    }

    #[test]
    fn insert_rows_shifts_cells_down() {
        let mut grid = make_grid(4, 3);
        let cell_a = grid.ensure_cell_id(0, 0); // above insertion - should stay
        let cell_b = grid.ensure_cell_id(2, 1); // at insertion point - should shift
        let cell_c = grid.ensure_cell_id(3, 2); // below insertion - should shift

        grid.insert_rows(2, 2); // insert 2 rows at index 2

        // cell_a at row 0 should be unchanged
        assert_eq!(grid.cell_position(&cell_a), Some((0, 0)));
        // cell_b was at row 2, should now be at row 4
        assert_eq!(grid.cell_position(&cell_b), Some((4, 1)));
        // cell_c was at row 3, should now be at row 5
        assert_eq!(grid.cell_position(&cell_c), Some((5, 2)));
        assert_invariants(&grid);
    }

    #[test]
    fn insert_rows_preserves_cell_ids() {
        let mut grid = make_grid(3, 3);
        let id = grid.ensure_cell_id(1, 1);
        grid.insert_rows(0, 5);
        // The cell ID should be the same, just at a new position
        assert_eq!(grid.cell_position(&id), Some((6, 1)));
        assert_eq!(grid.cell_id_at(6, 1), Some(id));
        assert_invariants(&grid);
    }

    #[test]
    fn insert_rows_existing_row_ids_shift() {
        let mut grid = make_grid(3, 3);
        let rid0 = grid.row_id(0).unwrap();
        let rid1 = grid.row_id(1).unwrap();
        let rid2 = grid.row_id(2).unwrap();

        grid.insert_rows(1, 2); // insert 2 rows at index 1

        // Row 0 stays at 0
        assert_eq!(grid.row_index(&rid0), Some(0));
        // Row 1 shifts to 3
        assert_eq!(grid.row_index(&rid1), Some(3));
        // Row 2 shifts to 4
        assert_eq!(grid.row_index(&rid2), Some(4));
        assert_invariants(&grid);
    }

    // -----------------------------------------------------------------------
    // 5. Delete rows
    // -----------------------------------------------------------------------

    #[test]
    fn delete_rows_decreases_row_count() {
        let mut grid = make_grid(5, 3);
        grid.delete_rows(1, 2);
        assert_eq!(grid.row_count(), 3);
        assert_invariants(&grid);
    }

    #[test]
    fn delete_rows_returns_deleted_cell_ids() {
        let mut grid = make_grid(5, 3);
        let c1 = grid.ensure_cell_id(1, 0);
        let c2 = grid.ensure_cell_id(2, 1);
        grid.ensure_cell_id(3, 2); // should not be deleted

        let deleted = grid.delete_rows(1, 2);
        let deleted_set: HashSet<CellId> = deleted.into_iter().collect();
        assert!(deleted_set.contains(&c1));
        assert!(deleted_set.contains(&c2));
        assert_eq!(deleted_set.len(), 2);
    }

    #[test]
    fn delete_rows_shifts_remaining_up() {
        let mut grid = make_grid(5, 3);
        let cell_above = grid.ensure_cell_id(0, 0);
        let cell_below = grid.ensure_cell_id(4, 2);

        grid.delete_rows(1, 3); // delete rows 1, 2, 3

        assert_eq!(grid.cell_position(&cell_above), Some((0, 0)));
        // row 4 shifts up by 3 to row 1
        assert_eq!(grid.cell_position(&cell_below), Some((1, 2)));
        assert_eq!(grid.row_count(), 2);
        assert_invariants(&grid);
    }

    #[test]
    fn delete_rows_removes_deleted_row_ids() {
        let mut grid = make_grid(4, 2);
        let rid1 = grid.row_id(1).unwrap();
        let rid2 = grid.row_id(2).unwrap();

        grid.delete_rows(1, 2);

        assert_eq!(grid.row_index(&rid1), None);
        assert_eq!(grid.row_index(&rid2), None);
        assert_invariants(&grid);
    }

    // -----------------------------------------------------------------------
    // 6. Insert cols
    // -----------------------------------------------------------------------

    #[test]
    fn insert_cols_increases_col_count() {
        let mut grid = make_grid(3, 3);
        let new_ids = grid.insert_cols(1, 2);
        assert_eq!(grid.col_count(), 5);
        assert_eq!(new_ids.len(), 2);
        assert_invariants(&grid);
    }

    #[test]
    fn insert_cols_shifts_cells_right() {
        let mut grid = make_grid(3, 4);
        let cell_left = grid.ensure_cell_id(0, 0);
        let cell_at = grid.ensure_cell_id(1, 2);
        let cell_right = grid.ensure_cell_id(2, 3);

        grid.insert_cols(2, 3);

        assert_eq!(grid.cell_position(&cell_left), Some((0, 0)));
        assert_eq!(grid.cell_position(&cell_at), Some((1, 5)));
        assert_eq!(grid.cell_position(&cell_right), Some((2, 6)));
        assert_invariants(&grid);
    }

    #[test]
    fn insert_cols_existing_col_ids_shift() {
        let mut grid = make_grid(2, 3);
        let cid0 = grid.col_id(0).unwrap();
        let cid1 = grid.col_id(1).unwrap();
        let cid2 = grid.col_id(2).unwrap();

        grid.insert_cols(1, 2);

        assert_eq!(grid.col_index(&cid0), Some(0));
        assert_eq!(grid.col_index(&cid1), Some(3));
        assert_eq!(grid.col_index(&cid2), Some(4));
        assert_invariants(&grid);
    }

    // -----------------------------------------------------------------------
    // 7. Delete cols
    // -----------------------------------------------------------------------

    #[test]
    fn delete_cols_decreases_col_count() {
        let mut grid = make_grid(3, 5);
        grid.delete_cols(1, 2);
        assert_eq!(grid.col_count(), 3);
        assert_invariants(&grid);
    }

    #[test]
    fn delete_cols_returns_deleted_cell_ids() {
        let mut grid = make_grid(3, 5);
        let c1 = grid.ensure_cell_id(0, 1);
        let c2 = grid.ensure_cell_id(1, 2);
        grid.ensure_cell_id(2, 3); // not deleted

        let deleted = grid.delete_cols(1, 2);
        let deleted_set: HashSet<CellId> = deleted.into_iter().collect();
        assert!(deleted_set.contains(&c1));
        assert!(deleted_set.contains(&c2));
        assert_eq!(deleted_set.len(), 2);
    }

    #[test]
    fn delete_cols_shifts_remaining_left() {
        let mut grid = make_grid(3, 5);
        let cell_left = grid.ensure_cell_id(0, 0);
        let cell_right = grid.ensure_cell_id(1, 4);

        grid.delete_cols(1, 3);

        assert_eq!(grid.cell_position(&cell_left), Some((0, 0)));
        assert_eq!(grid.cell_position(&cell_right), Some((1, 1)));
        assert_eq!(grid.col_count(), 2);
        assert_invariants(&grid);
    }

    // -----------------------------------------------------------------------
    // 8. Insert at boundary
    // -----------------------------------------------------------------------

    #[test]
    fn insert_rows_at_zero() {
        let mut grid = make_grid(3, 2);
        let rid_original_0 = grid.row_id(0).unwrap();
        let cell = grid.ensure_cell_id(0, 0);

        grid.insert_rows(0, 2);

        assert_eq!(grid.row_count(), 5);
        assert_eq!(grid.row_index(&rid_original_0), Some(2));
        assert_eq!(grid.cell_position(&cell), Some((2, 0)));
        assert_invariants(&grid);
    }

    #[test]
    fn insert_rows_at_end() {
        let mut grid = make_grid(3, 2);
        let cell = grid.ensure_cell_id(2, 1);

        grid.insert_rows(3, 2);

        assert_eq!(grid.row_count(), 5);
        // Cell at row 2 should not move
        assert_eq!(grid.cell_position(&cell), Some((2, 1)));
        assert_invariants(&grid);
    }

    #[test]
    fn insert_rows_beyond_bounds_clamps() {
        let mut grid = make_grid(3, 2);
        // at=100 should clamp to row_count()=3 (i.e., insert at end)
        grid.insert_rows(100, 2);
        assert_eq!(grid.row_count(), 5);
        assert_invariants(&grid);
    }

    #[test]
    fn insert_cols_at_zero() {
        let mut grid = make_grid(2, 3);
        let cid0 = grid.col_id(0).unwrap();
        let cell = grid.ensure_cell_id(0, 0);

        grid.insert_cols(0, 2);

        assert_eq!(grid.col_count(), 5);
        assert_eq!(grid.col_index(&cid0), Some(2));
        assert_eq!(grid.cell_position(&cell), Some((0, 2)));
        assert_invariants(&grid);
    }

    #[test]
    fn insert_cols_beyond_bounds_clamps() {
        let mut grid = make_grid(2, 3);
        grid.insert_cols(100, 2);
        assert_eq!(grid.col_count(), 5);
        assert_invariants(&grid);
    }

    // -----------------------------------------------------------------------
    // 9. Delete at boundary
    // -----------------------------------------------------------------------

    #[test]
    fn delete_rows_at_zero() {
        let mut grid = make_grid(5, 2);
        let cell = grid.ensure_cell_id(3, 0);

        grid.delete_rows(0, 2);

        assert_eq!(grid.row_count(), 3);
        assert_eq!(grid.cell_position(&cell), Some((1, 0)));
        assert_invariants(&grid);
    }

    #[test]
    fn delete_rows_clamps_count() {
        let mut grid = make_grid(3, 2);
        grid.ensure_cell_id(0, 0);
        grid.ensure_cell_id(1, 0);
        grid.ensure_cell_id(2, 0);

        // Requesting to delete 10 rows starting at 1 should clamp to 2
        let deleted = grid.delete_rows(1, 10);
        assert_eq!(grid.row_count(), 1);
        assert_eq!(deleted.len(), 2); // cells at rows 1 and 2
        assert_invariants(&grid);
    }

    #[test]
    fn delete_all_rows() {
        let mut grid = make_grid(3, 2);
        grid.ensure_cell_id(0, 0);
        grid.ensure_cell_id(1, 1);
        grid.ensure_cell_id(2, 0);

        let deleted = grid.delete_rows(0, 3);
        assert_eq!(grid.row_count(), 0);
        assert_eq!(deleted.len(), 3);
        assert_eq!(grid.cell_count(), 0);
        assert_invariants(&grid);
    }

    #[test]
    fn delete_cols_clamps_count() {
        let mut grid = make_grid(2, 3);
        grid.ensure_cell_id(0, 1);
        grid.ensure_cell_id(0, 2);

        let deleted = grid.delete_cols(1, 100);
        assert_eq!(grid.col_count(), 1);
        assert_eq!(deleted.len(), 2);
        assert_invariants(&grid);
    }

    // -----------------------------------------------------------------------
    // 10. Sort rows
    // -----------------------------------------------------------------------

    #[test]
    fn sort_rows_simple_swap() {
        let mut grid = make_grid(3, 2);
        let rid0 = grid.row_id(0).unwrap();
        let rid2 = grid.row_id(2).unwrap();
        let cell_a = grid.ensure_cell_id(0, 0);
        let cell_b = grid.ensure_cell_id(2, 1);

        grid.sort_rows(&[(0, 2), (2, 0)]);

        // RowIds should remain unchanged (Yrs rowOrder is authoritative)
        assert_eq!(grid.row_id(0), Some(rid0));
        assert_eq!(grid.row_id(2), Some(rid2));
        // Cell positions should follow the permutation
        assert_eq!(grid.cell_position(&cell_a), Some((2, 0)));
        assert_eq!(grid.cell_position(&cell_b), Some((0, 1)));
        assert_invariants(&grid);
    }

    #[test]
    fn sort_rows_identity_permutation() {
        let mut grid = make_grid(3, 2);
        let rid0 = grid.row_id(0).unwrap();
        let rid1 = grid.row_id(1).unwrap();
        let rid2 = grid.row_id(2).unwrap();
        let cell = grid.ensure_cell_id(1, 0);

        grid.sort_rows(&[(0, 0), (1, 1), (2, 2)]);

        assert_eq!(grid.row_id(0), Some(rid0));
        assert_eq!(grid.row_id(1), Some(rid1));
        assert_eq!(grid.row_id(2), Some(rid2));
        assert_eq!(grid.cell_position(&cell), Some((1, 0)));
        assert_invariants(&grid);
    }

    #[test]
    fn sort_rows_three_way_rotation() {
        let mut grid = make_grid(4, 2);
        let rid0 = grid.row_id(0).unwrap();
        let rid1 = grid.row_id(1).unwrap();
        let rid2 = grid.row_id(2).unwrap();
        let rid3 = grid.row_id(3).unwrap();
        let c0 = grid.ensure_cell_id(0, 0);
        let c1 = grid.ensure_cell_id(1, 0);
        let c2 = grid.ensure_cell_id(2, 0);

        // Rotate rows 0->1, 1->2, 2->0. Row 3 is not in the permutation.
        grid.sort_rows(&[(0, 1), (1, 2), (2, 0)]);

        // RowIds should remain unchanged (Yrs rowOrder is authoritative)
        assert_eq!(grid.row_id(0), Some(rid0));
        assert_eq!(grid.row_id(1), Some(rid1));
        assert_eq!(grid.row_id(2), Some(rid2));
        assert_eq!(grid.row_id(3), Some(rid3)); // untouched

        assert_eq!(grid.cell_position(&c0), Some((1, 0)));
        assert_eq!(grid.cell_position(&c1), Some((2, 0)));
        assert_eq!(grid.cell_position(&c2), Some((0, 0)));
        assert_invariants(&grid);
    }

    #[test]
    fn sort_rows_empty_permutation_is_noop() {
        let mut grid = make_grid(3, 2);
        let rid0 = grid.row_id(0).unwrap();
        grid.sort_rows(&[]);
        assert_eq!(grid.row_id(0), Some(rid0));
        assert_invariants(&grid);
    }

    // -----------------------------------------------------------------------
    // 11. Auto-expansion
    // -----------------------------------------------------------------------

    #[test]
    fn ensure_cell_id_beyond_bounds_grows_grid() {
        let mut grid = make_grid(2, 2);
        let id = grid.ensure_cell_id(5, 7);

        assert!(grid.row_count() >= 6);
        assert!(grid.col_count() >= 8);
        assert_eq!(grid.cell_position(&id), Some((5, 7)));
        assert_invariants(&grid);
    }

    #[test]
    fn register_cell_beyond_bounds_grows_grid() {
        let mut grid = make_grid(1, 1);
        let alloc = Arc::new(IdAllocator::with_seed(9000));
        let ext_id = alloc.next_cell_id();
        grid.register_cell(ext_id, 10, 20);

        assert!(grid.row_count() >= 11);
        assert!(grid.col_count() >= 21);
        assert_eq!(grid.cell_id_at(10, 20), Some(ext_id));
        assert_invariants(&grid);
    }

    #[test]
    fn auto_expansion_fills_intermediate_row_col_ids() {
        let mut grid = make_grid(1, 1);
        grid.ensure_cell_id(3, 4);

        // All intermediate indices should have valid IDs
        for r in 0..grid.row_count() {
            assert!(grid.row_id(r).is_some());
        }
        for c in 0..grid.col_count() {
            assert!(grid.col_id(c).is_some());
        }
        assert_invariants(&grid);
    }

    // -----------------------------------------------------------------------
    // 12. Query methods
    // -----------------------------------------------------------------------

    #[test]
    fn cells_in_range_inclusive_bounds() {
        let mut grid = make_grid(5, 5);
        let c00 = grid.ensure_cell_id(0, 0);
        let c11 = grid.ensure_cell_id(1, 1);
        let c22 = grid.ensure_cell_id(2, 2);
        let _c33 = grid.ensure_cell_id(3, 3);

        let result: HashSet<CellId> = grid
            .cells_in_range(0, 0, 2, 2)
            .map(|(id, _, _)| id)
            .collect();
        assert!(result.contains(&c00));
        assert!(result.contains(&c11));
        assert!(result.contains(&c22));
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn cells_in_range_single_cell() {
        let mut grid = make_grid(5, 5);
        let c = grid.ensure_cell_id(2, 3);

        let result: Vec<_> = grid.cells_in_range(2, 3, 2, 3).collect();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].0, c);
    }

    #[test]
    fn cells_in_range_empty_when_no_cells() {
        let grid = make_grid(5, 5);
        let result: Vec<_> = grid.cells_in_range(0, 0, 4, 4).collect();
        assert!(result.is_empty());
    }

    #[test]
    fn cells_at_or_after_row() {
        let mut grid = make_grid(5, 3);
        let _c0 = grid.ensure_cell_id(0, 0);
        let c2 = grid.ensure_cell_id(2, 1);
        let c4 = grid.ensure_cell_id(4, 2);

        let result: HashSet<CellId> = grid
            .cells_at_or_after_row(2)
            .into_iter()
            .map(|(id, _, _)| id)
            .collect();
        assert!(result.contains(&c2));
        assert!(result.contains(&c4));
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn cells_at_or_after_col() {
        let mut grid = make_grid(3, 5);
        let _c0 = grid.ensure_cell_id(0, 0);
        let c3 = grid.ensure_cell_id(1, 3);
        let c4 = grid.ensure_cell_id(2, 4);

        let result: HashSet<CellId> = grid
            .cells_at_or_after_col(3)
            .into_iter()
            .map(|(id, _, _)| id)
            .collect();
        assert!(result.contains(&c3));
        assert!(result.contains(&c4));
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn cells_in_row_range_exclusive_end() {
        let mut grid = make_grid(5, 3);
        let c1 = grid.ensure_cell_id(1, 0);
        let c2 = grid.ensure_cell_id(2, 0);
        let _c3 = grid.ensure_cell_id(3, 0); // should NOT be included

        // [1, 1+2) = [1, 3)
        let result: HashSet<CellId> = grid
            .cells_in_row_range(1, 2)
            .into_iter()
            .map(|(id, _, _)| id)
            .collect();
        assert!(result.contains(&c1));
        assert!(result.contains(&c2));
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn cells_in_col_range_exclusive_end() {
        let mut grid = make_grid(3, 5);
        let c1 = grid.ensure_cell_id(0, 1);
        let c2 = grid.ensure_cell_id(0, 2);
        let _c3 = grid.ensure_cell_id(0, 3); // should NOT be included

        let result: HashSet<CellId> = grid
            .cells_in_col_range(1, 2)
            .into_iter()
            .map(|(id, _, _)| id)
            .collect();
        assert!(result.contains(&c1));
        assert!(result.contains(&c2));
        assert_eq!(result.len(), 2);
    }

    // -----------------------------------------------------------------------
    // 13. Bidirectional invariant after mutations
    // -----------------------------------------------------------------------

    #[test]
    fn invariant_after_mixed_mutations() {
        let mut grid = make_grid(5, 5);
        grid.ensure_cell_id(0, 0);
        grid.ensure_cell_id(1, 1);
        grid.ensure_cell_id(2, 2);
        grid.ensure_cell_id(3, 3);
        grid.ensure_cell_id(4, 4);
        assert_invariants(&grid);

        grid.insert_rows(2, 3);
        assert_invariants(&grid);

        grid.delete_rows(0, 2);
        assert_invariants(&grid);

        grid.insert_cols(1, 2);
        assert_invariants(&grid);

        grid.delete_cols(3, 1);
        assert_invariants(&grid);

        grid.sort_rows(&[(0, 1), (1, 0)]);
        assert_invariants(&grid);
    }

    // -----------------------------------------------------------------------
    // 14. Combined operations
    // -----------------------------------------------------------------------

    #[test]
    fn insert_then_delete_restores_row_count() {
        let mut grid = make_grid(5, 3);
        grid.insert_rows(2, 3);
        assert_eq!(grid.row_count(), 8);
        grid.delete_rows(2, 3);
        assert_eq!(grid.row_count(), 5);
        assert_invariants(&grid);
    }

    #[test]
    fn delete_then_insert_at_same_spot() {
        let mut grid = make_grid(5, 3);
        let cell = grid.ensure_cell_id(4, 2);

        grid.delete_rows(1, 2); // removes rows 1,2 -> row count 3, cell shifts to row 2
        assert_eq!(grid.cell_position(&cell), Some((2, 2)));

        grid.insert_rows(1, 2); // re-insert 2 rows -> row count 5, cell shifts to row 4
        assert_eq!(grid.cell_position(&cell), Some((4, 2)));
        assert_eq!(grid.row_count(), 5);
        assert_invariants(&grid);
    }

    #[test]
    fn multiple_sequential_inserts() {
        let mut grid = make_grid(2, 2);
        let cell = grid.ensure_cell_id(0, 0);

        grid.insert_rows(0, 1); // cell moves to row 1
        grid.insert_rows(0, 1); // cell moves to row 2
        grid.insert_rows(0, 1); // cell moves to row 3

        assert_eq!(grid.cell_position(&cell), Some((3, 0)));
        assert_eq!(grid.row_count(), 5);
        assert_invariants(&grid);
    }

    #[test]
    fn insert_cols_then_delete_cols() {
        let mut grid = make_grid(3, 3);
        let cell = grid.ensure_cell_id(1, 2);

        grid.insert_cols(0, 2); // cell shifts right to col 4
        assert_eq!(grid.cell_position(&cell), Some((1, 4)));

        grid.delete_cols(0, 2); // cell shifts left back to col 2
        assert_eq!(grid.cell_position(&cell), Some((1, 2)));
        assert_eq!(grid.col_count(), 3);
        assert_invariants(&grid);
    }

    #[test]
    fn delete_row_with_multiple_cells_in_same_row() {
        let mut grid = make_grid(3, 5);
        let c0 = grid.ensure_cell_id(1, 0);
        let c1 = grid.ensure_cell_id(1, 1);
        let c2 = grid.ensure_cell_id(1, 2);

        let deleted = grid.delete_rows(1, 1);
        let deleted_set: HashSet<CellId> = deleted.into_iter().collect();
        assert!(deleted_set.contains(&c0));
        assert!(deleted_set.contains(&c1));
        assert!(deleted_set.contains(&c2));
        assert_eq!(grid.cell_count(), 0);
        assert_invariants(&grid);
    }

    #[test]
    fn sort_rows_with_cells_in_multiple_cols() {
        let mut grid = make_grid(3, 3);
        let c00 = grid.ensure_cell_id(0, 0);
        let c01 = grid.ensure_cell_id(0, 1);
        let c10 = grid.ensure_cell_id(1, 0);
        let c11 = grid.ensure_cell_id(1, 1);

        grid.sort_rows(&[(0, 1), (1, 0)]);

        // Row 0 cells -> row 1, row 1 cells -> row 0
        assert_eq!(grid.cell_position(&c00), Some((1, 0)));
        assert_eq!(grid.cell_position(&c01), Some((1, 1)));
        assert_eq!(grid.cell_position(&c10), Some((0, 0)));
        assert_eq!(grid.cell_position(&c11), Some((0, 1)));
        assert_invariants(&grid);
    }

    #[test]
    fn reorder_row_ids_simple_swap() {
        let mut grid = make_grid(3, 1);
        let r0 = grid.row_id(0).unwrap();
        let r2 = grid.row_id(2).unwrap();

        grid.reorder_row_ids(&[(0, 2), (2, 0)]);

        assert_eq!(grid.row_id(0), Some(r2));
        assert_eq!(grid.row_id(2), Some(r0));
        assert_eq!(grid.row_index(&r0), Some(2));
        assert_eq!(grid.row_index(&r2), Some(0));
    }

    #[test]
    fn reorder_row_ids_three_way_rotation() {
        let mut grid = make_grid(4, 1);
        let r0 = grid.row_id(0).unwrap();
        let r1 = grid.row_id(1).unwrap();
        let r2 = grid.row_id(2).unwrap();
        let r3 = grid.row_id(3).unwrap();

        grid.reorder_row_ids(&[(0, 1), (1, 2), (2, 0)]);

        assert_eq!(grid.row_id(0), Some(r2));
        assert_eq!(grid.row_id(1), Some(r0));
        assert_eq!(grid.row_id(2), Some(r1));
        assert_eq!(grid.row_id(3), Some(r3));
    }

    #[test]
    fn reorder_row_ids_empty_is_noop() {
        let mut grid = make_grid(3, 1);
        let r0 = grid.row_id(0).unwrap();
        let r1 = grid.row_id(1).unwrap();
        let r2 = grid.row_id(2).unwrap();

        grid.reorder_row_ids(&[]);

        assert_eq!(grid.row_id(0), Some(r0));
        assert_eq!(grid.row_id(1), Some(r1));
        assert_eq!(grid.row_id(2), Some(r2));
    }

    #[test]
    fn insert_rows_between_cells_preserves_relative_order() {
        let mut grid = make_grid(4, 1);
        let c0 = grid.ensure_cell_id(0, 0);
        let c1 = grid.ensure_cell_id(1, 0);
        let c2 = grid.ensure_cell_id(2, 0);
        let c3 = grid.ensure_cell_id(3, 0);

        grid.insert_rows(2, 5);

        // Cells before insertion point unchanged
        assert_eq!(grid.cell_position(&c0), Some((0, 0)));
        assert_eq!(grid.cell_position(&c1), Some((1, 0)));
        // Cells at or after insertion point shifted down by 5
        assert_eq!(grid.cell_position(&c2), Some((7, 0)));
        assert_eq!(grid.cell_position(&c3), Some((8, 0)));
        assert_invariants(&grid);
    }
}
