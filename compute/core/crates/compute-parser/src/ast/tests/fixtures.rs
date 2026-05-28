use cell_types::{CellId, SheetId};
use formula_types::{CellRef, ExternalWorkbookToken};

pub(super) fn pos(row: u32, col: u32) -> CellRef {
    CellRef::positional(SheetId::from_raw(0), row, col)
}

pub(super) fn pos_on(sheet: u128, row: u32, col: u32) -> CellRef {
    CellRef::positional(SheetId::from_raw(sheet), row, col)
}

pub(super) fn resolved(raw: u128) -> CellRef {
    CellRef::resolved(CellId::from_raw(raw))
}

pub(super) fn workbook(token: &str) -> ExternalWorkbookToken {
    ExternalWorkbookToken::new(token.to_string())
}
