//! Formula-parser cell-reference resolution backed by [`CellMirror`].
//!
//! Both persisted formula registration and ephemeral expression evaluation
//! must resolve unqualified references against an explicit current worksheet.
//! Keeping that policy in one adapter prevents the two production paths from
//! drifting on identity-backed, positional, virtual, and named-sheet refs.

use crate::mirror::CellMirror;
use cell_types::{SheetId, SheetPos};
use compute_parser::CellRefResolver;
use formula_types::CellRef;

/// Resolve formula references against a mirror and an explicit current sheet.
pub(crate) struct MirrorCellRefResolver<'a> {
    pub mirror: &'a CellMirror,
    pub current_sheet: SheetId,
}

impl CellRefResolver for MirrorCellRefResolver<'_> {
    fn resolve(&self, sheet: &SheetId, row: u32, col: u32) -> CellRef {
        match self.mirror.resolve_cell_id(sheet, SheetPos::new(row, col)) {
            Some(cell_id) if !cell_id.is_virtual() => CellRef::Resolved(cell_id),
            // Large Range-backed cells use deterministic virtual CellIds that
            // are intentionally not all registered in the mirror. A resolved
            // endpoint must be reversible during evaluation, so keep virtual
            // and currently empty references positional.
            Some(_) | None => CellRef::Positional {
                sheet: *sheet,
                row,
                col,
            },
        }
    }

    fn resolve_sheet_name(&self, name: &str) -> Option<SheetId> {
        self.mirror.sheet_by_name(name)
    }

    fn current_sheet(&self) -> SheetId {
        self.current_sheet
    }
}
