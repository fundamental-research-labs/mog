use cell_types::{CellId, SheetId, SheetPos};

use crate::mirror::CellMirror;
use crate::storage::engine::stores::EngineStores;

pub(in crate::storage::engine) fn find_cell_id_at(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellId> {
    stores.grid_indexes.get(sheet_id)?.cell_id_at(row, col)
}

/// Resolve existing authored, ghost, or virtual identities without mutating
/// indexes. Batch validation must finish before positions are registered.
pub(in crate::storage::engine) fn find_cell_id_at_mirrored(
    stores: &mut EngineStores,
    mirror: &crate::mirror::CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellId> {
    stores
        .grid_indexes
        .get(sheet_id)?
        .cell_id_at(row, col)
        .or_else(|| mirror.resolve_cell_id(sheet_id, SheetPos::new(row, col)))
}

// ---------------------------------------------------------------------------
pub(in crate::storage::engine) fn ensure_cell_id_mirrored(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellId> {
    let grid = stores.grid_indexes.get(sheet_id)?;
    let id = grid
        .cell_id_at(row, col)
        .or_else(|| mirror.resolve_cell_id(sheet_id, SheetPos::new(row, col)))
        .unwrap_or_else(|| stores.grid_id_alloc.next_cell_id());
    crate::storage::engine::history::cells::capture_cell(stores, mirror, *sheet_id, id, row, col);
    let grid = stores.grid_indexes.get_mut(sheet_id)?;
    grid.ensure_capacity(row, col);
    grid.register_cell(id, row, col);
    mirror.install_sheet_axes(*sheet_id, grid.row_axis(), grid.col_axis());
    mirror.register_identity_position(*sheet_id, SheetPos::new(row, col), id);
    Some(id)
}

/// Register native positions for cell identities referenced by a formula.
pub(in crate::storage::engine) fn register_formula_cell_identities(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    cell_id: CellId,
) {
    use formula_types::IdentityFormulaRef;
    let Some(identity) = mirror.get_formula(&cell_id) else {
        return;
    };
    for reference in &identity.refs {
        // Axis references already resolve through the shared native axes.
        let ids = match reference {
            IdentityFormulaRef::Cell(cell) => [Some(cell.id), None],
            IdentityFormulaRef::Range(range) => [Some(range.start_id), Some(range.end_id)],
            _ => [None, None],
        };
        for cell_id in ids.into_iter().flatten() {
            let Some(sheet_id) = mirror.sheet_for_cell(&cell_id) else {
                continue;
            };
            let Some(pos) = mirror.resolve_position(&cell_id) else {
                continue;
            };
            if let Some(grid) = stores.grid_indexes.get_mut(&sheet_id) {
                grid.ensure_capacity(pos.row(), pos.col());
                grid.register_cell(cell_id, pos.row(), pos.col());
            }
        }
    }
}
