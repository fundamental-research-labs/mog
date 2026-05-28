mod named_range_mirror;
mod named_range_storage;
mod named_refs;
mod sheet_refs;
mod sheet_rename_storage;

use cell_types::{CellId, SheetId};

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

fn make_cell_id(n: u128) -> CellId {
    CellId::from_raw(n)
}
