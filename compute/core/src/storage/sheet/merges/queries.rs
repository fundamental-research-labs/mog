use crate::identity::GridIndex;
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use domain_types::domain::merge::{CellMergeInfo, ResolvedMergedRegion};

pub fn get_all_merges(
    storage: &WorkbookStorage,
    sheet_id: SheetId,
    grid: &GridIndex,
) -> Vec<ResolvedMergedRegion> {
    let Some(meta) = storage.sheet_metadata.get(&sheet_id) else {
        return vec![];
    };
    let mut result: Vec<_> = meta
        .merges
        .iter()
        .filter_map(|entry| Some((entry.ord.unwrap_or(u32::MAX), entry.resolve(grid)?)))
        .collect();
    result.sort_by_key(|(order, _)| *order);
    result.into_iter().map(|(_, merge)| merge).collect()
}

pub fn iter_merge_bounds(
    storage: &WorkbookStorage,
    sheet_id: SheetId,
    grid: &GridIndex,
) -> Vec<(u32, u32, u32, u32)> {
    get_all_merges(storage, sheet_id, grid)
        .into_iter()
        .map(|merge| {
            (
                merge.start_row,
                merge.start_col,
                merge.end_row,
                merge.end_col,
            )
        })
        .collect()
}

pub fn get_merges_in_range(
    storage: &WorkbookStorage,
    sheet_id: SheetId,
    grid: &GridIndex,
    sr: u32,
    sc: u32,
    er: u32,
    ec: u32,
) -> Vec<ResolvedMergedRegion> {
    get_all_merges(storage, sheet_id, grid)
        .into_iter()
        .filter(|merge| {
            merge.start_row <= er
                && merge.end_row >= sr
                && merge.start_col <= ec
                && merge.end_col >= sc
        })
        .collect()
}

pub fn get_merge_for_cell(
    storage: &WorkbookStorage,
    sheet_id: SheetId,
    grid: &GridIndex,
    row: u32,
    col: u32,
) -> Option<CellMergeInfo> {
    get_merges_in_range(storage, sheet_id, grid, row, col, row, col)
        .into_iter()
        .next()
        .map(|merge| CellMergeInfo {
            is_origin: row == merge.start_row && col == merge.start_col,
            merge,
        })
}

pub fn is_merge_origin(
    storage: &WorkbookStorage,
    sheet_id: SheetId,
    grid: &GridIndex,
    row: u32,
    col: u32,
) -> bool {
    let Some(id) = grid.cell_id_at(row, col) else {
        return false;
    };
    storage.sheet_metadata.get(&sheet_id).is_some_and(|meta| {
        meta.merges
            .iter()
            .any(|merge| merge.top_left_id == id && merge.resolve(grid).is_some())
    })
}
