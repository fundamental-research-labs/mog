use cell_types::{CellId, IdAllocator, SheetId, SheetPos};
use value_types::CellValue;

use crate::mirror::cell_mirror::CellMirror;
use crate::mirror::types::CellEntry;

impl CellMirror {
    /// Get or create a CellId at the given position.
    ///
    /// If a cell already exists at the position, its CellId is returned.
    /// Otherwise, a new unique CellId is created via the allocator and registered.
    ///
    /// For positions within an active projection, the CellId is registered in
    /// the identity maps (`pos_to_id`, `id_to_pos`, `cells`, `cell_to_sheet`)
    /// but `col_data` is NOT touched - the projected value written by
    /// `materialize_projection()` must be preserved. Ghost cells should never
    /// overwrite projected spill values.
    pub fn ensure_cell_id(
        &mut self,
        sheet_id: &SheetId,
        pos: SheetPos,
        id_alloc: &IdAllocator,
    ) -> Option<CellId> {
        // If already exists, return it
        if let Some(id) = self.resolve_cell_id(sheet_id, pos) {
            return Some(id);
        }
        // Create a unique CellId via the monotonic allocator. Must NOT be
        // position-derived because position-based hashes would collide after
        // structure changes: a cell created at (row=4, col=0) that later shifts
        // to (row=5, col=0) would collide with a new cell at the original
        // (row=4, col=0).
        let new_id = id_alloc.next_cell_id();
        let entry = CellEntry {
            value: CellValue::Null,
            formula: None,
        };

        // If position is within an active projection, register the CellId for
        // identity tracking only - do NOT write Null to col_data.
        if self
            .projection_registry
            .is_projected(sheet_id, pos.row(), pos.col())
        {
            if let Some(s) = self.sheets.get_mut(sheet_id) {
                s.cells.insert(new_id, entry);
                s.pos_to_id.insert(pos, new_id);
                s.id_to_pos.insert(new_id, pos);
                self.cell_to_sheet.insert(new_id, *sheet_id);
                s.expand_identity_extent(pos);
            }
            return Some(new_id);
        }

        // Normal path: full insert with col_data write
        self.insert_cell(sheet_id, new_id, pos, entry);
        Some(new_id)
    }

    /// Get or create a CellId at the given position, preserving `col_data`.
    ///
    /// Like `ensure_cell_id`, but registers identity mappings only - it does
    /// NOT write `Null` to `col_data`. This is critical for data table body
    /// cells whose cached XLSX values in `col_data` must survive until the
    /// prepass writes computed results.
    pub fn ensure_cell_id_identity_only(
        &mut self,
        sheet_id: &SheetId,
        pos: SheetPos,
        id_alloc: &IdAllocator,
    ) -> Option<CellId> {
        if let Some(id) = self.resolve_cell_id(sheet_id, pos) {
            return Some(id);
        }
        let new_id = id_alloc.next_cell_id();
        let entry = CellEntry {
            value: CellValue::Null,
            formula: None,
        };
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.cells.insert(new_id, entry);
            s.pos_to_id.insert(pos, new_id);
            s.id_to_pos.insert(new_id, pos);
            self.cell_to_sheet.insert(new_id, *sheet_id);
            s.expand_identity_extent(pos);
        }
        Some(new_id)
    }

    /// Register a pre-allocated ghost cell at the given position.
    ///
    /// Used by the parallel init path to flush ghost cells that were allocated
    /// concurrently via `ConcurrentIdentityResolver`. The CellId was already
    /// determined during parallel resolution, so we must use it exactly.
    ///
    /// No-op if a cell already exists at this position (race-safe).
    pub fn register_ghost_cell(&mut self, sheet_id: &SheetId, pos: SheetPos, cell_id: CellId) {
        // Skip if already registered
        if self.resolve_cell_id(sheet_id, pos).is_some() {
            return;
        }
        let entry = CellEntry {
            value: CellValue::Null,
            formula: None,
        };

        // If position is within an active projection, register the CellId for
        // identity tracking only - do NOT write Null to col_data.
        if self
            .projection_registry
            .is_projected(sheet_id, pos.row(), pos.col())
        {
            if let Some(s) = self.sheets.get_mut(sheet_id) {
                s.cells.insert(cell_id, entry);
                s.pos_to_id.insert(pos, cell_id);
                s.id_to_pos.insert(cell_id, pos);
                self.cell_to_sheet.insert(cell_id, *sheet_id);
                s.expand_identity_extent(pos);
            }
            return;
        }

        // Normal path: full insert with col_data write
        self.insert_cell(sheet_id, cell_id, pos, entry);
    }

    /// Register a pre-allocated CellId at the given position **for identity
    /// tracking only** - does NOT write `Null` into `col_data`.
    ///
    /// This is the right primitive for callers that need a stable CellId at a
    /// position (so it can be referenced later through `resolve_position` /
    /// `cell_id_at`) but where the position itself is logically empty:
    ///
    /// * Filter corner cells (autofilter `header_start` / `header_end` /
    ///   `data_end`) where the corner sits on an empty cell - writing
    ///   `CellValue::Null` would expand the sheet's identity extent and
    ///   confuse `is_blank` predicates, autofill, and `expand_extent`.
    /// * Any future "exists for refs purposes only" identity allocation.
    ///
    /// Compare with [`Self::register_ghost_cell`], which falls through to
    /// [`Self::insert_cell`] (writes `Null` to `col_data`) when the position
    /// is not under an active projection. That behaviour is correct for
    /// parallel-init ghost cells - those positions did carry data in the
    /// source XLSX and the `Null` write reserves the slot. It is *wrong* for
    /// filter corners on empty cells.
    ///
    /// Mirrors [`Self::ensure_cell_id_identity_only`], but takes a caller-
    /// supplied CellId (matching the `register_ghost_cell` shape).
    ///
    /// No-op if a cell already exists at this position.
    pub fn register_identity_only(&mut self, sheet_id: &SheetId, pos: SheetPos, cell_id: CellId) {
        if self.resolve_cell_id(sheet_id, pos).is_some() {
            return;
        }
        let entry = CellEntry {
            value: CellValue::Null,
            formula: None,
        };
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.cells.insert(cell_id, entry);
            s.pos_to_id.insert(pos, cell_id);
            s.id_to_pos.insert(cell_id, pos);
            self.cell_to_sheet.insert(cell_id, *sheet_id);
            s.expand_identity_extent(pos);
        }
    }
}
