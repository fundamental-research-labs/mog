use crate::cells::CellStore;
use crate::snapshot::MutationResult;
use crate::storage::engine::{formula_read, stores::EngineStores};
use crate::storage::sheet::hyperlinks;
use cell_types::SheetId;
use value_types::ComputeError;

pub(in crate::storage::engine) fn get_hyperlink(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<String> {
    let grid = cell_store.get_sheet(sheet_id)?;
    hyperlinks::get_hyperlink(&stores.storage, sheet_id, grid, row, col).or_else(|| {
        let id = grid
            .cell_id_at(cell_types::SheetPos::new(row, col))
            .or_else(|| cell_store.resolve_cell_id(sheet_id, cell_types::SheetPos::new(row, col)));
        let formula =
            formula_read::formula_text_at(stores, cell_store, sheet_id, row, col, id.as_ref())?;
        hyperlinks::hyperlink_formula_url(&formula)
    })
}

pub(in crate::storage::engine) fn set_hyperlink(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    url: &str,
) -> Result<MutationResult, ComputeError> {
    let id = super::super::cell_editing::ensure_cell_id(stores, cell_store, sheet_id, row, col)
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })?;
    let display = cell_store
        .get_cell_value_at(sheet_id, cell_types::SheetPos::new(row, col))
        .filter(|value| !value.is_null())
        .map(|value| value.to_string())
        .filter(|value| !value.is_empty());
    hyperlinks::set_hyperlink(&mut stores.storage, sheet_id, id, url, display);
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn remove_hyperlink(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Result<MutationResult, ComputeError> {
    if get_hyperlink(stores, cell_store, sheet_id, row, col).is_none() {
        return Err(ComputeError::InvalidInput {
            message: format!("hyperlink not found at row {row}, column {col}"),
        });
    }
    if let Some(id) = cell_store.resolve_cell_id(sheet_id, cell_types::SheetPos::new(row, col)) {
        hyperlinks::remove_hyperlink(&mut stores.storage, sheet_id, id);
    }
    Ok(MutationResult::empty())
}
