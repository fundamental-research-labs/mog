use cell_types::{CellId, IdAllocator, SheetId, SheetPos};
use value_types::CellValue;

use crate::cells::cell_store::CellStore;
use crate::cells::types::CellEntry;

impl CellStore {
    /// Allocate a metadata anchor without creating a value entry.
    pub fn ensure_identity_at(&mut self, sheet_id: &SheetId, pos: SheetPos) -> Option<CellId> {
        if !self.sheets.contains_key(sheet_id) {
            return None;
        }
        let cell_id = self
            .resolve_cell_id(sheet_id, pos)
            .unwrap_or_else(|| self.id_alloc.next_cell_id());
        self.register_identity_position(*sheet_id, pos, cell_id);
        Some(cell_id)
    }

    /// Register an existing identity without allocating a value entry.
    pub(crate) fn register_identity_position(
        &mut self,
        sheet_id: SheetId,
        pos: SheetPos,
        cell_id: CellId,
    ) {
        let Some(target) = self.sheets.get(&sheet_id) else {
            return;
        };
        if let Some(displaced) = target.authored_cell_id_at(pos).filter(|id| *id != cell_id) {
            self.remove_cell(&displaced);
        }
        if self
            .cell_to_sheet
            .get(&cell_id)
            .is_some_and(|old| *old != sheet_id)
        {
            self.remove_cell(&cell_id);
        }
        let sheet = self.sheets.get_mut(&sheet_id).unwrap();
        let grew = sheet.row_id_at(pos.row()).is_none() || sheet.col_id_at(pos.col()).is_none();
        sheet.register_cell(cell_id, pos.row(), pos.col());
        sheet.expand_identity_extent(pos);
        self.cell_to_sheet.insert(cell_id, sheet_id);
        if grew {
            self.refresh_axis_ownership(sheet_id);
        }
    }

    /// Get or create an authored identity, preserving projected values.
    pub fn ensure_cell_id(
        &mut self,
        sheet_id: &SheetId,
        pos: SheetPos,
        id_alloc: &IdAllocator,
    ) -> Option<CellId> {
        if !self.sheets.contains_key(sheet_id) {
            return None;
        }
        if let Some(id) = self.resolve_cell_id(sheet_id, pos) {
            self.register_identity_position(*sheet_id, pos, id);
            return Some(id);
        }
        let id = id_alloc.next_cell_id();
        self.register_ghost_cell(sheet_id, pos, id);
        Some(id)
    }

    /// Allocate an identity while keeping imported and projected values intact.
    pub fn ensure_cell_id_identity_only(
        &mut self,
        sheet_id: &SheetId,
        pos: SheetPos,
        id_alloc: &IdAllocator,
    ) -> Option<CellId> {
        if !self.sheets.contains_key(sheet_id) {
            return None;
        }
        if let Some(id) = self.resolve_cell_id(sheet_id, pos) {
            self.register_identity_position(*sheet_id, pos, id);
            return Some(id);
        }
        let id = id_alloc.next_cell_id();
        self.register_identity_only(sheet_id, pos, id);
        Some(id)
    }

    /// Flush an identity allocated during parallel formula resolution.
    pub fn register_ghost_cell(&mut self, sheet_id: &SheetId, pos: SheetPos, cell_id: CellId) {
        if let Some(existing) = self.resolve_cell_id(sheet_id, pos) {
            self.register_identity_position(*sheet_id, pos, existing);
            return;
        }
        if self
            .projection_registry
            .is_projected(sheet_id, pos.row(), pos.col())
        {
            self.register_identity_only(sheet_id, pos, cell_id);
        } else {
            self.insert_cell(
                sheet_id,
                cell_id,
                pos,
                CellEntry {
                    value: CellValue::Null,
                },
            );
        }
    }

    /// Register a preallocated reference without changing the visible value extent.
    pub fn register_identity_only(&mut self, sheet_id: &SheetId, pos: SheetPos, cell_id: CellId) {
        if let Some(existing) = self.resolve_cell_id(sheet_id, pos) {
            self.register_identity_position(*sheet_id, pos, existing);
            return;
        }
        self.register_identity_position(*sheet_id, pos, cell_id);
        if let Some(sheet) = self.sheets.get_mut(sheet_id) {
            sheet.cells.entry(cell_id).or_insert(CellEntry {
                value: CellValue::Null,
            });
        }
    }
}
