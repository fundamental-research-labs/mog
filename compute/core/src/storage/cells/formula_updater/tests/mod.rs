mod named_range_mirror;
mod named_range_storage;
mod named_refs;
mod sheet_refs;

use cell_types::{CellId, SheetId};

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

fn make_cell_id(n: u128) -> CellId {
    CellId::from_raw(n)
}

fn update_mirror_formulas_on_named_range_rename(
    mirror: &mut crate::mirror::CellMirror,
    old_name: &str,
    new_name: &str,
) -> Vec<cell_types::CellId> {
    super::update_mirror_formulas_on_named_range_rename(mirror, |_, _, template| {
        super::named_refs::replace_name_in_formula(template, old_name, new_name)
    })
}
