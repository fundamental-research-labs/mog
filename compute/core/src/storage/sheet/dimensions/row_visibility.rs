use crate::identity::GridIndex;
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RowVisibilityOwnership {
    pub effective_hidden: bool,
    pub manual: bool,
    pub structural: bool,
    pub filter_owner_ids: BTreeSet<String>,
}

/// Manual and filter ownership coexist. Releasing one owner preserves the others.
pub fn hide_manual_rows(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    rows: &[u32],
    grid: Option<&GridIndex>,
) {
    if storage.history.is_active() {
        if let Some(grid) = grid {
            for id in rows.iter().filter_map(|row| grid.row_id(*row)) {
                crate::storage::engine::history::metadata::capture_hidden_row(
                    storage, *sheet_id, id,
                );
            }
        }
    }
    let (Some(meta), Some(grid)) = (storage.sheet_metadata.get_mut(sheet_id), grid) else {
        return;
    };
    meta.dimensions
        .manual_hidden_rows
        .extend(rows.iter().filter_map(|row| grid.row_id(*row)));
}

pub fn unhide_manual_rows(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    rows: &[u32],
    grid: Option<&GridIndex>,
) -> Vec<(u32, bool)> {
    if storage.history.is_active() {
        if let Some(grid) = grid {
            for id in rows.iter().filter_map(|row| grid.row_id(*row)) {
                crate::storage::engine::history::metadata::capture_hidden_row(
                    storage, *sheet_id, id,
                );
            }
        }
    }
    let (Some(meta), Some(grid)) = (storage.sheet_metadata.get_mut(sheet_id), grid) else {
        return vec![];
    };
    let state = &mut meta.dimensions;
    let mut transitions = Vec::new();
    for &row in rows {
        let Some(id) = grid.row_id(row) else {
            continue;
        };
        let before = state.row_hidden(&id);
        state.manual_hidden_rows.remove(&id);
        let after = state.row_hidden(&id);
        if before != after {
            transitions.push((row, after));
        }
    }
    transitions
}

pub fn set_filter_hidden_rows(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    filter_id: &str,
    rows_to_hide: &[u32],
    rows_to_release: &[u32],
    grid: Option<&GridIndex>,
) -> Vec<(u32, bool)> {
    update_filter_hidden_rows(
        storage,
        sheet_id,
        filter_id,
        rows_to_hide,
        rows_to_release,
        grid,
        false,
    )
}

/// XLSX has one hidden bit. Evaluated filter exclusions take ownership of imported
/// hidden rows; included rows retain their imported manual ownership.
pub fn normalize_imported_filter_hidden_rows(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    filter_id: &str,
    excluded: &[u32],
    included: &[u32],
    grid: Option<&GridIndex>,
) -> Vec<(u32, bool)> {
    update_filter_hidden_rows(storage, sheet_id, filter_id, excluded, included, grid, true)
}

fn update_filter_hidden_rows(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    filter_id: &str,
    hide: &[u32],
    release: &[u32],
    grid: Option<&GridIndex>,
    claim_imported: bool,
) -> Vec<(u32, bool)> {
    crate::storage::engine::history::metadata::capture_filter_hidden_rows(
        storage, *sheet_id, filter_id,
    );
    if claim_imported && storage.history.is_active() {
        if let Some(grid) = grid {
            for id in hide.iter().filter_map(|row| grid.row_id(*row)) {
                crate::storage::engine::history::metadata::capture_hidden_row(
                    storage, *sheet_id, id,
                );
            }
        }
    }
    let (Some(meta), Some(grid)) = (storage.sheet_metadata.get_mut(sheet_id), grid) else {
        return vec![];
    };
    let state = &mut meta.dimensions;
    let affected: BTreeSet<_> = hide.iter().chain(release).copied().collect();
    let before: Vec<_> = affected
        .into_iter()
        .filter_map(|row| Some((row, grid.row_id(row)?)))
        .map(|(row, id)| (row, id, state.row_hidden(&id)))
        .collect();
    let owner = state
        .filter_hidden_rows
        .entry(filter_id.to_owned())
        .or_default();
    for &row in hide {
        if let Some(id) = grid.row_id(row) {
            owner.insert(id);
            if claim_imported {
                state.manual_hidden_rows.remove(&id);
            }
        }
    }
    for &row in release {
        if let Some(id) = grid.row_id(row) {
            owner.remove(&id);
        }
    }
    if owner.is_empty() {
        state.filter_hidden_rows.remove(filter_id);
    }
    before
        .into_iter()
        .filter_map(|(row, id, before)| {
            let after = state.row_hidden(&id);
            (before != after).then_some((row, after))
        })
        .collect()
}

pub fn clear_filter_hidden_rows(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    filter_id: &str,
    grid: Option<&GridIndex>,
) -> Vec<(u32, bool)> {
    crate::storage::engine::history::metadata::capture_filter_hidden_rows(
        storage, *sheet_id, filter_id,
    );
    let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) else {
        return vec![];
    };
    let Some(rows) = meta.dimensions.filter_hidden_rows.remove(filter_id) else {
        return vec![];
    };
    let Some(grid) = grid else {
        return vec![];
    };
    let mut transitions: Vec<_> = rows
        .into_iter()
        .filter_map(|id| {
            (!meta.dimensions.row_hidden(&id))
                .then(|| grid.row_index(&id))
                .flatten()
                .map(|row| (row, false))
        })
        .collect();
    transitions.sort_unstable();
    transitions
}

pub fn get_row_visibility_ownership(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
    grid: Option<&GridIndex>,
) -> RowVisibilityOwnership {
    let structural = !super::super::grouping::is_row_visible_by_groups(storage, sheet_id, row);
    let state = storage
        .sheet_metadata
        .get(sheet_id)
        .map(|meta| &meta.dimensions);
    let row_id = grid.and_then(|grid| grid.row_id(row));
    let manual = state
        .zip(row_id)
        .is_some_and(|(state, id)| state.manual_hidden_rows.contains(&id));
    let filter_owner_ids: BTreeSet<_> = state
        .zip(row_id)
        .map(|(state, id)| {
            state
                .filter_hidden_rows
                .iter()
                .filter_map(|(owner, rows)| rows.contains(&id).then_some(owner.clone()))
                .collect()
        })
        .unwrap_or_default();
    RowVisibilityOwnership {
        effective_hidden: manual || structural || !filter_owner_ids.is_empty(),
        manual,
        structural,
        filter_owner_ids,
    }
}

pub fn is_row_hidden(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
    grid: Option<&GridIndex>,
) -> bool {
    let Some(id) = grid.and_then(|grid| grid.row_id(row)) else {
        return false;
    };
    storage
        .sheet_metadata
        .get(sheet_id)
        .is_some_and(|meta| meta.dimensions.row_hidden(&id))
}

pub fn get_hidden_rows(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    grid: Option<&GridIndex>,
) -> Vec<u32> {
    let (Some(meta), Some(grid)) = (storage.sheet_metadata.get(sheet_id), grid) else {
        return vec![];
    };
    meta.dimensions
        .manual_hidden_rows
        .iter()
        .chain(meta.dimensions.filter_hidden_rows.values().flatten())
        .filter_map(|id| grid.row_index(id))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

pub fn is_row_hidden_by_any_filter(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
    grid: Option<&GridIndex>,
) -> bool {
    is_row_hidden_by_any_filter_id(storage, sheet_id, grid.and_then(|grid| grid.row_id(row)))
}

/// Query filter ownership using a stable row identity without allocating an axis.
pub fn is_row_hidden_by_any_filter_id(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    row_id: Option<cell_types::RowId>,
) -> bool {
    let Some(id) = row_id else {
        return false;
    };
    storage.sheet_metadata.get(sheet_id).is_some_and(|meta| {
        meta.dimensions
            .filter_hidden_rows
            .values()
            .any(|rows| rows.contains(&id))
    })
}

#[cfg(test)]
pub fn is_row_manually_hidden(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
    grid: Option<&GridIndex>,
) -> bool {
    get_row_visibility_ownership(storage, sheet_id, row, grid).manual
}
#[cfg(test)]
pub fn is_row_hidden_by_filter(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
    filter_id: &str,
    grid: Option<&GridIndex>,
) -> bool {
    get_row_visibility_ownership(storage, sheet_id, row, grid)
        .filter_owner_ids
        .contains(filter_id)
}
