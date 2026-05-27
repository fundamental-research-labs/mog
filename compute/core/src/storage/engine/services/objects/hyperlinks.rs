use crate::mirror::CellMirror;
use crate::snapshot::MutationResult;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::hyperlinks;
use cell_types::SheetId;
use value_types::ComputeError;

pub(in crate::storage::engine) fn set_hyperlink(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    url: &str,
) -> Result<MutationResult, ComputeError> {
    // Capture whether a cell already exists at this position before calling in;
    // `set_hyperlink` allocates a marker CellId via GridIndex when the slot is
    // empty, and we need to mirror that allocation into CellMirror.
    let pre_existing_id = stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|g| g.cell_id_at(row, col));

    let Some(grid) = stores.grid_indexes.get_mut(sheet_id) else {
        return Ok(MutationResult::empty());
    };
    hyperlinks::set_hyperlink(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        grid,
        row,
        col,
        url,
    );

    // If a new marker cell was allocated, mirror it into CellMirror so that
    // subsequent queries find it immediately.
    if pre_existing_id.is_none()
        && let Some(cell_id) = stores
            .grid_indexes
            .get(sheet_id)
            .and_then(|g| g.cell_id_at(row, col))
    {
        let pos = cell_types::SheetPos::new(row, col);
        mirror.apply_edit(sheet_id, cell_id, pos, value_types::CellValue::Null, None);
    }

    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn remove_hyperlink(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Result<MutationResult, ComputeError> {
    // Capture the (potential) marker CellId before removal; if the cell is
    // fully deleted below, its id will no longer resolve in the GridIndex.
    let pre_existing_id = stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|g| g.cell_id_at(row, col));

    let Some(grid) = stores.grid_indexes.get_mut(sheet_id) else {
        return Ok(MutationResult::empty());
    };
    hyperlinks::remove_hyperlink(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        grid,
        row,
        col,
    );

    // If the marker cell was deleted (no longer resolvable at the position),
    // also drop it from CellMirror.
    if let Some(cell_id) = pre_existing_id
        && stores
            .grid_indexes
            .get(sheet_id)
            .and_then(|g| g.cell_id_at(row, col))
            .is_none()
    {
        mirror.remove_cell(&cell_id);
    }

    Ok(MutationResult::empty())
}

// -------------------------------------------------------------------
// Pivot Tables
