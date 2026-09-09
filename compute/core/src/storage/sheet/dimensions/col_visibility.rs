use crate::identity::GridIndex;
use crate::storage::WorkbookStorage;
use cell_types::SheetId;

pub fn hide_columns(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cols: &[u32],
    grid: Option<&GridIndex>,
) {
    if storage.history.is_active() {
        if let Some(grid) = grid {
            for id in cols.iter().filter_map(|col| grid.col_id(*col)) {
                crate::storage::engine::history::metadata::capture_hidden_column(
                    storage, *sheet_id, id,
                );
            }
        }
    }
    let (Some(meta), Some(grid)) = (storage.sheet_metadata.get_mut(sheet_id), grid) else {
        return;
    };
    for &col in cols {
        if let Some(id) = grid.col_id(col) {
            meta.dimensions.hidden_columns.insert(id);
        }
    }
}
pub fn unhide_columns(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cols: &[u32],
    grid: Option<&GridIndex>,
) {
    if storage.history.is_active() {
        if let Some(grid) = grid {
            for id in cols.iter().filter_map(|col| grid.col_id(*col)) {
                crate::storage::engine::history::metadata::capture_hidden_column(
                    storage, *sheet_id, id,
                );
            }
        }
    }
    let (Some(meta), Some(grid)) = (storage.sheet_metadata.get_mut(sheet_id), grid) else {
        return;
    };
    for &col in cols {
        if let Some(id) = grid.col_id(col) {
            meta.dimensions.hidden_columns.remove(&id);
        }
    }
}
pub fn is_column_hidden(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    col: u32,
    grid: Option<&GridIndex>,
) -> bool {
    let Some(id) = grid.and_then(|grid| grid.col_id(col)) else {
        return false;
    };
    storage
        .sheet_metadata
        .get(sheet_id)
        .is_some_and(|meta| meta.dimensions.hidden_columns.contains(&id))
}
pub fn get_hidden_columns(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    grid: Option<&GridIndex>,
) -> Vec<u32> {
    let (Some(meta), Some(grid)) = (storage.sheet_metadata.get(sheet_id), grid) else {
        return vec![];
    };
    let mut cols: Vec<_> = meta
        .dimensions
        .hidden_columns
        .iter()
        .filter_map(|id| grid.col_index(id))
        .collect();
    cols.sort_unstable();
    cols
}
