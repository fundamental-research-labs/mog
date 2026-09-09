use cell_types::SheetId;
use formula_types::CellRef;

use crate::cells::CellStore;

use super::sources::SourceFormula;

pub(super) struct DiagnosticResolver<'a> {
    pub(super) cell_store: &'a CellStore,
    pub(super) source: &'a SourceFormula,
}

impl compute_parser::CellRefResolver for DiagnosticResolver<'_> {
    fn resolve(&self, sheet: &SheetId, row: u32, col: u32) -> CellRef {
        self.cell_store
            .resolve_cell_id(sheet, cell_types::SheetPos::new(row, col))
            .map_or(
                CellRef::Positional {
                    sheet: *sheet,
                    row,
                    col,
                },
                CellRef::Resolved,
            )
    }

    fn resolve_sheet_name(&self, name: &str) -> Option<SheetId> {
        self.cell_store.sheet_by_name(name)
    }

    fn current_sheet(&self) -> SheetId {
        self.source.sheet_id.unwrap_or_else(|| SheetId::from_raw(0))
    }
}
